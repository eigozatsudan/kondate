# 分量表記の読みやすさ + 共有同意既定オン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 買い足し材料の過大な大さじ/小さじと数字付き定性表現を materialize 時に ml / 固定語へ正規化し、初回 `/privacy` の匿名共有チェックを既定オンにする。

**Architecture:** pure 関数 `normalizeIngredientQuantity`（`shared/shopping`）が triple（value/unit/text）を同時更新する。`materializeAiGeneratedMenu` と `materializeDishRegenerationCandidate` は pantry bind 後・`pantryRef === null` のときだけ呼ぶ。プロンプトは予防のみ。共有は UI 既定とコピーのみ変更し、RPC / version は触らない。

**Tech Stack:** TypeScript strict、Vitest、React 19、既存 `shared/shopping/normalize.ts`、Netlify Functions materializer。

**Spec:** `docs/superpowers/specs/2026-08-08-quantity-display-and-share-default-design.md`

## Global Constraints

- Node.js `>=24 <25`、ESM、`strict: true`、境界で `any` 禁止
- ユーザー向け文言は日本語。コードコメント・コミットメッセージは日本語
- Docker 経由: `docker compose run --rm --no-deps app <cmd>`（コマンドは連結しない）
- browser は `@shared/safety/*` を import しない。`shared/shopping` pure は dual-surface 可
- pantry 連動 ingredient は単位換算しない（既存 G5 / pantry_unit_mismatch）
- 英語単位（tbsp/tsp）を synonym に載せない
- Conventional Commits（日本語）
- worktree: `.worktrees/fix-quantity-display-and-share-default`、branch `fix/quantity-display-and-share-default`

## File map

| ファイル | 責務 |
| --- | --- |
| `shared/shopping/normalize.ts` | 大さじ/小さじ synonym |
| `shared/shopping/quantity-display.ts` | **新規** pure 正規化 |
| `shared/shopping/quantity-display.test.ts` | **新規** 表駆動 |
| `shared/shopping/normalize.test.ts` | synonym 追加テスト |
| `netlify/functions/_shared/generation-materializer.ts` | pantry 後に非 pantry 正規化 |
| `netlify/functions/_shared/generation-materializer.test.ts` | 結合 |
| `netlify/functions/_shared/regeneration-context.ts` | `mapLocalDish` で同様 |
| `netlify/functions/_shared/regeneration-context.test.ts` | 結合 1 本以上 |
| `netlify/functions/_shared/generation-prompt.ts` | 分量誘導文 |
| `netlify/functions/_shared/generation-prompt.test.ts` | 部分文字列ロック |
| `src/features/privacy/privacy-notice-page.tsx` | 既定 checked |
| `src/features/privacy/privacy-copy.ts` | 既定オン説明文 |
| `src/features/privacy/privacy-copy.test.ts` | コピーロック |
| `src/features/privacy/privacy-notice-page.test.tsx` | 既定 checked 反転 |
| `e2e/specs/onboarding.spec.ts` | 既定 checked |
| `README.md` | 既定オン表記 |

---

### Task 1: pure 分量正規化 + unit synonym

**Files:**
- Create: `shared/shopping/quantity-display.ts`
- Create: `shared/shopping/quantity-display.test.ts`
- Modify: `shared/shopping/normalize.ts`（`UNIT_SYNONYMS`）
- Modify: `shared/shopping/normalize.test.ts`

**Interfaces:**
- Consumes: `normalizeUnit`, `formatQuantityValue`, `roundQuantityValue` from `./normalize.js`
- Produces:
  - `export type IngredientQuantityFields = { quantityValue: number | null; quantityText: string; unit: string | null }`
  - `export function normalizeIngredientQuantity(input: IngredientQuantityFields): IngredientQuantityFields`
  - 定性固定語: `少々` | `適量` | `ひとつまみ` | `適宜`
  - 大さじ→ml ×15、小さじ→ml ×5、閾値 `roundQuantityValue(value) > 3`
  - P2: unit null 時に text パース（value 有限正なら value 優先）

- [ ] **Step 1: synonym の RED テストを追加**

`shared/shopping/normalize.test.ts` に追加:

```ts
  it("maps tablespoon/teaspoon Japanese synonyms to canonical spoon units", () => {
    expect(normalizeUnit("大さじ")).toBe("大さじ");
    expect(normalizeUnit("大匙")).toBe("大さじ");
    expect(normalizeUnit("小さじ")).toBe("小さじ");
    expect(normalizeUnit("小匙")).toBe("小さじ");
    // 英語は合法化しない
    expect(normalizeUnit("tbsp")).toBe("tbsp");
    expect(normalizeUnit("tsp")).toBe("tsp");
  });
```

