# 献立材料まとめタブ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `MenuResult` 共有の「全体の段取り」ブロックに「段取り / 材料まとめ」タブを追加し、全料理材料を在庫非控除で合算表示する（調理前チェック用）。

**Architecture:** menu-detail の純関数 `buildMenuIngredientsSummary` が dishes を売り場区分順の合算行に変換する。正規化は `@shared/shopping/normalize` を再利用し、在庫差し引きと aliases は使わない。`MenuSteps` にローカルタブ state を置き、両適用面（生成結果・`/menus/:id`）に同時に載せる。`categoryLabel` は `src/shared/ui` へ移し feature 間依存を避ける。段取り tablist は **sticky しない** `.cook-timeline-tabs`（料理の `.menu-result-tabs` と分離）。既存 E2E / 単体のスコープなし `tab`/`tabpanel` クエリを料理 tablist 配下に直す。

**Tech Stack:** React 19、TypeScript strict、Vitest + Testing Library、Playwright E2E、既存 `.menu-result-*` / 新規 `.cook-timeline-tabs`、Docker `app` 経由の検証。

**Spec:** `docs/superpowers/specs/2026-08-09-menu-ingredients-summary-tab-design.md`

## Global Constraints

- Node.js `>=24 <25`、ESM、`strict: true`、境界で `any` 禁止、**`!` non-null 断言禁止**（本番 `.ts`/`.tsx`）
- ユーザー向け文言は日本語。コードコメント・コミットメッセージは日本語（Conventional Commits）
- Docker: `docker compose run --rm --no-deps app <cmd>`（コマンドは `&&` / `;` で連結しない）
- browser は `@shared/safety/*` を import しない。`@shared/shopping/normalize` は dual-surface 可
- `src/features/**/*.tsx` で生 Tailwind 禁止 → `Surface`/`Stack`/`Inset` + 意味クラスのみ
- API / DB / `shared/contracts` / `buildShoppingDraft` の業務ロジックは変更しない
- tablist `aria-label` 固定: `献立の段取りと材料`（E2E セレクタ）
- `h2#timeline-heading` の直接の親は常に `.cook-timeline-panel`
- 段取り tablist クラスは **`.cook-timeline-tabs` のみ**（`.menu-result-tabs` は料理列専用 sticky）

## File map

| ファイル | 責務 |
| --- | --- |
| `src/shared/ui/store-section-label.ts` | **新規** `categoryLabel` 正本（`ui/` 配置: `@/shared/ui/*` 習慣に揃える） |
| `src/features/shopping/category-label.ts` | re-export のみ |
| `src/styles.css` | **`.cook-timeline-tabs` 追加**（sticky なし） |
| `src/features/menu-detail/build-menu-ingredients-summary.ts` | **新規** 合算純関数 |
| `src/features/menu-detail/build-menu-ingredients-summary.test.ts` | **新規** 純関数テスト |
| `src/features/menu-detail/menu-ingredients-summary.tsx` | **新規** 区分+行表示（`div`+`h3`、region にしない） |
| `src/features/menu-detail/menu-ingredients-summary.test.tsx` | **新規** 表示テスト |
| `src/features/menu-detail/menu-steps.tsx` | タブ + panel 切替 |
| `src/features/menu-detail/menu-steps.test.tsx` | タブ a11y / 初期段取り / Home End |
| `src/features/generation/components/menu-result.test.tsx` | 料理 tab スコープ修正（行番号は Task 3 Step 8） |
| `e2e/specs/generation-recovery-results.spec.ts` | 料理 tab スコープ + 材料タブ/横幅 |
| `e2e/specs/full-journey.spec.ts` | 料理 tab スコープ |

**対象外（修正不要）:** `src/features/menu-detail/menu-dishes.test.tsx` の無スコープ `getByRole("tabpanel")` は **MenuDishes 単体 render** のため段取りタブが存在せず、現状のままでよい。

---

### Task 1: `categoryLabel` を `src/shared/ui` へ移設

**Files:**
- Create: `src/shared/ui/store-section-label.ts`
- Modify: `src/features/shopping/category-label.ts`（re-export）
- Test: 既存 `src/features/shopping/pages/shopping-list-page.test.tsx`（import 経路維持で回帰）

**Interfaces:**
- Consumes: `StoreSection` from `@shared/contracts/shopping`
- Produces:
  - `export function categoryLabel(section: StoreSection): string`
  - ラベル表は現行どおり（野菜 / 肉・魚 / 乳製品・卵 / 乾物 / 調味料 / その他）

- [ ] **Step 1: 正本ファイルを作成**

`src/shared/ui/store-section-label.ts`（`ui/` に置く理由: 既存 browser 共有 UI ラベルの import 習慣に揃え、計画パスを1つに固定。純粋文言でも `lib/` へ分ける必要はない）:

```ts
import type { StoreSection } from "@shared/contracts/shopping";

const sectionLabels: Record<StoreSection, string> = {
  produce: "野菜",
  meat_fish: "肉・魚",
  dairy_eggs: "乳製品・卵",
  dry_goods: "乾物",
  seasonings: "調味料",
  other: "その他",
};

/** 売場セクションの日本語ラベル（menu-detail / shopping 共用）。 */
export function categoryLabel(section: StoreSection): string {
  return sectionLabels[section];
}
```

- [ ] **Step 2: shopping 側を re-export に変更**

