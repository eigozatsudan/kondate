/**
 * planQuota 製品定数のうち、TS（plan-quota.ts）と mjs（preflight 等）が
 * 共有する単一正本（S1: 数値ミラーの二重定義を禁止）。
 *
 * 製品 max / Free 枠自体の引き上げ時は plan-quota-constants.mjs だけを改訂し、
 * 本ファイル・function-budget・env の text 引数・テスト期待を同期する。
 * 運用値（ENV の GLOBAL_DAILY_AI_LIMIT）の引き上げは ENV のみで足りる。
 */
import {
  FREE_ATTEMPTS_PER_DAY,
  FREE_SHORT_WINDOW_LIMIT,
  FREE_SHORT_WINDOW_SECONDS,
  FREE_SUCCESS_PER_DAY,
  GLOBAL_DAILY_AI_LIMIT_PRODUCT_MAX as productMaxFromShared,
} from "./plan-quota-constants.mjs";

/** プラン別製品上限と DB/Zod 防御天井。設計 2026-07-29 L6–L9。 */
export const planQuota = {
  free: {
    successPerDay: FREE_SUCCESS_PER_DAY,
    attemptsPerDay: FREE_ATTEMPTS_PER_DAY,
    shortWindowLimit: FREE_SHORT_WINDOW_LIMIT,
    shortWindowSeconds: FREE_SHORT_WINDOW_SECONDS,
  },
  plus: {
    successPerDay: 10,
    attemptsPerDay: 20,
    shortWindowLimit: 8,
    shortWindowSeconds: FREE_SHORT_WINDOW_SECONDS,
  },
  quality: {
    perDay: 3,
    perMonth: 20,
  },
  flyerWeekly: {
    successPerJstWeek: 2,
    /** OpenRouter 送信前に数える週次試行（成功 2 と独立） */
    triesPerJstWeek: 6,
  },
  /** DB CHECK / Zod max の防御上限（製品最大） */
  defense: {
    maxSuccessPerDay: 10,
    maxAttemptsPerDay: 20,
    maxShortWindow: 8,
    maxFlyerSuccessPerWeek: 2,
    maxFlyerTriesPerWeek: 6,
  },
  /**
   * アプリ全体の外部 AI 日次枠（GLOBAL_DAILY_AI_LIMIT）の製品 max。
   * 正本は plan-quota-constants.mjs（本オブジェクト経由 + preflight が同一 import）。
   * SQL は p_global_limit を範囲拒否しない。
   *
   * - 運用値の引き上げ（例: 80→200）: Netlify ENV のみ。コード・SQL 不要。
   * - 製品 max 自体の引き上げ（例: 500→1000）: plan-quota-constants.mjs のみ + 文書。
   */
  globalDailyAiLimitProductMax: productMaxFromShared,
} as const;

/** 上記 max の単独 export（env / テスト用）。mjs 正本と同一参照。 */
export const GLOBAL_DAILY_AI_LIMIT_PRODUCT_MAX = planQuota.globalDailyAiLimitProductMax;

export type PlanCode = "free" | "plus";

/** 後方互換: Free 固定の別名（既存 import を段階的に planQuota へ寄せる） */
export const releaseQuota = {
  userDailySuccessLimit: planQuota.free.successPerDay,
  userDailyExternalCallLimit: planQuota.free.attemptsPerDay,
  userShortWindowExternalCallLimit: planQuota.free.shortWindowLimit,
  userShortWindowSeconds: planQuota.free.shortWindowSeconds,
} as const;
