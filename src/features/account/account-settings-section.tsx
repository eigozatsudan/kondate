import { useState } from "react";
import { deleteAccountEnvelopeSchema } from "@shared/contracts/account";
import { withTimeout } from "@/features/auth/async-timeout";
import {
  clearLocalAuthAndDrafts,
  clearOwnedLocalDataBestEffort,
  SIGN_OUT_TIMEOUT_MS,
} from "@/features/auth/auth-cleanup";
import { requireAccessToken } from "@/features/auth/session";
import { accountDeletionAnonymousShareNote } from "@/features/privacy/privacy-copy";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { DeleteAccountDialog } from "./delete-account-dialog";

/**
 * AP1: 削除後 probe の getSession/getUser が never-settle すると pending が固着し
 * Escape/やめるも効かず cleanup に進めない。signOut と同窓で切る（cancel 不能な SDK 向け）。
 */
export const AUTH_SESSION_PROBE_TIMEOUT_MS = SIGN_OUT_TIMEOUT_MS;

/**
 * AP1: DELETE /api/account 本体のクライアント上限。
 * Function 総予算 55s / platform 60s の内側に置き、never-settle で「削除しています」固着を防ぐ。
 */
export const ACCOUNT_DELETE_CLIENT_TIMEOUT_MS = 58_000;

function mapDeleteError(
  code: string | undefined,
  options?: { maybeStillProcessing?: boolean },
): string {
  if (code === "invalid_request") return "「削除する」と入力してください";
  if (code === "billing_cancel_failed") {
    return "有料プランの解約が完了しませんでした。請求が続く可能性があるため、アカウントは削除していません。時間をおいてもう一度お試しください";
  }
  // AP1: 解約は進んだが Auth 削除だけ失敗 — 再試行で delete を通せば復旧できる
  if (code === "account_delete_after_billing_cancel_failed") {
    return "有料プランの解約は完了した可能性がありますが、アカウント削除に失敗しました。時間をおいてもう一度削除を試してください";
  }
  // AP3: クライアント締切後もサーバ側削除が完了し得る。失敗確定に見えない文言にする
  if (options?.maybeStillProcessing === true) {
    return "削除の結果を確認できませんでした。処理が続いている場合があるため、時間をおいてからログインできるか確認してください。すでに削除済みのときはログインできなくなります";
  }
  return "削除できませんでした。時間をおいてもう一度お試しください";
}

/** withTimeout の timeout と AbortSignal abort の両方を締切扱いする */
function isDeleteAttemptTimeoutError(error: unknown): boolean {
  if (error instanceof Error && error.message === "timeout") return true;
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return true;
  }
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return true;
  }
  return false;
}

/**
 * 危険操作ゾーン。初期は折りたたみ、展開時に不可逆性を説明する。
 * 親の AccountSettingsSection だけが API 呼び出しを所有する。
 */
export function DangerZone({
  expanded,
  onExpand,
  onOpenDialog,
}: {
  expanded: boolean;
  onExpand: () => void;
  onOpenDialog: () => void;
}) {
  return (
    // 親のアカウント card 内に置くため、外側に二重 card は付けない
    <div
      className="account-danger-block stack"
      role="region"
      aria-labelledby="account-danger-zone-title"
    >
      <h3 id="account-danger-zone-title" className="settings-section-title">
        危険な操作
      </h3>
      {!expanded ? (
        <button type="button" className="secondary-button min-h-11" onClick={onExpand}>
          アカウントを削除
        </button>
      ) : (
        <>
          <p>
            家族設定、献立履歴、冷蔵庫の食材、買い物リストは削除され、元に戻せません。不正利用防止のため、メールから作った復元できない識別子や日々の利用回数、無料期間の利用履歴などの記録は残ることがあります。
          </p>
          {/* AP4: 方針 B（匿名共有 pool 残存）を削除導線でも開示（privacy-copy と単一ソース） */}
          <p>{accountDeletionAnonymousShareNote}</p>
          <button
            type="button"
            className="min-h-11 rounded-xl bg-danger-700 px-4 font-semibold text-white"
            onClick={onOpenDialog}
          >
            削除の確認へ進む
          </button>
        </>
      )}
    </div>
  );
}