`src/features/shopping/category-label.ts` を次の内容だけにする（コメントで移設理由を日本語で）:

```ts
/**
 * 正本は src/shared/ui/store-section-label.ts。
 * shopping 既存 import を壊さないための re-export。
 */
export { categoryLabel } from "@/shared/ui/store-section-label";
```

- [ ] **Step 3: 回帰テスト**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run src/features/shopping/pages/shopping-list-page.test.tsx
```

Expected: PASS（`categoryLabel` のラベル期待が緑）

- [ ] **Step 4: Commit**

```bash
git add src/shared/ui/store-section-label.ts src/features/shopping/category-label.ts
git commit -m "refactor: 売場ラベルを shared UI に移設する"
```

---

### Task 2: 合算純関数 `buildMenuIngredientsSummary`（TDD）

**Files:**
- Create: `src/features/menu-detail/build-menu-ingredients-summary.ts`
- Create: `src/features/menu-detail/build-menu-ingredients-summary.test.ts`

**Interfaces:**
- Consumes:
  - `ValidatedMenu` type from `@shared/contracts/generation`（`dishes` 配列）
  - `storeSections` from `@shared/contracts/generation`
  - `normalizeIngredientName`, `normalizeUnit`, `roundQuantityValue`, `formatQuantityValue` from `@shared/shopping/normalize`
- Produces:

```ts
export type MenuIngredientSummaryLine = {
  /** React key 用。正規化キー由来の安定文字列 */
  key: string;
  displayName: string;
  quantityValue: number | null;
  quantityText: string;
  unit: string | null;
  storeSection: (typeof storeSections)[number];
  labelConfirmationRequired: boolean;
};

export type MenuIngredientSummarySection = {
  storeSection: (typeof storeSections)[number];
  lines: readonly MenuIngredientSummaryLine[];
};

/** 調理前チェック用。在庫差し引き・aliases なし。買い物 draft とは別系統。 */
export function buildMenuIngredientsSummary(
  dishes: ValidatedMenu["dishes"],
): readonly MenuIngredientSummarySection[];
```

**アルゴリズム（実装が従う仕様）:**
1. dishes を `position` 昇順、各 dish 内 ingredients を `position` 昇順で走査し、出現 index `0..n-1` を付与。
2. 別名マップは `new Map<string, string>()`（空固定）。
3. **合算可能:** `quantityValue !== null` かつ `normalizeUnit(unit) !== null`。  
   キー = `JSON.stringify([normalizedName, normalizedUnit])`。  
   数量は加算後 `roundQuantityValue`。`quantityText = \`${formatQuantityValue(sum)}${normalizedUnit}\``。  
   **未登録単位（本・片など）も synonym 解決後の文字列一致で合算する。**
4. **合算不可:** 数量は足さない。キー = `JSON.stringify([normalizedName, normalizedUnit, quantityText])` で **完全一致行を1行に畳む**。`quantityText` は元のまま。
5. 各グループ: `displayName` / `storeSection` は最初出現、`labelConfirmationRequired` は OR、代表位置 = 最初の出現 index。
6. 全グループを `storeSections` 順にバケツ分けし、同一区分内は代表位置昇順。空区分は返さない。

- [ ] **Step 1: 失敗するテストを書く**