- [ ] **Step 2: テスト実行（FAIL を確認）**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run shared/shopping/normalize.test.ts
```

Expected: FAIL（大匙/小匙がそのまま返る）

- [ ] **Step 3: `UNIT_SYNONYMS` を拡張**

`shared/shopping/normalize.ts` の `UNIT_SYNONYMS` に追加（既存 g/ml エントリの近く）:

```ts
  大さじ: "大さじ",
  大匙: "大さじ",
  小さじ: "小さじ",
  小匙: "小さじ",
```

- [ ] **Step 4: synonym テスト PASS**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run shared/shopping/normalize.test.ts
```

Expected: PASS

- [ ] **Step 5: quantity-display の RED テストを書く**

Create `shared/shopping/quantity-display.test.ts`:

```ts
// @vitest-environment node

import { describe, expect, it } from "vitest";
import { normalizeIngredientQuantity } from "./quantity-display.js";

describe("normalizeIngredientQuantity", () => {
  it.each([
    {
      name: "15 tbsp oil -> 225ml",
      input: { quantityValue: 15, quantityText: "15大さじ", unit: "大さじ" },
      expected: { quantityValue: 225, quantityText: "225ml", unit: "ml" },
    },
    {
      name: "30 tbsp milk -> 450ml",
      input: { quantityValue: 30, quantityText: "30大さじ", unit: "大さじ" },
      expected: { quantityValue: 450, quantityText: "450ml", unit: "ml" },
    },
    {
      name: "2 tbsp stays",
      input: { quantityValue: 2, quantityText: "2大さじ", unit: "大さじ" },
      expected: { quantityValue: 2, quantityText: "2大さじ", unit: "大さじ" },
    },
    {
      name: "boundary 3 tbsp stays",
      input: { quantityValue: 3, quantityText: "3大さじ", unit: "大さじ" },
      expected: { quantityValue: 3, quantityText: "3大さじ", unit: "大さじ" },
    },
    {
      name: "just over 3 tbsp converts",
      input: { quantityValue: 3.001, quantityText: "3.001大さじ", unit: "大さじ" },
      expected: { quantityValue: 45.015, quantityText: "45.015ml", unit: "ml" },
    },
    {
      name: "4 tsp -> 20ml",
      input: { quantityValue: 4, quantityText: "4小さじ", unit: "小さじ" },
      expected: { quantityValue: 20, quantityText: "20ml", unit: "ml" },
    },
    {
      name: "P2 parse text only 30大さじ",
      input: { quantityValue: null, quantityText: "30大さじ", unit: null },
      expected: { quantityValue: 450, quantityText: "450ml", unit: "ml" },
    },
    {
      name: "P2 parse 大さじ15 prefix",
      input: { quantityValue: null, quantityText: "大さじ15", unit: null },
      expected: { quantityValue: 225, quantityText: "225ml", unit: "ml" },
    },
    {
      name: "P2 value set unit null text spoon uses value",
      input: { quantityValue: 15, quantityText: "15大さじ", unit: null },
      expected: { quantityValue: 225, quantityText: "225ml", unit: "ml" },
    },
    {
      name: "non-spoon unit does not parse text spoon",
      input: { quantityValue: 15, quantityText: "15大さじ", unit: "g" },
      expected: { quantityValue: 15, quantityText: "15大さじ", unit: "g" },
    },
    {
      name: "non-finite value stays",
      input: { quantityValue: Number.NaN, quantityText: "15大さじ", unit: "大さじ" },
      expected: { quantityValue: Number.NaN, quantityText: "15大さじ", unit: "大さじ" },
    },
    {
      name: "tsp boundary 3 stays",
      input: { quantityValue: 3, quantityText: "3小さじ", unit: "小さじ" },
      expected: { quantityValue: 3, quantityText: "3小さじ", unit: "小さじ" },
    },
    {
      name: "大匙 synonym converts",
      input: { quantityValue: 10, quantityText: "10大匙", unit: "大匙" },
      expected: { quantityValue: 150, quantityText: "150ml", unit: "ml" },
    },
    {
      name: "1少々 -> 少々",
      input: { quantityValue: 1, quantityText: "1少々", unit: "少々" },
      expected: { quantityValue: null, quantityText: "少々", unit: null },
    },
    {
      name: "text 適量 only",
      input: { quantityValue: null, quantityText: "適量", unit: null },
      expected: { quantityValue: null, quantityText: "適量", unit: null },
    },
    {
      name: "partial 少し多め untouched",
      input: { quantityValue: null, quantityText: "少し多め", unit: null },
      expected: { quantityValue: null, quantityText: "少し多め", unit: null },
    },
    {
      name: "english tbsp untouched",
      input: { quantityValue: 15, quantityText: "15tbsp", unit: "tbsp" },
      expected: { quantityValue: 15, quantityText: "15tbsp", unit: "tbsp" },
    },
    {
      name: "grams untouched",
      input: { quantityValue: 300, quantityText: "300g", unit: "g" },
      expected: { quantityValue: 300, quantityText: "300g", unit: "g" },
    },
  ] as const)("$name", ({ input, expected }) => {
    expect(normalizeIngredientQuantity(input)).toEqual(expected);
  });

  it("prefers qualitative when text is bare 適量 even if unit is spoon", () => {
    expect(
      normalizeIngredientQuantity({
        quantityValue: 15,
        quantityText: "適量",
        unit: "大さじ",
      }),
    ).toEqual({ quantityValue: null, quantityText: "適量", unit: null });
  });

  it("rebuilds text from value+unit when spoon numeric wins over contradictory 適量 in middle", () => {
    // text が定性「のみ」でない場合は Step B（P1）
    expect(
      normalizeIngredientQuantity({
        quantityValue: 15,
        quantityText: "だいたい適量",
        unit: "大さじ",
      }),
    ).toEqual({ quantityValue: 225, quantityText: "225ml", unit: "ml" });
  });
});
```