/**
 * 設定ページ下部に合成するアカウント操作。
 * 通常ログアウトとアカウント削除の両方で、遷移前に clearLocalAuthAndDrafts を待つ。
 * 通常ログアウトは DELETE /api/account を呼ばない。
 *
 * 掃除後は React Router の navigate ではなく window.location.replace を使う。
 * signOut で session が消えると RequireSession が同一描画で
 * /login?returnTo=... へ割り込み、クライアント navigate が負けたり消えるため。
 * フル遷移なら復帰先なしのログイン URL を確定でき、再ログインで設定へ戻らない。
 */
export function AccountSettingsSection() {
  const [dangerExpanded, setDangerExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSignOut(): Promise<void> {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // 遷移より先に掃除を完了させ、復帰キーが残ったまま /login へ行かない。
      // 通常ログアウトは local（この端末のみ）。他端末のセッションは維持する。
      // 全端末失効が必要な場合は signOutScope: "global" を明示する。
      await clearLocalAuthAndDrafts(getBrowserSupabaseClient());
      window.location.replace("/login?signedOut=1");
    } finally {
      setSigningOut(false);
    }
  }

  /**
   * AP10/AP3: 削除 API 成功後に JSON/HTTP が端末側で欠落すると dialog エラーのままになる。
   * Admin hard delete は他端末の local JWT を消さないため、getSession（local のみ）だけでは
   * サーバ削除成功を検出できない。local session が null なら gone。残っていれば getUser で
   * Auth サーバへ確認し、user 不在 / 4xx なら削除済みとみなして成功同等 cleanup へ寄せる。
   * getSession/getUser の一時エラー・5xx・timeout・ネットワーク系は不明扱い
   * （誤成功・請求 fail-closed を壊さない。AP3 residual-intentional）。
   *
   * AP1: probe 自体に timeout を付け、never-settle で pending/ダイアログが固着しないようにする。
   * AP8: `{ user: null, error: null }` のランタイム形も gone 扱い（型上の non-null 前提に依存しない）。
   *
   * AP2 residual-intentional: 成功 cleanup は local 既定のみ。他端末 / cleanup 未到達端末の
   * owned storage は SPA では wipe 不能。RequireSession は login Navigate のみで storage 非掃除。
   */
  async function isAuthSessionGone(): Promise<boolean> {
    try {
      const client = getBrowserSupabaseClient();
      const sessionResult = await withTimeout(
        client.auth.getSession(),
        AUTH_SESSION_PROBE_TIMEOUT_MS,
      );
      if (sessionResult.error !== null) return false;
      if (sessionResult.data.session === null) return true;

      // local JWT 残存: Auth サーバでユーザー実在を確認（AP3）
      const { data, error } = await withTimeout(
        client.auth.getUser(),
        AUTH_SESSION_PROBE_TIMEOUT_MS,
      );
      if (error !== null) {
        // AuthApiError 等の 4xx は JWT 無効・ユーザー削除済み。status 無し / 5xx は不明
        const status = error.status;
        if (typeof status === "number" && status >= 400 && status < 500) {
          return true;
        }
        return false;
      }
      // AP8: error 無しでも user が null なら削除済み寄り（誤 residual 維持を避ける）
      // getUser 成功型は user: User だが runtime 形を unknown 経由で検査する
      const user: unknown = data.user;
      if (user === null) return true;
      return false;
    } catch {
      // timeout / throw → 不明。finally で pending を落としダイアログを復帰させる（AP1）
      return false;
    }
  }

  /**
   * 削除成功後の local 掃除 + フル遷移（AP5 の second pass を含む）。
   * AP2 residual-intentional: signOutScope 既定 local。他端末 JWT/draft は触れない。
   */
  async function completeAccountDeletedLocally(): Promise<void> {
    try {
      await clearLocalAuthAndDrafts(getBrowserSupabaseClient());
    } catch {
      clearOwnedLocalDataBestEffort();
    }
    window.location.replace("/login?accountDeleted=1");
  }

  async function handleConfirmDelete(confirmation: "削除する"): Promise<void> {
    if (pending) return;
    setPending(true);
    setErrorMessage(null);
    // fetch 開始前の requireAccessToken 失敗では session probe を成功扱いにしない
    let requestStarted = false;
    // AP2/AP3: 締切時に in-flight DELETE を abort し zombie 再試行並行を抑える
    const abortController = new AbortController();
    const abortDelete = (): void => {
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    };
    // settle + body を同一壁時計で切る（ヘッダ到達後の body hang = AP1）
    const deleteDeadlineMs = Date.now() + ACCOUNT_DELETE_CLIENT_TIMEOUT_MS;
    const remainingDeleteBudgetMs = (): number =>
      Math.max(1, deleteDeadlineMs - Date.now());
    try {
      const accessToken = await requireAccessToken(getBrowserSupabaseClient());
      requestStarted = true;
      // AP1/AP2: withTimeout で UI を回復しつつ onTimeout で AbortSignal を立て、
      // プラットフォームが中断可能な in-flight DELETE を止める（generation POST と同型）。
      const response = await withTimeout(
        fetch("/api/account", {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ confirmation }),
          cache: "no-store",
          signal: abortController.signal,
        }),
        remainingDeleteBudgetMs(),
        abortDelete,
      );
      let raw: unknown;
      try {
        // AP1: body 読取も同一予算。headers-only hang で pending 固着させない
        raw = await withTimeout(response.json(), remainingDeleteBudgetMs(), abortDelete);
      } catch (error) {
        // 締切 / abort は外側で probe + AP3 文言へ
        if (isDeleteAttemptTimeoutError(error)) {
          throw error;
        }
        // AP10: 本文欠落窓。Auth 消滅済みなら成功同等 cleanup
        // AP4 residual-intentional: 非 JSON では専用 code を復元できない。
        // Auth 残存時は汎用文言のみ（cancel 済みの可観測性は JSON 成功枝に限定）。
        if (await isAuthSessionGone()) {
          await completeAccountDeletedLocally();
          return;
        }
        setErrorMessage(mapDeleteError(undefined));
        return;
      }
      const parsed = deleteAccountEnvelopeSchema.safeParse(raw);
      if (!parsed.success) {
        // AP4 residual-intentional: 同上（専用 billing/Auth 文言は envelope 成功時のみ）
        if (await isAuthSessionGone()) {
          await completeAccountDeletedLocally();
          return;
        }
        setErrorMessage(mapDeleteError(undefined));
        return;
      }
      if (!parsed.data.ok) {
        // 明示失敗（billing_cancel 等）は Auth 残存が正。probe で成功扱いしない
        setErrorMessage(mapDeleteError(parsed.data.error.code));
        return;
      }
      // サーバー削除成功後のローカル掃除は best-effort。Auth は消えているので成功遷移する。
      await completeAccountDeletedLocally();
    } catch (error) {
      // AP10: ネットワーク切断等。DELETE 到達後に session が消えていれば成功同等
      if (requestStarted && (await isAuthSessionGone())) {
        await completeAccountDeletedLocally();
        return;
      }
      // AP3: timeout/abort は「失敗確定」ではなく処理継続の可能性を開示
      setErrorMessage(
        mapDeleteError(undefined, {
          maybeStillProcessing: requestStarted && isDeleteAttemptTimeoutError(error),
        }),
      );
    } finally {
      abortDelete();
      setPending(false);
    }
  }

  return (
    <section className="card stack settings-section" aria-labelledby="account-settings-title">
      {/* 家族CRUDと同型の白カードで操作境界を示す */}
      <h2 id="account-settings-title" className="settings-section-title">
        アカウント
      </h2>
      <button
        type="button"
        className="secondary-button min-h-11"
        disabled={signingOut}
        onClick={() => {
          void handleSignOut();
        }}
      >
        ログアウト
      </button>
      {/* AP2: local scope 既定を利用者に開示（全端末失効ではない） */}
      <p className="type-small text-ink/80">
        この端末だけログアウトします。ほかの端末のログインはそのまま続きます。
      </p>
      <DangerZone
        expanded={dangerExpanded}
        onExpand={() => {
          setDangerExpanded(true);
        }}
        onOpenDialog={() => {
          setErrorMessage(null);
          setDialogOpen(true);
        }}
      />
      <DeleteAccountDialog
        open={dialogOpen}
        pending={pending}
        errorMessage={errorMessage}
        onCancel={() => {
          setDialogOpen(false);
          setErrorMessage(null);
        }}
        onConfirm={handleConfirmDelete}
      />
    </section>
  );
}
