/** 制限説明文の文頭に「無料版は」を付ける。二重付与しない。 */
export function formatFreeTierQuotaCopy(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) return trimmed;
  if (trimmed.startsWith("無料版は")) return trimmed;
  return `無料版は${trimmed}`;
}
