import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef } from "react";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { shareConsentSettingsCopy } from "./privacy-copy";
import {
  getMyShareConsent,
  hasCurrentShareConsent,
  listMySharedEmergencyRecipes,
  reacceptMyShareConsent,
  revokeMyShareConsent,
  type ShareConsentState,
  type SharedEmergencyRecipeListItem,
} from "./share-consent-api";
import { shareConsentKeys } from "./share-consent-queries";

/** AP12: 跨タブで同意 cache を invalidate するための BroadcastChannel 名 */
export const SHARE_CONSENT_BROADCAST_CHANNEL = "kondate:share-consent";

export type ShareConsentSettingsSectionProps = {
  userId: string;
  /** テスト注入。省略時は RPC 経由。 */
  consent?: ShareConsentState | null;
  consentLoading?: boolean;
  consentError?: boolean;
  sharedList?: SharedEmergencyRecipeListItem[] | null;
  sharedListLoading?: boolean;
  sharedListError?: boolean;
  onToggle?: (nextEnabled: boolean) => Promise<void>;
};

/** shared_on "YYYY-MM-DD" を Asia/Tokyo の日付表示に（時刻なし）。 */
function formatSharedOn(sharedOn: string): string {
  // 日付のみなので UTC 正午相当でパースし、タイムゾーンずれで前日に落ちないようにする
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      dateStyle: "long",
    }).format(new Date(`${sharedOn}T12:00:00+09:00`));
  } catch {
    return sharedOn;
  }
}

/**
 * 家族設定ページに合成する共有同意トグルと提供管理一覧。
 * トグル off → revoke（既提供分は残る文言を再表示）、on → 現行 version で reaccept。
 * 一覧は title + shared_on のみ（個別取り下げはこの版のスコープ外）。
 *
 * AP12: 跨タブ race の最小防衛 — 操作世代ガード + 完了後サーバ再読 + focus/Broadcast で再同期。
 * サーバは last-write-wins のまま。UI が「止めた」表示のままサーバだけ復活するずれを縮める。
 */
