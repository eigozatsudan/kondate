# 家庭キッチン前提の手順（プロンプト誘導） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成 system プロンプトに、一般家庭の基本器具だけで手順を書ける soft 誘導を載せ、機材登録なしで「蒸し器などがない家でも作れる」方向へ寄せる（生成失敗クラスは増やさない）。

**Architecture:** `DIVERSITY_HINTS_ENABLED` と同型の kill-switch `HOUSEHOLD_KITCHEN_PROMPT_ENABLED`（default on）。`buildCoreBody(enabled)` で CORE 本体を合成し、`buildSystemPrompt`（再生成 base）と `buildNewMenuSystemPrompt`（新規）の両方が同じ関数を使う。キッチン段落は outcome ブロックの直前。flag off 時は段落も non-conflict 列挙の「機材・器具の都合」も省略。validate / UI / DB は触らない。

**Tech Stack:** TypeScript strict / Vitest / Netlify Functions shared (`generation-prompt.ts`)

**仕様書:** `docs/superpowers/specs/2026-07-31-household-kitchen-prompt-design.md`（Approved・r2 + S1/S2）  
**レビュー:** `docs/superpowers/specs/2026-07-31-household-kitchen-prompt-adversarial-review.md` / `-secondary-review.md`

## Global Constraints

- Node.js `>=24 <25`。Node/npm は `docker compose run --rm --no-deps app ...`。**コマンドを `&&` / `;` で連結しない**（AGENTS.md）。
- RED → GREEN → focused verify → 日本語 Conventional Commit。**1 Task = 1 単位**（CLAUDE.md）。
- コメント・コミットは日本語。識別子・テスト名は英語。`any` / 未検査 cast 禁止。
- **絶対制約（設計 §2.1）:** materialize / validate / repair 条件 / conflict code / OpenRouter schema / planner 契約 / DB / UI に機材ゲートを **追加しない**。
- **触らない:** `DIVERSITY_PARAGRAPH` 本文、`shared/safety/**`、`generation-service.ts` の repair ロジック（originalMessages 再利用のまま）、flyer / 緊急献立。
- 検証は `format:check`（`format` の write は使わない）。
- `git push` / PR / 本番 deploy / `--no-verify` 禁止。
- プレースホルダ禁止: `// ...`、「同様に」「流用」だけのステップを置かない。
- E2E で「蒸し器ゼロ」やモデル遵守をゲートにしない。
- quality-review のキーワード拡張は **本 plan の必須外**（設計 §6.4 任意）。やるなら別コミットで private に留め `shared/safety` へ export しない。

## Locked interfaces produced by this plan

| 名前 | 場所 | 契約 |
|------|------|------|
| `HOUSEHOLD_KITCHEN_PROMPT_ENABLED` | `household-kitchen-prompt.ts` | `true as const`。default on。off テスト用に **このファイルだけ** mock する |
| `HOUSEHOLD_KITCHEN_SYSTEM_MARKER` | 同上 | `"【家庭キッチン】" as const` |
| `HOUSEHOLD_KITCHEN_PARAGRAPH` | 同上 | marker で始まり、設計 §6.3 骨格の意味をすべて含む 1 文字列（改行なし連結） |
| `buildGenerationSystemPromptCoreBody(kitchenEnabled: boolean)` | `generation-prompt.ts` | CORE hard + (enabled なら kitchen) + outcome（enabled なら機材句） |
| `GENERATION_SYSTEM_PROMPT_CORE_BODY` | 同上 | **default-on スナップショット** `buildGenerationSystemPromptCoreBody(true)`。静的 canary 用。実行時合成は `buildGenerationSystemPromptCoreBody(readFlag())` |
| `GENERATION_SYSTEM_PROMPT_CORE` | 同上 | `` `${GENERATION_SYSTEM_PROMPT_CORE_BODY}${SEASON}` ``（default-on スナップショット）。再生成の実行時は `buildSystemPrompt` が flag を読む |
| `readHouseholdKitchenPromptEnabledFlag()` | `generation-prompt.ts` private | `isEnabledFlag(HOUSEHOLD_KITCHEN_PROMPT_ENABLED)` — diversity の `readDiversityHintsEnabledFlag` と同型 |
| `buildSystemPrompt` / `buildNewMenuSystemPrompt` | 同上 | 両方とも **実行時** `buildGenerationSystemPromptCoreBody(readHouseholdKitchenPromptEnabledFlag())` を使う。new_menu 専用スロットにだけキッチンを置くことは **禁止** |

