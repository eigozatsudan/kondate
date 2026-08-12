# admin 共有レシピ閲覧 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ローカル admin コンソールに「共有レシピ」画面を追加し、ops が掲載済み緊急共有プールを構造化プレビューで品質目視できるようにする（生 `menu_payload` 非露出・閲覧のみ）。

**Architecture:** (1) migration で `kondate_ops_readonly` に recipes/origins SELECT と title 関数 EXECUTE を付与 (2) BFF が `BEGIN READ ONLY` + 名前付き SELECT で一覧/詳細を返す（詳細は mapper で preview DTO に投影）(3) React 画面が同一 origin で一覧+in-page 詳細を表示 (4) 共有レシピ API のみ `ADMIN_LOCAL_TOKEN` 必須でルート登録。

**Tech Stack:** 既存 admin パッケージ（Node 24、Hono、`pg`、Zod、React 19、Vite、Vitest、pgTAP）

**Spec:** [`docs/superpowers/specs/2026-08-12-admin-shared-recipes-viewer-design.md`](../specs/2026-08-12-admin-shared-recipes-viewer-design.md)（MF-I1…I8 反映済み）  
**Parent:** [`docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md`](../specs/2026-08-11-local-ops-admin-console-design.md)（§2.2 / §3.1 / §5.6 改訂済み）  
**Reviews (spec):** `docs/superpowers/reviews/2026-08-12-admin-shared-recipes-viewer-{primary,adversarial,secondary}.md`  
**Reviews (plan):** `docs/superpowers/reviews/2026-08-12-admin-shared-recipes-viewer-plan-{primary,adversarial,secondary}.md`（**MF-P1…P4 反映済み**）

## Global Constraints

- Node.js `>=24 <25`、ESM、TypeScript `strict: true`、境界で `any` 禁止
- ユーザー向け文言は日本語。コードコメント・コミットメッセージは日本語（Conventional Commits）
- admin 検証: ホストで `cd admin && npm test` 可。または Docker。**本編** `docker compose run --rm --no-deps app …` は admin を対象にしない
- DB テスト: `docker compose --profile test run --rm db-test`（ホストから。`app` 内では不可）
- migration 適用（local）: `docker compose run --rm migrate` またはプロジェクト慣例の `npm run db:push`（ホスト）。**本番 apply は人間のみ**
- `.env.admin` は本番を指し得る。実装検証の既定は **local Compose DB**（`ADMIN_ALLOW_INSECURE_LOCAL_DB=1`）。エージェントは本番 URL で admin を起動しない
- コマンドは `&&` / `;` で連結しない（1 ツール呼び出し = 1 コマンド）
- `git push` / 本番 deploy / 破壊的 git は人間の明示指示なしで行わない
- 生 `menu_payload` を API/UI/ログに出さない。preview は all-or-nothing
- GET のみ。`SELECT *` 禁止。識別は UUID のみ
- 本編 `src/` / `netlify/functions/` は触らない

## File map

| パス | 責務 |
| --- | --- |
| `supabase/migrations/20260812120000_ops_readonly_shared_recipes.sql` | GRANT + index + title EXECUTE |
| `supabase/tests/database/ops_readonly_role.test.sql` | ops 権限 pgTAP 追記 |
| `docs/testing/database-access-matrix.md` | notes に ops SELECT 追記 |
| `admin/shared/schemas.ts` | list/detail/preview DTO + FORBIDDEN |
| `admin/shared/schemas.test.ts` | FORBIDDEN / round-trip |
| `admin/server/src/queries/sharedRecipes.ts` | 一覧・詳細 SELECT（sql-guard 許可唯一） |
| `admin/server/src/lib/map-shared-recipe.ts` | row → DTO / payload → preview |
| `admin/server/src/lib/map-shared-recipe.test.ts` | mapper unit |
| `admin/server/src/queries/sql-guard.test.ts` | basename allowlist |
| `admin/server/src/routes/register.ts` | 2 GET（token 必須時のみ） |
| `admin/server/src/app.test.ts` または routes テスト | token / 400 / 404 |
| `admin/client/src/pages/SharedRecipesPage.tsx` | UI |
| `admin/client/src/components/Layout.tsx` | ナビ |
| `admin/client/src/app.tsx` | Route |
| `admin/README.md` | 画面・token・本番注意 |

親設計ドキュメントは **既に改訂済み**。再編集不要（矛盾が出たら設計を正に戻す）。

---

### Task 1: DB migration・pgTAP・access matrix

**Files:**
- Create: `supabase/migrations/20260812120000_ops_readonly_shared_recipes.sql`
- Modify: `supabase/tests/database/ops_readonly_role.test.sql`
- Modify: `docs/testing/database-access-matrix.md`（`shared_emergency_recipes` / `origins` の Notes に ops SELECT を追記）

**Interfaces:**
- Produces: ops が recipes/origins を SELECT 可、DML 不可、title 関数 EXECUTE 可、service_role 表 SELECT は増えない

- [ ] **Step 1: migration を書く**

`supabase/migrations/20260812120000_ops_readonly_shared_recipes.sql`:

