import { useEffect, useId, useRef, useState } from "react";
import { InlineNotice } from "@/shared/ui/wizard/inline-notice";

/**
 * ラベル確認の免責（加工品 soft → 表示確認経路向け）。
 * 表示確認の記録完了＝食べて安全、と誤認しないよう、確認手続きと AI 生成の両方を非保証に含める。
 * 設計は保証表現（「安全です」「対応済み」等）を禁じる。平易化で保証寄りにしないこと。
 */
export const MENU_LABEL_DISCLAIMER =
  "加工品は原材料表示の確認が必要です。表示確認の記録やAI生成レシピだけでは、アレルギー対応や食べて安全であることを保証するものではありません。";

/**
 * 原材料表示セクション内の短い非保証（確認バッジ直近で「確認＝安全」誤認を抑える）。
 * ページ枠の MENU_LABEL_DISCLAIMER と軸を揃え、手続き記録である旨だけを重ねて示す。
 */
export const MENU_LABEL_CONFIRMATION_RECORD_NOTICE =
  "表示確認は商品の原材料表示を見た記録です。確認した＝食べて安全、という意味ではありません。";

/**
 * 設計 L213: 「やわらかめ」は一般家庭の食べやすさであり嚥下調整ではないことの明記。
 * アレルギー非保証（MENU_LABEL_DISCLAIMER）とは別軸。入力時は必須、結果は短い固定文。
 */
export const EASE_SOFT_NOT_SWALLOW_DISCLAIMER =
  "「やわらかめ」は家庭での食べやすさの希望です。嚥下調整食や医療的な食事対応ではありません。";

/** 必須注意を開く操作名（unit / e2e で共有）。 */
export const IDEA_SAFETY_DETAILS_BUTTON_LABEL = "注意事項を見る";

/**
 * idea 結果・履歴詳細の上部注意。
 * 設計 §5.4 / Plan 7 Step 11: 固定必須文言は常時表示。
 * AI 詳細とラベル免責の長文はダイアログで追加確認できる。
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
            {/* 設計固定の必須2文は常時表示（ダイアログ内だけに閉じない） */}
            <div className="stack min-w-0 gap-1 text-ink">
              <p>家族条件を使用していません</p>
              <p>年齢・アレルギーへの適合は確認されていません</p>
            </div>
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
            <p className="type-small">{EASE_SOFT_NOT_SWALLOW_DISCLAIMER}</p>
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
