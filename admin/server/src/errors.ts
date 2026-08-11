/**
 * admin API / 起動の closed エラー。
 * err.message / SQLSTATE / URL を外部に出さない。
 */

export type ClosedErrorBody = {
  code: string;
  message: string;
};

export class AdminClosedError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly body: ClosedErrorBody;

  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "AdminClosedError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.body = { code, message };
  }
}

export function databaseUrlInvalid(): never {
  throw new AdminClosedError(
    "database_url_invalid",
    "データベース接続設定が不正です。",
    500,
  );
}

export function databaseStartupFailed(): never {
  throw new AdminClosedError(
    "database_startup_failed",
    "データベース起動検証に失敗しました。",
    500,
  );
}

export function badRequest(code: string, message: string): AdminClosedError {
  return new AdminClosedError(code, message, 400);
}

export function unauthorized(): AdminClosedError {
  return new AdminClosedError("unauthorized", "認証が必要です。", 401);
}

export function hostRejected(): AdminClosedError {
  return new AdminClosedError("host_rejected", "許可されていない Host です。", 400);
}

export function methodNotAllowed(): AdminClosedError {
  return new AdminClosedError("method_not_allowed", "このメソッドは許可されていません。", 405);
}

export function notFound(): AdminClosedError {
  return new AdminClosedError("not_found", "リソースが見つかりません。", 404);
}

export function internalError(): AdminClosedError {
  return new AdminClosedError(
    "internal_error",
    "内部エラーが発生しました。",
    500,
  );
}
