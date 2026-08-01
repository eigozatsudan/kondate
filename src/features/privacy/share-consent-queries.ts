/** 共有同意の React Query キー。privacy とは別系統。 */
export const shareConsentKeys = {
  all: ["share-consent"] as const,
  current: (userId: string) => ["share-consent", "current", userId] as const,
};
