import { useState } from "react";
import { deleteAccountEnvelopeSchema } from "@shared/contracts/account";
import {
  clearLocalAuthAndDrafts,
  clearOwnedLocalDataBestEffort,
} from "@/features/auth/auth-cleanup";
import { requireAccessToken } from "@/features/auth/session";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { DeleteAccountDialog } from "./delete-account-dialog";

function mapDeleteError(code: string | undefined): string {
  if (code === "invalid_request") return "「削除する」と入力してください";
  if (code === "billing_cancel_failed") {
    return "有料プランの解約が完了しませんでした。請求が続く可能性があるため、アカウントは削除していません。時間をおいてもう一度お試しください";
  }
  // AP1: 解約は進んだが Auth 削除だけ失敗 — 再試行で delete を通せば復旧できる
  if (code === "account_delete_after_billing_cancel_failed") {
    return "有料プランの解約は完了した可能性がありますが、アカウント削除に失敗しました。時間をおいてもう一度削除を試してください";
  }
  return "削除できませんでした。時間をおいてもう一度お試しください";
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
   * getSession/getUser の一時エラーや 5xx・ネットワーク系は不明扱い（誤成功・請求 fail-closed を壊さない）。
   */
  async function isAuthSessionGone(): Promise<boolean> {
    try {
      const client = getBrowserSupabaseClient();
      const sessionResult = await client.auth.getSession();
      if (sessionResult.error !== null) return false;
      if (sessionResult.data.session === null) return true;

      // local JWT 残存: Auth サーバでユーザー実在を確認（AP3）
      const { data, error } = await client.auth.getUser();
      if (error !== null) {
        // AuthApiError 等の 4xx は JWT 無効・ユーザー削除済み。status 無し / 5xx は不明
        const status = error.status;
        if (typeof status === "number" && status >= 400 && status < 500) {
          return true;
        }
        return false;
      }
      return data.user == null;
    } catch {
      return false;
    }
  }

  /** 削除成功後の local 掃除 + フル遷移（AP5 の second pass を含む） */
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
    try {
      const accessToken = await requireAccessToken(getBrowserSupabaseClient());
      requestStarted = true;
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirmation }),
        cache: "no-store",
      });
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        // AP10: 本文欠落窓。Auth 消滅済みなら成功同等 cleanup
        if (await isAuthSessionGone()) {
          await completeAccountDeletedLocally();
          return;
        }
        setErrorMessage(mapDeleteError(undefined));
        return;
      }
      const parsed = deleteAccountEnvelopeSchema.safeParse(raw);
      if (!parsed.success) {
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
    } catch {
      // AP10: ネットワーク切断等。DELETE 到達後に session が消えていれば成功同等
      if (requestStarted && (await isAuthSessionGone())) {
        await completeAccountDeletedLocally();
        return;
      }
      setErrorMessage(mapDeleteError(undefined));
    } finally {
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