- [ ] **Step 6: RED 確認**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run shared/shopping/quantity-display.test.ts
```

Expected: FAIL（module not found）

- [ ] **Step 7: 実装**

Create `shared/shopping/quantity-display.ts`:

```ts
import {
  formatQuantityValue,
  normalizeUnit,
  roundQuantityValue,
} from "./normalize.js";

export type IngredientQuantityFields = {
  quantityValue: number | null;
  quantityText: string;
  unit: string | null;
};

/** strict で string を受けられるよう includes（Set<"少々"|...> は typecheck で落ちる） */
const QUALITATIVE_WORDS = ["少々", "適量", "ひとつまみ", "適宜"] as const;

function isQualitativeWord(value: string): boolean {
  return (QUALITATIVE_WORDS as readonly string[]).includes(value);
}

const TBSP_ML = 15;
const TSP_ML = 5;
const SPOON_THRESHOLD = 3;

/** 定性語のみ（前後に任意の数可）。部分一致はしない。 */
const QUALITATIVE_TEXT =
  /^(?:(\d+(?:\.\d+)?)\s*)?(少々|適量|ひとつまみ|適宜)(?:\s*(\d+(?:\.\d+)?))?$/u;

/** N大さじ / 大さじN（大匙・小さじ・小匙含む） */
const SPOON_TEXT =
  /^(?:(\d+(?:\.\d+)?)\s*(大さじ|大匙|小さじ|小匙)|(大さじ|大匙|小さじ|小匙)\s*(\d+(?:\.\d+)?))$/u;

function spoonFactor(canonicalUnit: string): number | null {
  if (canonicalUnit === "大さじ") return TBSP_ML;
  if (canonicalUnit === "小さじ") return TSP_ML;
  return null;
}

function toMlTriple(value: number, factor: number): IngredientQuantityFields {
  const ml = roundQuantityValue(value * factor);
  return {
    quantityValue: ml,
    unit: "ml",
    quantityText: `${formatQuantityValue(ml)}ml`,
  };
}

function tryQualitative(input: IngredientQuantityFields): IngredientQuantityFields | null {
  const unitCanon = normalizeUnit(input.unit);
  if (unitCanon !== null && isQualitativeWord(unitCanon)) {
    return { quantityValue: null, unit: null, quantityText: unitCanon };
  }
  const text = input.quantityText.normalize("NFKC").trim();
  const m = QUALITATIVE_TEXT.exec(text);
  if (m !== null) {
    const word = m[2]!;
    return { quantityValue: null, unit: null, quantityText: word };
  }
  return null;
}

function trySpoonFromValueUnit(
  input: IngredientQuantityFields,
): IngredientQuantityFields | null {
  if (input.quantityValue === null) return null;
  if (!Number.isFinite(input.quantityValue) || input.quantityValue <= 0) return null;
  const unitCanon = normalizeUnit(input.unit);
  if (unitCanon === null) return null;
  const factor = spoonFactor(unitCanon);
  if (factor === null) return null;
  const rounded = roundQuantityValue(input.quantityValue);
  if (rounded <= SPOON_THRESHOLD) {
    // 閾値以下は仕様どおり無変換
    return null;
  }
  return toMlTriple(rounded, factor);
}

/**
 * P2: unit が null のとき text をパース（設計 §4.6）。
 * quantityValue が有限正なら数値は value 優先。unit が g 等なら触らない。
 */