```sql
-- admin 共有レシピ閲覧: ops に pool / origins の SELECT と title 関数 EXECUTE のみ付与。
-- service_role / authenticated / anon への表 GRANT は拡大しない。

grant select on private.shared_emergency_recipes to kondate_ops_readonly;
grant select on private.shared_emergency_recipe_origins to kondate_ops_readonly;

grant execute on function private.share_recipe_title_from_payload(jsonb)
  to kondate_ops_readonly;

create index if not exists shared_emergency_recipes_ops_created_id_idx
  on private.shared_emergency_recipes (created_at desc, id desc);
```

- [ ] **Step 2: pgTAP を追記**

1. ファイル先頭コメントを「6 GRANT 表」→ **「8 GRANT 表（jobs + recipes + origins を含む）」** に更新する。  
2. `select plan(38);` を **`select plan(50);` に変更**する（既存 38 + 下記 12 assert）。  
3. `share_generalization_jobs` ブロックの直後に次を追加する:

```sql
select ok(
  has_table_privilege('kondate_ops_readonly', 'private.shared_emergency_recipes', 'SELECT'),
  'ops has SELECT grant on shared_emergency_recipes'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.shared_emergency_recipes', 'INSERT'),
  'ops has no INSERT on shared_emergency_recipes'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.shared_emergency_recipes', 'UPDATE'),
  'ops has no UPDATE on shared_emergency_recipes'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.shared_emergency_recipes', 'DELETE'),
  'ops has no DELETE on shared_emergency_recipes'
);

select ok(
  has_table_privilege('kondate_ops_readonly', 'private.shared_emergency_recipe_origins', 'SELECT'),
  'ops has SELECT grant on shared_emergency_recipe_origins'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.shared_emergency_recipe_origins', 'INSERT'),
  'ops has no INSERT on shared_emergency_recipe_origins'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.shared_emergency_recipe_origins', 'UPDATE'),
  'ops has no UPDATE on shared_emergency_recipe_origins'
);
select ok(
  not has_table_privilege('kondate_ops_readonly', 'private.shared_emergency_recipe_origins', 'DELETE'),
  'ops has no DELETE on shared_emergency_recipe_origins'
);

select ok(
  has_function_privilege(
    'kondate_ops_readonly',
    'private.share_recipe_title_from_payload(jsonb)',
    'EXECUTE'
  ),
  'ops can execute share_recipe_title_from_payload'
);

-- 製品境界: service_role に表 SELECT を広げない
select ok(
  not has_table_privilege('service_role', 'private.shared_emergency_recipes', 'SELECT'),
  'service_role still has no SELECT on shared_emergency_recipes'
);
select ok(
  not has_table_privilege('service_role', 'private.shared_emergency_recipe_origins', 'SELECT'),
  'service_role still has no SELECT on shared_emergency_recipe_origins'
);

select lives_ok(
  $$
    set local role kondate_ops_readonly;
    select id, status, meal_type from private.shared_emergency_recipes limit 1;
    reset role;
  $$,
  'ops can select shared_emergency_recipes columns'
);
```

- [ ] **Step 3: access matrix を更新**

`private.shared_emergency_recipes` と `private.shared_emergency_recipe_origins` の Notes に  
`ops readonly SELECT for local admin shared-recipes viewer; no DML; no Data API` を追記。  
必要なら別表「ops grants」行があれば整合。

- [ ] **Step 4: local で migration + db-test**

```bash
docker compose run --rm migrate
```

```bash
docker compose --profile test run --rm db-test
```

Expected: ops_readonly_role 関連が PASS。失敗したら GRANT / plan 件数を修正。

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260812120000_ops_readonly_shared_recipes.sql supabase/tests/database/ops_readonly_role.test.sql docs/testing/database-access-matrix.md
git commit -m "feat(db): ops に共有レシピ SELECT と title 関数 EXECUTE を付与"
```

---

### Task 2: Zod DTO と FORBIDDEN_DTO_KEYS

**Files:**
- Modify: `admin/shared/schemas.ts`
- Modify: `admin/shared/schemas.test.ts`

**Interfaces:**
- Produces:
  - `sharedRecipeListItemSchema` / `SharedRecipeListItem`
  - `sharedRecipesResponseSchema` / `SharedRecipesResponse`
  - `sharedRecipePreviewSchema` / `SharedRecipePreview`
  - `sharedRecipeDetailSchema` / `SharedRecipeDetail`
  - `FORBIDDEN_DTO_KEYS` に `menu_payload`, `menuPayload`

- [ ] **Step 1: 失敗する schema テストを追加**

`schemas.test.ts` に:

```ts
it("forbids menu_payload keys on DTO surface", () => {
  expect(FORBIDDEN_DTO_KEYS).toContain("menu_payload");
  expect(FORBIDDEN_DTO_KEYS).toContain("menuPayload");
});

