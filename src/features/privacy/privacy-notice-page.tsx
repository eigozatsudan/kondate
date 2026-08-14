import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { isCurrentShareConsent } from "@shared/contracts/share-consent";
import { withTimeout } from "@/features/auth/async-timeout";
import { useAuth } from "@/features/auth/use-auth";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { sanitizeReturnPath } from "@/features/auth/auth-flow";
import { acceptCurrentPrivacyConsent } from "./privacy-api";
import { privacySections, providerExplanation, shareConsentSection } from "./privacy-copy";
import { privacyKeys } from "./privacy-queries";
import {
  getMyShareConsent,
  hasCurrentShareConsent,
  upsertMyShareConsent,
  type ShareConsentState,
} from "./share-consent-api";
import { shareConsentKeys } from "./share-consent-queries";
import { SHARE_CONSENT_BROADCAST_CHANNEL } from "./share-consent-settings-section";

/**
 * AP8: privacy accept（PostgREST）の上限。
 * never-settle で saving 固着し「今はAIを使わない」も disabled のままになるのを防ぐ。
 */
export const PRIVACY_ACCEPT_TIMEOUT_MS = 10_000;

/** 必須チェック未入力のまま primary を押したときの案内（disabled だと理由が伝わらないため） */
export const privacyConsentCheckboxRequiredMessage =
  "「説明を確認しました」にチェックを入れてから進んでください。";

export type PrivacyAcceptInput = {
  /**
   * 共有任意チェック。
   * true → 単独再読が現行/未同意なら upsert(true)。未タッチの再読失敗・fresh revoke は書かない。
   * false かつ利用者がオフにした場合だけ、現行同意なら upsert(false)。
   * 未タッチのオフ追従 / 未同意 / 既 revoke は upsert しない。
   */
  shareConsentAccepted: boolean;
  /**
   * AP7: 利用者が共有チェックを手で触ったか。
   * 未指定は未タッチ扱い（Content 単体の省略互換）。
   */
  shareConsentTouched?: boolean;
};

/**
 * AP1: 共有チェック初期値。
 * 有効同意 → true、revoke 済み（行はあるが current でない）→ false、
 * 未同意（null フィールド）→ true（初回推奨既定）。
 * data 無し（pending / 初回 error）では false（revoke 済みを default true で出さない — AP10）。
 * AP12: success 後の refetch error は v5 が直前 data を残す。isSuccess が false でも
 * その data を使い、未タッチのボックスをオフ追従させない。
 */
function initialShareCheckedFromConsent(state: ShareConsentState | undefined): boolean {
  if (state === undefined) return false;
  if (state.consent_version === null) return true;
  return isCurrentShareConsent({
    consent_version: state.consent_version,
    revoked_at: state.revoked_at,
  });
}

