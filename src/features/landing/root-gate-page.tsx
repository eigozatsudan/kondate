import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { COLD_START_SESSION_DEADLINE_MS } from "@/features/auth/auth-provider";
import { RootEntryPage } from "@/features/auth/root-entry-page";
import { useAuthLoadingDeadline } from "@/features/auth/use-auth-loading-deadline";
import { useAuth } from "@/features/auth/use-auth";

/** cold-start / auth 解決中だけ。chunk 待ちや deadline 後の UI とは文言を分ける（L1）。 */
const SESSION_CHECK_COPY = "ログイン状態を確認しています…" as const;
/** Free LP lazy chunk 待ち。セッション確認と同一文言だと「まだ確認中」と誤解される。 */
const LANDING_CHUNK_FALLBACK_COPY = "読み込み中…" as const;
/** L2: chunk hang 打ち切り後。秘密や内部理由は出さない。 */
const LANDING_CHUNK_TIMEOUT_COPY =
  "読み込みに時間がかかっています。通信を確認して再読み込みしてください。" as const;

// 未ログイン時だけマーケ chunk（webp 含む）を取る。ログイン済み / では落とさない。
const FreeLandingPage = lazy(async () => {
  const { FreeLandingPage: Page } = await import("./free-landing-page");
  return { default: Page };
});

/**
 * L2: Free LP が mount されたら deadline 武装を解除するプローブ。
 * Suspense 中は effect が走らないため、chunk / 子の suspend 中は timeout 対象のまま。
 */
function FreeLandingLoadProbe({ onLoaded }: { onLoaded: () => void }) {
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  useEffect(() => {
    onLoadedRef.current();
  }, []);
  return <FreeLandingPage />;
}

/**
 * L2: Free LP lazy chunk が never-settle でも auth C5 同尺で打ち切り、再読み込み UI へ。
 * import reject はルート errorElement 側。ここは pending 永久の二次防衛。
 */
function FreeLandingChunkGate() {
  const [timedOut, setTimedOut] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (timedOut) return;
    const timerId = window.setTimeout(() => {
      // 成功 mount 後は UI をエラーに差し替えない
      if (!loadedRef.current) {
        setTimedOut(true);
      }
    }, COLD_START_SESSION_DEADLINE_MS);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [timedOut]);

  if (timedOut) {
    return (
      <main className="page-frame stack">
        <p className="error-message" role="alert">
          {LANDING_CHUNK_TIMEOUT_COPY}
        </p>
        <button
          className="secondary-button min-h-11"
          type="button"
          onClick={() => {
            window.location.reload();
          }}
        >
          再読み込み
        </button>
      </main>
    );
  }

  return (
    <Suspense fallback={<main className="page-frame">{LANDING_CHUNK_FALLBACK_COPY}</main>}>
      <FreeLandingLoadProbe
        onLoaded={() => {
          loadedRef.current = true;
        }}
      />
    </Suspense>
  );
}

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
  // L2: Free LP chunk 自体の hang は FreeLandingChunkGate の 15s で打ち切る。
  if (loadingTimedOut || auth.status === "unauthenticated" || auth.session === null) {
    return <FreeLandingChunkGate />;
  }

  return <RootEntryPage />;
}