it("parses shared recipe list item without raw payload", () => {
  const item = sharedRecipeListItemSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-08-12T00:00:00.000Z",
    status: "active",
    mealType: "dinner",
    totalElapsedMinutes: 15,
    title: "肉じゃが",
    standardAllergenIds: [],
    eligibleAgeBands: ["adult"],
    contributorUserId: null,
    sourceMenuId: null,
  });
  expect(item.title).toBe("肉じゃが");
  expect(JSON.stringify(item)).not.toMatch(/menu_payload/i);
});
```

- [ ] **Step 2: テスト実行（RED）**

```bash
cd admin && npm test -- --run shared/schemas.test.ts
```

Expected: FAIL（未定義 schema / FORBIDDEN 未更新）

- [ ] **Step 3: schemas を実装**

`admin/shared/schemas.ts` に追加（既存 export の近く）:

```ts
export const sharedRecipeStatusSchema = z.enum(["active", "disabled"]);
export const sharedMealTypeSchema = z.enum(["breakfast", "lunch", "dinner"]);

export const sharedRecipeListItemSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  status: sharedRecipeStatusSchema,
  mealType: sharedMealTypeSchema,
  totalElapsedMinutes: z.number().int().positive(),
  title: z.string().min(1).max(80),
  standardAllergenIds: z.array(z.string()),
  eligibleAgeBands: z.array(z.string()),
  contributorUserId: z.string().uuid().nullable(),
  sourceMenuId: z.string().uuid().nullable(),
});

export const sharedRecipesResponseSchema = z.object({
  generatedAt: z.string(),
  activeCount: z.number().int().nonnegative(),
  disabledCount: z.number().int().nonnegative(),
  items: z.array(sharedRecipeListItemSchema),
});

const previewIngredientSchema = z.object({
  name: z.string(),
  quantityText: z.string(),
  unit: z.string().nullable(),
  storeSection: z.string(),
});

const previewStepSchema = z.object({
  position: z.number().int(),
  instruction: z.string(),
});

const previewDishSchema = z.object({
  role: z.string(),
  position: z.number().int(),
  name: z.string(),
  description: z.string(),
  cookingTimeMinutes: z.number().int(),
  ingredients: z.array(previewIngredientSchema),
  steps: z.array(previewStepSchema),
});

const previewTimelineSchema = z.object({
  position: z.number().int(),
  startMinute: z.number().int(),
  durationMinutes: z.number().int(),
  instruction: z.string(),
});

const previewSafetyActionSchema = z.object({
  kind: z.string(),
  instruction: z.string(),
});

const previewAdaptationSchema = z.object({
  portionText: z.string(),
  additionalCutting: z.string().nullable(),
  additionalHeating: z.string().nullable(),
  additionalSeasoning: z.string().nullable(),
  servingCheck: z.string(),
  anonymousMemberRef: z.string(),
  safetyActions: z.array(previewSafetyActionSchema),
});

export const sharedRecipePreviewSchema = z.object({
  schemaVersion: z.string(),
  menuId: z.string().uuid(),
  mealType: sharedMealTypeSchema,
  cuisineGenre: z.string(),
  servings: z.number().int(),
  totalElapsedMinutes: z.number().int(),
  safetyTags: z.array(z.string()),
  dishes: z.array(previewDishSchema).min(1),
  timeline: z.array(previewTimelineSchema),
  adaptations: z.array(previewAdaptationSchema),
});

export const sharedRecipePreviewErrorSchema = z.enum([
  "invalid_menu_payload",
  "unsupported_schema_version",
]);

export const sharedRecipeDetailSchema = sharedRecipeListItemSchema.extend({
  preview: sharedRecipePreviewSchema.nullable(),
  previewError: sharedRecipePreviewErrorSchema.nullable(),
});

export type SharedRecipeListItem = z.infer<typeof sharedRecipeListItemSchema>;
export type SharedRecipesResponse = z.infer<typeof sharedRecipesResponseSchema>;
export type SharedRecipePreview = z.infer<typeof sharedRecipePreviewSchema>;
export type SharedRecipeDetail = z.infer<typeof sharedRecipeDetailSchema>;
```

`FORBIDDEN_DTO_KEYS` 配列に `"menu_payload", "menuPayload"` を追加。

- [ ] **Step 4: テスト GREEN**

```bash
cd admin && npm test -- --run shared/schemas.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin/shared/schemas.ts admin/shared/schemas.test.ts
git commit -m "feat(admin): 共有レシピ DTO と menu_payload 禁止キーを追加"
```

---

### Task 3: query・mapper・sql-guard

**Files:**
- Create: `admin/server/src/queries/sharedRecipes.ts`
- Create: `admin/server/src/lib/map-shared-recipe.ts`
- Create: `admin/server/src/lib/map-shared-recipe.test.ts`
- Modify: `admin/server/src/queries/sql-guard.test.ts`

**Interfaces:**
- Produces:
  - `listSharedRecipes(client, filter): Promise<SharedRecipesResponse>`
  - `getSharedRecipe(client, id: string): Promise<SharedRecipeDetail | null>`
  - `mapSharedRecipeListItem`, `mapSharedRecipeDetail` / `buildPreviewFromPayload`
- Consumes: Task 2 schemas、`formatIso` from `jst.ts`

- [ ] **Step 1: sql-guard を allowlist 方式に改訂（最終形のみ。全面解禁しない）**

`sql-guard.test.ts` を次の **最終形**に置き換える（`/menu_payload/i` を FORBIDDEN から消して終わりにしない）:

```ts
const FORBIDDEN_ALWAYS = [
  /identity_key/i,
  /request_hmac/i,
  /request_hmac_version/i,
  /stripe_price_id/i,
  /stripe_[a-z0-9_]+/i,
  /auth\.users/i,
];

