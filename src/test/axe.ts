import axe, { type AxeResults, type Result } from "axe-core";

/**
 * コンポーネントツリーに対して axe を走らせ、違反があれば ID と対象セレクタを
 * 含む AssertionError を投げる。region ルールは有効のままにし、main / nav 等の
 * ランドマーク欠落を検知する（Plan 6 Task 5 契約）。
 */
export async function runAxe(container: Element): Promise<AxeResults> {
  const results = await axe.run(container, {
    rules: {
      region: { enabled: true },
    },
  });
  if (results.violations.length > 0) {
    const summary = results.violations
      .map((violation: Result) => {
        const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
        return `${violation.id}: ${violation.help} [${targets}]`;
      })
      .join("\n");
    throw new Error(`axe violations (${String(results.violations.length)}):\n${summary}`);
  }
  return results;
}
