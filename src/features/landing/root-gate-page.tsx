import { RootEntryPage } from "@/features/auth/root-entry-page";
import { useAuth } from "@/features/auth/use-auth";
import { FreeLandingPage } from "./free-landing-page";

const SESSION_CHECK_COPY = "ログイン状態を確認しています…" as const;

/**
 * 公開 `/` のゲート（設計 2026-07-30 L13–L14）。
 * loading → 確認文のみ。session なし → FreeLanding。authenticated+session → RootEntry。
 */
export function RootGatePage() {
  const auth = useAuth();

  if (auth.status === "loading") {
    return <main className="page-frame">{SESSION_CHECK_COPY}</main>;
  }

  if (auth.status === "unauthenticated" || auth.session === null) {
    return <FreeLandingPage />;
  }

  return <RootEntryPage />;
}