const MENU_PAYLOAD = /menu_payload/i;
/** basename exact のみ許可。他ファイルに menu_payload を書いてはならない */
const ALLOW_MENU_PAYLOAD_BASENAME = "sharedRecipes.ts";
```

各ファイルの it 内:

```ts
for (const re of FORBIDDEN_ALWAYS) {
  expect(text).not.toMatch(re);
}
const base = file.split("/").pop();
if (base !== ALLOW_MENU_PAYLOAD_BASENAME) {
  expect(text).not.toMatch(MENU_PAYLOAD);
}
expect(normalized).not.toMatch(/select \*/);
```

- [ ] **Step 2: mapper テストを書く（失敗・成功・raw 非露出）**

`map-shared-recipe.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPreviewFromPayload } from "./map-shared-recipe.js";

const VALID_SCHEMA = "2026-07-11.v1";
const menuId = "33333333-3333-4333-8333-333333333333";

/** preview 投影に十分な最小 payload（余分キーは strip される想定） */
function minimalValidPayload() {
  return {
    schemaVersion: VALID_SCHEMA,
    menuId,
    mealType: "dinner",
    cuisineGenre: "japanese",
    servings: 2,
    totalElapsedMinutes: 15,
    safetyTags: [],
    dishes: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        role: "main",
        position: 1,
        name: "肉じゃが",
        description: "定番",
        cookingTimeMinutes: 15,
        ingredients: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            position: 1,
            name: "じゃがいも",
            quantityValue: 2,
            quantityText: "2個",
            unit: null,
            storeSection: "produce",
            pantrySelectionId: null,
            labelConfirmationRequired: false,
          },
        ],
        steps: [
          {
            id: "66666666-6666-4666-8666-666666666666",
            position: 1,
            instruction: "切る",
          },
        ],
      },
    ],
    timeline: [
      {
        id: "77777777-7777-4777-8777-777777777777",
        position: 1,
        startMinute: 0,
        durationMinutes: 5,
        instruction: "下ごしらえ",
        dishId: null,
        recipeStepId: null,
      },
    ],
    adaptations: [],
    pantryUsage: [{ shouldNot: "appear" }],
    labelConfirmations: [{ shouldNot: "appear" }],
  };
}

describe("buildPreviewFromPayload", () => {
  it("returns unsupported_schema_version for unknown version", () => {
    const r = buildPreviewFromPayload({ schemaVersion: "nope" });
    expect(r.preview).toBeNull();
    expect(r.previewError).toBe("unsupported_schema_version");
  });

  it("returns invalid_menu_payload for empty object", () => {
    const r = buildPreviewFromPayload({});
    expect(r.preview).toBeNull();
    expect(r.previewError).toBe("invalid_menu_payload");
  });

  it("maps valid payload without raw or forbidden keys", () => {
    const r = buildPreviewFromPayload(minimalValidPayload());
    expect(r.previewError).toBeNull();
    expect(r.preview).not.toBeNull();
    expect(r.preview?.dishes[0]?.name).toBe("肉じゃが");
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/menu_payload/i);
    expect(json).not.toMatch(/menuPayload/);
    expect(json).not.toMatch(/pantryUsage/);
    expect(json).not.toMatch(/labelConfirmations/);
    // dish UUID は preview から除外
    expect(json).not.toContain("44444444-4444-4444-8444-444444444444");
  });
});
```

- [ ] **Step 3: mapper を実装**

`map-shared-recipe.ts`:

```ts
import type {
  SharedRecipeDetail,
  SharedRecipeListItem,
  SharedRecipePreview,
} from "../../../shared/schemas.js";
import {
  sharedRecipeDetailSchema,
  sharedRecipeListItemSchema,
  sharedRecipePreviewSchema,
} from "../../../shared/schemas.js";
import { formatIso } from "./jst.js";

const SUPPORTED_SCHEMA = "2026-07-11.v1";

export type SharedRecipeListRow = {
  id: string;
  created_at: Date | string;
  status: string;
  meal_type: string;
  total_elapsed_minutes: number;
  title: string;
  standard_allergen_ids: string[] | null;
  eligible_age_bands: string[] | null;
  contributor_user_id: string | null;
  source_menu_id: string | null;
};

export function mapSharedRecipeListItem(row: SharedRecipeListRow): SharedRecipeListItem {
  return sharedRecipeListItemSchema.parse({
    id: row.id,
    createdAt: formatIso(row.created_at) ?? "",
    status: row.status,
    mealType: row.meal_type,
    totalElapsedMinutes: row.total_elapsed_minutes,
    title: row.title,
    standardAllergenIds: row.standard_allergen_ids ?? [],
    eligibleAgeBands: row.eligible_age_bands ?? [],
    contributorUserId: row.contributor_user_id,
    sourceMenuId: row.source_menu_id,
  });
}

