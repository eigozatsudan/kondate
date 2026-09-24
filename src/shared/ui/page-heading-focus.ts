import { createContext, useContext } from "react";

/**
 * 同じ pathname のまま画面の中身だけが入れ替わったとき（例: /planner の質問中に下の
 * 「献立」タブでホームへ戻る）、AppShell の「遷移後にページ h1 へフォーカスする」処理を
 * もう一度走らせるための口。pathname が変わらないとシェルの effect は再実行されず、
 * フォーカスがタブに残ったまま何も読み上げられないため、画面を入れ替えた側から呼ぶ。
 *
 * 実体は AppShell が提供する（フォーカス先の選び方・dialog 尊重はシェルの既存処理のまま）。
 * シェルの外（route 単体のテストなど）では何もしない。
 */
export type RequestPageHeadingFocus = () => void;

export const PageHeadingFocusContext = createContext<RequestPageHeadingFocus>(() => undefined);

export function useRequestPageHeadingFocus(): RequestPageHeadingFocus {
  return useContext(PageHeadingFocusContext);
}
