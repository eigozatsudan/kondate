import { useEffect, useRef, useState } from "react";

export type DeleteAccountDialogProps = {
  open: boolean;
  pending: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: (confirmation: "削除する") => Promise<void>;
};

/**
 * アカウント完全削除の確認ダイアログ。
 * 送信ボタンは確認フレーズが正確に「削除する」のときだけ有効化する。
 */
export function DeleteAccountDialog(props: DeleteAccountDialogProps) {
  const [confirmation, setConfirmation] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (props.open && !dialog.open) {
      setConfirmation("");
      dialog.showModal();
    }
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="delete-account-title"
      onCancel={(event) => {
        event.preventDefault();
        // APE-I3: 削除中のキャンセルは失敗フィードバックを落とすため無視する
        if (props.pending) return;
        props.onCancel();
      }}
      className="w-[calc(100%-2rem)] max-w-md rounded-2xl p-5"
    >
      <h2 id="delete-account-title" className="text-lg font-bold">
        アカウントを削除しますか？
      </h2>
      <p className="mt-3">
        家族設定、冷蔵庫、献立履歴、買い物リストは削除され、元に戻せません。不正利用防止のため、メールから作った復元できない識別子と日々の利用回数だけは残ります。
      </p>
      <label className="mt-4 block" htmlFor="delete-confirmation">
        確認のため「削除する」と入力
      </label>
      <input
        id="delete-confirmation"
        value={confirmation}
        onChange={(event) => {
          setConfirmation(event.target.value);
        }}
        autoComplete="off"
        className="mt-2 min-h-11 w-full rounded-xl border px-3"
      />
      {/* ACCT-M1: 空の role=alert は常時マウントしない（読み上げが無言で鳴る） */}
      {props.errorMessage !== null && props.errorMessage !== "" ? (
        <p role="alert" className="mt-2 min-h-6">
          {props.errorMessage}
        </p>
      ) : (
        <p className="mt-2 min-h-6" aria-hidden="true" />
      )}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          className="min-h-11 rounded-xl border disabled:opacity-50"
          disabled={props.pending}
          onClick={props.onCancel}
        >
          やめる
        </button>
        <button
          type="button"
          className="min-h-11 rounded-xl bg-danger-700 text-white disabled:opacity-50"
          disabled={confirmation !== "削除する" || props.pending}
          onClick={() => {
            void props.onConfirm("削除する");
          }}
        >
          {props.pending ? "削除しています" : "完全に削除する"}
        </button>
      </div>
    </dialog>
  );
}