export function buildPreviewFromPayload(raw: unknown): {
  preview: SharedRecipePreview | null;
  previewError: "invalid_menu_payload" | "unsupported_schema_version" | null;
} {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { preview: null, previewError: "invalid_menu_payload" };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion === undefined || obj.schemaVersion === null) {
    return { preview: null, previewError: "invalid_menu_payload" };
  }
  if (obj.schemaVersion !== SUPPORTED_SCHEMA) {
    return { preview: null, previewError: "unsupported_schema_version" };
  }

  const dishesIn = Array.isArray(obj.dishes) ? obj.dishes : null;
  const timelineIn = Array.isArray(obj.timeline) ? obj.timeline : null;
  const adaptationsIn = Array.isArray(obj.adaptations) ? obj.adaptations : [];

  if (!dishesIn || !timelineIn) {
    return { preview: null, previewError: "invalid_menu_payload" };
  }

  const picked = {
    schemaVersion: obj.schemaVersion,
    menuId: obj.menuId,
    mealType: obj.mealType,
    cuisineGenre: obj.cuisineGenre,
    servings: obj.servings,
    totalElapsedMinutes: obj.totalElapsedMinutes,
    safetyTags: Array.isArray(obj.safetyTags) ? obj.safetyTags : [],
    dishes: dishesIn.map((d) => {
      const dish = d as Record<string, unknown>;
      const ingredients = Array.isArray(dish.ingredients) ? dish.ingredients : [];
      const steps = Array.isArray(dish.steps) ? dish.steps : [];
      return {
        role: dish.role,
        position: dish.position,
        name: dish.name,
        description: dish.description,
        cookingTimeMinutes: dish.cookingTimeMinutes,
        ingredients: ingredients.map((i) => {
          const ing = i as Record<string, unknown>;
          return {
            name: ing.name,
            quantityText: ing.quantityText,
            unit: ing.unit ?? null,
            storeSection: ing.storeSection,
          };
        }),
        steps: steps.map((s) => {
          const step = s as Record<string, unknown>;
          return { position: step.position, instruction: step.instruction };
        }),
      };
    }),
    timeline: timelineIn.map((t) => {
      const step = t as Record<string, unknown>;
      return {
        position: step.position,
        startMinute: step.startMinute,
        durationMinutes: step.durationMinutes,
        instruction: step.instruction,
      };
    }),
    adaptations: adaptationsIn.map((a) => {
      const ad = a as Record<string, unknown>;
      const actions = Array.isArray(ad.safetyActions) ? ad.safetyActions : [];
      return {
        portionText: ad.portionText,
        additionalCutting: ad.additionalCutting ?? null,
        additionalHeating: ad.additionalHeating ?? null,
        additionalSeasoning: ad.additionalSeasoning ?? null,
        servingCheck: ad.servingCheck,
        anonymousMemberRef: ad.anonymousMemberRef,
        safetyActions: actions.map((x) => {
          const act = x as Record<string, unknown>;
          return { kind: act.kind, instruction: act.instruction };
        }),
      };
    }),
  };

  const parsed = sharedRecipePreviewSchema.safeParse(picked);
  if (!parsed.success) {
    return { preview: null, previewError: "invalid_menu_payload" };
  }
  return { preview: parsed.data, previewError: null };
}

export function mapSharedRecipeDetail(
  row: SharedRecipeListRow & { menu_payload: unknown },
): SharedRecipeDetail {
  const base = mapSharedRecipeListItem(row);
  const { preview, previewError } = buildPreviewFromPayload(row.menu_payload);
  return sharedRecipeDetailSchema.parse({
    ...base,
    preview,
    previewError,
  });
}
```

注: `schemaVersion` が `"nope"` のときは `unsupported_schema_version`、欠落/空は `invalid_menu_payload` になるよう分岐順をテストと一致させる。

- [ ] **Step 4: sharedRecipes.ts 完全実装（MF-P1）**

```ts
/**
 * 共有プール一覧・詳細。
 * menu_payload 文字列は本ファイル（basename sharedRecipes.ts）のみ SQL に出現してよい。
 * 一覧の SELECT リストに menu_payload 列は出さない（title 関数の引数参照のみ）。
 * レスポンス DTO に生 payload は載せない。
 */
import type { PoolClient } from "pg";
import type { SharedRecipeDetail, SharedRecipesResponse } from "../../../shared/schemas.js";
import { sharedRecipesResponseSchema } from "../../../shared/schemas.js";
import { mapSharedRecipeDetail, mapSharedRecipeListItem } from "../lib/map-shared-recipe.js";
import type { SharedRecipeListRow } from "../lib/map-shared-recipe.js";

export type ListSharedRecipesFilter = {
  fromUtc: Date;
  toUtcExclusive: Date;
  status?: "active" | "disabled";
  mealType?: "breakfast" | "lunch" | "dinner";
  limit: number;
  offset: number;
};

