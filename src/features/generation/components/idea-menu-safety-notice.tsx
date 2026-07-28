import { useEffect, useId, useRef, useState } from "react";
import { InlineNotice } from "@/shared/ui/wizard/inline-notice";

/** 設計固定のラベル確認免責。文言は ui-refresh / MVP 設計どおり変更しない。 */
export const MENU_LABEL_DISCLAIMER =
  "加工品はラベル確認が必要です。AI生成レシピだけでアレルギー対応を保証するものではありません。";

/** 必須注意を開く操作名（unit / e2e で共有）。 */
export const IDEA_SAFETY_DETAILS_BUTTON_LABEL = "注意事項を見る";

/**
 * idea 結果・履歴詳細の上部注意。
 * 画面上はアイコン付きの短い注意喚起だけを出し、設計固定の必須文言は
 * ダイアログでまとめて読む。冗長な三重枠を避けつつ、原文は残す。
 */
export function IdeaMenuSafetyNotice() {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (detailsOpen && !dialog.open) {
      dialog.showModal();
    }
    if (!detailsOpen && dialog.open) {
      dialog.close();
    }
  }, [detailsOpen]);

  const closeDetails = () => {
    setDetailsOpen(false);
  };

  return (
    <>
      <InlineNotice tone="notice" title="ご確認ください">
        <div className="stack gap-3">
          <div className="flex items-start gap-3">
            {/* 注意を惹く警告アイコン。装飾なので a11y ツリーには載せない */}
            <span
              className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3 2.5 20h19L12 3Z" />
                <path d="M12 10v4" />
                <path d="M12 17h.01" />
              </svg>
            </span>
            <p className="min-w-0 text-ink">
              この献立はアイデアとして作成しました。家族条件は使っておらず、調理前に内容の確認が必要です。
            </p>
          </div>
          <button
            type="button"
            className="min-h-11 w-full rounded-xl border-2 border-terracotta-700 px-4 font-semibold text-ink sm:w-auto"
            onClick={() => {
              setDetailsOpen(true);
            }}
          >
            {IDEA_SAFETY_DETAILS_BUTTON_LABEL}
          </button>
        </div>
      </InlineNotice>

      {/*
        dialog 本体に .stack を付けない（UA の dialog:not([open]){display:none} を
        作者スタイルで潰さない。DeleteAccountDialog / RegenerationSheet と同じ方針）。
      */}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          closeDetails();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border bg-white p-5 shadow-lg"
      >
        <div className="stack gap-4">
          <h2 id={titleId} className="text-lg font-bold">
            この献立はアイデアとして作成しました
          </h2>
          <div className="stack gap-2">
            <p>家族条件を使用していません</p>
            <p>年齢・アレルギーへの適合は確認されていません</p>
            <p>
              <strong>AIが作成した献立です。</strong>{" "}
              内容、加熱状態、家庭内での混入を調理前に確認してください。
            </p>
            <p className="font-semibold">{MENU_LABEL_DISCLAIMER}</p>
          </div>
          <button
            type="button"
            className="min-h-11 rounded-xl bg-terracotta-700 px-4 font-semibold text-white"
            onClick={closeDetails}
          >
            閉じる
          </button>
        </div>
      </dialog>
    </>
  );
}