export function ShareConsentSettingsSection({
  userId,
  consent: injectedConsent,
  consentLoading: injectedConsentLoading,
  consentError: injectedConsentError,
  sharedList: injectedList,
  sharedListLoading: injectedListLoading,
  sharedListError: injectedListError,
  onToggle,
}: ShareConsentSettingsSectionProps) {
  const queryClient = useQueryClient();
  const toggleId = useId();
  const residualId = useId();
  // AP12: 同一タブ内の遅延応答が古い mutation 結果で cache を上書きしない
  const mutationGenerationRef = useRef(0);

  const consentQuery = useQuery({
    queryKey: shareConsentKeys.current(userId),
    queryFn: () => getMyShareConsent(getBrowserSupabaseClient()),
    enabled: injectedConsent === undefined,
  });
  const listQuery = useQuery({
    queryKey: shareConsentKeys.sharedList(userId),
    queryFn: () => listMySharedEmergencyRecipes(getBrowserSupabaseClient()),
    enabled: injectedList === undefined,
  });

  // AP12: 他タブの完了・フォーカス復帰でサーバ正を再取得（注入モードでは no-op）
  useEffect(() => {
    if (injectedConsent !== undefined) return;
    const invalidate = (): void => {
      void queryClient.invalidateQueries({ queryKey: shareConsentKeys.current(userId) });
    };
    const onFocus = (): void => {
      invalidate();
    };
    window.addEventListener("focus", onFocus);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(SHARE_CONSENT_BROADCAST_CHANNEL);
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (data === null || typeof data !== "object" || !("userId" in data)) return;
        // unknown 経由で userId を取り、他ユーザー向け通知は無視する
        const messageUserId: unknown = Reflect.get(data, "userId");
        if (messageUserId === userId) {
          invalidate();
        }
      };
    }

    return () => {
      window.removeEventListener("focus", onFocus);
      channel?.close();
    };
  }, [injectedConsent, queryClient, userId]);

  const consent = injectedConsent !== undefined ? injectedConsent : (consentQuery.data ?? null);
  const consentLoading =
    injectedConsentLoading !== undefined
      ? injectedConsentLoading
      : consentQuery.isPending || consentQuery.isFetching;
  const consentError =
    injectedConsentError !== undefined ? injectedConsentError : consentQuery.isError;

  const sharedList = injectedList !== undefined ? injectedList : (listQuery.data ?? null);
  const sharedListLoading =
    injectedListLoading !== undefined
      ? injectedListLoading
      : listQuery.isPending || listQuery.isFetching;
  const sharedListError = injectedListError !== undefined ? injectedListError : listQuery.isError;

  const enabled = hasCurrentShareConsent(consent);

  const toggleMutation = useMutation({
    mutationFn: async (nextEnabled: boolean) => {
      const generation = ++mutationGenerationRef.current;
      if (onToggle !== undefined) {
        await onToggle(nextEnabled);
        return { nextEnabled, generation };
      }
      const client = getBrowserSupabaseClient();
      // off → revoke、on → 現行 version で reaccept（upsert 本体は API 側）
      const next = nextEnabled
        ? await reacceptMyShareConsent(client)
        : await revokeMyShareConsent(client);
      // AP12: 古い mutation の応答は捨て、最新世代だけ cache を更新する
      if (generation !== mutationGenerationRef.current) {
        return { nextEnabled, generation, discarded: true as const };
      }
      // サーバ再読で最終状態を正とする（他タブ完了分を拾う）
      try {
        const fresh = await getMyShareConsent(client);
        if (generation === mutationGenerationRef.current) {
          queryClient.setQueryData(shareConsentKeys.current(userId), fresh);
        }
      } catch {
        if (generation === mutationGenerationRef.current) {
          queryClient.setQueryData(shareConsentKeys.current(userId), next);
        }
      }
      // 他タブへ invalidate 通知
      if (typeof BroadcastChannel !== "undefined") {
        try {
          const channel = new BroadcastChannel(SHARE_CONSENT_BROADCAST_CHANNEL);
          channel.postMessage({ userId, at: Date.now() });
          channel.close();
        } catch {
          // BroadcastChannel 失敗は focus 再同期に委ねる
        }
      }
      return { nextEnabled, generation };
    },
  });

  const pending = toggleMutation.isPending;
  // オフ状態では常時。オンからオフへ操作中も「既提供分は残る」を再表示（§7.2）
  const showResidual = !enabled || (pending && enabled);

  return (
    <section className="card stack settings-section" aria-labelledby="share-consent-settings-title">
      <h2 id="share-consent-settings-title" className="settings-section-title">
        {shareConsentSettingsCopy.title}
      </h2>

      <p className="type-small">{shareConsentSettingsCopy.help}</p>

      {consentLoading && consent === null ? (
        <p role="status">{shareConsentSettingsCopy.consentLoading}</p>
      ) : null}
      {consentError && consent === null ? (
        <p role="alert">{shareConsentSettingsCopy.consentError}</p>
      ) : null}

      {consent !== null || !consentLoading ? (
        <div className="stack gap-2">
          <label className="inline-flex min-h-11 items-center gap-2" htmlFor={toggleId}>
            <input
              id={toggleId}
              type="checkbox"
              role="switch"
              className="min-h-11 min-w-11"
              checked={enabled}
              aria-checked={enabled}
              aria-describedby={showResidual ? residualId : undefined}
              disabled={pending || (consentError && consent === null)}
              onChange={(event) => {
                const next = event.target.checked;
                // 楽観表示はせず、RPC 結果で query cache を更新する
                toggleMutation.mutate(next);
              }}
            />
            {shareConsentSettingsCopy.toggleLabel}
          </label>
          {/* オフ時（およびオフ操作中）に既提供分の残存を再表示（§7.2） */}
          {showResidual ? (
            <p id={residualId} className="type-small" role="status">
              {shareConsentSettingsCopy.residualRetentionNotice}
            </p>
          ) : null}
          {toggleMutation.isError ? <p role="alert">{shareConsentSettingsCopy.saveError}</p> : null}
        </div>
      ) : null}

      <div className="stack gap-2" aria-labelledby="share-consent-shared-list-title">
        <h3 id="share-consent-shared-list-title" className="settings-section-title">
          {shareConsentSettingsCopy.sharedListTitle}
        </h3>
        {sharedListLoading && sharedList === null ? (
          <p role="status">{shareConsentSettingsCopy.sharedListLoading}</p>
        ) : null}
        {sharedListError && sharedList === null ? (
          <p role="alert">{shareConsentSettingsCopy.sharedListError}</p>
        ) : null}
        {sharedList !== null ? (
          sharedList.length === 0 ? (
            <p className="type-small">{shareConsentSettingsCopy.sharedListEmpty}</p>
          ) : (
            <ul className="stack gap-2">
              {/* title+date は非一意になり得る（recipe_id は意図的に非公開）ため index を併用 */}
              {sharedList.map((item, index) => (
                <li key={`${item.shared_on}:${item.title}:${String(index)}`}>
                  <strong>{item.title}</strong>
                  <p className="type-small">{formatSharedOn(item.shared_on)}</p>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </section>
  );
}
