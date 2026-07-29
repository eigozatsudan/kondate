/**
 * OpenRouter の model ID を利用者向けの短い表示名にする。
 * 献立結果のメタ表示専用。技術 ID をそのまま出さず、読みやすい短縮名にする。
 */

/** よく使う ID の明示マップ（未知 ID はヒューリスティックに落とす） */
const KNOWN_LABELS: Readonly<Record<string, string>> = {
  "inception/mercury-2": "Mercury 2",
  "openai/gpt-4.1-nano": "GPT-4.1 Nano",
  "mock/kondate-primary:free": "Kondate Primary",
  "mock/kondate-repair:free": "Kondate Repair",
  "mock/primary:free": "Primary",
  "mock/repair:free": "Repair",
};

/**
 * model ID を短い表示名へ変換する。
 * 空・空白のみは空文字を返す（呼び出し側で非表示にする）。
 */
export function formatGenerationModelLabel(modelId: string): string {
  const trimmed = modelId.trim();
  if (trimmed === "") return "";

  const known = KNOWN_LABELS[trimmed];
  if (known !== undefined) return known;

  // vendor/name[:variant] → name 部分だけを人間向けに整形
  const slash = trimmed.lastIndexOf("/");
  const leaf = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  const base = leaf.split(":")[0] ?? leaf;
  if (base === "") return trimmed;

  return base
    .split(/[-_]/u)
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const lower = segment.toLowerCase();
      if (lower === "gpt") return "GPT";
      // 先頭が数字のセグメント（4.1 など）はそのまま
      if (/^\d/u.test(segment)) return segment;
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(" ");
}