function trySpoonFromText(input: IngredientQuantityFields): IngredientQuantityFields | null {
  const unitCanon = normalizeUnit(input.unit);
  if (unitCanon !== null) return null;
  const text = input.quantityText.normalize("NFKC").trim();
  const m = SPOON_TEXT.exec(text);
  if (m === null) return null;
  const rawValue = m[1] ?? m[4];
  const rawUnit = m[2] ?? m[3];
  if (rawValue === undefined || rawUnit === undefined) return null;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const spoonCanon = normalizeUnit(rawUnit);
  if (spoonCanon === null) return null;
  const factor = spoonFactor(spoonCanon);
  if (factor === null) return null;
  const numeric =
    input.quantityValue !== null &&
    Number.isFinite(input.quantityValue) &&
    input.quantityValue > 0
      ? input.quantityValue
      : parsed;
  const rounded = roundQuantityValue(numeric);
  if (rounded <= SPOON_THRESHOLD) return null;
  return toMlTriple(rounded, factor);
}

/**
 * 買い足し材料の分量 triple を読みやすくする。
 * pantry 連動行には呼ばないこと（呼び出し側で pantryRef を除外）。
 */
export function normalizeIngredientQuantity(
  input: IngredientQuantityFields,
): IngredientQuantityFields {
  const qualitative = tryQualitative(input);
  if (qualitative !== null) return qualitative;

  const fromValue = trySpoonFromValueUnit(input);
  if (fromValue !== null) return fromValue;

  const fromText = trySpoonFromText(input);
  if (fromText !== null) return fromText;

  return input;
}
```

- [ ] **Step 8: pure テスト PASS**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run shared/shopping/quantity-display.test.ts shared/shopping/normalize.test.ts
```

Expected: PASS（3.001 ケースの丸め結果が実装と一致しない場合は期待値を `roundQuantityValue(3.001*15)` に合わせる）

- [ ] **Step 9: Commit**

```bash
git add shared/shopping/normalize.ts shared/shopping/normalize.test.ts shared/shopping/quantity-display.ts shared/shopping/quantity-display.test.ts
git commit -m "$(cat <<'EOF'
feat: 分量 triple の大さじ/小さじと定性表記を正規化する

EOF
)"
```

---

### Task 2: generation materializer に接続

**Files:**
- Modify: `netlify/functions/_shared/generation-materializer.ts`
- Modify: `netlify/functions/_shared/generation-materializer.test.ts`

**Interfaces:**
- Consumes: `normalizeIngredientQuantity` from `../../../shared/shopping/quantity-display.js`
- Produces: `materializeAiGeneratedMenu` が非 pantry ingredient を正規化済みで返す

- [ ] **Step 1: 結合 RED テストを追加**

`generation-materializer.test.ts` の describe 内に追加（`makePayload` の side dish にんじんを流用または payload を複製）:

```ts
  it("normalizes non-pantry large tablespoon quantities to ml", () => {
    const payload = makePayload();
    payload.dishes[1]!.ingredients[0] = {
      ingredientRef: "ingredient_2",
      position: 1,
      name: "オリーブ油",
      quantityValue: 15,
      quantityText: "15大さじ",
      unit: "大さじ",
      storeSection: "seasonings",
      pantryRef: null,
      labelConfirmationRequired: false,
    };
    const menu = materializeAiGeneratedMenu(payload, makeContext(), uuidFactory());
    const oil = menu.dishes
      .flatMap((d) => d.ingredients)
      .find((i) => i.name === "オリーブ油");
    // UI amount() は value+unit 優先。triple 同時更新を固定する
    expect(oil).toMatchObject({
      quantityValue: 225,
      quantityText: "225ml",
      unit: "ml",
    });
  });

  it("does not convert pantry-backed spoon quantities", () => {
    const context = makeContext(5);
    context.pantryItems = [
      {
        ...context.pantryItems[0]!,
        name: "ごはん",
        quantity: 5,
        unit: "大さじ",
      },
    ];
    const payload = makePayload();
    payload.dishes[0]!.ingredients[0] = {
      ...payload.dishes[0]!.ingredients[0]!,
      name: "ごはん",
      quantityValue: 5,
      quantityText: "5大さじ",
      unit: "大さじ",
    };
    payload.pantryUsage = [
      {
        pantryRef: "pantry_1",
        priority: "must_use",
        usageStatus: "used",
        plannedQuantity: 5,
        unit: "大さじ",
        dishRefs: ["dish_1"],
        unusedReason: null,
      },
    ];
    const menu = materializeAiGeneratedMenu(payload, context, uuidFactory());
    const rice = menu.dishes[0]!.ingredients[0]!;
    // 5>3 なので skip 漏れなら 75ml になり即検知
    expect(rice.quantityValue).toBe(5);
    expect(rice.unit).toBe("大さじ");
    expect(rice.quantityText).toBe("5大さじ");
  });

  it("normalizes 1少々 on non-pantry ingredients", () => {
    const payload = makePayload();
    payload.dishes[1]!.ingredients[0] = {
      ingredientRef: "ingredient_2",
      position: 1,
      name: "こしょう",
      quantityValue: 1,
      quantityText: "1少々",
      unit: "少々",
      storeSection: "seasonings",
      pantryRef: null,
      labelConfirmationRequired: false,
    };
    const menu = materializeAiGeneratedMenu(payload, makeContext(), uuidFactory());
    const pepper = menu.dishes
      .flatMap((d) => d.ingredients)
      .find((i) => i.name === "こしょう");
    expect(pepper).toMatchObject({
      quantityValue: null,
      quantityText: "少々",
      unit: null,
    });
  });
```

