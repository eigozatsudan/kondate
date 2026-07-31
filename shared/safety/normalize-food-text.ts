/**
 * 食材テキスト正規化（純粋関数）。
 * アレルゲン評価本体（evaluateAllergens 等）とは分離し、ブラウザの preference gap
 * 表示やサーバ検証が同じ空間で照合できるようにする。
 * 評価 pipeline 全体をブラウザへ引き込まないための薄い dual-surface モジュール。
 */

/** カタカナ（ァ-ヶ）を対応するひらがなへ折り畳む。 */
export function foldKatakanaToHiragana(value: string): string {
  return value.replace(/[\u30a1-\u30f6]/gu, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * NFKC → カタカナ→ひらがな → 小文字 → 書式制御除去。
 * 区切り文字は残す（matching 用の区切り検出が後段で使う）。
 */
export function normalizeFoodTextBase(value: string): string {
  return foldKatakanaToHiragana(value.normalize("NFKC"))
    .toLocaleLowerCase("ja-JP")
    .replace(/\p{Cf}/gu, "");
}

/**
 * 献立テキストと辞書 alias を同じ空間へ寄せる。
 * 半角カナ等を先に NFKC で全角へ寄せてから、カタカナ→ひらがなへ折り畳む。
 */
export function normalizeFoodText(value: string): string {
  return normalizeFoodTextBase(value).replace(/[\s\u3000、。・,./（）()「」『』']/gu, "");
}