export async function listSharedRecipes(
  client: PoolClient,
  filter: ListSharedRecipesFilter,
): Promise<SharedRecipesResponse> {
  // counts: 日付 + mealType のみ（status は使わない）
  const countParams: unknown[] = [filter.fromUtc, filter.toUtcExclusive];
  const countWhere = ["r.created_at >= $1", "r.created_at < $2"];
  if (filter.mealType) {
    countParams.push(filter.mealType);
    countWhere.push(`r.meal_type = $${countParams.length}`);
  }

  const counts = await client.query<{ active: number; disabled: number }>(
    `
    select
      count(*) filter (where r.status = 'active')::int as active,
      count(*) filter (where r.status = 'disabled')::int as disabled
    from private.shared_emergency_recipes r
    where ${countWhere.join(" and ")}
    `,
    countParams,
  );

  // items: 日付 + mealType + status
  const listParams: unknown[] = [filter.fromUtc, filter.toUtcExclusive];
  const listWhere = ["r.created_at >= $1", "r.created_at < $2"];
  if (filter.mealType) {
    listParams.push(filter.mealType);
    listWhere.push(`r.meal_type = $${listParams.length}`);
  }
  if (filter.status) {
    listParams.push(filter.status);
    listWhere.push(`r.status = $${listParams.length}`);
  }
  listParams.push(filter.limit);
  const limitIdx = listParams.length;
  listParams.push(filter.offset);
  const offsetIdx = listParams.length;

  const list = await client.query<SharedRecipeListRow>(
    `
    select
      r.id,
      r.created_at,
      r.status,
      r.meal_type,
      r.total_elapsed_minutes,
      private.share_recipe_title_from_payload(r.menu_payload) as title,
      r.standard_allergen_ids,
      r.eligible_age_bands,
      o.contributor_user_id,
      o.source_menu_id
    from private.shared_emergency_recipes r
    left join private.shared_emergency_recipe_origins o on o.recipe_id = r.id
    where ${listWhere.join(" and ")}
    order by r.created_at desc, r.id desc
    limit $${limitIdx}
    offset $${offsetIdx}
    `,
    listParams,
  );

  return sharedRecipesResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    activeCount: counts.rows[0]?.active ?? 0,
    disabledCount: counts.rows[0]?.disabled ?? 0,
    items: list.rows.map((row) => mapSharedRecipeListItem(row)),
  });
}

export async function getSharedRecipe(
  client: PoolClient,
  id: string,
): Promise<SharedRecipeDetail | null> {
  const res = await client.query<SharedRecipeListRow & { menu_payload: unknown }>(
    `
    select
      r.id,
      r.created_at,
      r.status,
      r.meal_type,
      r.total_elapsed_minutes,
      private.share_recipe_title_from_payload(r.menu_payload) as title,
      r.standard_allergen_ids,
      r.eligible_age_bands,
      o.contributor_user_id,
      o.source_menu_id,
      r.menu_payload
    from private.shared_emergency_recipes r
    left join private.shared_emergency_recipe_origins o on o.recipe_id = r.id
    where r.id = $1::uuid
    limit 1
    `,
    [id],
  );
  const row = res.rows[0];
  if (!row) return null;
  return mapSharedRecipeDetail(row);
}
```

- [ ] **Step 5: テスト GREEN**

```bash
cd admin && npm test -- --run server/src/lib/map-shared-recipe.test.ts server/src/queries/sql-guard.test.ts shared/schemas.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add admin/server/src/queries/sharedRecipes.ts admin/server/src/lib/map-shared-recipe.ts admin/server/src/lib/map-shared-recipe.test.ts admin/server/src/queries/sql-guard.test.ts
git commit -m "feat(admin): 共有レシピ query と構造化 preview mapper を追加"
```

---

### Task 4: API ルート（token 必須登録）

**Files:**
- Modify: `admin/server/src/routes/register.ts`
- Modify: `admin/server/src/app.test.ts`（または `register` 向けテストを同ファイルに追加）

**Interfaces:**
- Consumes: `listSharedRecipes`, `getSharedRecipe`, `deps.config.localToken`
- Produces: `GET /api/shared-recipes`, `GET /api/shared-recipes/:id`（token 設定時のみ）

- [ ] **Step 1: ルートテストを書く（RED 後 GREEN）**

`app.test.ts` に追加（`baseConfig.localToken` は設定済み）:

```ts
it("does not register shared-recipes when localToken is null", async () => {
  const app = createApp({
    pool: null,
    config: { ...baseConfig, localToken: null },
    dbReady: false,
  });
  const res = await app.request(
    "http://127.0.0.1:5193/api/shared-recipes?from=2026-08-01&to=2026-08-07",
    { headers: { host: "127.0.0.1:5193" } },
  );
  expect(res.status).toBe(404);
});

it("requires bearer for shared-recipes when token configured", async () => {
  const app = createApp({ pool: null, config: baseConfig, dbReady: false });
  const denied = await app.request(
    "http://127.0.0.1:5193/api/shared-recipes?from=2026-08-01&to=2026-08-07",
    { headers: { host: "127.0.0.1:5193" } },
  );
  expect(denied.status).toBe(401);
});