export function PrivacyNoticePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const userId = auth.session?.user.id;
  const returnTo = sanitizeReturnPath(params.get("returnTo"));
  const shareQuery = useQuery({
    queryKey: shareConsentKeys.current(userId ?? ""),
    queryFn: () => getMyShareConsent(getBrowserSupabaseClient()),
    enabled: userId !== undefined,
    // AP7: AppProviders の 30s だと設定/他タブ revoke 後も accepted cache が fresh のまま残る
    staleTime: 0,
  });
  // AP7: 設定と同型。他タブ revoke / フォーカス復帰でサーバ正を再取得する
  useEffect(() => {
    if (userId === undefined) return;
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
  }, [queryClient, userId]);
  // isFetched: 成功・失敗どちらでも読取は終わっている。disabled（未ログイン）は false。
  const shareConsentReady = shareQuery.isFetched;
  const initialShareChecked = initialShareCheckedFromConsent(shareQuery.data);
  const mutation = useMutation({
    mutationFn: async (input: PrivacyAcceptInput) => {
      if (userId === undefined) throw new Error("ログインが必要です");
      const client = getBrowserSupabaseClient();
      // privacy は必須。共有は読取完了後だけ別 RPC。
      // 共有 RPC 失敗で必須 privacy 同意を巻き戻さない・画面遷移を止めない（設定で再同意可）。
      // AP8: accept 全体を withTimeout（skip 導線が永久 disabled にならないようにする）
      const consent = await withTimeout(
        acceptCurrentPrivacyConsent(client, userId),
        PRIVACY_ACCEPT_TIMEOUT_MS,
      );
      const shareState = queryClient.getQueryState(shareConsentKeys.current(userId));
      const shareSettled = shareState?.status === "success" || shareState?.status === "error";
      // pending 中は share 分岐を走らせない（default true 再 accept を残さない）
      if (shareSettled) {
        let current = queryClient.getQueryData<ShareConsentState>(shareConsentKeys.current(userId));
        let freshReadFailed = false;
        // AP11: 同一キー fetchQuery は mount/focus の in-flight accepted に合流する。
        // 単独 RPC なら revoke 後のサーバ正を読める。throw / timeout は cache を accept 根拠にしない。
        if (input.shareConsentAccepted) {
          try {
            current = await withTimeout(getMyShareConsent(client), PRIVACY_ACCEPT_TIMEOUT_MS);
            // AP13: 単独再読の成功値は cache に載せる（revoked / accepted とも）。
            // 遅延 mount の accepted が後から上書きしないよう、当該キーを cancel してから書く。
            // TQ v5 は cancel 後の resolve を捨てる。未タッチ + 再読失敗では cache を触らない（AP11）。
            await queryClient.cancelQueries({ queryKey: shareConsentKeys.current(userId) });
            queryClient.setQueryData(shareConsentKeys.current(userId), current);
            // AP13: 設定と同型。同一 QC の設定トグルが 30s accepted のまま残らないよう他タブへ通知する
            if (typeof BroadcastChannel !== "undefined") {
              try {
                const channel = new BroadcastChannel(SHARE_CONSENT_BROADCAST_CHANNEL);
                channel.postMessage({ userId });
                channel.close();
              } catch {
                // BroadcastChannel 失敗は focus 再同期に委ねる
              }
            }
          } catch {
            freshReadFailed = true;
          }
        }
        const freshRevoked =
          current !== undefined &&
          current.consent_version !== null &&
          !hasCurrentShareConsent(current);
        // 未タッチ + 再読失敗は accepted cache で upsert(true) しない（AP11）
        // サーバが revoke 済みで利用者が共有を触っていないなら再 accept しない（AP7）
        const shouldUpsertAccept =
          input.shareConsentAccepted &&
          !(freshReadFailed && input.shareConsentTouched !== true) &&
          !(freshRevoked && input.shareConsentTouched !== true);
        // AP12: 未タッチのオフ追従では revoke しない。
        // revoke は利用者がオフにしたときだけ。fresh 現行かつ入力 false は触っている場合に限る。
        const shouldRevoke =
          !input.shareConsentAccepted &&
          input.shareConsentTouched === true &&
          hasCurrentShareConsent(current ?? null);
        if (shouldUpsertAccept || shouldRevoke) {
          try {
            const share = await withTimeout(
              upsertMyShareConsent(client, shouldUpsertAccept),
              PRIVACY_ACCEPT_TIMEOUT_MS,
            );
            queryClient.setQueryData(shareConsentKeys.current(userId), share);
          } catch {
            // AP12 residual-intentional: share は無言 best-effort（revoke 失敗も同じ）。
            // privacy は保存済み・returnTo 継続。失敗案内は設定トグル再試行に委ねる。
          }
        }
      }
      return consent;
    },
    onSuccess: (consent) => {
      queryClient.setQueryData(privacyKeys.current(consent.user_id), consent);
      void navigate(returnTo, { replace: true });
    },
  });

  return (
    <PrivacyNoticeContent
      saving={mutation.isPending}
      error={
        mutation.isError ? "確認状態を保存できませんでした。通信を確認してください。" : undefined
      }
      initialShareChecked={initialShareChecked}
      shareConsentReady={shareConsentReady}
      onAccept={(input) => {
        mutation.mutate(input);
      }}
      onSkip={() => {
        void navigate(returnTo, { replace: true });
      }}
    />
  );
}

