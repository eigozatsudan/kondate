/**
 * 同じ /login 上の番号待ち状態。
 * flowId / 番号 / returnTo は載せない（sessionStorage snapshot も同じ）。
 */
export type EmailOtpLoginState =
  | { status: "idle"; email: string }
  | { status: "sending"; email: string }
  | { status: "waiting"; email: string; resendAvailableAt: string }
  | { status: "verifying"; email: string; resendAvailableAt: string }
  | { status: "complete" }
  | { status: "send_failed"; email: string; message: string };

/** 互換 alias。login 以外からは参照しない */
export type MagicLinkState = EmailOtpLoginState;