it("rejects shared-recipes without date range", async () => {
  const app = createApp({ pool: null, config: baseConfig, dbReady: false });
  const res = await app.request("http://127.0.0.1:5193/api/shared-recipes", {
    headers: {
      host: "127.0.0.1:5193",
      authorization: "Bearer test-token-32chars-minimum-ok",
    },
  });
  expect(res.status).toBe(400);
});

it("rejects invalid status on shared-recipes", async () => {
  const app = createApp({ pool: null, config: baseConfig, dbReady: false });
  const res = await app.request(
    "http://127.0.0.1:5193/api/shared-recipes?from=2026-08-01&to=2026-08-07&status=nope",
    {
      headers: {
        host: "127.0.0.1:5193",
        authorization: "Bearer test-token-32chars-minimum-ok",
      },
    },
  );
  expect(res.status).toBe(400);
});

it("rejects invalid mealType on shared-recipes", async () => {
  const app = createApp({ pool: null, config: baseConfig, dbReady: false });
  const res = await app.request(
    "http://127.0.0.1:5193/api/shared-recipes?from=2026-08-01&to=2026-08-07&mealType=brunch",
    {
      headers: {
        host: "127.0.0.1:5193",
        authorization: "Bearer test-token-32chars-minimum-ok",
      },
    },
  );
  expect(res.status).toBe(400);
});

it("returns 404 for missing shared recipe id", async () => {
  // pool が null のときは db_unavailable(400) になり得る。
  // 詳細 404 は withReadOnly + getSharedRecipe が null を返す結合テスト、
  // または getSharedRecipe の unit で null を固定する。
  // ルート層では不正 UUID を 400 にする:
  const app = createApp({ pool: null, config: baseConfig, dbReady: false });
  const res = await app.request(
    "http://127.0.0.1:5193/api/shared-recipes/not-a-uuid",
    {
      headers: {
        host: "127.0.0.1:5193",
        authorization: "Bearer test-token-32chars-minimum-ok",
      },
    },
  );
  expect(res.status).toBe(400);
});
```

一覧に `preview` キーが無いことは Task 2 の `sharedRecipesResponseSchema`（preview フィールドなし）で固定する。追加で:

```ts
it("sharedRecipesResponseSchema has no preview key", () => {
  const parsed = sharedRecipesResponseSchema.parse({
    generatedAt: "2026-08-12T00:00:00.000Z",
    activeCount: 0,
    disabledCount: 0,
    items: [],
  });
  expect("preview" in parsed).toBe(false);
  expect(JSON.stringify(parsed)).not.toMatch(/menu_payload/i);
});
```

（`schemas.test.ts` に置く。）

設計: 共有レシピ API は token **必須でルート登録**。親の token middleware は「設定時は全 API に Bearer」。`localToken === null` のときは **register しない**。  
`register.ts` 先頭コメントの「6 画面」を **「7 画面（共有レシピ含む）」** に更新する。

- [ ] **Step 2: register.ts に追加**

`registerApiRoutes` 末尾:

```ts
  // 共有レシピは構造化本文を返すため token 未設定時はルート自体を載せない
  if (deps.config.localToken) {
    app.get("/api/shared-recipes", async (c) => {
      try {
        const pool = requirePool(deps.pool);
        const q = c.req.query();
        const range = parseJstDateRange({ from: q.from, to: q.to });
        const status =
          q.status === "active" || q.status === "disabled" ? q.status : undefined;
        const mealType =
          q.mealType === "breakfast" ||
          q.mealType === "lunch" ||
          q.mealType === "dinner"
            ? q.mealType
            : undefined;
        if (q.status && !status) {
          throw badRequest("invalid_status", "status が不正です。");
        }
        if (q.mealType && !mealType) {
          throw badRequest("invalid_meal_type", "mealType が不正です。");
        }
        const data = await withReadOnly(pool, (client) =>
          listSharedRecipes(client, {
            fromUtc: range.fromUtc,
            toUtcExclusive: range.toUtcExclusive,
            status,
            mealType,
            limit: clampLimit(q.limit),
            offset: clampOffset(q.offset),
          }),
        );
        return ok(c, data);
      } catch (e) {
        return fail(c, e);
      }
    });

    app.get("/api/shared-recipes/:id", async (c) => {
      try {
        const pool = requirePool(deps.pool);
        const id = c.req.param("id");
        if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
          throw badRequest("invalid_id", "id が不正です。");
        }
        const data = await withReadOnly(pool, (client) => getSharedRecipe(client, id));
        if (!data) throw notFound();
        return ok(c, data);
      } catch (e) {
        return fail(c, e);
      }
    });
  } else {
    console.warn(
      "[admin] ADMIN_LOCAL_TOKEN 未設定のため共有レシピ API は無効です。",
    );
  }