注: `storeSection` は契約 enum の **`seasonings`**（末尾 s）。`seasoning` は `invalid_provider_menu` になる。

- [ ] **Step 2: RED 確認**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-materializer.test.ts
```

Expected: 新規 3 件 FAIL

- [ ] **Step 3: materializer に正規化を挿入**

`generation-materializer.ts` 先頭 import に追加:

```ts
import { normalizeIngredientQuantity } from "../../../shared/shopping/quantity-display.js";
```

`workingDishes` の map を次のように変更（pantry bind の後に非 pantry を正規化）:

```ts
  const workingDishes = menu.dishes.map((dish) => ({
    ...dish,
    ingredients: dish.ingredients.map((ingredient) => {
      // pantry 連動: trusted 上書きのみ（単位換算しない）
      if (ingredient.pantryRef !== null) {
        const trusted = pantryByRef.get(ingredient.pantryRef);
        if (trusted === undefined) return ingredient;
        const quantityValue = quantityValueFromPlanned(
          ingredient.pantryRef,
          ingredient.quantityValue,
        );
        return {
          ...ingredient,
          name: trusted.item.name,
          unit: trusted.item.unit,
          quantityValue,
          quantityText: quantityTextFromValue(
            ingredient.pantryRef,
            quantityValue,
            trusted.item.unit,
            ingredient.quantityText,
          ),
        };
      }
      // 買い足しのみ読みやすい分量へ（設計 §4.7）
      const normalized = normalizeIngredientQuantity({
        quantityValue: ingredient.quantityValue,
        quantityText: ingredient.quantityText,
        unit: ingredient.unit,
      });
      return {
        ...ingredient,
        quantityValue: normalized.quantityValue,
        quantityText: normalized.quantityText,
        unit: normalized.unit,
      };
    }),
  }));
```

- [ ] **Step 4: 結合テスト PASS**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-materializer.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/generation-materializer.ts netlify/functions/_shared/generation-materializer.test.ts
git commit -m "$(cat <<'EOF'
feat: 献立 materialize で買い足し分量を正規化する

EOF
)"
```

---

### Task 3: regeneration materialize に接続

**Files:**
- Modify: `netlify/functions/_shared/regeneration-context.ts`（`mapLocalDish` 内）
- Modify: `netlify/functions/_shared/regeneration-context.test.ts`

**Interfaces:**
- Consumes: 同一 `normalizeIngredientQuantity`
- Produces: 再生成候補の非 pantry ingredient も正規化済み

- [ ] **Step 1: 既存の materialize 成功テスト近くに RED を追加**

`regeneration-context.test.ts` の `describe("materializeDishRegenerationCandidate")` 内に、既存 helper を使った完全コードを追加する:

```ts
  it("normalizes non-pantry tablespoon quantities on replacement dish", () => {
    const { execution, uuid } = makeDishRegenerationExecutionContext();
    const output = makeDishRegenerationAiOutput();
    output.replacementDish.ingredients[0] = {
      ingredientRef: "ingredient_10",
      position: 1,
      name: "オリーブ油",
      quantityValue: 15,
      quantityText: "15大さじ",
      unit: "大さじ",
      storeSection: "seasonings",
      pantryRef: null,
      labelConfirmationRequired: false,
    };
    const candidate = materializeDishRegenerationCandidate(execution, output, uuid);
    const oil = candidate.dishes
      .flatMap((d) => d.ingredients)
      .find((i) => i.name === "オリーブ油");
    expect(oil).toMatchObject({
      quantityValue: 225,
      quantityText: "225ml",
      unit: "ml",
    });
  });
```

注: `makeDishRegenerationExecutionContext` / `makeDishRegenerationAiOutput` は同 describe 内の既存 local function（`regeneration-context.test.ts` 付近 L981–1186）。replacement の `ingredient_10` を差し替えるだけなので timeline/adaptation の ref はそのまま通る。

