import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { withTimeout } from "@/features/auth/async-timeout";
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

/**
 * AP6: 設定トグルの revoke/reaccept（+ 再読）上限。
 * never-settle で switch が disabled のまま固着し「協力を止める」が完了不能になるのを防ぐ。
 * privacy accept（PRIVACY_ACCEPT_TIMEOUT_MS）と同値。
 */
export const SHARE_CONSENT_TOGGLE_TIMEOUT_MS = 10_000;

/**
 * AP-R1: abort 直後の 1 回再読だけでは、到達済み upsert の commit 前 OFF を信じうる。
 * 初回を含む再読回数。ロックの 10s 本体は変えない。
 */
export const SHARE_CONSENT_RECONCILE_ATTEMPTS = 3;

/** AP-R1: 再読間隔。即時再読だけだとまだ revoked の窓を閉じられない。 */
export const SHARE_CONSENT_RECONCILE_RETRY_DELAY_MS = 1_000;

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
  // AP5: timeout 後の遅延成功で cache が正になったら saveError を隠す
  const lastToggleIntentRef = useRef<boolean | null>(null);
  // AP-R1: 再読が全部失敗したらオフ確定せず mixed のまま再読する
  const [consentReconcileUnconfirmed, setConsentReconcileUnconfirmed] = useState(false);
  const consentReconcileUnconfirmedAtRef = useRef(0);
  const toggleInputRef = useRef<HTMLInputElement | null>(null);

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

  // AP-R1: 未確定より後の再読成功だけ mixed を解く（旧 cache の isSuccess では解かない）
  useEffect(() => {
    if (!consentReconcileUnconfirmed) return;
    if (injectedConsent !== undefined) {
      setConsentReconcileUnconfirmed(false);
      return;
    }
    if (
      consentQuery.isSuccess &&
      consentQuery.dataUpdatedAt > consentReconcileUnconfirmedAtRef.current
    ) {
      setConsentReconcileUnconfirmed(false);
    }
  }, [
    consentReconcileUnconfirmed,
    consentQuery.dataUpdatedAt,
    consentQuery.isSuccess,
    injectedConsent,
  ]);

  useEffect(() => {
    if (toggleInputRef.current !== null) {
      toggleInputRef.current.indeterminate = consentReconcileUnconfirmed;
    }
  }, [consentReconcileUnconfirmed]);

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
      lastToggleIntentRef.current = nextEnabled;
      setConsentReconcileUnconfirmed(false);
      const abortController = new AbortController();
      const abortToggle = (): void => {
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
      };
      const applyFreshConsent = (fresh: ShareConsentState): void => {
        if (generation === mutationGenerationRef.current) {
          queryClient.setQueryData(shareConsentKeys.current(userId), fresh);
          setConsentReconcileUnconfirmed(false);
        }
      };
      const notifyOtherTabs = (): void => {
        if (typeof BroadcastChannel === "undefined") return;
        try {
          const channel = new BroadcastChannel(SHARE_CONSENT_BROADCAST_CHANNEL);
          channel.postMessage({ userId, at: Date.now() });
          channel.close();
        } catch {
          // BroadcastChannel 失敗は focus 再同期に委ねる
        }
      };

      if (onToggle !== undefined) {
        // AP6: 注入ハンドラも同上限（テストの never-settle と本番 RPC を揃える）
        await withTimeout(onToggle(nextEnabled), SHARE_CONSENT_TOGGLE_TIMEOUT_MS, abortToggle);
        return { nextEnabled, generation };
      }
      const client = getBrowserSupabaseClient();
      // off → revoke、on → 現行 version で reaccept（upsert 本体は API 側）
      // AP6: never-settle で switch disabled 固着を防ぐ（timeout → saveError + 再有効化）
      // AP5: timeout 時に in-flight upsert を abort し、UI オフのままサーバ ON を残さない
      const upsertPromise = nextEnabled
        ? reacceptMyShareConsent(client, { signal: abortController.signal })
        : revokeMyShareConsent(client, { signal: abortController.signal });

      try {
        const next = await withTimeout(upsertPromise, SHARE_CONSENT_TOGGLE_TIMEOUT_MS, abortToggle);
        // AP12: 古い mutation の応答は捨て、最新世代だけ cache を更新する
        if (generation !== mutationGenerationRef.current) {
          return { nextEnabled, generation, discarded: true as const };
        }
        // サーバ再読で最終状態を正とする（他タブ完了分を拾う）
        // AP6: 再読も同上限。timeout/失敗時は mutation 結果 next にフォールバック（同意操作自体は成功扱い）
        try {
          const fresh = await withTimeout(
            getMyShareConsent(client),
            SHARE_CONSENT_TOGGLE_TIMEOUT_MS,
          );
          applyFreshConsent(fresh);
        } catch {
          applyFreshConsent(next);
        }
        notifyOtherTabs();
        return { nextEnabled, generation };
      } catch (error) {
        // AP5: abort 後もサーバ処理済みになり得る。再読で cache を正にし、一致なら成功扱い。
        // AP-R1: 1 回目 OFF / throw でも遅延 commit を取りこぼさないよう再読する。
        if (generation !== mutationGenerationRef.current) {
          throw error;
        }
        let sawSuccessfulRead = false;
        for (let attempt = 0; attempt < SHARE_CONSENT_RECONCILE_ATTEMPTS; attempt += 1) {
          if (generation !== mutationGenerationRef.current) {
            throw error;
          }
          try {
            const fresh = await withTimeout(
              getMyShareConsent(client),
              SHARE_CONSENT_TOGGLE_TIMEOUT_MS,
            );
            sawSuccessfulRead = true;
            applyFreshConsent(fresh);
            if (hasCurrentShareConsent(fresh) === nextEnabled) {
              notifyOtherTabs();
              return { nextEnabled, generation, reconciled: true as const };
            }
          } catch {
            // この回の再読失敗。残回数でサーバを再確認する
          }
          if (attempt < SHARE_CONSENT_RECONCILE_ATTEMPTS - 1) {
            await waitMs(SHARE_CONSENT_RECONCILE_RETRY_DELAY_MS);
          }
        }
        if (!sawSuccessfulRead && generation === mutationGenerationRef.current) {
          // 再読が全部失敗: オフ表示のままサーバ ON を残さない
          consentReconcileUnconfirmedAtRef.current = Date.now();
          setConsentReconcileUnconfirmed(true);
          void queryClient.invalidateQueries({ queryKey: shareConsentKeys.current(userId) });
        }
        // abort が効かない SDK 向けに遅延成功で cache を正にする
        void upsertPromise.then(applyFreshConsent).catch(() => undefined);
        throw error;
      }
    },
  });

  const pending = toggleMutation.isPending;
  // AP5: 遅延成功で cache が意図状態になったら、timeout の saveError を残さない
  // AP-R1: 未確定中はオフ+saveError にせず mixed を出す
  const showSaveError =
    !consentReconcileUnconfirmed &&
    toggleMutation.isError &&
    (lastToggleIntentRef.current === null || enabled !== lastToggleIntentRef.current);
  // オフ状態では常時。オンからオフへ操作中も「既提供分は残る」を再表示（§7.2）
  const showResidual = !enabled || (pending && enabled);

  return (
    <section className="card stack settings-section" aria-labelledby="share-consent-settings-title">
      <h2 id="share-consent-settings-title" className="settings-section-title">
        {shareConsentSettingsCopy.title}
      </h2>

      <p className="type-small">{shareConsentSettingsCopy.help}</p>
      {/* AP6: オフ時だけ必須同意フレーズを見せ、設定トグルだけで見ずに accept しない */}
      {!enabled ? <p className="type-small">{shareConsentSettingsCopy.acceptDisclosure}</p> : null}

      {consentLoading && consent === null ? (
        <p role="status">{shareConsentSettingsCopy.consentLoading}</p>
      ) : null}
      {consentError && consent === null && !consentReconcileUnconfirmed ? (
        <p role="alert">{shareConsentSettingsCopy.consentError}</p>
      ) : null}

      {consent !== null || !consentLoading || consentReconcileUnconfirmed ? (
        <div className="stack gap-2">
          <label className="inline-flex min-h-11 items-center gap-2" htmlFor={toggleId}>
            <input
              id={toggleId}
              ref={toggleInputRef}
              type="checkbox"
              role="switch"
              className="min-h-11 min-w-11"
              checked={consentReconcileUnconfirmed ? false : enabled}
              aria-checked={consentReconcileUnconfirmed ? "mixed" : enabled}
              aria-describedby={showResidual ? residualId : undefined}
              disabled={
                pending || consentReconcileUnconfirmed || (consentError && consent === null)
              }
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
          {consentReconcileUnconfirmed ? (
            <div className="stack gap-2">
              <p role="alert">{shareConsentSettingsCopy.reconcileUnconfirmed}</p>
              <button
                type="button"
                className="secondary-button min-h-11"
                onClick={() => {
                  void queryClient.invalidateQueries({
                    queryKey: shareConsentKeys.current(userId),
                  });
                }}
              >
                {shareConsentSettingsCopy.reconcileRetry}
              </button>
            </div>
          ) : null}
          {showSaveError ? <p role="alert">{shareConsentSettingsCopy.saveError}</p> : null}
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