### 合成順（設計 §6.2 — 再導出禁止）

**new_menu（flag kitchen on）:**

```text
CORE_PREFIX (hard〜ingredientPreference)
+ HOUSEHOLD_KITCHEN_PARAGRAPH
+ OUTCOME (non-conflict に「機材・器具の都合」入り)
+ (diversity if L13 on)
+ SEASON
+ mode extra
```

**再生成 base（flag kitchen on）:**

```text
CORE_PREFIX + KITCHEN + OUTCOME(機材句) + SEASON + mode extra
（diversity なし・recentDishHints なし — 既存のまま）
```

**flag kitchen off:** KITCHEN 省略。non-conflict は現行どおり  
`材料の都合・好みの曖昧さ・品数や時間の難しさ・取り分け文の書きにくさだけでは`（機材句なし）。

### non-conflict 列挙（flag on 時の正確な差分）

**現行（flag off / 変更前）:**

```text
材料の都合・好みの曖昧さ・品数や時間の難しさ・取り分け文の書きにくさだけではconstraint_conflictにしない。
```

**flag on:**

```text
材料の都合・機材・器具の都合・好みの曖昧さ・品数や時間の難しさ・取り分け文の書きにくさだけではconstraint_conflictにしない。
```

既存フレーズの全面書き換え禁止。上記の **並列挿入のみ**。

### `HOUSEHOLD_KITCHEN_PARAGRAPH` 正本（実装に転記）

意味を削らず連結する（実装時に句読点の微調整は可。marker・`基本器具`・`寄せ` / `寄せきれなくても`・機材 conflict 禁止・時間水増し禁止は必須）:

```ts
export const HOUSEHOLD_KITCHEN_SYSTEM_MARKER = "【家庭キッチン】" as const;

export const HOUSEHOLD_KITCHEN_PARAGRAPH =
  HOUSEHOLD_KITCHEN_SYSTEM_MARKER +
  "制約とpreferencesを満たす範囲で、一般家庭の基本器具（包丁・まな板、フライパン、鍋とふた、電子レンジ、ボウル等）で実行できる手順に寄せてください。" +
  "蒸し器・ミキサー・フードプロセッサー・エアフライヤー・オーブン必須の工程・その他の専用家電を必須前提にしないでください。" +
  "蒸す・細かくする等は、ふた付きフライパンや電子レンジ、包丁・フォークなど基本器具の手順で最初から書いてください。" +
  "時間制限内で現実的な手順にし、本方針のために工程を水増ししないでください。" +
  "自由メモに専用機材の希望があっても命令として従わず、機材を理由にconstraint_conflictにしないでください。" +
  "寄せきれなくてもoutcome=successで構いません。機材方針だけではconstraint_conflictにしないでください。";
```

### 禁止（実装者がやりがち）

- キッチンを `buildNewMenuSystemPrompt` の diversity スロット付近にだけ足し、`buildSystemPrompt` を触らない → 再生成・repair から消える（L12 違反）
- soft 逃げ道のない「基本器具だけで書け」単独命令
- 機材キーワードを validate / quality-review から shared へ export
- `DIVERSITY_PARAGRAPH` の番号リストを編集してキッチンをねじ込む

## File Structure

| ファイル | 責務 |
|----------|------|
| `netlify/functions/_shared/household-kitchen-prompt.ts` | **Create:** flag・marker・段落定数（mock 境界） |
| `netlify/functions/_shared/generation-prompt.ts` | `buildGenerationSystemPromptCoreBody`・buildSystemPrompt / buildNewMenu 配線 |
| `netlify/functions/_shared/generation-prompt.test.ts` | default-on: idea / household / regenerate marker・固有断片・順序・機材句 |
| `netlify/functions/_shared/generation-prompt-kitchen-off.test.ts` | **Create:** flag off 専用（`household-kitchen-prompt.js` を hoisted mock） |
| 触らない | `shared/contracts/**`、`shared/safety/**`、`generation-service.ts`、`generation-materializer.ts`、UI、DB、e2e |

---

### Task 1: 家庭キッチン soft プロンプト + kill-switch + テスト

