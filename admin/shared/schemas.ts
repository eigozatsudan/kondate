import { z } from "zod";

/** API エラー envelope の closed code / 日本語 message */
export const closedErrorSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
  message: z.string().min(1).max(200),
});

export const apiErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: closedErrorSchema,
});

export const generationStatusSchema = z.enum([
  "processing",
  "succeeded",
  "failed",
  "constraint_conflict",
]);

export const generationListItemSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  status: generationStatusSchema,
  requestKind: z.string(),
  failureCode: z.string().nullable(),
  durationMs: z.number().nullable(),
  actualModelIds: z.array(z.string()),
  qualityMode: z.boolean(),
  repairAttempted: z.boolean(),
  userId: z.string().uuid(),
});

export const generationDetailSchema = generationListItemSchema.extend({
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  userUsageDay: z.string().nullable(),
  globalSentCalls: z.number().nullable(),
  terminalDetails: z.unknown().nullable(),
  changeReason: z.string().nullable(),
  draftId: z.string().uuid().nullable(),
  sourceMenuId: z.string().uuid().nullable(),
  replaceDishId: z.string().uuid().nullable(),
  completedMenuId: z.string().uuid().nullable(),
  processingExpiresAt: z.string().nullable(),
  quotaSuccessLimit: z.number().nullable(),
});

export const feedbackListItemSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  category: z.string(),
  clientPath: z.string().nullable(),
  userId: z.string().uuid(),
  bodyPreview: z.string(),
});

export const feedbackDetailSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  category: z.string(),
  clientPath: z.string().nullable(),
  userId: z.string().uuid(),
  bodyPreview: z.string(),
  /** includeBody=1 のときのみ全文。それ以外は null */
  body: z.string().nullable(),
});

export const statusCountSchema = z.object({
  status: z.string(),
  count: z.number().int().nonnegative(),
});

export const categoryCountSchema = z.object({
  category: z.string(),
  count: z.number().int().nonnegative(),
});

export const dashboardResponseSchema = z.object({
  generatedAt: z.string(),
  connectionHost: z.string(),
  sessionUser: z.string(),
  todayJst: z.string(),
  rangeFromJst: z.string(),
  rangeToJst: z.string(),
  generationStatusCounts: z.array(statusCountSchema),
  globalUsageToday: z
    .object({
      usageDay: z.string(),
      reservedCount: z.number().int(),
      sentCount: z.number().int(),
    })
    .nullable(),
  feedbackCategoryCounts: z.array(categoryCountSchema),
  stuckGenerationCount: z.number().int().nonnegative(),
  shareFailedCount: z.number().int().nonnegative(),
  shareStuckCount: z.number().int().nonnegative(),
  sharePendingStaleCount: z.number().int().nonnegative(),
  billingStatusCounts: z.array(statusCountSchema),
});

export const nearLimitUserSchema = z.object({
  userId: z.string().uuid(),
  successCount: z.number().int().nonnegative(),
  quotaSuccessLimit: z.number().int().positive(),
});

export const failureCodeRankSchema = z.object({
  failureCode: z.string(),
  count: z.number().int().nonnegative(),
});

export const globalDailyUsageRowSchema = z.object({
  usageDay: z.string(),
  reservedCount: z.number().int(),
  sentCount: z.number().int(),
});

export const quotaHealthResponseSchema = z.object({
  generatedAt: z.string(),
  globalDailyUsage: z.array(globalDailyUsageRowSchema),
  stuckGenerations: z.array(generationListItemSchema),
  failureTop24h: z.array(failureCodeRankSchema),
  failureTop7d: z.array(failureCodeRankSchema),
  nearLimitUsers: z.array(nearLimitUserSchema),
});

export const billingSubscriptionRowSchema = z.object({
  userId: z.string().uuid(),
  status: z.string(),
  currentPeriodEnd: z.string().nullable(),
  trialEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  pastDueSince: z.string().nullable(),
});

export const eventTypeCountSchema = z.object({
  eventType: z.string(),
  count: z.number().int().nonnegative(),
});

export const billingResponseSchema = z.object({
  generatedAt: z.string(),
  statusCounts: z.array(statusCountSchema),
  cancelAtPeriodEndCount: z.number().int().nonnegative(),
  pastDueCount: z.number().int().nonnegative(),
  webhookEventTypeCounts: z.array(eventTypeCountSchema),
  subscriptions: z.array(billingSubscriptionRowSchema),
});

export const shareJobStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
]);

export const shareJobListItemSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  status: shareJobStatusSchema,
  failureCode: z.string().nullable(),
  skipReason: z.string().nullable(),
  claimedAt: z.string().nullable(),
  heartbeatAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  pass1Model: z.string().nullable(),
  pass2Model: z.string().nullable(),
  contributorUserId: z.string().uuid().nullable(),
  sourceMenuId: z.string().uuid().nullable(),
});

export const shareJobsResponseSchema = z.object({
  generatedAt: z.string(),
  stuckCount: z.number().int().nonnegative(),
  pendingStaleCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  jobs: z.array(shareJobListItemSchema),
});

