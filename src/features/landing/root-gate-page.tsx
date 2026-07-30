import { lazy, Suspense } from "react";
import { RootEntryPage } from "@/features/auth/root-entry-page";
import { useAuth } from "@/features/auth/use-auth";

const SESSION_CHECK_COPY = "ログイン状態を確認しています…" as const;

// 未ログイン時だけマーケ chunk（webp 含む）を取る。ログイン済み / では落とさない。
const FreeLandingPage = lazy(async () => {
  const { FreeLandingPage: Page } = await import("./free-landing-page");
  return { default: Page };
});

/**
 * 公開 `/` のゲート（設計 2026-07-30 L13–L14）。
 * loading → 確認文のみ。session なし → FreeLanding（lazy）。authenticated+session → RootEntry。
 */
export function RootGatePage() {
  const auth = useAuth();

  if (auth.status === "loading") {
    return <main className="page-frame">{SESSION_CHECK_COPY}</main>;
  }

  if (auth.status === "unauthenticated" || auth.session === null) {
    return (
      <Suspense fallback={<main className="page-frame">{SESSION_CHECK_COPY}</main>}>
        <FreeLandingPage />
      </Suspense>
    );
  }

  return <RootEntryPage />;
}
