import type { UnsupportedDietKind } from "@shared/contracts/domain";

// 設計 r2 §6 確定文言。UI・schema・オンボーディングが単一ソースとして参照する。
// リテラル再導出禁止 — 文言変更は設計改訂経由のみ。

export const UNSUPPORTED_DIET_STATUS_LABEL =
  "離乳食・飲み込みの不安・治療食など、このアプリで献立を作れない事情はありますか";
export const UNSUPPORTED_DIET_STATUS_HELP =
  "アレルギーや苦手なものは別の項目です。ここでは上の3つだけを答えます。";
export const UNSUPPORTED_DIET_KIND_LABELS = {
  weaning_food: "離乳食が必要",
  swallowing_concern: "飲み込み・むせに不安がある",
  therapeutic_diet: "医師等から治療食の指示がある",
} as const satisfies Record<UnsupportedDietKind, string>;
export const UNSUPPORTED_DIET_KINDS_LEGEND = "該当する事情";
export const UNSUPPORTED_DIET_PRESENT_HELP =
  "選んだ場合、このメンバー向けの通常の献立は作れません。対象から外すか、専門職の指示に従ってください。治療食の指示内容はここでは入力できません（このアプリでは作れないためです）。";
export const UNSUPPORTED_DIET_UNCONFIRMED_HELP =
  "作れない事情を確認するまで、このメンバーは献立生成に使えません。";
export const UNSUPPORTED_DIET_STATUS_REQUIRED = "作れない事情があるか選んでください";
export const UNSUPPORTED_DIET_KINDS_REQUIRED = "該当する事情を選んでください";
export const UNSUPPORTED_DIET_ONBOARDING_INTRO =
  "年齢のめやす、アレルギー、作れない事情の3項目から始めます。";
export const UNSUPPORTED_DIET_EMPTY_ADD_HELP =
  "「家族を追加」を押すと、登録の前に確認が表示されます。続けたあと、1人目の入力が始まります。呼び名・年齢・アレルギーなどを順に入れられます。";

export const ADD_SCOPE_NOTICE_TITLE = "登録の前に";
export const ADD_SCOPE_NOTICE_BODY =
  "当てはまる方がいる場合、その方個人向けのメニューには対応していません。他の家族向けの献立はこれまでどおり作れます。";
export const ADD_SCOPE_NOTICE_ITEMS = [
  "離乳食が必要",
  "飲み込み・むせに不安がある",
  "医師等から治療食の指示がある",
] as const;
export const ADD_SCOPE_NOTICE_FOOTNOTE =
  "それでも登録する場合は、「この人には献立を作らない」という明示として名簿に残せます。通常の献立の対象にはなりません。専門職の指示に従ってください。";
export const ADD_SCOPE_NOTICE_CONTINUE = "登録を続ける";
export const ADD_SCOPE_NOTICE_CANCEL = "やめる";