export function PrivacyNoticeContent({
  saving,
  error,
  onAccept,
  onSkip,
  initialShareChecked = true,
  shareConsentReady = true,
}: {
  saving: boolean;
  error?: string | undefined;
  onAccept: (input: PrivacyAcceptInput) => void;
  onSkip: () => void;
  /** 省略時は既定オン（Content 単体テスト互換） */
  initialShareChecked?: boolean;
  /** false の間は共有チェックと primary を触れない（読取中の誤 accept / 誤 revoke を防ぐ） */
  shareConsentReady?: boolean;
}) {
  // 共有チェック値は任意なので primary の enable には使わない。
  // 読取完了前は進めない（未観測の unchecked を revoke と誤認しない）
  const [checked, setChecked] = useState(false);
  const [shareChecked, setShareChecked] = useState(initialShareChecked);
  // AP7: 利用者が共有を手で触ったらサーバ再読で上書きしない
  const userTouchedShareRef = useRef(false);
  useEffect(() => {
    if (!shareConsentReady) return;
    if (userTouchedShareRef.current) return;
    setShareChecked(initialShareChecked);
  }, [shareConsentReady, initialShareChecked]);
  // 未チェックのまま primary を押したときの案内。チェックしたら消す。
  const [consentGateMessage, setConsentGateMessage] = useState<string | undefined>();
  const consentCheckboxRef = useRef<HTMLInputElement>(null);
  // 保存失敗とゲート案内は同じ領域。保存失敗を優先する。
  const displayError = error ?? consentGateMessage;
  return (
    <main className="page-frame stack">
      <div>
        <p className="eyebrow">AIを使う前の確認</p>
        <h1>家族情報の取り扱い</h1>
      </div>
      {privacySections.map((section) => (
        <section className="card" key={section.title}>
          <h2>{section.title}</h2>
          <p>{section.body}</p>
        </section>
      ))}
      <section className="card">
        <h2>送信先について</h2>
        <p>{providerExplanation}</p>
        {/* 同画面への自己リンクは避け、説明本文はこのページ内セクションで足りる */}
        <p className="type-small">この画面の説明が運営者のプライバシー説明です。</p>
      </section>
      <p>
        AI生成レシピだけでアレルギーの安全は保証できません。加工品の原材料表示と家庭内の混入を確認してください。
      </p>
      <label className="control-label">
        <input
          ref={consentCheckboxRef}
          type="checkbox"
          checked={checked}
          aria-invalid={error === undefined && consentGateMessage !== undefined ? true : undefined}
          aria-describedby={
            error === undefined && consentGateMessage !== undefined
              ? "privacy-consent-checkbox-hint"
              : undefined
          }
          onChange={(event) => {
            const next = event.target.checked;
            setChecked(next);
            // チェックが入ったらゲート案内を消し、再試行しやすくする
            if (next) setConsentGateMessage(undefined);
          }}
        />
        説明を確認しました
      </label>
      {/* 共有は必須 AI 同意と視覚的に分離した別カード。既定オン・推奨トーンなし。任意のまま */}
      <section className="card" aria-labelledby="share-consent-heading">
        <h2 id="share-consent-heading">{shareConsentSection.title}</h2>
        <p>{shareConsentSection.body}</p>
        <p className="type-small">{shareConsentSection.defaultCheckedHint}</p>
        <label className="control-label">
          <input
            type="checkbox"
            checked={shareChecked}
            disabled={!shareConsentReady}
            onChange={(event) => {
              userTouchedShareRef.current = true;
              setShareChecked(event.target.checked);
            }}
          />
          {shareConsentSection.checkboxLabel}
        </label>
      </section>
      {displayError !== undefined && (
        <p
          id={
            error === undefined && consentGateMessage !== undefined
              ? "privacy-consent-checkbox-hint"
              : undefined
          }
          className="error-message"
          role="alert"
        >
          {displayError}
        </p>
      )}
      <button
        className="primary-button"
        type="button"
        // 必須未チェックでも押せる（押下で案内）。読取中は進めない（AP8: 未観測 false で revoke しない）
        disabled={saving || !shareConsentReady}
        onClick={() => {
          if (!checked) {
            setConsentGateMessage(privacyConsentCheckboxRequiredMessage);
            consentCheckboxRef.current?.focus();
            return;
          }
          // 読取完了前は share を true で送らない（pending 中の default true 再 accept を防ぐ）
          onAccept({
            shareConsentAccepted: shareConsentReady && shareChecked,
            shareConsentTouched: userTouchedShareRef.current,
          });
        }}
      >
        {saving ? "保存中…" : "確認して進む"}
      </button>
      {/* APE-I1: 同意保存中は skip を止め、遅延 accept で同意が残る競合を防ぐ */}
      <button className="text-button" type="button" disabled={saving} onClick={onSkip}>
        今はAIを使わない
      </button>
      {/* B-I10: シェル外のため緊急献立への操作導線を明示。同意は付けない */}
      <Link
        className={`secondary-button min-h-11${saving ? " pointer-events-none opacity-50" : ""}`}
        to="/emergency-menus"
        aria-disabled={saving}
        onClick={(event) => {
          if (saving) event.preventDefault();
        }}
      >
        AIなしの緊急献立を見る
      </Link>
      <p>同意しなくても、AIを使わない緊急献立は利用できます。</p>
    </main>
  );
}