- [ ] **Step 2: RED 確認**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/regeneration-context.test.ts
```

Expected: 新規ケース FAIL

- [ ] **Step 3: `mapLocalDish` で正規化**

`regeneration-context.ts` import:

```ts
import { normalizeIngredientQuantity } from "../../../shared/shopping/quantity-display.js";
```

`mapLocalDish` の ingredients map 末尾（pantry 分岐の後）:

```ts
    ingredients: dish.ingredients.map((item) => {
      let name = item.name;
      let unit = item.unit;
      let quantityValue = item.quantityValue;
      let quantityText = item.quantityText;
      if (item.pantryRef !== null) {
        const trusted = pantryByRef.get(item.pantryRef);
        if (trusted !== undefined) {
          name = trusted.item.name;
          unit = trusted.item.unit;
          quantityValue = quantityValueFromPlanned(item.pantryRef, item.quantityValue);
          quantityText = quantityTextFromValue(
            item.pantryRef,
            quantityValue,
            unit,
            item.quantityText,
          );
        }
      } else {
        const normalized = normalizeIngredientQuantity({
          quantityValue,
          quantityText,
          unit,
        });
        quantityValue = normalized.quantityValue;
        quantityText = normalized.quantityText;
        unit = normalized.unit;
      }
      return {
        id: requiredMap(ingredientIdByRef, item.ingredientRef),
        position: item.position,
        name,
        quantityValue,
        quantityText,
        unit,
        storeSection: item.storeSection,
        pantrySelectionId:
          item.pantryRef === null ? null : requiredMap(selectionIdByRef, item.pantryRef),
        labelConfirmationRequired: item.labelConfirmationRequired,
      };
    }),
```

- [ ] **Step 4: PASS**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/regeneration-context.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/regeneration-context.ts netlify/functions/_shared/regeneration-context.test.ts
git commit -m "$(cat <<'EOF'
feat: 一品再生成 materialize でも分量を正規化する

EOF
)"
```

---

### Task 4: 生成プロンプト誘導

**Files:**
- Modify: `netlify/functions/_shared/generation-prompt.ts`
- Modify: `netlify/functions/_shared/generation-prompt.test.ts`

**Interfaces:**
- Consumes: 既存 `GENERATION_SYSTEM_PROMPT_CORE_PREFIX`（または同等の core 文字列）
- Produces: 分量・定性・pantry 書き分けの部分文字列

- [ ] **Step 1: RED — プロンプト部分文字列**

`generation-prompt.test.ts` に追加（既存の system 文字列取得ヘルパを使う）:

```ts
  it("guides readable units for non-pantry amounts without relying on pre-existing pantry wording", () => {
    const system = systemText(buildGenerationMessages(asNewMenuExecution(makeGenerationContext())));
    // 新規誘導の核だけをロック（既存の「大さじ」「ml」「pantry…換算」だけでは通さない）
    expect(system).toContain("買い足し");
    expect(system).toContain("4以上");
    expect(system).toContain("数字を付けない");
    expect(system).toContain("ml（またはg）");
  });
```

文言は Step 3 の実装文字列と**完全一致**させること。
- [ ] **Step 2: RED 確認**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-prompt.test.ts
```

Expected: FAIL

- [ ] **Step 3: CORE_PREFIX の分量文を差し替え・追記**

現行:

```ts
  "分量の数字と単位（g・ml・大さじ等）はそのままでよい。ingredientsのunitにtsp・tbsp・piece等の英語単位だけは書かない。" +
```

付近を例えば次のように拡張（1 連の短い日本語。トークン膨張を抑える）:

```ts
  "分量の数字と単位は日本語の計量（g・ml・大さじ・小さじ・個等）で書く。" +
  "ingredientsのunitにtsp・tbsp・piece等の英語単位だけは書かない。" +
  "買い足し材料で大さじまたは小さじが4以上になる量はml（またはg）で書く。" +
  "少々・適量・ひとつまみ・適宜に数字を付けない。" +
  "材料のunit/quantityと手順の言い回しを大きく食い違わせない。" +
```

既存 pantry 段落の「換算をしない」はそのまま。必要なら直前に「入力pantryのname/unitに限る」を明示する一文を足す。

- [ ] **Step 4: PASS**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-prompt.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/generation-prompt.ts netlify/functions/_shared/generation-prompt.test.ts
git commit -m "$(cat <<'EOF'
feat: 生成プロンプトに読みやすい分量の誘導を追加する

EOF
)"
```

---

### Task 5: 共有同意の既定オン + ドキュメント

**Files:**
- Modify: `src/features/privacy/privacy-notice-page.tsx`
- Modify: `src/features/privacy/privacy-copy.ts`
- Modify: `src/features/privacy/privacy-copy.test.ts`
- Modify: `src/features/privacy/privacy-notice-page.test.tsx`
- Modify: `e2e/specs/onboarding.spec.ts`
- Modify: `README.md`（該当 3 箇所）