/** 共有レシピ一覧・詳細の status / mealType */
export const sharedRecipeStatusSchema = z.enum(["active", "disabled"]);
export const sharedMealTypeSchema = z.enum(["breakfast", "lunch", "dinner"]);

/** 一覧行。menu_payload は含めない（preview は detail のみ） */
export const sharedRecipeListItemSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  status: sharedRecipeStatusSchema,
  mealType: sharedMealTypeSchema,
  totalElapsedMinutes: z.number().int().positive(),
  title: z.string().min(1).max(80),
  standardAllergenIds: z.array(z.string()),
  eligibleAgeBands: z.array(z.string()),
  contributorUserId: z.string().uuid().nullable(),
  sourceMenuId: z.string().uuid().nullable(),
});

export const sharedRecipesResponseSchema = z.object({
  generatedAt: z.string(),
  activeCount: z.number().int().nonnegative(),
  disabledCount: z.number().int().nonnegative(),
  items: z.array(sharedRecipeListItemSchema),
});

const previewIngredientSchema = z.object({
  name: z.string(),
  quantityText: z.string(),
  unit: z.string().nullable(),
  storeSection: z.string(),
});

const previewStepSchema = z.object({
  position: z.number().int(),
  instruction: z.string(),
});

const previewDishSchema = z.object({
  role: z.string(),
  position: z.number().int(),
  name: z.string(),
  description: z.string(),
  cookingTimeMinutes: z.number().int(),
  ingredients: z.array(previewIngredientSchema),
  steps: z.array(previewStepSchema),
});

const previewTimelineSchema = z.object({
  position: z.number().int(),
  startMinute: z.number().int(),
  durationMinutes: z.number().int(),
  instruction: z.string(),
});

const previewSafetyActionSchema = z.object({
  kind: z.string(),
  instruction: z.string(),
});

const previewAdaptationSchema = z.object({
  portionText: z.string(),
  additionalCutting: z.string().nullable(),
  additionalHeating: z.string().nullable(),
  additionalSeasoning: z.string().nullable(),
  servingCheck: z.string(),
  anonymousMemberRef: z.string(),
  safetyActions: z.array(previewSafetyActionSchema),
});

/** menu_payload を整形した閲覧用 preview（生 JSON は載せない） */
export const sharedRecipePreviewSchema = z.object({
  schemaVersion: z.string(),
  menuId: z.string().uuid(),
  mealType: sharedMealTypeSchema,
  cuisineGenre: z.string(),
  servings: z.number().int(),
  totalElapsedMinutes: z.number().int(),
  safetyTags: z.array(z.string()),
  dishes: z.array(previewDishSchema).min(1),
  timeline: z.array(previewTimelineSchema),
  adaptations: z.array(previewAdaptationSchema),
});

export const sharedRecipePreviewErrorSchema = z.enum([
  "invalid_menu_payload",
  "unsupported_schema_version",
]);

export const sharedRecipeDetailSchema = sharedRecipeListItemSchema.extend({
  preview: sharedRecipePreviewSchema.nullable(),
  previewError: sharedRecipePreviewErrorSchema.nullable(),
});

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    status: z.enum(["up", "degraded"]),
    dbReady: z.boolean(),
    connectionHost: z.string().nullable(),
    sessionUser: z.string().nullable(),
  }),
});

/**
 * mapper / Zod 二重排除用。DTO キーおよび snake 別名を列挙する。
 * これらを schemas やレスポンスに置いてはならない。
 */
export const FORBIDDEN_DTO_KEYS = [
  "identityKey",
  "identity_key",
  "requestHmac",
  "request_hmac",
  "requestHmacVersion",
  "request_hmac_version",
  "stripeSubscriptionId",
  "stripe_subscription_id",
  "stripeCustomerId",
  "stripe_customer_id",
  "stripeEventId",
  "stripe_event_id",
  "stripePriceId",
  "stripe_price_id",
  "email",
  "menu_payload",
  "menuPayload",
] as const;

export type GenerationListItem = z.infer<typeof generationListItemSchema>;
export type GenerationDetail = z.infer<typeof generationDetailSchema>;
export type FeedbackListItem = z.infer<typeof feedbackListItemSchema>;
export type FeedbackDetail = z.infer<typeof feedbackDetailSchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type QuotaHealthResponse = z.infer<typeof quotaHealthResponseSchema>;
export type BillingResponse = z.infer<typeof billingResponseSchema>;
export type ShareJobsResponse = z.infer<typeof shareJobsResponseSchema>;
export type ShareJobListItem = z.infer<typeof shareJobListItemSchema>;
export type SharedRecipeListItem = z.infer<typeof sharedRecipeListItemSchema>;
export type SharedRecipesResponse = z.infer<typeof sharedRecipesResponseSchema>;
export type SharedRecipePreview = z.infer<typeof sharedRecipePreviewSchema>;
export type SharedRecipeDetail = z.infer<typeof sharedRecipeDetailSchema>;