```

- [ ] **Step 3: テスト GREEN + typecheck**

```bash
cd admin && npm test -- --run server/src/app.test.ts
```

```bash
cd admin && npm run typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add admin/server/src/routes/register.ts admin/server/src/app.test.ts
git commit -m "feat(admin): 共有レシピ API を token 必須で登録する"
```

---

### Task 5: UI（SharedRecipesPage + ナビ）

**Files:**
- Create: `admin/client/src/pages/SharedRecipesPage.tsx`
- Modify: `admin/client/src/components/Layout.tsx`
- Modify: `admin/client/src/app.tsx`

**Interfaces:**
- Consumes: `SharedRecipesResponse`, `SharedRecipeDetail` from `../../../shared/schemas`
- Route: `/shared-recipes`

- [ ] **Step 1: ナビとルートを追加**

`Layout.tsx` の `nav` に:

```ts
{ to: "/share-jobs", label: "共有ジョブ" },
{ to: "/shared-recipes", label: "共有レシピ" },
```

`app.tsx`:

```tsx
import { SharedRecipesPage } from "./pages/SharedRecipesPage";
// ...
<Route path="share-jobs" element={<ShareJobsPage />} />
<Route path="shared-recipes" element={<SharedRecipesPage />} />
```

- [ ] **Step 2: SharedRecipesPage を実装**

`FeedbackPage` / `ShareJobsPage` を手本にする:

- 日付 `defaultDateRange` + `DateRangeFilter`
- status / mealType select または input
- `useQuery` → `apiGet<SharedRecipesResponse>(\`/api/shared-recipes?${params}\`)`
- サマリ: activeCount / disabledCount
- `DataTable` 列: createdAt, status, mealType, title, totalElapsedMinutes, allergens join, ageBands join, contributor UuidText, id UuidText
- 行クリックで `detailId`、`GET /api/shared-recipes/:id`
- 詳細パネル: メタ + preview（dishes / timeline / adaptations）または previewError メッセージ
- 注意文言（設計 §9.2）
- 401/404 時: token 未設定や API 無効の日本語メッセージ

プレビュー UI はシンプルな見出し+リストでよい（本編デザインシステム不要）。

- [ ] **Step 3: typecheck / lint**

```bash
cd admin && npm run typecheck
```

```bash
cd admin && npm run lint
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add admin/client/src/pages/SharedRecipesPage.tsx admin/client/src/components/Layout.tsx admin/client/src/app.tsx
git commit -m "feat(admin): 共有レシピ画面とナビを追加"
```

---

### Task 6: README と最終検証

**Files:**
- Modify: `admin/README.md`

- [ ] **Step 1: README 更新**

画面一覧に「共有レシピ」を追加。次を明記:

- 共有レシピ API は `ADMIN_LOCAL_TOKEN` 必須
- 生 `menu_payload` は出さない / 外部共有禁止
- `.env.admin` が本番を指し得る → 起動前に host 目視
- 検証既定は local DB

- [ ] **Step 2: admin 一式検証**

```bash
cd admin && npm test
```

```bash
cd admin && npm run typecheck
```

```bash
cd admin && npm run lint
```

```bash
cd admin && npm run format:check
```

Expected: すべて PASS

- [ ] **Step 3: db-test 再確認（Task 1 後に未実行なら）**

```bash
docker compose --profile test run --rm db-test
```

- [ ] **Step 4: Commit**

```bash
git add admin/README.md
git commit -m "docs(admin): 共有レシピ画面と token 必須を README に追記"
```

---

## Spec coverage（self-review）

| Spec 要件 | Task |
| --- | --- |
| GRANT recipes/origins + title EXECUTE + index | 1 |
| pgTAP DML 不可・service_role 非 SELECT・plan(50) | 1 |
| access matrix | 1 |
| list/detail DTO・FORBIDDEN menu_payload | 2 |
| 一覧 title 関数・counts 定義・filter・完全 SQL | 3 |
| preview all-or-nothing・adaptations 固定・detail title | 3 |
| sql-guard basename allowlist（全面解禁しない） | 3 |
| token 必須ルート登録 + 400/401 テスト | 4 |
| UI 画面・ナビ | 5 |
| README・本番注意 | 6 |
| 親設計改訂 | 済み（本 plan 対象外） |
| 書込 API なし | 全 Task（GET only） |
| 本編非混入 | 全 Task（admin/ + supabase のみ） |

## Plan review MF 反映

| ID | 内容 | 反映 |
| --- | --- | --- |
| MF-P1 | list/detail 完全 SQL・counts・一覧に payload 列なし | Task 3 Step 4 |
| MF-P2 | plan(50)、mapper golden、Bearer/400 テスト、preview キー無し | Task 1 / 3 / 4 |
| MF-P3 | detail title 関数 | Task 3 getSharedRecipe SELECT |
| MF-P4 | 6→8 表・6→7 画面コメント | Task 1 / 4 |

## Placeholder scan

- TBD/TODO なし（mapper success fixture・SQL 本文を埋済み）
- コマンドは admin 用 / db-test 用を具体化
- migration ファイル名固定: `20260812120000_ops_readonly_shared_recipes.sql`

## Type consistency

- `SharedRecipesResponse` / `SharedRecipeDetail` / `SharedRecipePreview` を Task 2→3→4→5 で同一名
- filter: `status?: "active"|"disabled"`, `mealType?: "breakfast"|"lunch"|"dinner"`
- `previewError`: `"invalid_menu_payload" | "unsupported_schema_version" | null`
- `SharedRecipeListRow` を mapper と query で共有