`src/features/menu-detail/build-menu-ingredients-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ValidatedMenu } from "@shared/contracts/generation";
import { buildMenuIngredientsSummary } from "./build-menu-ingredients-summary";

type Dish = ValidatedMenu["dishes"][number];
type Ingredient = Dish["ingredients"][number];

const ing = (overrides: Partial<Ingredient> & Pick<Ingredient, "id" | "name">): Ingredient => ({
  position: 1,
  quantityValue: 1,
  quantityText: "1",
  unit: "個",
  storeSection: "produce",
  pantrySelectionId: null,
  labelConfirmationRequired: false,
  ...overrides,
});

const dish = (
  overrides: Partial<Dish> & Pick<Dish, "id" | "name" | "ingredients">,
): Dish => ({
  role: "main",
  position: 1,
  description: "説明",
  cookingTimeMinutes: 10,
  steps: [
    {
      id: "51000000-0000-4000-8000-000000000099",
      position: 1,
      instruction: "作る",
    },
  ],
  ...overrides,
});

describe("buildMenuIngredientsSummary", () => {
  it("sums same normalized name and unit across dishes", () => {
    const sections = buildMenuIngredientsSummary([
      dish({
        id: "50000000-0000-4000-8000-000000000001",
        name: "A",
        position: 1,
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000001",
            name: "玉ねぎ",
            quantityValue: 1,
            quantityText: "1個",
            unit: "個",
            storeSection: "produce",
          }),
        ],
      }),
      dish({
        id: "50000000-0000-4000-8000-000000000002",
        name: "B",
        position: 2,
        role: "side",
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000002",
            name: "玉ねぎ",
            quantityValue: 0.5,
            quantityText: "1/2個",
            unit: "個",
            storeSection: "produce",
          }),
        ],
      }),
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.storeSection).toBe("produce");
    expect(sections[0]?.lines).toHaveLength(1);
    expect(sections[0]?.lines[0]).toMatchObject({
      displayName: "玉ねぎ",
      quantityValue: 1.5,
      quantityText: "1.5個",
      unit: "個",
    });
  });

  it("merges gram synonyms (g and グラム)", () => {
    const sections = buildMenuIngredientsSummary([
      dish({
        id: "50000000-0000-4000-8000-000000000001",
        name: "A",
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000001",
            name: "小麦粉",
            quantityValue: 50,
            quantityText: "50g",
            unit: "g",
            storeSection: "dry_goods",
          }),
          ing({
            id: "53000000-0000-4000-8000-000000000002",
            name: "小麦粉",
            position: 2,
            quantityValue: 30,
            quantityText: "30グラム",
            unit: "グラム",
            storeSection: "dry_goods",
          }),
        ],
      }),
    ]);
    const dry = sections.find((s) => s.storeSection === "dry_goods");
    expect(dry?.lines).toHaveLength(1);
    expect(dry?.lines[0]).toMatchObject({
      quantityValue: 80,
      quantityText: "80g",
      unit: "g",
    });
  });

  it("sums unregistered units by string identity after normalizeUnit (本)", () => {
    const sections = buildMenuIngredientsSummary([
      dish({
        id: "50000000-0000-4000-8000-000000000001",
        name: "A",
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000001",
            name: "にんじん",
            quantityValue: 1,
            quantityText: "1本",
            unit: "本",
            storeSection: "produce",
          }),
          ing({
            id: "53000000-0000-4000-8000-000000000002",
            name: "にんじん",
            position: 2,
            quantityValue: 2,
            quantityText: "2本",
            unit: "本",
            storeSection: "produce",
          }),
        ],
      }),
    ]);
    expect(sections[0]?.lines[0]).toMatchObject({
      quantityValue: 3,
      quantityText: "3本",
      unit: "本",
    });
  });

  it("keeps different units as separate lines", () => {
    const sections = buildMenuIngredientsSummary([
      dish({
        id: "50000000-0000-4000-8000-000000000001",
        name: "A",
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000001",
            name: "牛乳",
            quantityValue: 100,
            quantityText: "100ml",
            unit: "ml",
            storeSection: "dairy_eggs",
          }),
          ing({
            id: "53000000-0000-4000-8000-000000000002",
            name: "牛乳",
            position: 2,
            quantityValue: 1,
            quantityText: "1本",
            unit: "本",
            storeSection: "dairy_eggs",
          }),
        ],
      }),
    ]);
    expect(sections[0]?.lines).toHaveLength(2);
  });

  it("collapses identical non-numeric rows (塩 少々 x3 → 1 line)", () => {
    const salt = (id: string, dishId: string, position: number) =>
      dish({
        id: dishId,
        name: `D${position}`,
        position,
        role: position === 1 ? "main" : "side",
        ingredients: [
          ing({
            id,
            name: "塩",
            quantityValue: null,
            quantityText: "少々",
            unit: null,
            storeSection: "seasonings",
          }),
        ],
      });
    const sections = buildMenuIngredientsSummary([
      salt(
        "53000000-0000-4000-8000-000000000001",
        "50000000-0000-4000-8000-000000000001",
        1,
      ),
      salt(
        "53000000-0000-4000-8000-000000000002",
        "50000000-0000-4000-8000-000000000002",
        2,
      ),
      salt(
        "53000000-0000-4000-8000-000000000003",
        "50000000-0000-4000-8000-000000000003",
        3,
      ),
    ]);
    const seasonings = sections.find((s) => s.storeSection === "seasonings");
    expect(seasonings?.lines).toHaveLength(1);
    expect(seasonings?.lines[0]).toMatchObject({
      displayName: "塩",
      quantityValue: null,
      quantityText: "少々",
      unit: null,
    });
  });

  it("does not collapse non-numeric rows with different quantityText", () => {
    const sections = buildMenuIngredientsSummary([
      dish({
        id: "50000000-0000-4000-8000-000000000001",
        name: "A",
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000001",
            name: "塩",
            quantityValue: null,
            quantityText: "少々",
            unit: null,
            storeSection: "seasonings",
          }),
          ing({
            id: "53000000-0000-4000-8000-000000000002",
            name: "塩",
            position: 2,
            quantityValue: null,
            quantityText: "適量",
            unit: null,
            storeSection: "seasonings",
          }),
        ],
      }),
    ]);
    expect(sections[0]?.lines).toHaveLength(2);
  });

  it("orders sections by storeSections definition and lines by first appearance", () => {
    const sections = buildMenuIngredientsSummary([
      dish({
        id: "50000000-0000-4000-8000-000000000001",
        name: "A",
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000001",
            name: "しょうゆ",
            quantityValue: 1,
            quantityText: "大さじ1",
            unit: "大さじ",
            storeSection: "seasonings",
          }),
          ing({
            id: "53000000-0000-4000-8000-000000000002",
            name: "にんじん",
            position: 2,
            quantityValue: 1,
            quantityText: "1本",
            unit: "本",
            storeSection: "produce",
          }),
        ],
      }),
    ]);
    expect(sections.map((s) => s.storeSection)).toEqual(["produce", "seasonings"]);
    expect(sections[0]?.lines[0]?.displayName).toBe("にんじん");
  });

  it("ORs labelConfirmationRequired within a group", () => {
    const sections = buildMenuIngredientsSummary([
      dish({
        id: "50000000-0000-4000-8000-000000000001",
        name: "A",
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000001",
            name: "しょうゆ",
            quantityValue: 1,
            quantityText: "大さじ1",
            unit: "大さじ",
            storeSection: "seasonings",
            labelConfirmationRequired: false,
          }),
          ing({
            id: "53000000-0000-4000-8000-000000000002",
            name: "しょうゆ",
            position: 2,
            quantityValue: 1,
            quantityText: "大さじ1",
            unit: "大さじ",
            storeSection: "seasonings",
            labelConfirmationRequired: true,
          }),
        ],
      }),
    ]);
    expect(sections[0]?.lines[0]?.labelConfirmationRequired).toBe(true);
  });

  it("avoids floating-point noise when summing fractions", () => {
    const sections = buildMenuIngredientsSummary([
      dish({
        id: "50000000-0000-4000-8000-000000000001",
        name: "A",
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000001",
            name: "みりん",
            quantityValue: 0.1,
            quantityText: "0.1大さじ",
            unit: "大さじ",
            storeSection: "seasonings",
          }),
          ing({
            id: "53000000-0000-4000-8000-000000000002",
            name: "みりん",
            position: 2,
            quantityValue: 0.2,
            quantityText: "0.2大さじ",
            unit: "大さじ",
            storeSection: "seasonings",
          }),
        ],
      }),
    ]);
    expect(sections[0]?.lines[0]?.quantityValue).toBe(0.3);
    expect(sections[0]?.lines[0]?.quantityText).toBe("0.3大さじ");
  });
});
```

