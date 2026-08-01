import { lazy, Suspense } from "react";
import { RootEntryPage } from "@/features/auth/root-entry-page";
import { useAuthLoadingDeadline } from "@/features/auth/use-auth-loading-deadline";
import { useAuth } from "@/features/auth/use-auth";

/** cold-start / auth 解決中だけ。chunk 待ちや deadline 後の UI とは文言を分ける（L1）。 */
const SESSION_CHECK_COPY = "ログイン状態を確認しています…" as const;
/** Free LP lazy chunk 待ち。セッション確認と同一文言だと「まだ確認中」と誤解される。 */
const LANDING_CHUNK_FALLBACK_COPY = "読み込み中…" as const;

// 未ログイン時だけマーケ chunk（webp 含む）を取る。ログイン済み / では落とさない。
const FreeLandingPage = lazy(async () => {
  const { FreeLandingPage: Page } = await import("./free-landing-page");
  return { default: Page };
});

/**
 * 公開 `/` のゲート（設計 2026-07-30 L13–L14）。
 * loading → 確認文のみ（C5/L1: 15s 超過は fail-closed で LP）。
 * session なし → FreeLanding（lazy）。authenticated+session → RootEntry。
 */
export function RootGatePage() {
  const auth = useAuth();
  const { showLoading, loadingTimedOut } = useAuthLoadingDeadline(auth.status);

  if (showLoading) {
    return <main className="page-frame">{SESSION_CHECK_COPY}</main>;
  }

  // L1: loading が C5 期限を超えたら未ログイン相当（Free LP）へ fail-closed。
  // Suspense fallback は SESSION_CHECK_COPY と別文言にし、deadline 後に
  // cold-start と同じ「確認中」で詰まって見えないようにする。
  if (loadingTimedOut || auth.status === "unauthenticated" || auth.session === null) {
    return (
      <Suspense fallback={<main className="page-frame">{LANDING_CHUNK_FALLBACK_COPY}</main>}>
        <FreeLandingPage />
      </Suspense>
    );
  }

  return <RootEntryPage />;
}
