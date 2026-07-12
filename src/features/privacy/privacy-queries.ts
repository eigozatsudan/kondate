export const privacyKeys = {
  all: ["privacy"] as const,
  current: (userId: string) => ["privacy", "current", userId] as const,
};