- [ ] **Step 2: RED を確認**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run src/features/menu-detail/build-menu-ingredients-summary.test.ts
```

Expected: FAIL（module not found または function undefined）

- [ ] **Step 3: 最小実装**

`src/features/menu-detail/build-menu-ingredients-summary.ts` を仕様どおり実装する。ファイル先頭コメント（日本語）で次を明記する:

- 調理前チェック用。買い物 `buildShoppingDraft` とは別（在庫非控除・aliases 空）
- 合算行の `quantityText` は `formatQuantityValue`（`MenuDishes.amount` とは別系統）
- 未登録単位も `normalizeUnit` 後の文字列一致で合算

実装骨格（この構造を埋める）:

```ts
import type { ValidatedMenu } from "@shared/contracts/generation";
import { storeSections } from "@shared/contracts/generation";
import {
  formatQuantityValue,
  normalizeIngredientName,
  normalizeUnit,
  roundQuantityValue,
} from "@shared/shopping/normalize";

const EMPTY_ALIASES: ReadonlyMap<string, string> = new Map();

export type MenuIngredientSummaryLine = {
  key: string;
  displayName: string;
  quantityValue: number | null;
  quantityText: string;
  unit: string | null;
  storeSection: (typeof storeSections)[number];
  labelConfirmationRequired: boolean;
};

export type MenuIngredientSummarySection = {
  storeSection: (typeof storeSections)[number];
  lines: readonly MenuIngredientSummaryLine[];
};

type MutableGroup = MenuIngredientSummaryLine & { firstAppearance: number };

export function buildMenuIngredientsSummary(
  dishes: ValidatedMenu["dishes"],
): readonly MenuIngredientSummarySection[] {
  const groups = new Map<string, MutableGroup>();
  let appearance = 0;
  // toSorted は新配列を返すので [...x].toSorted は不要
  const orderedDishes = dishes.toSorted((a, b) => a.position - b.position);
  for (const d of orderedDishes) {
    const orderedIngredients = d.ingredients.toSorted((a, b) => a.position - b.position);
    for (const item of orderedIngredients) {
      const normalizedName = normalizeIngredientName(item.name, EMPTY_ALIASES);
      const unit = normalizeUnit(item.unit);
      // value をローカルに束縛して narrow（item.quantityValue! は lint error）
      const value = item.quantityValue;
      if (value !== null && unit !== null) {
        const key = JSON.stringify(["m", normalizedName, unit]);
        const existing = groups.get(key);
        if (existing === undefined) {
          groups.set(key, {
            key,
            displayName: item.name,
            quantityValue: value,
            quantityText: `${formatQuantityValue(value)}${unit}`,
            unit,
            storeSection: item.storeSection,
            labelConfirmationRequired: item.labelConfirmationRequired,
            firstAppearance: appearance,
          });
        } else if (existing.quantityValue !== null) {
          const sum = roundQuantityValue(existing.quantityValue + value);
          existing.quantityValue = sum;
          existing.quantityText = `${formatQuantityValue(sum)}${unit}`;
          existing.labelConfirmationRequired =
            existing.labelConfirmationRequired || item.labelConfirmationRequired;
        }
      } else {
        const key = JSON.stringify(["a", normalizedName, unit, item.quantityText]);
        const existing = groups.get(key);
        if (existing === undefined) {
          groups.set(key, {
            key,
            displayName: item.name,
            quantityValue: null,
            quantityText: item.quantityText,
            unit,
            storeSection: item.storeSection,
            labelConfirmationRequired: item.labelConfirmationRequired,
            firstAppearance: appearance,
          });
        } else {
          existing.labelConfirmationRequired =
            existing.labelConfirmationRequired || item.labelConfirmationRequired;
        }
      }
      appearance += 1;
    }
  }

  const bySection = new Map<(typeof storeSections)[number], MutableGroup[]>();
  for (const group of groups.values()) {
    const list = bySection.get(group.storeSection) ?? [];
    list.push(group);
    bySection.set(group.storeSection, list);
  }

  const result: MenuIngredientSummarySection[] = [];
  for (const section of storeSections) {
    const list = bySection.get(section);
    if (list === undefined || list.length === 0) continue;
    list.sort((a, b) => a.firstAppearance - b.firstAppearance);
    result.push({
      storeSection: section,
      lines: list.map(({ firstAppearance: _fa, ...line }) => line),
    });
  }
  return result;
}
```

- [ ] **Step 4: GREEN を確認**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run src/features/menu-detail/build-menu-ingredients-summary.test.ts
```

