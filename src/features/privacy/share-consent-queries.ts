/** 共有同意の React Query キー。privacy とは別系統。 */
export const shareConsentKeys = {
  all: ["share-consent"] as const,
  current: (userId: string) => ["share-consent", "current", userId] as const,
  /** 本人が提供済みの緊急候補（title + date のみ） */
  sharedList: (userId: string) => ["share-consent", "shared-list", userId] as const,
};
