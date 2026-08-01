/**
 * 共有化の抽選・日次枠・lease・緊急配信 bound。
 * 通常 generate の planQuota / GLOBAL_DAILY_AI_LIMIT とは完全独立。
 * max*Running は claim 時の同時 running 上限（worker 過負荷防止）。
 */
export const shareQuota = {
  /** 適格成功のうち job 化する割合（%） */
  lotteryPercent: 20,
  /** 掲載成功 / ユーザー / 日 */
  perUserDailySuccessCap: 1,
  /** job 化（attempt）/ ユーザー / 日 */
  perUserDailyAttemptCap: 2,
  /** アプリ掲載成功 / 日 */
  appDailyAiSuccessCap: 200,
  /** Pass 呼び出し回数 / 日（失敗含む） */
  appDailyAiCallCap: 500,
  /** running の reaper 閾値（分） */
  jobLeaseMinutes: 15,
  /** 緊急レスポンス候補上限（S1∪S2） */
  emergencyMaxCandidates: 5,
  /** S2 を Stage S に載せる前の DB 取得上限 */
  sharePoolFetchLimit: 20,
  /** グローバル同時 running 上限 */
  maxGlobalRunning: 4,
  /** ユーザーあたり同時 running 上限 */
  maxPerUserRunning: 1,
} as const;