Expected: PASS（全 it 緑）

- [ ] **Step 5: lint（本ファイルに `!` が残っていないこと）**

```bash
docker compose run --rm --no-deps app npm run lint -- --no-error-on-unmatched-pattern src/features/menu-detail/build-menu-ingredients-summary.ts
```

Expected: PASS（`no-non-null-assertion` なし）。プロジェクトの lint スクリプトがファイル引数を受けない場合は次で代替:

```bash
docker compose run --rm --no-deps app npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/features/menu-detail/build-menu-ingredients-summary.ts src/features/menu-detail/build-menu-ingredients-summary.test.ts
git commit -m "feat: 献立全体の材料合算純関数を追加する"
```

---

### Task 3: `MenuIngredientsSummary` + `MenuSteps` タブ UI

**Files:**
- Modify: `src/styles.css`（`.cook-timeline-tabs` 追加）
- Create: `src/features/menu-detail/menu-ingredients-summary.tsx`
- Create: `src/features/menu-detail/menu-ingredients-summary.test.tsx`
- Modify: `src/features/menu-detail/menu-steps.tsx`
- Modify: `src/features/menu-detail/menu-steps.test.tsx`
- Modify: `src/features/generation/components/menu-result.test.tsx`（料理 tab スコープ）

**Interfaces:**
- Consumes: `buildMenuIngredientsSummary`, `categoryLabel` from `@/shared/ui/store-section-label`, `Badge` from `@/shared/ui/feedback`
- Produces:
  - `export function MenuIngredientsSummary({ dishes }: { dishes: ValidatedMenu["dishes"] })`
  - `MenuSteps` は props 変更なし（`timeline` + `dishes`）
  - ローカル state: `"timeline" | "ingredients"`、初期 `"timeline"`（**意図的にローカル**。`MenuDishes` の親リフトとは非対称でよい）

**DOM ロック（必須）:**

```
Surface > Inset > .cook-timeline-panel
  > h2#timeline-heading 「全体の段取り」
  > role=tablist aria-label="献立の段取りと材料" class=cook-timeline-tabs
      > tab 「段取り」 id=steps-tab-timeline aria-controls=steps-panel-timeline
      > tab 「材料まとめ」 id=steps-tab-ingredients aria-controls=steps-panel-ingredients
  > role=tabpanel#steps-panel-timeline  (初期表示)
      > ol.cook-timeline ...（既存ロジックそのまま）
  > role=tabpanel#steps-panel-ingredients
      > MenuIngredientsSummary（区分は div + h3）
```

- 非選択 panel は unmount または `hidden` でよいが、**段取りが初期選択**であること。
- キーボード: ArrowLeft/Right/Home/End + roving tabindex（`MenuDishes` と同型）。
- **tablist に `.menu-result-tabs` を付けない**（sticky 重なり禁止。spec §5.4）。

- [ ] **Step 0: `.cook-timeline-tabs` を styles.css に追加**

`.menu-result-tabs` 定義の直後に追加（sticky / top / z-index / background は載せない）:

```css
/*
 * 段取り/材料 tablist。料理の .menu-result-tabs と sticky が top:0 で重ならないよう
 * position は static のまま。見た目（flex・gap・padding）だけ揃える。
 */
.cook-timeline-tabs {
  display: flex;
  min-width: 0;
  max-width: 100%;
  margin: 0;
  padding-block: 10px 6px;
  gap: var(--space-2);
  overflow-x: auto;
}
```

タブボタンは既存 `.menu-result-tab` を共有してよい。

- [ ] **Step 1: 材料 summary の RED テスト**

`src/features/menu-detail/menu-ingredients-summary.test.tsx`:

```ts
import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { makeMenuResultViewModel } from "@shared/testing/factories";
import { MenuIngredientsSummary } from "./menu-ingredients-summary";

it("renders store-section headings and ingredient rows from dishes", () => {
  const result = makeMenuResultViewModel();
  render(<MenuIngredientsSummary dishes={result.menu.dishes} />);
  // factory: ごはん(dry_goods) + にんじん(produce) → produce が先
  expect(screen.getByRole("heading", { name: "野菜" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "乾物" })).toBeVisible();
  // 区分は div（region landmark にしない）。見出しの親 div を掴む
  const produceHeading = screen.getByRole("heading", { name: "野菜" });
  const produce = produceHeading.parentElement;
  if (!(produce instanceof HTMLElement)) throw new Error("produce block required");
  expect(produce.tagName).toBe("DIV");
  expect(within(produce).getByText("にんじん")).toBeVisible();
  // 名前付き section/region を増やしていない
  expect(screen.queryByRole("region", { name: "野菜" })).toBeNull();
});
```

