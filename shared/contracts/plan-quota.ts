/** プラン別製品上限と DB/Zod 防御天井。設計 2026-07-29 L6–L9。 */
export const planQuota = {
  free: {
    successPerDay: 3,
    attemptsPerDay: 6,
    shortWindowLimit: 4,
    shortWindowSeconds: 600,
  },
  plus: {
    successPerDay: 10,
    attemptsPerDay: 20,
    shortWindowLimit: 8,
    shortWindowSeconds: 600,
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
} as const;

export type PlanCode = "free" | "plus";

/** 後方互換: Free 固定の別名（既存 import を段階的に planQuota へ寄せる） */
export const releaseQuota = {
  userDailySuccessLimit: planQuota.free.successPerDay,
  userDailyExternalCallLimit: planQuota.free.attemptsPerDay,
  userShortWindowExternalCallLimit: planQuota.free.shortWindowLimit,
  userShortWindowSeconds: planQuota.free.shortWindowSeconds,
} as const;