**Interfaces:**
- Consumes: 既存 `shareConsentSection`
- Produces:
  - `shareConsentSection.defaultCheckedHint`（または body 先頭に固定文）: `最初からチェックが入っています。不要なら外してください。`
  - `useState(true)` for `shareChecked`

- [ ] **Step 1: コピー定数とテスト RED**

`privacy-copy.ts`:

```ts
/** 初回 /privacy の共有任意カード用コピー。既定オン・推奨トーンなし。 */
export const shareConsentSection = {
  title: "匿名の緊急候補への協力（任意）",
  checkboxLabel: "匿名で緊急候補に役立ててよい",
  /** pre-checked であることの平易な説明（推奨トーンなし） */
  defaultCheckedHint: "最初からチェックが入っています。不要なら外してください。",
  body: [
    "完成した献立のうち、条件を満たしたものの一部を、匿名の緊急用レシピ候補として他の方にも役立てることがあります。",
    ...shareConsentRequiredPhrases.map((phrase) =>
      phrase.endsWith("。") ? phrase : `${phrase}。`,
    ),
  ].join(""),
} as const;
```

`privacy-copy.test.ts` に追加:

```ts
it("documents pre-checked share consent without recommendation tone", () => {
  expect(shareConsentSection.defaultCheckedHint).toContain("最初からチェックが入っています");
  expect(shareConsentSection.defaultCheckedHint).toContain("不要なら外してください");
  expect(shareConsentSection.defaultCheckedHint).not.toMatch(/ぜひ|おすすめ|推奨/u);
});
```

- [ ] **Step 2: privacy-notice テストを反転（RED）— Content と Page 統合の両方**

#### Content 系

1. `"explains sent..."` の `shareConsentAccepted: false` → **`true`**（既定オンのまま進む）。
2. `"keeps share consent as a separate card, unchecked by default..."` を改名:

```ts
it("keeps share consent as a separate card, checked by default, without gating primary", async () => {
  const user = userEvent.setup();
  const onAccept = vi.fn();
  renderPrivacyContent({ saving: false, onAccept, onSkip: vi.fn() });

  const shareHeading = screen.getByRole("heading", { name: shareConsentSection.title });
  const shareCard = shareHeading.closest("section");
  expect(shareCard).not.toBeNull();
  expect(
    within(shareCard as HTMLElement).queryByRole("checkbox", { name: /説明を確認しました/ }),
  ).toBeNull();
  expect(shareCard?.textContent ?? "").toContain(shareConsentSection.defaultCheckedHint);

  const shareCheckbox = screen.getByRole("checkbox", {
    name: shareConsentSection.checkboxLabel,
  });
  expect(shareCheckbox).toBeChecked();

  const accept = screen.getByRole("button", { name: "確認して進む" });
  // 共有を外しても primary は privacy のみ依存
  await user.click(shareCheckbox);
  expect(shareCheckbox).not.toBeChecked();
  expect(accept).toBeDisabled();

  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  expect(accept).toBeEnabled();
  await user.click(accept);
  expect(onAccept).toHaveBeenCalledWith({ shareConsentAccepted: false });
});
```

```ts
it("accepts share consent by default when user leaves the pre-checked box on", async () => {
  const user = userEvent.setup();
  const onAccept = vi.fn();
  renderPrivacyContent({ saving: false, onAccept, onSkip: vi.fn() });
  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  await user.click(screen.getByRole("button", { name: "確認して進む" }));
  expect(onAccept).toHaveBeenCalledWith({ shareConsentAccepted: true });
});
```

#### Page 統合（`PrivacyNoticePage` + mock RPC）— 未更新だと Task 5/6 が赤

| 現行テスト名（付近） | 変更 |
| --- | --- |
| `saves only the privacy consent...` | タイトルを「既定 share ON で upsert する」に。`expect(upsertShare).not.toHaveBeenCalled()` → **`toHaveBeenCalledWith({}, true)`**。`upsertShare.mockResolvedValue({...})` を追加 |
| `upserts share consent only when the optional share checkbox is checked` | タイトルを「外すと upsert しない」に。**クリックで OFF** にしてから accept → `expect(upsertShare).not.toHaveBeenCalled()` |
| `共有同意 RPC が失敗しても...` | **クリックで外さない**（既定 ON のまま）。`upsertShare` は reject のまま呼ばれ、遷移継続・alert なし |
| `review resume 付きの returnTo...` | 末尾 `expect(upsertShare).not.toHaveBeenCalled()` を削除し、**`toHaveBeenCalledWith({}, true)`**（既定 ON）。`upsertShare.mockResolvedValue` を追加 |