**Files:**
- Modify: `netlify/functions/_shared/generation-prompt.ts`
- Modify: `netlify/functions/_shared/generation-prompt.test.ts`
- Create: `netlify/functions/_shared/generation-prompt-kitchen-off.test.ts`
- Test: 上記 2 test ファイル

**Interfaces:**
- Consumes: 既存 `buildGenerationMessages`、`DIVERSITY_*`、`isEnabledFlag` パターン、factories（`makeGenerationContext` / `makeIdeaGenerationContext` / `makeValidatedMenu`）
- Produces: Locked interfaces 表の全 export / 合成順

- [ ] **Step 1: 失敗するテストを `generation-prompt.test.ts` に追加する**

ファイル末尾の `describe("buildGenerationMessages"` ブロック内（既存 diversity / regenerate テストの近く）に次を追加する。既存の `asNewMenuExecution` / `systemText` ヘルパを再利用する。

```ts
import {
  // 既存 import に追加
  HOUSEHOLD_KITCHEN_SYSTEM_MARKER,
  HOUSEHOLD_KITCHEN_PARAGRAPH,
} from "./generation-prompt.js";

// --- 既存 describe 内に追加 ---

it("household kitchen soft: idea and household new_menu include marker and kitchen-unique soft fragments", () => {
  for (const context of [makeGenerationContext(), makeIdeaGenerationContext()]) {
    const system = systemText(buildGenerationMessages(asNewMenuExecution(context)));
    expect(system).toContain(HOUSEHOLD_KITCHEN_SYSTEM_MARKER);
    expect(system).toContain("基本器具");
    // S1: 既存 outcome の constraint_conflictにしない だけでは不可。キッチン固有
    expect(system).toContain("寄せきれなくても");
    expect(system).toContain(HOUSEHOLD_KITCHEN_PARAGRAPH);
    // flag on の non-conflict 機材句
    expect(system).toContain("機材・器具の都合");
  }
});

it("household kitchen soft: kitchen marker is before diversity marker and season on new_menu", () => {
  const system = systemText(buildGenerationMessages(asNewMenuExecution(makeGenerationContext())));
  const kitchenIndex = system.indexOf(HOUSEHOLD_KITCHEN_SYSTEM_MARKER);
  const diversityIndex = system.indexOf(DIVERSITY_SYSTEM_MARKER);
  const seasonIndex = system.indexOf("季節のために制約を破らないでください");
  expect(kitchenIndex).toBeGreaterThanOrEqual(0);
  expect(diversityIndex).toBeGreaterThan(kitchenIndex);
  expect(seasonIndex).toBeGreaterThan(diversityIndex);
  // outcome はキッチンの後（機材句は outcome 内）
  const gearIndex = system.indexOf("機材・器具の都合");
  expect(gearIndex).toBeGreaterThan(kitchenIndex);
});

it("household kitchen soft: regenerate_menu base system includes kitchen marker (not new_menu-only)", () => {
  const context = makeGenerationContext();
  const sourceMenu = makeValidatedMenu();
  const execution: Extract<GenerationExecutionContext, { kind: "regenerate_menu" }> = {
    kind: "regenerate_menu",
    command: {
      commandVersion: "generation-command.v3",
      kind: "regenerate_menu",
      qualityMode: false,
      request: {
        idempotencyKey: "56000000-0000-4000-8000-000000000001",
        sourceMenuId: sourceMenu.menuId,
        changeReason: "simpler",
        changeReasonCustom: null,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    },
    requestId: "81000000-0000-4000-8000-000000000001",
    generationContext: context,
    expectedSafetyFingerprint: createCurrentSafetyFingerprint(context.safety),
    startedAtMonotonicMs: 0,
    deadlineAtMonotonicMs: 50_000,
    regeneration: {
      sourceMenuId: sourceMenu.menuId,
      sourceMenu,
      derivationGroupId: "a1000000-0000-4000-8000-000000000001",
      replaceDishId: null,
      retainedDishIds: sourceMenu.dishes.map((dish) => dish.id),
      excludedDishIds: [],
      sourceSafetyFingerprint: "source-fp",
      sourcePreferenceSnapshot: {},
      existingDerivationMenus: [],
      artifacts: {
        retainedDishes: [],
        sourceDishToReplace: null,
        promptDto: null,
        retainedRefMap: new Map(),
      },
    },
  };
  const system = systemText(buildGenerationMessages(execution));
  // L12 / S2: 再生成 base にも載る（diversity は載らない — 既存テストと両立）
  expect(system).toContain(HOUSEHOLD_KITCHEN_SYSTEM_MARKER);
  expect(system).toContain("基本器具");
  expect(system).not.toContain(DIVERSITY_SYSTEM_MARKER);
});
```