- [ ] **Step 2: RED 確認**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/menu-detail/menu-ingredients-summary.test.tsx
```

Expected: FAIL

- [ ] **Step 3: `MenuIngredientsSummary` 実装**

`src/features/menu-detail/menu-ingredients-summary.tsx`:

```tsx
import type { ValidatedMenu } from "@shared/contracts/generation";
import { buildMenuIngredientsSummary } from "./build-menu-ingredients-summary";
import { categoryLabel } from "@/shared/ui/store-section-label";
import { Badge } from "@/shared/ui/feedback";
import { Stack } from "@/shared/ui/stack";

export type MenuIngredientsSummaryProps = {
  dishes: ValidatedMenu["dishes"];
};

/**
 * 献立全体の材料まとめ（表示専用）。
 * 合算は buildMenuIngredientsSummary。区分は div+h3（region を増やさない）。
 * 生 Tailwind 禁止 → 意味クラスのみ。
 */
export function MenuIngredientsSummary({ dishes }: MenuIngredientsSummaryProps) {
  const sections = buildMenuIngredientsSummary(dishes);
  return (
    <Stack gap={4}>
      {sections.map((section) => (
        <div key={section.storeSection}>
          <h3
            id={`ingredient-section-${section.storeSection}`}
            className="menu-result-section-heading"
          >
            {categoryLabel(section.storeSection)}
          </h3>
          <ul className="menu-result-ingredient-list">
            {section.lines.map((line) => (
              <li key={line.key} className="menu-result-ingredient-row">
                <span className="menu-result-ingredient-name">
                  {line.displayName}
                  {line.labelConfirmationRequired ? (
                    <Badge tone="warning">ラベル確認</Badge>
                  ) : null}
                </span>
                <span className="menu-result-ingredient-amount">{line.quantityText}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Stack>
  );
}
```

- [ ] **Step 4: summary テスト GREEN**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/menu-detail/menu-ingredients-summary.test.tsx
```

Expected: PASS

- [ ] **Step 5: `MenuSteps` の RED テスト更新**

`src/features/menu-detail/menu-steps.test.tsx` を置き換え/拡張:

```ts
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { makeMenuResultViewModel } from "@shared/testing/factories";
import { MenuSteps } from "./menu-steps";

it("exposes the overall timeline heading and list structure by default", () => {
  const result = makeMenuResultViewModel();
  const { container } = render(
    <MenuSteps timeline={result.menu.timeline} dishes={result.menu.dishes} />,
  );

  const heading = screen.getByRole("heading", { name: "全体の段取り" });
  expect(heading).toBeVisible();
  expect(heading.id).toBe("timeline-heading");
  // DOM ロック: h2 の親は .cook-timeline-panel
  expect(heading.parentElement?.classList.contains("cook-timeline-panel")).toBe(true);

  const stepsTablist = screen.getByRole("tablist", { name: "献立の段取りと材料" });
  expect(stepsTablist).toBeVisible();
  expect(screen.getByRole("tab", { name: "段取り" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "材料まとめ" })).toHaveAttribute(
    "aria-selected",
    "false",
  );

  const timelinePanel = screen.getByRole("tabpanel", { name: "段取り" });
  const list = within(timelinePanel).getByRole("list");
  expect(list.tagName).toBe("OL");
  expect(list.className).toContain("cook-timeline");
  expect(screen.getAllByText(/分〜/u).length).toBeGreaterThan(0);
  // 材料まとめ panel は初期非表示（unmount なら heading 野菜が無い）
  expect(screen.queryByRole("heading", { name: "野菜" })).toBeNull();
  expect(container.querySelector(".cook-timeline-panel")).not.toBeNull();
});

it("switches to aggregated ingredients tab", async () => {
  const result = makeMenuResultViewModel();
  render(<MenuSteps timeline={result.menu.timeline} dishes={result.menu.dishes} />);
  await userEvent.click(screen.getByRole("tab", { name: "材料まとめ" }));
  expect(screen.getByRole("tab", { name: "材料まとめ" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const panel = screen.getByRole("tabpanel", { name: "材料まとめ" });
  expect(within(panel).getByRole("heading", { name: "野菜" })).toBeVisible();
  expect(within(panel).getByText("にんじん")).toBeVisible();
});

it("moves focus between steps tabs with arrow keys", async () => {
  const result = makeMenuResultViewModel();
  render(<MenuSteps timeline={result.menu.timeline} dishes={result.menu.dishes} />);
  const timelineTab = screen.getByRole("tab", { name: "段取り" });
  const ingredientsTab = screen.getByRole("tab", { name: "材料まとめ" });
  timelineTab.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(ingredientsTab).toHaveFocus();
  expect(ingredientsTab).toHaveAttribute("aria-selected", "true");
});

it("moves focus to first and last steps tabs with Home and End", async () => {
  const result = makeMenuResultViewModel();
  render(<MenuSteps timeline={result.menu.timeline} dishes={result.menu.dishes} />);
  const timelineTab = screen.getByRole("tab", { name: "段取り" });
  const ingredientsTab = screen.getByRole("tab", { name: "材料まとめ" });
  timelineTab.focus();
  await userEvent.keyboard("{End}");
  expect(ingredientsTab).toHaveFocus();
  expect(ingredientsTab).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Home}");
  expect(timelineTab).toHaveFocus();
  expect(timelineTab).toHaveAttribute("aria-selected", "true");
});
```

- [ ] **Step 6: MenuSteps をタブ化（最小変更）**

`menu-steps.tsx` を拡張:

- `useState<"timeline" | "ingredients">("timeline")`
- 既存 timeline 描画を `tabpanel` 内へ移動（ロジックはコピーではなく移動）
- 材料 panel で `<MenuIngredientsSummary dishes={dishes} />`
- tab ボタン: `className="menu-result-tab"`
- tablist: **`className="cook-timeline-tabs"`**（**`menu-result-tabs` は使わない**）
- `onKeyDown` で ArrowLeft/Right/Home/End

タブ id は固定:

- `steps-tab-timeline` / `steps-panel-timeline`
- `steps-tab-ingredients` / `steps-panel-ingredients`

accessible name: ボタンテキスト「段取り」「材料まとめ」→ `getByRole("tabpanel", { name: "段取り" })` が通るよう `aria-labelledby` をタブ id に紐づける。

- [ ] **Step 7: menu-steps テスト GREEN**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/menu-detail/menu-steps.test.tsx
```

Expected: PASS

- [ ] **Step 8: `menu-result.test.tsx` の tab/tabpanel を料理 tablist スコープに修正**

ページ全体に tab が複数あるため、次のヘルパをテストファイル先頭付近に追加:

```ts
function dishTablist() {
  return screen.getByRole("tablist", { name: "料理" });
}

function selectedDishPanel() {
  const selected = within(dishTablist()).getByRole("tab", { selected: true });
  const panelId = selected.getAttribute("aria-controls");
  if (panelId === null) throw new Error("dish tab must have aria-controls");
  const panel = document.getElementById(panelId);
  if (!(panel instanceof HTMLElement)) throw new Error("dish tabpanel missing");
  return panel;
}
```

**必ず直す行（取りこぼし禁止。MenuSteps が料理タブより前に来る）:**

| 行付近 | 現行 | 変更後 |
| --- | --- | --- |
| **:95–96** | `getByRole("tab", { name: /secondDish/ })` → `getByRole("tabpanel")` | `within(dishTablist()).getByRole("tab", …)` → `selectedDishPanel()` |
| **:106** | `screen.getAllByRole("tab")` | `within(dishTablist()).getAllByRole("tab")`（**最危険**: 未修正だと `tabs[0]` が「段取り」になり ArrowLeft が壊れる） |
| **:213** | `screen.getByRole("tabpanel")` | `selectedDishPanel()` |
| **:247** | `screen.getByRole("tabpanel")` | `selectedDishPanel()` |

`:95` の dish 名クリック、`:235` の second dish クリックも同様に `within(dishTablist())` でスコープする。

`shows the overall timeline before persistent dish tabs`（:50 付近）は見出し比較のまま残してよい。`getByRole("tablist", { name: "献立の段取りと材料" })` の存在を1行追加してよい。

**対象外:** `menu-dishes.test.tsx:34` の無スコープ `tabpanel` は MenuDishes 単体 render のため **変更不要**。

- [ ] **Step 9: 関連単体テスト一括**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/menu-detail src/features/generation/components/menu-result.test.tsx
```

Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/styles.css src/features/menu-detail/menu-ingredients-summary.tsx src/features/menu-detail/menu-ingredients-summary.test.tsx src/features/menu-detail/menu-steps.tsx src/features/menu-detail/menu-steps.test.tsx src/features/generation/components/menu-result.test.tsx
git commit -m "feat: 全体の段取りに材料まとめタブを追加する"
```

---

### Task 4: E2E スコープ修正と材料タブの横幅確認

**Files:**
- Modify: `e2e/specs/generation-recovery-results.spec.ts`
- Modify: `e2e/specs/full-journey.spec.ts`

**Interfaces:**
- Consumes: 固定 `aria-label="献立の段取りと材料"` / `"料理"`
- Produces: スコープ付きクエリ。誤って段取りタブを掴まない

- [ ] **Step 1: `generation-recovery-results.spec.ts` を修正**

#### 1a. 材料タブ横幅チェック（**挿入位置を1つに固定**）

**場所:** 段取りテキスト確認（`主菜を煮ながら副菜を仕上げる` など）の **直後**、かつ料理 tablist 操作（旧 L367 `getByRole("tablist", { name: "料理" })`）の **前**。

**必須:** チェック後に **必ず「段取り」タブへ戻す**。戻さないと後続の `resultRoot.querySelectorAll("*")` 溢れ検査に材料 panel が混ざる。

```ts
  // --- 材料まとめタブ: 320px 横はみ出し（viewport ループより前・段取りに必ず戻す） ---
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("tab", { name: "材料まとめ" }).click();
  const ingredientsPanel = page.getByRole("tabpanel", { name: "材料まとめ" });
  await expect(ingredientsPanel).toBeVisible();
  const stepsPanel = page.getByRole("heading", { name: "全体の段取り" }).locator("..");
  await expect(stepsPanel).toHaveClass(/cook-timeline-panel/);
  await expectContainedHorizontally(stepsPanel, ingredientsPanel);
  // 必須: 段取りに戻す（以降の料理タブ操作・overflow 走査と干渉させない）
  await page.getByRole("tab", { name: "段取り" }).click();
  await expect(page.getByRole("tabpanel", { name: "段取り" })).toBeVisible();
```

#### 1b. 料理タブ操作（旧 L367–375 付近）

```ts
  const dishTablist = page.getByRole("tablist", { name: "料理" });
  await expect(dishTablist).toBeVisible();
  await dishTablist.getByRole("tab").nth(1).click();
  // ...材料・作り方アサーション...
  await dishTablist.getByRole("tab").first().click();
```

#### 1c. 横幅計測ループ内（旧 L402–427 付近）

**`CSS.escape` は使わない**（Playwright は Node 実行で `CSS` が無い。`panel-${uuid}` もエスケープ不要）。

```ts
    const timeline = page.getByRole("heading", { name: "全体の段取り" }).locator("..");
    await expect(timeline).toHaveClass(/cook-timeline-panel/);

    const dishTablist = page.getByRole("tablist", { name: "料理" });
    const selectedDishTab = dishTablist.getByRole("tab", { selected: true });
    const dishPanelId = await selectedDishTab.getAttribute("aria-controls");
    if (dishPanelId === null) throw new Error("dish tab aria-controls required");
    // panel-${uuid}。Node に CSS グローバルは無い → 素の id セレクタ
    const tabpanel = page.locator(`#${dishPanelId}`);

    const stepsTablist = page.getByRole("tablist", { name: "献立の段取りと材料" });
    await expectContainedHorizontally(resultRoot, timeline);
    await expectContainedHorizontally(resultRoot, dishTablist);
    await expectContainedHorizontally(resultRoot, tabpanel);
    await expectContainedHorizontally(resultRoot, stepsTablist);
```

- [ ] **Step 2: `full-journey.spec.ts` を修正**

```ts
  // 料理タブ
  const dishTablist = page.getByRole("tablist", { name: "料理" });
  const dishTab = dishTablist.getByRole("tab").first();
  await expect(dishTab).toBeVisible();
  await dishTab.click();
```

- [ ] **Step 3: 単体の最終確認**

```bash
docker compose run --rm --no-deps app npm run format:check
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npx vitest run src/features/menu-detail src/features/generation/components/menu-result.test.tsx src/features/shopping/pages/shopping-list-page.test.tsx
```

Expected: すべて PASS

- [ ] **Step 4: E2E 実行**

```bash
./scripts/run-e2e.sh
```

Expected: PASS（少なくとも `generation-recovery-results` と `full-journey` が緑）。失敗したら tab スコープと DOM ロックを再確認。

（エージェント環境で E2E が重い/不可の場合は、人間に同コマンド実行を依頼し、summary を貼ってもらう。skip して完了扱いにしない。）

- [ ] **Step 5: Commit**

```bash
git add e2e/specs/generation-recovery-results.spec.ts e2e/specs/full-journey.spec.ts
git commit -m "test: 材料まとめタブ追加に合わせ E2E の tab スコープを直す"
```

---

### Task 5: 提出前検証の締め

**Files:** 差分なし（検証のみ）。失敗時のみ該当 Task に戻る。

- [ ] **Step 1: format / lint / typecheck / 焦点 vitest（再実行）**

各コマンドを独立実行（連結しない）:

```bash
docker compose run --rm --no-deps app npm run format:check
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npx vitest run src/features/menu-detail src/features/generation/components/menu-result.test.tsx
```

- [ ] **Step 2: E2E が未実行なら実行**

```bash
./scripts/run-e2e.sh
```

- [ ] **Step 3: 成功基準チェックリスト（人間/親エージェント）**

- [ ] 生成結果と `/menus/:id` の両方で「段取り」「材料まとめ」が切替できる
- [ ] 初期は段取りタイムライン、`h2` 親が `.cook-timeline-panel`
- [ ] 材料は合算・重複畳み・売り場順
- [ ] 料理 E2E が誤って段取りタブを掴まない
- [ ] 320px で材料 panel が横スクロールしない
- [ ] 買い物 API / 1品材料 UI を意図せず変えていない

差分があれば修正コミット。完了報告に実行コマンドと結果を記す。

---

## Spec coverage（self-review）

| Spec 要件 | Task |
| --- | --- |
| 両適用面（MenuResult 共有） | Task 3（MenuSteps 変更が両面に載る） |
| タブ「段取り」「材料まとめ」、初期段取り | Task 3 |
| DOM ロック `.cook-timeline-panel` | Task 3, 4 |
| **`.cook-timeline-tabs`（sticky 禁止）** | Task 3 Step 0 / Step 6 |
| 合算・g/グラム・未登録単位・非合算畳み | Task 2 |
| 1件でも formatQuantityValue 再生成 | Task 2 |
| aliases 空・在庫非控除 | Task 2 コメント + 実装 |
| categoryLabel shared 移設 | Task 1 |
| 区分 div+h3（region 禁止） | Task 3 Step 1/3 |
| 生 Tailwind 禁止 | Task 3（意味クラス） |
| Home/End キーボード | Task 3 Step 5 テスト |
| 空状態なし | Task 3（分岐なし） |
| ローカル state 意図 | Task 3 Interfaces |
| E2E スコープ + run-e2e 必須 | Task 4, 5 |
| 320px 材料 panel（段取りに戻す必須） | Task 4 Step 1a |
| 単体 menu-result tab スコープ（行番号付き） | Task 3 Step 8 |

## Placeholder scan

TBD / “similar to Task N” / 実装なき “add tests” なし。コマンド・コードブロックを各ステップに記載済み。

## Type consistency

- `MenuIngredientSummaryLine` / `MenuIngredientSummarySection` / `buildMenuIngredientsSummary(dishes)` を Task 2 で定義し Task 3 が消費
- tab id: `steps-tab-timeline` / `steps-tab-ingredients` / panels 同名
- aria-label: `献立の段取りと材料` 固定
