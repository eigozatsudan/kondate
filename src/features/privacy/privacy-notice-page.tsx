import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { withTimeout } from "@/features/auth/async-timeout";
import { useAuth } from "@/features/auth/use-auth";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { sanitizeReturnPath } from "@/features/auth/auth-flow";
import { acceptCurrentPrivacyConsent } from "./privacy-api";
import { privacySections, providerExplanation, shareConsentSection } from "./privacy-copy";
import { privacyKeys } from "./privacy-queries";
import { upsertMyShareConsent } from "./share-consent-api";
import { shareConsentKeys } from "./share-consent-queries";

/**
 * AP8: privacy accept（PostgREST）の上限。
 * never-settle で saving 固着し「今はAIを使わない」も disabled のままになるのを防ぐ。
 */
export const PRIVACY_ACCEPT_TIMEOUT_MS = 10_000;

export type PrivacyAcceptInput = {
  /** 共有任意チェック。true のときだけ upsert_my_share_consent(accept=true) を呼ぶ */
  shareConsentAccepted: boolean;
};

export function PrivacyNoticePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const userId = auth.session?.user.id;
  const returnTo = sanitizeReturnPath(params.get("returnTo"));
  const mutation = useMutation({
    mutationFn: async (input: PrivacyAcceptInput) => {
      if (userId === undefined) throw new Error("ログインが必要です");
      const client = getBrowserSupabaseClient();
      // privacy は必須。共有は任意チェック時のみ別 RPC で保存する。
      // 共有 RPC 失敗で必須 privacy 同意を巻き戻さない・画面遷移を止めない（設定で再同意可）。
      // AP8: accept 全体を withTimeout（skip 導線が永久 disabled にならないようにする）
      const consent = await withTimeout(
        acceptCurrentPrivacyConsent(client, userId),
        PRIVACY_ACCEPT_TIMEOUT_MS,
      );
      if (input.shareConsentAccepted) {
        try {
          const share = await withTimeout(
            upsertMyShareConsent(client, true),
            PRIVACY_ACCEPT_TIMEOUT_MS,
          );
          queryClient.setQueryData(shareConsentKeys.current(userId), share);
        } catch {
          // AP12 residual-intentional: share は無言 best-effort。
          // privacy は保存済み・returnTo 継続。失敗案内は設定トグル再試行に委ねる。
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
}: {
  saving: boolean;
  error?: string | undefined;
  onAccept: (input: PrivacyAcceptInput) => void;
  onSkip: () => void;
}) {
  // 共有は既定 checked（任意。primary の enable 条件には使わない）
  const [checked, setChecked] = useState(false);
  const [shareChecked, setShareChecked] = useState(true);
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
          type="checkbox"
          checked={checked}
          onChange={(event) => {
            setChecked(event.target.checked);
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
            onChange={(event) => {
              setShareChecked(event.target.checked);
            }}
          />
          {shareConsentSection.checkboxLabel}
        </label>
      </section>
      {error !== undefined && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary-button"
        type="button"
        disabled={!checked || saving}
        onClick={() => {
          onAccept({ shareConsentAccepted: shareChecked });
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
