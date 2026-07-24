import { useState } from "react";
import { useNavigate } from "react-router";
import { clearLocalAuthAndDrafts } from "@/features/auth/auth-cleanup";
import { requireAccessToken } from "@/features/auth/session";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { DeleteAccountDialog } from "./delete-account-dialog";

type DeleteAccountEnvelope =
  { ok: true; data: { deleted: true } } | { ok: false; error: { code: string; message: string } };

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
    <section className="card stack" aria-label="DangerZone">
      <h2 className="text-base font-bold">危険な操作</h2>
      {!expanded ? (
        <button type="button" className="secondary-button min-h-11" onClick={onExpand}>
          アカウントを削除
        </button>
      ) : (
        <>
          <p>
            家族設定、献立履歴、冷蔵庫の食材、買い物リストを含むすべてのデータが完全に削除され、元に戻せません。
          </p>
          <button
            type="button"
            className="min-h-11 rounded-xl bg-red-700 px-4 font-semibold text-white"
            onClick={onOpenDialog}
          >
            削除の確認へ進む
          </button>
        </>
      )}
    </section>
  );
}

/**
 * 設定ページ下部に合成するアカウント操作。
 * 通常ログアウトとアカウント削除の両方で、ナビゲート前に clearLocalAuthAndDrafts を待つ。
 * 通常ログアウトは DELETE /api/account を呼ばない。
 */
export function AccountSettingsSection() {
  const navigate = useNavigate();
  const [dangerExpanded, setDangerExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSignOut(): Promise<void> {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // ナビより先に掃除を完了させ、復帰キーが残ったまま /login へ行かない
      await clearLocalAuthAndDrafts(getBrowserSupabaseClient());
      await navigate("/login?signedOut=1", { replace: true });
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
      let envelope: DeleteAccountEnvelope;
      try {
        envelope = (await response.json()) as DeleteAccountEnvelope;
      } catch {
        setErrorMessage(mapDeleteError(undefined));
        return;
      }
      if (!envelope.ok) {
        setErrorMessage(mapDeleteError(envelope.error.code));
        return;
      }
      // サーバー削除成功後だけローカル掃除。失敗時はダイアログを開いたまま再試行可能にする
      await clearLocalAuthAndDrafts(getBrowserSupabaseClient());
      await navigate("/login?accountDeleted=1", { replace: true });
    } catch {
      setErrorMessage(mapDeleteError(undefined));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="stack" aria-label="アカウント設定">
      {/* 家族CRUDと並べて合成されるため、操作の境界が一目で分かる見出しを置く */}
      <h2 className="text-base font-bold">アカウント</h2>
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
