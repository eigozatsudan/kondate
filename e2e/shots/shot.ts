import type { Page } from "@playwright/test";

/**
 * 提出物の幅。README「各 Phase 完了時の提出物」の 320 / 375 / 768 px。
 * 768 を含むのは styles.css の @media (min-width: 720px) 配下がどのテストからも
 * 検証されていないため。
 */
const WIDTHS = [320, 375, 768] as const;

const SHOT_ROOT = "docs/superpowers/plans/2026-08-08-ui-modernization";

/**
 * 同一画面を 3 幅で撮る。ファイル名は phase-0-shots / phase-1-shots と同じ
 * `<name>-<width>.png` 形式に揃える。
 */
export async function shot(page: Page, phaseDir: string, name: string): Promise<void> {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    // 幅変更後のレイアウト確定と、reduced-motion なしのトランジション収束を待つ。
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `${SHOT_ROOT}/${phaseDir}/${name}-${String(width)}.png`,
      fullPage: true,
    });
  }
  // 次の操作は既定幅に戻してから行う（狭い幅のままだと折り返しで要素を掴み損ねる）。
  await page.setViewportSize({ width: 375, height: 812 });
}
