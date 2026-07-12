import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { createAuthGateway, type AuthCallbackResult, type AuthGateway } from "./auth-gateway";

export function AuthCallbackPage({ gateway }: { gateway?: AuthGateway }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [result, setResult] = useState<AuthCallbackResult | null>(null);
  const [defaultGateway] = useState(createAuthGateway);
  const activeGateway = gateway ?? defaultGateway;

  useEffect(() => {
    let active = true;
    void activeGateway.completeCallback(new URL(window.location.href)).then((next) => {
      if (!active) return;
      setResult(next);
      if (next.kind === "complete") {
        void navigate(next.returnTo, { replace: true });
      } else if (next.kind === "expired") {
        void navigate("/login", {
          replace: true,
          state: { authError: "magic_link_expired" },
        });
      } else if (next.kind === "error") {
        void navigate("/login", {
          replace: true,
          state: { authError: next.code },
        });
      }
    });
    return () => {
      active = false;
    };
  }, [activeGateway, location.key, navigate]);

  if (result?.kind === "deposited") {
    return (
      <main className="page-frame stack">
        <h1>ログイン情報を元のブラウザへ渡しました</h1>
        <section className="card stack">
          <p>元のブラウザでログインを続けてください。この画面に認証情報は保存されません</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page-frame" aria-live="polite">
      <h1>ログインを確認中</h1>
      <p>この画面を閉じずにお待ちください。</p>
    </main>
  );
}