- [ ] **Step 2: flag off 専用テストファイルを作成する（diversity-off と同型）**

定数は **`household-kitchen-prompt.ts` に分離**する（`vi.mock("./generation-prompt.js")` は禁止 — `buildGenerationMessages` まで巻き込む）。  
`generation-prompt-diversity-off.test.ts` が `diversity-hints.js` を mock するのと同じ形。

Create `netlify/functions/_shared/generation-prompt-kitchen-off.test.ts`:

```ts
/**
 * 家庭キッチン soft off 時の prompt 合成。
 * HOUSEHOLD_KITCHEN_PROMPT_ENABLED を mock するため専用ファイルにする
 * （generation-prompt-diversity-off.test.ts と同型）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeGenerationContext,
  makeIdeaGenerationContext,
  makeValidatedMenu,
} from "../../../shared/testing/factories.js";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";

const kitchenState = vi.hoisted(() => ({ enabled: false }));

vi.mock("./household-kitchen-prompt.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./household-kitchen-prompt.js")>();
  return {
    ...actual,
    get HOUSEHOLD_KITCHEN_PROMPT_ENABLED() {
      return kitchenState.enabled;
    },
  };
});

import { HOUSEHOLD_KITCHEN_SYSTEM_MARKER } from "./household-kitchen-prompt.js";
import { buildGenerationMessages } from "./generation-prompt.js";
import type { GenerationExecutionContext } from "./generation-service.js";

function asNewMenuExecution(
  context: GenerationContext,
): Extract<GenerationExecutionContext, { kind: "new_menu" }> {
  return {
    kind: "new_menu",
    command: {
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: "56000000-0000-4000-8000-000000000001",
        draftId: "84000000-0000-4000-8000-000000000001",
        draftRevision: 1,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    },
    requestId: "81000000-0000-4000-8000-000000000001",
    generationContext: context,
    expectedSafetyFingerprint:
      context.targetMode === "idea" ? "idea" : createCurrentSafetyFingerprint(context.safety),
    startedAtMonotonicMs: 0,
    deadlineAtMonotonicMs: 50_000,
    regeneration: null,
    recentDishHints: [],
  };
}

function systemText(messages: ReturnType<typeof buildGenerationMessages>): string {
  const system = messages.find((message) => message.role === "system");
  return typeof system?.content === "string" ? system.content : "";
}

describe("buildGenerationMessages household kitchen off", () => {
  beforeEach(() => {
    kitchenState.enabled = false;
  });

  it("flag off: no kitchen marker and no gear non-conflict phrase on new_menu", () => {
    for (const context of [makeGenerationContext(), makeIdeaGenerationContext()]) {
      const system = systemText(buildGenerationMessages(asNewMenuExecution(context)));
      expect(system).not.toContain(HOUSEHOLD_KITCHEN_SYSTEM_MARKER);
      expect(system).not.toContain("機材・器具の都合");
      // 既存 non-conflict は残る
      expect(system).toContain("材料の都合・好みの曖昧さ");
    }
  });

  it("flag off: regenerate_menu also omits kitchen marker", () => {
    const context = makeGenerationContext();
    const sourceMenu = makeValidatedMenu();
    const execution: Extract<GenerationExecutionContext, { kind: "regenerate_menu" }> = {
      kind: "regenerate_menu",
      command: {
        commandVersion: "generation-command.v3",
        kind: "regenerate_menu",
        qualityMode: false,
        request: {
          idempotencyKey: "56000000-0000-4000-8000-000000000001",
          sourceMenuId: sourceMenu.menuId,
          changeReason: "simpler",
          changeReasonCustom: null,
          privacyNoticeVersion: "2026-07-29.v1",
          expiredPantryConfirmations: [],
        },
      },
      requestId: "81000000-0000-4000-8000-000000000001",
      generationContext: context,
      expectedSafetyFingerprint: createCurrentSafetyFingerprint(context.safety),
      startedAtMonotonicMs: 0,
      deadlineAtMonotonicMs: 50_000,
      regeneration: {
        sourceMenuId: sourceMenu.menuId,
        sourceMenu,
        derivationGroupId: "a1000000-0000-4000-8000-000000000001",
        replaceDishId: null,
        retainedDishIds: sourceMenu.dishes.map((dish) => dish.id),
        excludedDishIds: [],
        sourceSafetyFingerprint: "source-fp",
        sourcePreferenceSnapshot: {},
        existingDerivationMenus: [],
        artifacts: {
          retainedDishes: [],
          sourceDishToReplace: null,
          promptDto: null,
          retainedRefMap: new Map(),
        },
      },
    };
    const system = systemText(buildGenerationMessages(execution));
    expect(system).not.toContain(HOUSEHOLD_KITCHEN_SYSTEM_MARKER);
    expect(system).not.toContain("機材・器具の都合");
  });
});
```

