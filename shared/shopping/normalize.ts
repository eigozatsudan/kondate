export function normalizeIngredientName(
  name: string,
  aliases: ReadonlyMap<string, string>,
): string {
  const compact = name.normalize("NFKC").trim().replace(/\s+/gu, "");
  return aliases.get(compact) ?? compact;
}
