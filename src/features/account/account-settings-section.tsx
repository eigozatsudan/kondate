import { useState } from "react";
import { deleteAccountEnvelopeSchema } from "@shared/contracts/account";
import { clearLocalAuthAndDrafts } from "@/features/auth/auth-cleanup";
import { requireAccessToken } from "@/features/auth/session";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { DeleteAccountDialog } from "./delete-account-dialog";

function mapDeleteError(code: string | undefined): string {
  if (code === "invalid_request") return "「削除する」と入力してください";
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
      // 遷移より先に掃除を完了させ、復帰キーが残ったまま /login へ行かない
      // U1-003: 通常ログアウトは global でサーバー側 refresh も無効化する
      await clearLocalAuthAndDrafts(getBrowserSupabaseClient(), { signOutScope: "global" });
      window.location.replace("/login?signedOut=1");
    } finally {
      setSigningOut(false);
    }
  }

  async function handleConfirmDelete(confirmation: "削除する"): Promise<void> {
    if (pending) return;
    setPending(true);
    setErrorMessage(null);
    try {
      const accessToken = await requireAccessToken(getBrowserSupabaseClient());
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
        setErrorMessage(mapDeleteError(undefined));
        return;
      }
      const parsed = deleteAccountEnvelopeSchema.safeParse(raw);
      if (!parsed.success) {
        setErrorMessage(mapDeleteError(undefined));
        return;
      }
      if (!parsed.data.ok) {
        setErrorMessage(mapDeleteError(parsed.data.error.code));
        return;
      }
      // サーバー削除成功後のローカル掃除は best-effort。失敗しても Auth は消えているので成功遷移する。
      try {
        await clearLocalAuthAndDrafts(getBrowserSupabaseClient());
      } catch {
        // storage 例外で削除成功を失敗表示にしない
      }
      window.location.replace("/login?accountDeleted=1");
    } catch {
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