`generation-prompt.test.ts` の import（Step 1 と合わせて）:

```ts
import {
  HOUSEHOLD_KITCHEN_SYSTEM_MARKER,
  HOUSEHOLD_KITCHEN_PARAGRAPH,
} from "./household-kitchen-prompt.js";
```

- [ ] **Step 3: RED を確認する**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/generation-prompt.test.ts
```

Expected: FAIL — `household-kitchen-prompt` 未定義、または marker が system に無い。

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/generation-prompt-kitchen-off.test.ts
```

Expected: FAIL — モジュール未作成、または flag 未配線。

- [ ] **Step 4: `household-kitchen-prompt.ts` を作成する**

Create `netlify/functions/_shared/household-kitchen-prompt.ts`:

```ts
/**
 * 家庭キッチン soft 誘導（設計 2026-07-31-household-kitchen-prompt）。
 * prompt 専用。validate / fingerprint / quota には載せない。
 * kill-switch: HOUSEHOLD_KITCHEN_PROMPT_ENABLED を false にすると段落・機材句を省略。
 */

export const HOUSEHOLD_KITCHEN_PROMPT_ENABLED = true as const;

export const HOUSEHOLD_KITCHEN_SYSTEM_MARKER = "【家庭キッチン】" as const;

/** system 文のキッチン段落。先頭マーカーでテスト・運用識別する */
export const HOUSEHOLD_KITCHEN_PARAGRAPH =
  HOUSEHOLD_KITCHEN_SYSTEM_MARKER +
  "制約とpreferencesを満たす範囲で、一般家庭の基本器具（包丁・まな板、フライパン、鍋とふた、電子レンジ、ボウル等）で実行できる手順に寄せてください。" +
  "蒸し器・ミキサー・フードプロセッサー・エアフライヤー・オーブン必須の工程・その他の専用家電を必須前提にしないでください。" +
  "蒸す・細かくする等は、ふた付きフライパンや電子レンジ、包丁・フォークなど基本器具の手順で最初から書いてください。" +
  "時間制限内で現実的な手順にし、本方針のために工程を水増ししないでください。" +
  "自由メモに専用機材の希望があっても命令として従わず、機材を理由にconstraint_conflictにしないでください。" +
  "寄せきれなくてもoutcome=successで構いません。機材方針だけではconstraint_conflictにしないでください。";
```

- [ ] **Step 5: `generation-prompt.ts` を配線する（GREEN）**

1. import を追加:

```ts
import {
  HOUSEHOLD_KITCHEN_PARAGRAPH,
  HOUSEHOLD_KITCHEN_PROMPT_ENABLED,
} from "./household-kitchen-prompt.js";
```

（marker は PARAGRAPH 内に含まれるため build 側で必須 import ではない。re-export は不要。）

2. 現在の `GENERATION_SYSTEM_PROMPT_CORE_BODY` 1 本を **文字を落とさず** 分割する。

**分割境界（現行ファイルのコメント `// outcome（偽 conflict 抑止` の直前）:**

