/**
 * planQuota 製品定数のうち、TS（plan-quota.ts）と mjs（preflight 等）が
 * 共有する単一正本（S4: 数値ミラーの二重定義を禁止）。
 *
 * 製品 max 自体の引き上げ時はここだけを改訂し、plan-quota コメントと
 * テスト期待を同期する。運用値（ENV の GLOBAL_DAILY_AI_LIMIT）の
 * 引き上げは ENV のみで足りる。
 */
export const GLOBAL_DAILY_AI_LIMIT_PRODUCT_MAX = 500;
