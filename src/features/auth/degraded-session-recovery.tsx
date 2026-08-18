/**
 * C4: pin/probe 乖離中の fail-closed 面。
 * RequireSession の Outlet 閉鎖と、PWA start_url `/` の RootGate が同じ文言・導線を使う。
 * RootEntry を出さないことで getProfile が C4 より先に走る窓を閉じる。
 */
export function DegradedSessionRecovery({
  recoverDegradedSession,
}: {
  recoverDegradedSession?: (() => void) | undefined;
}) {
  return (
    <div className="page-frame type-small stack" role="status">
      <p>
        ログイン状態の確認に時間がかかっているか、別の状態と食い違っています。安全のため一部の操作を止めています。画面をそのままにするか、再読み込みするか、下のボタンからログインし直してください。
      </p>
      {recoverDegradedSession !== undefined ? (
        <p>
          <button
            type="button"
            className="text-button min-h-11 min-w-11"
            onClick={recoverDegradedSession}
          >
            ログインし直す
          </button>
        </p>
      ) : null}
    </div>
  );
}
