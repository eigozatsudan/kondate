import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/features/auth/use-auth";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { sanitizeReturnPath } from "@/features/auth/auth-flow";
import { acceptCurrentPrivacyConsent } from "./privacy-api";
import { privacySections, providerExplanation } from "./privacy-copy";
import { privacyKeys } from "./privacy-queries";

export function PrivacyNoticePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const userId = auth.session?.user.id;
  const returnTo = sanitizeReturnPath(params.get("returnTo"));
  const mutation = useMutation({
    mutationFn: async () => {
      if (userId === undefined) throw new Error("ログインが必要です");
      const client = getBrowserSupabaseClient();
      return acceptCurrentPrivacyConsent(client, userId);
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
      onAccept={() => {
        mutation.mutate();
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
  onAccept: () => void;
  onSkip: () => void;
}) {
  const [checked, setChecked] = useState(false);
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
      {error !== undefined && <p className="error-message">{error}</p>}
      <button
        className="primary-button"
        type="button"
        disabled={!checked || saving}
        onClick={onAccept}
      >
        {saving ? "保存中…" : "確認して進む"}
      </button>
      <button className="text-button" type="button" onClick={onSkip}>
        今はAIを使わない
      </button>
      {/* B-I10: シェル外のため緊急献立への操作導線を明示。同意は付けない */}
      <Link className="secondary-button min-h-11" to="/emergency-menus">
        AIなしの緊急献立を見る
      </Link>
      <p>同意しなくても、AIを使わない緊急献立は利用できます。</p>
    </main>
  );
}
