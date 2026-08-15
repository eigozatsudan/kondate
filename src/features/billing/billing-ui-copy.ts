/** 課金 UI 固定コピー（設定・Plus LP で共有。文字列は 1 字も変えない）。 */
export const TRIAL_END_WARNING =
  "無料期間が終わると、登録したお支払い方法に料金がかかります" as const;
export const YEARLY_CONFIRM_COPY =
  "1 年分まとめてのお支払いです。途中解約しても残り期間の返金はありません（法令に従う場合を除く）" as const;
export const PORTAL_BUTTON_LABEL = "お支払い・解約の管理" as const;
export const STRIPE_REDIRECT_NOTICE = "カード入力画面に移ります" as const;
export const PAST_DUE_COPY = "お支払いの更新が必要です" as const;
/** B1: incomplete は Checkout 409 が Portal 完了を指示する。Settings にも同導線を出す。 */
export const INCOMPLETE_COPY =
  "お支払いの手続きが完了していません。お支払い管理から手続きを続けてください" as const;
export const SURFACES_CLOSED_COPY = "お支払い管理は現在ご利用いただけません。" as const;
/** Checkout 成功後 poll が 5 分 / 連続失敗で止まったときの確認不能 UX（runbook と同文） */
export const CHECKOUT_POLL_UNCONFIRMED_COPY = "お支払い状況を確認できません" as const;