「opt-out して resume へ戻る」専用ケースは必須ではない。resume は既定 ON 経路を固定すれば足りる。

- [ ] **Step 3: 実装**

`privacy-notice-page.tsx`:

```ts
  // 共有は既定 checked（任意。primary の enable 条件には使わない）
  const [shareChecked, setShareChecked] = useState(true);
```

コメント「推奨トーンや既定オンにしない」を削除し、「既定オン・推奨トーンなし。任意のまま」に更新。

共有カード内、checkbox の前後に:

```tsx
        <p className="type-small">{shareConsentSection.defaultCheckedHint}</p>
```

- [ ] **Step 4: e2e onboarding**

`e2e/specs/onboarding.spec.ts`:

```ts
  // 共有同意は任意カード: 既定 checked。外さなくても privacy 同意だけで生成導線へ戻れる。
  const shareCheckbox = page.getByRole("checkbox", { name: "匿名で緊急候補に役立ててよい" });
  await expect(page.getByRole("heading", { name: "匿名の緊急候補への協力（任意）" })).toBeVisible();
  await expect(shareCheckbox).toBeVisible();
  await expect(shareCheckbox).toBeChecked();
  await expect(page.getByText("最初からチェックが入っています。不要なら外してください。")).toBeVisible();
```

- [ ] **Step 5: README 3 箇所**

- 行付近「任意同意・既定オフ」→「任意同意・既定オン（外せる）」
- planner 手順の「既定オフ」→「既定オン。不要なら外す。失敗時は設定のトグルで再設定可」
- 表「既定オフ」→「既定オン（外せる）」

- [ ] **Step 6: テスト PASS**

Run（順に・連結しない）:

```bash
docker compose run --rm --no-deps app npx vitest run src/features/privacy/privacy-copy.test.ts src/features/privacy/privacy-notice-page.test.tsx
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/features/privacy/privacy-notice-page.tsx src/features/privacy/privacy-copy.ts src/features/privacy/privacy-copy.test.ts src/features/privacy/privacy-notice-page.test.tsx e2e/specs/onboarding.spec.ts README.md
git commit -m "$(cat <<'EOF'
feat: 匿名共有同意チェックを既定オンにする

EOF
)"
```

---

### Task 6: 横断検証

**Files:** なし（検証のみ）

- [ ] **Step 1: format**

```bash
docker compose run --rm --no-deps app npm run format:check
```

- [ ] **Step 2: lint**

```bash
docker compose run --rm --no-deps app npm run lint
```

- [ ] **Step 3: typecheck**

```bash
docker compose run --rm --no-deps app npm run typecheck
```

- [ ] **Step 4: 焦点テスト一括**

```bash
docker compose run --rm --no-deps app npx vitest run shared/shopping/quantity-display.test.ts shared/shopping/normalize.test.ts netlify/functions/_shared/generation-materializer.test.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/generation-prompt.test.ts src/features/privacy/privacy-copy.test.ts src/features/privacy/privacy-notice-page.test.tsx
```

Expected: すべて PASS

- [ ] **Step 5: 差分チェック**

```bash
git diff --check
```

- [ ] **Step 6: 完了報告**

- 変更サマリ（分量正規化 + 共有既定オン）
- テスト結果
- 残リスク: R1–R6（spec §5）、e2e フルはローカル CI 任意

---

## Plan self-review（レビュー指摘パッチ後）

| Spec 要件 | Task |
| --- | --- |
| synonym 大さじ/小さじ | Task 1 |
| pure triple 正規化・閾値・定性・P1/P2（unit null 含む） | Task 1 |
| materialize 非 pantry のみ・`seasonings` fixture | Task 2 |
| regeneration 同一 pure・完全テストコード | Task 3 |
| プロンプト誘導（新規フレーズロック） | Task 4 |
| 共有既定オン・hint・Content+Page 統合・README・e2e | Task 5 |
| 手順機械置換なし / マイグレーションなし | 非タスク（意図的） |
| shareConsentVersion 非バンプ | Task 5 で触らない |

### レビュー由来の修正済み項目

- B1: `storeSection: "seasonings"`（末尾 s）
- B2: privacy Page 統合 4 本の反転を Task 5 に明記
- B3: `QUALITATIVE` を `includes` ベースに（typecheck 通過）
- M1: unit null + value/text スプーンを P2 で拾う（spec §4.6 同期）
- M2: Task 3 に `makeDishRegeneration*` 完全コード
- M3: プロンプト RED を `買い足し` / `4以上` / `数字を付けない` 中心に

`normalizeIngredientQuantity` のシグネチャは Task 1→2/3 で一致。
