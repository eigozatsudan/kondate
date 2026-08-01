import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
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
      if (onToggle !== undefined) {
        await onToggle(nextEnabled);
        return nextEnabled;
      }
      const client = getBrowserSupabaseClient();
      // off → revoke、on → 現行 version で reaccept（upsert 本体は API 側）
      const next = nextEnabled
        ? await reacceptMyShareConsent(client)
        : await revokeMyShareConsent(client);
      queryClient.setQueryData(shareConsentKeys.current(userId), next);
      return nextEnabled;
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
              {sharedList.map((item) => (
                <li key={`${item.shared_on}:${item.title}`}>
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
