/**
 * メール 6 桁番号ログインのユーザー向け文言。
 * Spec §3.1–3.2 / §6 の exact 文字列。類義語や英語コードは出さない。
 */

/** Spec §3.1 リード（現行 login と同じ単一画面方針） */
export const EMAIL_OTP_LOGIN_LEAD =
  "はじめての方も、すでに使っている方も、この画面から進めます。" as const;

/** Spec §3.1 補足。番号 / Google の両方ではじめての方にアカウントができる */
export const EMAIL_OTP_LOGIN_NOTE =
  "新規登録の別画面はありません。番号を受け取るか Google で進むと、はじめての方はアカウントができます。パスワードの設定は不要です。" as const;

export const EMAIL_OTP_EMAIL_LABEL = "メールアドレス" as const;
export const EMAIL_OTP_SEND_BUTTON = "番号をメールで受け取る" as const;
export const EMAIL_OTP_SENDING = "送信中…" as const;
export const EMAIL_OTP_GOOGLE_BUTTON = "Googleで続ける" as const;
export const EMAIL_OTP_GOOGLE_STARTING = "Googleへ移動中…" as const;

/** Spec §3.2 番号待ち見出し。送信後も URL は /login のまま */
export const EMAIL_OTP_WAITING_HEADING = "メールを確認してください" as const;

/** Spec §3.2 宛先。空メールでは画面側が出さない */
export function emailOtpSentTo(email: string): string {
  return `${email} に送りました`;
}

export const EMAIL_OTP_WAITING_BODY =
  "メールに書いてある 6 つの数字を、下に入力してください。" as const;
export const EMAIL_OTP_WAITING_HINT = "迷惑メールフォルダも確認してください" as const;

/** Spec §3.2 各マスの aria-label。画面はここを読む（マス実装の複製を避ける） */
export const EMAIL_OTP_DIGIT_ARIA_LABELS = [
  "確認番号の1けた目",
  "確認番号の2けた目",
  "確認番号の3けた目",
  "確認番号の4けた目",
  "確認番号の5けた目",
  "確認番号の6けた目",
] as const;

/** Spec §3.2 再送床の待ち文言。n は画面が計算した残り秒 */
export function emailOtpResendWaitSeconds(n: number): string {
  return `${String(n)}秒後に再送できます`;
}

export const EMAIL_OTP_RESEND_BUTTON = "番号を再送" as const;
export const EMAIL_OTP_CHANGE_EMAIL = "メールアドレスを変更" as const;
export const EMAIL_OTP_SWITCH_TO_GOOGLE = "Googleに切り替える" as const;

/** Spec §6 送信失敗。サーバ文は出さない */
export const EMAIL_OTP_SEND_FAILED =
  "メールを送れませんでした。アドレスを確認してもう一度お試しください。" as const;

/** Spec §6 不一致・期限切れ・使用済み。三分割しない */
export const EMAIL_OTP_MISMATCH =
  "番号が違います。メールの 6 桁をもう一度入力してください。" as const;

/** Spec §6 回数超過・利用不可 */
export const EMAIL_OTP_UNAVAILABLE = "少し待ってから、新しい番号を受け取ってください。" as const;

/** Spec §6 Google 開始失敗 */
export const EMAIL_OTP_GOOGLE_START_FAILED =
  "Googleログインを開始できませんでした。もう一度お試しください。" as const;