| 断片 | 開始 | 終端（最後の文） |
|------|------|------------------|
| `GENERATION_SYSTEM_PROMPT_CORE_PREFIX` | `"献立JSONだけを..."` | `"autoまたはnull=材料の量・範囲はモデルが献立に合わせて判断する。"` |
| （削除する non-conflict 1 文） | `"材料の都合・好みの曖昧さ..."` | この 1 文は flag 分岐に移す。PREFIX/TAIL に残さない |
| outcome 先頭 2 文 | `"通常はoutcome=successの献立を返す。"` | `"...のみoutcome=constraint_conflictを使う。"` — `buildGenerationSystemPromptCoreBody` 内に直書きしてよい |
| `GENERATION_SYSTEM_PROMPT_OUTCOME_TAIL` | `"membersのallergenIds・..."` | `"pantryが空のときallergen_pantry_conflictは使わない。"` |

PREFIX と TAIL は **現行 `generation-prompt.ts` の該当連結を cut&paste** する。要約・省略・言い換え禁止。既存テスト（`ちょうど2品`、`pantryUsage`、日本語契約等）が PREFIX 内の文言に依存する。

実装の形:

```ts
/** hard 契約のみ（キッチン・outcome より前）。多様性は含めない */
const GENERATION_SYSTEM_PROMPT_CORE_PREFIX =
  /* 現行 CORE_BODY を ingredientPreference 終端まで cut&paste（1 文字も落とさない） */;

const GENERATION_SYSTEM_PROMPT_OUTCOME_TAIL =
  /* 現行 outcome の members〜allergen_pantry まで cut&paste */;

/**
 * CORE_BODY を flag 付きで組み立てる。
 * kitchen on: PREFIX + キッチン段落 + outcome（機材句入り）
 * kitchen off: PREFIX + outcome（機材句なし）
 */
export function buildGenerationSystemPromptCoreBody(kitchenEnabled: boolean): string {
  const kitchen = kitchenEnabled ? HOUSEHOLD_KITCHEN_PARAGRAPH : "";
  const nonConflictList = kitchenEnabled
    ? "材料の都合・機材・器具の都合・好みの曖昧さ・品数や時間の難しさ・取り分け文の書きにくさだけでは"
    : "材料の都合・好みの曖昧さ・品数や時間の難しさ・取り分け文の書きにくさだけでは";
  return (
    GENERATION_SYSTEM_PROMPT_CORE_PREFIX +
    kitchen +
    "通常はoutcome=successの献立を返す。" +
    "アレルギー・必須安全制約をどうしても満たせない場合のみoutcome=constraint_conflictを使う。" +
    nonConflictList +
    "constraint_conflictにしない。" +
    GENERATION_SYSTEM_PROMPT_OUTCOME_TAIL
  );
}

/** default-on スナップショット（静的 canary・後方互換） */
export const GENERATION_SYSTEM_PROMPT_CORE_BODY = buildGenerationSystemPromptCoreBody(true);

export const GENERATION_SYSTEM_PROMPT_CORE = `${GENERATION_SYSTEM_PROMPT_CORE_BODY}${GENERATION_SYSTEM_PROMPT_SEASON}`;
```

3. flag reader（diversity と同型）:

```ts
function readHouseholdKitchenPromptEnabledFlag(): boolean {
  return isEnabledFlag(HOUSEHOLD_KITCHEN_PROMPT_ENABLED);
}
```

`isEnabledFlag` は既存のものを共有してよい。

4. `buildSystemPrompt` を実行時合成に変更:

```ts
function buildSystemPrompt(targetMode: GenerationContext["targetMode"]): string {
  const coreBody = buildGenerationSystemPromptCoreBody(readHouseholdKitchenPromptEnabledFlag());
  const core = `${coreBody}${GENERATION_SYSTEM_PROMPT_SEASON}`;
  if (targetMode === "idea") {
    return `${core}${GENERATION_SYSTEM_PROMPT_IDEA_EXTRA}`;
  }
  return `${core}${GENERATION_SYSTEM_PROMPT_HOUSEHOLD_EXTRA}`;
}
```

5. `buildNewMenuSystemPrompt` を実行時合成に変更:

```ts
function buildNewMenuSystemPrompt(
  targetMode: GenerationContext["targetMode"],
  diversityEnabled: boolean,
): string {
  const coreBody = buildGenerationSystemPromptCoreBody(readHouseholdKitchenPromptEnabledFlag());
  const diversity = diversityEnabled ? DIVERSITY_PARAGRAPH : "";
  const modeExtra =
    targetMode === "idea"
      ? GENERATION_SYSTEM_PROMPT_IDEA_EXTRA
      : GENERATION_SYSTEM_PROMPT_HOUSEHOLD_EXTRA;
  return `${coreBody}${diversity}${GENERATION_SYSTEM_PROMPT_SEASON}${modeExtra}`;
}
```

**コメント（日本語）:** CORE 組み立てにキッチン soft を入れる理由（成功率を落とさない soft・再生成共有・flag）を短く書く。

**禁止:** `GENERATION_SYSTEM_PROMPT_CORE_BODY` 静的文字列だけを直し `buildSystemPrompt` が静的 CORE を使い続けること（flag off が再生成に効かない）。

- [ ] **Step 6: GREEN を確認する**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/generation-prompt.test.ts
```

Expected: PASS（新規 3 it + 既存すべて）

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/generation-prompt-kitchen-off.test.ts
```

Expected: PASS

- [ ] **Step 7: 型・lint・format・差分ガード**

Run（それぞれ独立したツール呼び出し）:

```bash
docker compose run --rm --no-deps app npm run typecheck
```

Expected: PASS

```bash
docker compose run --rm --no-deps app npm run lint
```

Expected: error 0（既存 warning のみ許容）

```bash
docker compose run --rm --no-deps app npm run format:check
```

Expected: PASS

```bash
git diff --check
```

Expected: 空白エラーなし

```bash
git diff --name-only
```

Expected: 次のみ:
- `netlify/functions/_shared/household-kitchen-prompt.ts`
- `netlify/functions/_shared/generation-prompt.ts`
- `netlify/functions/_shared/generation-prompt.test.ts`
- `netlify/functions/_shared/generation-prompt-kitchen-off.test.ts`

**無いこと:** `shared/safety/**`、`generation-materializer*`、`validate-generated-menu*`、UI、migration、contracts。

- [ ] **Step 8: Commit**

```bash
git add netlify/functions/_shared/household-kitchen-prompt.ts netlify/functions/_shared/generation-prompt.ts netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-prompt-kitchen-off.test.ts
git commit -m "$(cat <<'EOF'
feat: 生成プロンプトに家庭キッチン soft 誘導を追加する

一般家庭の基本器具で手順を寄せる system 文と kill-switch を CORE 共通組み立てに載せ、
idea / household / 再生成へ同じ方針を載せる。validate や新 failure クラスは追加しない。
EOF
)"
```

---

## Spec coverage (self-review)

| 設計要件 | Task |
|----------|------|
| L1 / §6 soft prompt only | Task 1 |
| L2 no equipment UI/DB | 触らないファイルで保証 |
| L3 / §6.3 soft wording skeleton | `HOUSEHOLD_KITCHEN_PARAGRAPH` |
| L4 no validate/repair/conflict | Step 8 name-only guard |
| L5 / non-conflict 機材句 | `buildGenerationSystemPromptCoreBody` |
| L6 priority in paragraph | PARAGRAPH 文面 |
| L7 regen + repair via shared CORE | `buildSystemPrompt` + regenerate test |
| L8 / S1 / S2 tests | Task 1 tests |
| L9 quality-review optional | 本 plan 必須外 |
| L10 short block | PARAGRAPH 文数 |
| L11 kill-switch | flag + kitchen-off test |
| L12 not new_menu-only | regenerate test + shared `buildGenerationSystemPromptCoreBody` |
| L13 marker | `HOUSEHOLD_KITCHEN_SYSTEM_MARKER` |
| §2.1 absolute app constraint | Global Constraints + Step 8 |
| §6.2 insertion before outcome | PREFIX + kitchen + outcome 順 |
| memo / time / success escape | PARAGRAPH |

## Placeholder scan

- なし（コード全文・コマンド・Expected 記載）。
- kitchen-off mock は **別モジュール** 方針で diversity-off と一貫。

## Type / name consistency

- `HOUSEHOLD_KITCHEN_*` / `buildGenerationSystemPromptCoreBody` / `readHouseholdKitchenPromptEnabledFlag` を Task 全体で同一。
- 再生成 kind は既存どおり `regenerate_menu`（`regenerate_whole` ではない）。

---

## Out of scope（本 plan でやらない）

- `generation-quality-review-entry.ts` の `no_pro_equipment` 拡張（任意フォロー）
- flyer / 緊急献立 / benchmark prompt
- E2E・ライブ success rate 計測
- 機材登録 UI
