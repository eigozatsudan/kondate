# 献立 UX・多様性ヒント・選択メンバー安全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ウィザード未入力のトースト UX、作る相手ページの並びと選択メンバー安全の誤認解消、家族フォームの validation toast、新規生成のソフト多様性ヒントを、生成不能を増やさずに届ける。

**Architecture:** ブラウザは薄い `AppToast` と step ローカル validation。安全条件は既存どおり `targetMemberIds` のみ。確認/conflict 補助文は pending メタ（localStorage・pending と同一 TTL）で `targetMode` を保持。多様性は Functions 内 fail-open loader + `buildGenerationMessages` の `new_menu` 合成のみ（検証・fingerprint 非介入）。

**Tech Stack:** React 19 / React Router 8 / TanStack Query 5 / TypeScript strict / Vitest / RTL / Playwright / Netlify Functions / Supabase JS / Zod

**仕様書:** `docs/superpowers/specs/2026-07-30-ux-diversity-safety-design.md`（Approved for planning, commit `edfe575`）  
**ブランチ / worktree:** `feat/ux-diversity-safety` / `.worktrees/ux-diversity-safety`

## Global Constraints

- Node.js `>=24 <25`。Node/npm は `docker compose run --rm --no-deps app <cmd>`。コマンドを `&&` / `;` で連結しない（1 コマンド＝1 ツール呼び出し）。
- 各 Task: RED → GREEN → focused 検証（Vitest / typecheck / lint / format:check / `git diff --check`）→ レビュー（Critical/Important/**Minor ゼロ**まで）→ 日本語 Conventional Commit。
- UI 文言・コメント・コミットは日本語。識別子・テスト名は英語。`any` / 未検査 cast 禁止。
- 320 CSS px・44×44・横スクロールなし。新カラー体系禁止。
- 後方互換不要。`git push` / PR / 本番デプロイ / `--no-verify` 禁止。
- 設計 L1–L14 を再導出しない。多様性は生成成功より弱い。
- OpenRouter / service key をブラウザに出さない。hints はサーバーのみ。
- 生成・ログに名前・アレルギー・自由文・raw AI・hints 料理名を出さない。

## Locked interfaces produced by this plan

| 名前 | 場所 | 契約 |
|------|------|------|
| `HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY` | `src/features/planner/household-safety-helper-copy.ts` | 固定文 `"献立には今回選んだ家族の条件だけが使われます。"` の正本。review / generation はここだけ import |
| `useAppToast` / `AppToastProvider` | `src/shared/ui/app-toast.tsx` | 下記シグネチャ |
| `showValidationToast` 用途制限 | 同上 | validation 用途の `show` は planner 質問 step と household 追加・編集のみ |
| `PendingGenerationMeta` | `src/features/generation/model/pending-generation-meta.ts` | 下記。pending と同一 localStorage 寿命 |
| `DIVERSITY_HINTS_ENABLED` | `netlify/functions/_shared/diversity-hints.ts` | `true` 定数。off で load スキップ |
| `loadRecentDishHints` | 同上 | fail-open・200ms・max 10 menus / 24 hints |
| `RecentDishHint` | 同上（Functions private） | `{ dishName: string; role?: string }` |
| `GenerationExecutionContext` (new_menu) | `generation-service.ts` | `recentDishHints: readonly RecentDishHint[]` を **new_menu のみ** 追加 |

```ts
// app-toast.tsx（Locked）
export type AppToastTone = "error" | "info";
export type ShowAppToastInput = {
  message: string;
  tone: AppToastTone;
  durationMs?: number; // default 6000
};
export function AppToastProvider(props: { children: React.ReactNode }): React.JSX.Element;
export function useAppToast(): {
  show: (input: ShowAppToastInput) => void;
  dismiss: () => void;
};
```

```ts
// pending-generation-meta.ts（Locked）
export type PendingGenerationMeta = {
  kind: "new_menu";
  targetMode: "household" | "idea";
  idempotencyKey: string;
};
export function savePendingGenerationMeta(meta: PendingGenerationMeta, storage?: Storage): void;
export function readPendingGenerationMeta(storage?: Storage): PendingGenerationMeta | null;
export function clearPendingGenerationMeta(storage?: Storage): void;
// storage key 例: "kondate:generation:v3:meta" — pending clear と同タイミングで必ず clear
```

```ts
// diversity-hints.ts（Locked）
export const DIVERSITY_HINTS_ENABLED = true as const;
export const RECENT_DISH_HINTS_TIMEOUT_MS = 200 as const;
export const RECENT_MENUS_LIMIT = 10 as const;
export const RECENT_DISH_HINTS_MAX = 24 as const;
export type RecentDishHint = { dishName: string; role?: string };
export function loadRecentDishHints(input: {
  ownerClient: /* user-scoped Supabase */;
  userId: string;
  timeoutMs?: number;
  enabled?: boolean; // default DIVERSITY_HINTS_ENABLED
}): Promise<readonly RecentDishHint[]>; // never throws; [] on fail/timeout/off
```

## File Structure

| ファイル | 責務 |
|----------|------|
| `src/shared/ui/app-toast.tsx` | Provider + hook + 表示 |
| `src/shared/ui/app-toast.test.tsx` | 1 件制限・status role・dismiss |
| `src/styles.css` | `.app-toast` z-index 20（autosave 15 の上） |
| `src/app/providers.tsx` | `AppToastProvider` マウント |
| `src/features/planner/components/meal-step.tsx` | incomplete 押下可 + toast + alert + focus |
| `src/features/planner/components/cuisine-step.tsx` | 同上 |
| `src/features/planner/components/ingredient-step.tsx` | empty dialog 廃止 → toast + inline |
| `src/features/planner/components/audience-step.tsx` | 並び・サマリー・ヒント・incomplete UX |
| `src/features/planner/components/review-step.tsx` | household 補助文 sibling |
| `src/features/planner/components/planner-wizard.tsx` | 必要なら toast 配線 / autosave error 連携 |
| `src/features/planner/household-safety-helper-copy.ts` | 固定補助文 |
| `src/features/household/*` | validation toast + focus |
| `src/features/generation/model/pending-generation-meta.ts` | targetMode メタ |
| `src/features/generation/model/pending-generation.ts` | clear 時に meta も clear |
| `src/features/planner/planner-route.tsx` | new_menu pending 保存時 meta upsert |
| `src/features/history/hooks/use-regeneration.ts` | regenerate 時 meta clear |
| `src/features/generation/components/generation-status-panel.tsx` | constraint_conflict 補助文 1 回 |
| `netlify/functions/_shared/diversity-hints.ts` | load + constants |
| `netlify/functions/_shared/generation-service.ts` | new_menu context に hints |
| `netlify/functions/_shared/generation-prompt.ts` | CORE_BODY + DIVERSITY + SEASON 合成 |
| `e2e/specs/*` | audience / incomplete セレクタ追随 |
| `.superpowers/sdd/ux-diversity-safety-audit.md` | 経路監査 1–6 記録（gitignored 可） |

---

### Task 1: AppToast 共通部品

**Files:**
- Create: `src/shared/ui/app-toast.tsx`
- Create: `src/shared/ui/app-toast.test.tsx`
- Modify: `src/styles.css`（`.app-toast` ブロック追加）
- Modify: `src/app/providers.tsx`（Provider ラップ）
- Modify: `src/app/providers.test.tsx`（必要なら Provider 内レンダー）

**Interfaces:**
- Consumes: なし
- Produces: `AppToastProvider`, `useAppToast`, CSS `.app-toast` z-index 20

- [ ] **Step 1: Write the failing test**

```tsx
// src/shared/ui/app-toast.test.tsx
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppToastProvider, useAppToast } from "./app-toast";

function Probe() {
  const toast = useAppToast();
  return (
    <button type="button" onClick={() => toast.show({ message: "食事の時間帯を選んでください", tone: "error" })}>
      show
    </button>
  );
}

it("shows a single status toast and replaces on second show", async () => {
  const user = userEvent.setup();
  render(
    <AppToastProvider>
      <Probe />
    </AppToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "show" }));
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent("食事の時間帯を選んでください");
  expect(status).toHaveAttribute("aria-live", "polite");
  expect(status.className).toMatch(/app-toast/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/shared/ui/app-toast.test.tsx
```

Expected: FAIL（module not found）

- [ ] **Step 3: Write minimal implementation**

`AppToastProvider`: React context + state `current: { message, tone, durationMs } | null`。  
`show`: 後勝ちで置換。`tone === "error"` でも **role="status" aria-live="polite"**（設計: alert は inline 側）。  
default `durationMs = 6000`。タイマーで dismiss。**pointerenter / focusin でタイマー停止、leave / focusout で再開**。  
`dismiss()` で即クリア。  
DOM: `className="app-toast app-toast--error|info"` fixed 右上。  
`useAppToast` は Provider 外で throw。

`src/styles.css` に追加（autosave 見た目トークン流用・z-index のみロック）:

```css
.app-toast {
  position: fixed;
  z-index: 20;
  top: max(12px, env(safe-area-inset-top, 0px));
  right: max(12px, env(safe-area-inset-right, 0px));
  /* 色・padding は .autosave-toast に近い値をコピー */
  pointer-events: none;
  max-width: min(calc(100vw - 24px), 18rem);
}
.app-toast--error {
  color: var(--danger);
  border: 1px solid var(--border-strong);
  background: #fff8f7;
}
```

`AppProviders` で `QueryClientProvider` の内側（または外側どちらでも可だが children を包む）に `AppToastProvider` を追加。

- [ ] **Step 4: Run tests and typecheck**

```bash
docker compose run --rm --no-deps app npm test -- --run src/shared/ui/app-toast.test.tsx
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/ui/app-toast.tsx src/shared/ui/app-toast.test.tsx src/styles.css src/app/providers.tsx src/app/providers.test.tsx
git commit -m "feat: 入力漏れ用の AppToast を追加する"
```

---

### Task 2: ウィザード質問 step の incomplete UX

**Files:**
- Modify: `src/features/planner/components/meal-step.tsx`
- Modify: `src/features/planner/components/cuisine-step.tsx`
- Modify: `src/features/planner/components/ingredient-step.tsx`
- Modify: 各既存 `*.test.tsx` / `planner-wizard.test.tsx` / `accessibility.test.tsx` の incomplete disabled 前提を更新
- Test: 各 step のテストファイル（無ければ追加）

**Interfaces:**
- Consumes: `useAppToast` from Task 1
- Produces: incomplete でも主ボタン押下可。文言ロック:
  - meal: `食事の時間帯を選んでください`
  - ingredients: `メイン食材を1つ以上選んでください`
  - cuisine: `ジャンルを選んでください`

- [ ] **Step 1: Write failing tests（meal 例）**

```tsx
it("allows Next when empty and shows toast plus alert and focuses radiogroup", async () => {
  const user = userEvent.setup();
  const onNext = vi.fn();
  render(
    <AppToastProvider>
      <MealStep value={null} onChange={vi.fn()} onNext={onNext} />
    </AppToastProvider>,
  );
  const next = screen.getByRole("button", { name: "次へ" });
  expect(next).not.toBeDisabled();
  await user.click(next);
  expect(onNext).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("食事の時間帯を選んでください");
  expect(screen.getByRole("status")).toHaveTextContent("食事の時間帯を選んでください");
  const group = screen.getByRole("radiogroup");
  expect(group.querySelector("input,button")).toHaveFocus();
});
```

同様に cuisine / ingredients（ingredients は **alertdialog が無い**こと、toast+alert があること）。

- [ ] **Step 2: Run tests to verify they fail**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/components/meal-step.tsx src/features/planner/components/cuisine-step.tsx src/features/planner/components/ingredient-step.tsx
```

（テストファイルパスに合わせて調整）Expected: FAIL

- [ ] **Step 3: Implement**

各 step:

1. incomplete でも `disabled={disabled}` のみ（親 busy 以外は押下可）。
2. ローカル `errorMessage` state。
3. Next click:
   - incomplete → set errorMessage、`useAppToast().show({ message, tone: "error" })`、focus 先（設計マトリクス）、return
   - complete → `dismiss()` toast、clear error、`onNext()`
4. value が complete になったら errorMessage clear。
5. unmount で toast dismiss（useEffect cleanup）。
6. ingredient: `emptyGateOpen` alertdialog ブロック削除。`mainIngredientRequiredMessage` を inline alert に流用。

autosave error 中に toast を抑止する必要があれば、`planner-wizard` から `autosaveStatus === "error"` を props で渡すか、DOM に `.autosave-toast--error` があるとき toast を skip（設計: retry を隠さない）。Task 2 では **props `suppressValidationToast?: boolean`** を wizard から渡す最小実装でよい。

- [ ] **Step 4: Verify**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: プランナー質問stepの未入力トーストを追加する"
```

---

### Task 3: audience 並び・選択サマリー・チェック必須 UX

**Files:**
- Modify: `src/features/planner/components/audience-step.tsx`
- Modify: `src/features/planner/components/audience-step` 関連テスト / `planner-wizard.test.tsx` / `accessibility.test.tsx`
- Modify: `src/features/planner/current-safety-summary.tsx`（必要なら props 追加は **しない** — 補助文は Task 6）

**Interfaces:**
- Consumes: `useAppToast`, `CurrentSafetySummary`, `normalizeAudienceForModeChange`
- Produces: DOM 順 idea → household → checks → summary(selected)；incomplete 文言

文言ロック:

- mode 未選択 toast: `作る相手の選び方を選んでください`
- household 0: `献立に合わせる家族を1人以上選んでください`
- idea servings null: `人数を選んでください`
- 常時ヒント: `献立に合わせる家族を1人以上選んでください`
- 一覧注記: `一覧の表示は選ぶときの参考です。チェックしていない人の条件は献立に入りません。`
- 選択 0 サマリー本文: `家族を選ぶと、その人の条件がここに表示されます。`
- 選択 1+ 注記: `ここに出ている条件だけが献立に使われます。選んでいない家族は含まれません。`

- [ ] **Step 1: Failing tests**

```tsx
it("orders idea radio before household and shows summary only for selected members under checks", () => {
  render(
    <AudienceStep
      value={{ targetMode: "household", targetMemberIds: [aId], servings: null }}
      eligibleMembers={[memberA, memberB]}
      onChange={vi.fn()}
      onNext={vi.fn()}
    />,
  );
  const radios = screen.getAllByRole("radio");
  expect(radios[0]).toHaveAccessibleName(/人数だけ/);
  expect(radios[1]).toHaveAccessibleName(/家族に合わせて/);
  // summary appears after checkboxes: query structure
  expect(screen.getByRole("heading", { name: "現在の家族・安全条件" })).toBeInTheDocument();
  expect(screen.getByText(memberA.displayName)).toBeInTheDocument();
  // unselected B must not appear inside summary section — assert via within(summary)
});

it("blocks next with toast when household has zero members", async () => { /* ... */ });
```

- [ ] **Step 2: RED run**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/components/
```

- [ ] **Step 3: Implement layout**

1. ラジオ順: idea label を先、household を後。
2. 削除: ラジオ上の `CurrentSafetySummary`。
3. household ブロック順: ヒント → checkboxes → selected filter の `CurrentSafetySummary`（0 人時はメンバー行なし固定文。**免責・家族設定リンクは CurrentSafetySummary 内で維持**）。
4. incomplete Next: Task 2 と同パターン。focus: mode → radiogroup; household 0 → members group; idea → chips/select。
5. `isComplete` は Next の disabled に使わない（押下可）。

- [ ] **Step 4: GREEN + verify**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run format:check
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 作る相手stepの並びと選択安全表示を直す"
```

---

### Task 4: 家族追加・編集の validation toast

**Files:**
- Modify: `src/features/household/household-onboarding-page.tsx`
- Modify: `src/features/household/household-settings-page.tsx`（保存・完了経路）
- Modify: 対応 `*.test.tsx`
- Consumes: `useAppToast`, `householdSettingsSchema` / `toHouseholdFieldErrors`

**Interfaces:**
- Produces: 必須漏れで先頭 field message の toast + field errors + focus

- [ ] **Step 1: Failing test**

```tsx
it("shows toast and focuses first invalid field when save is incomplete", async () => {
  // render form with empty displayName / missing age as per schema
  // click 保存 or 完了
  // expect getByRole("status") message
  // expect first invalid control focused
  // expect field error text present
});
```

- [ ] **Step 2: RED**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/household/
```

- [ ] **Step 3: Implement**

保存ハンドラ先頭:

```ts
const parsed = householdSettingsSchema.safeParse(values);
if (!parsed.success) {
  const fieldErrors = toHouseholdFieldErrors(parsed.error);
  setFieldErrors(fieldErrors);
  const firstMessage =
    focusOrder.map((k) => fieldErrors[k]).find(Boolean) ?? "入力内容を確認してください";
  toast.show({ message: firstMessage, tone: "error" });
  focusFirstInvalid(fieldErrors);
  return;
}
toast.dismiss();
// existing save...
```

ネットワーク失敗: 既存 `role="alert"` status 行があるなら toast 省略（設計）。

- [ ] **Step 4: Verify + commit**

```bash
git commit -m "feat: 家族設定の必須漏れにトーストを出す"
```

---

### Task 5: 選択メンバー安全の経路監査 + §12.3a 回帰

**Files:**
- Create: `.superpowers/sdd/ux-diversity-safety-audit.md`（gitignored ならコミット不要。Task 報告に表を残す）
- Modify/Create tests:
  - `netlify/functions/_shared/generation-context.test.ts`
  - `netlify/functions/_shared/generation-prompt.test.ts`
  - fingerprint 既存テストがあれば拡張
- Modify production **のみ監査 fail 時**

**Interfaces:**
- Consumes: 既存 `loadGenerationContext`, `buildGenerationMessages`, `validateGenerationPreflight`, `createCurrentSafetyFingerprint`
- Produces: 監査記録 + 回帰テスト固定

監査チェックリスト（各 pass/fail）:

1. generation-context member/dislike/safety load  
2. buildGenerationMessages / prompt members  
3. preflight / validate members  
4. reserve snapshot target_member_ids  
5. fingerprint 入力メンバー  
6. finalize p_target_members  

- [ ] **Step 1: Write regression test**

```ts
it("§12.3a excludes unselected allergic member B from context prompt preflight and fingerprint", async () => {
  // A: allergy none, B: has allergen
  // submission.targetMemberIds = [A]
  const ctx = await loadGenerationContext(...);
  expect(ctx.safety.members.map((m) => m.householdMemberId)).toEqual([A]);
  const messages = buildGenerationMessages({ kind: "new_menu", generationContext: ctx, recentDishHints: [], ... });
  const payload = JSON.parse(extractUserJson(messages));
  expect(payload.members).toHaveLength(1);
  const preflight = validateGenerationPreflight(ctx, now);
  expect(preflight.ok || !preflight.issueCodes?.includes("allergy_conflict")).toBeTruthy();
  // fingerprint from A-only safety must not equal fingerprint that includes B
});
```

- [ ] **Step 2: Run RED if any code path wrongly includes B; else PASS documents current correct server**

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/generation-context.test.ts netlify/functions/_shared/generation-prompt.test.ts
```

- [ ] **Step 3: Audit code paths（read-only then fix only if fail）**

Read and record:

- `generation-context.ts` `.in("id", submission.targetMemberIds)`
- reserve RPC args from draft
- `createCurrentSafetyFingerprint(context.safety)`
- finalize target members

If any path uses eligible-all, minimal fix + test.

- [ ] **Step 4: Commit**

```bash
git commit -m "test: 選択メンバーのみの安全経路を回帰固定する"
```

（コード修正があれば `fix:`）

---

### Task 6: household 補助文 + pending メタ

**Files:**
- Create: `src/features/planner/household-safety-helper-copy.ts`
- Create: `src/features/generation/model/pending-generation-meta.ts`
- Create: `src/features/generation/model/pending-generation-meta.test.ts`
- Modify: `src/features/generation/model/pending-generation.ts`（clear 連携）
- Modify: `src/features/planner/planner-route.tsx`（new_menu save 時 upsert meta）
- Modify: `src/features/history/hooks/use-regeneration.ts`（regenerate 時 clear meta）
- Modify: `src/features/planner/components/review-step.tsx`（sibling 補助文）
- Modify: `src/features/generation/components/generation-status-panel.tsx`
- Modify: 各テスト

**Interfaces:**
- Consumes: `HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY`, pending meta API
- Produces: 確認 + conflict UI 補助文

- [ ] **Step 1: Failing tests**

```ts
// pending-generation-meta.test.ts
it("round-trips meta and clears", () => {
  const storage = memoryStorage();
  savePendingGenerationMeta(
    { kind: "new_menu", targetMode: "household", idempotencyKey: key },
    storage,
  );
  expect(readPendingGenerationMeta(storage)?.targetMode).toBe("household");
  clearPendingGenerationMeta(storage);
  expect(readPendingGenerationMeta(storage)).toBeNull();
});
```

```tsx
// review-step: household shows helper under summary, not inside shared summary for idea
// generation-status-panel:
// - new_menu + household meta + constraint_conflict → helper once
// - regenerate_* → no helper
// - idea → no helper
// - missing meta → no helper
```

- [ ] **Step 2: RED**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/ src/features/planner/components/review-step
```

- [ ] **Step 3: Implement**

1. `household-safety-helper-copy.ts`:

```ts
export const HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY =
  "献立には今回選んだ家族の条件だけが使われます。" as const;
```

2. pending meta: localStorage key `kondate:generation:v3:meta`、Zod strict parse、TTL は **read 時に pending が null なら meta も捨てる**（または pending と同じ createdAt 比較）。実装最短: `clearPendingGeneration` / `savePendingGeneration` ラッパから meta clear/upsert を呼ぶ。

3. `planner-route` new_menu:

```ts
savePendingGeneration(pending);
savePendingGenerationMeta({
  kind: "new_menu",
  targetMode: saved.targetMode, // "household" | "idea"
  idempotencyKey: pending.request.idempotencyKey,
});
```

4. regenerate / clearPending: `clearPendingGenerationMeta()`。

5. `review-step`: `value.targetMode === "household"` のとき `CurrentSafetySummary` の **直後**に `<p>{HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY}</p>`（共有コンポーネントに埋め込まない）。

6. `GenerationStatusPanel` constraint_conflict 分岐:

```ts
const pending = readPendingGeneration(...);
const meta = readPendingGenerationMeta();
const showHelper =
  pending?.kind === "new_menu" &&
  meta?.kind === "new_menu" &&
  meta.targetMode === "household" &&
  meta.idempotencyKey === pending.request.idempotencyKey;
// render helper once above/below conflicts list
```

- [ ] **Step 4: Verify + commit**

```bash
git commit -m "feat: 選択家族のみの安全補助文とpendingメタを追加する"
```

---

### Task 7: recentDishHints（ソフト多様性）

**Files:**
- Create: `netlify/functions/_shared/diversity-hints.ts`
- Create: `netlify/functions/_shared/diversity-hints.test.ts`
- Modify: `netlify/functions/_shared/generation-service.ts`（ExecutionBase or new_menu に `recentDishHints`）
- Modify: `netlify/functions/_shared/generation-prompt.ts` + `.test.ts`
- Modify: `createBaseGenerationDeps` の `loadExecutionContext` で hints load

**Interfaces:**
- Consumes: owner Supabase client, userId
- Produces: prompt payload `recentDishHints: [] | hints` on **new_menu only**

- [ ] **Step 1: Failing tests**

```ts
// diversity-hints.test.ts
it("returns [] on timeout without throwing", async () => {
  const slow = { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => neverResolve() }) }) }) }) };
  await expect(loadRecentDishHints({ ownerClient: slow, userId, timeoutMs: 10 })).resolves.toEqual([]);
});

it("flattens max 24 valid dish names newest menus first", async () => { /* mock rows */ });

// generation-prompt.test.ts
it("includes recentDishHints on new_menu and diversity paragraph before season when enabled", () => {
  const messages = buildGenerationMessages(newMenuCtxWithHints);
  expect(userPayload(messages).recentDishHints).toEqual([{ dishName: "肉じゃが", role: "main" }]);
  const system = systemText(messages);
  const diversityIdx = system.indexOf("recentDishHints");
  const seasonIdx = system.indexOf("seasonContext");
  // diversity system paragraph marker string before season block
  expect(diversityIdx).toBeLessThan(seasonIdx);
});

it("omits diversity and recentDishHints key on regenerate_menu", () => {
  const messages = buildGenerationMessages(regenCtx);
  expect(JSON.stringify(messages)).not.toContain("recentDishHints");
});
```

- [ ] **Step 2: RED**

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/diversity-hints.test.ts netlify/functions/_shared/generation-prompt.test.ts
```

- [ ] **Step 3: Implement**

`diversity-hints.ts`:

- `DIVERSITY_HINTS_ENABLED = true`
- `loadRecentDishHints`: if `enabled === false` return `[]` without querying
- `Promise.race` timeout → `[]`
- Query: `.from("menus").select("id, created_at, dishes(name, role, position)").eq("user_id", userId).order("created_at", { ascending: false }).limit(10)`
- Flatten: position asc, drop empty names, cap 24, role optional key only if non-empty
- never throw

`generation-service.ts` new_menu loadExecutionContext:

```ts
const generationContext = await loadGenerationContext(...);
const recentDishHints = await loadRecentDishHints({
  ownerClient: createUserScopedSupabase(user.accessToken),
  userId: user.userId,
});
return { kind: "new_menu", ..., generationContext, recentDishHints, regeneration: null };
```

Regenerate contexts: **do not** set recentDishHints (type only on new_menu branch).

`generation-prompt.ts`:

- Split `GENERATION_SYSTEM_PROMPT_CORE` into body + season OR compose at build time:
  `CORE_BODY + (new_menu && enabled ? DIVERSITY_PARAGRAPH : "") + SEASON + ideaExtra`
- DIVERSITY_PARAGRAPH 文意: 可能なら避ける / 多様性だけで constraint_conflict にしない / 安全より下位
- `buildBaseGenerationMessages`: accept optional `recentDishHints` only when building for new_menu from `buildGenerationMessages`
- new_menu user payload always includes `recentDishHints` array
- regenerate: no key

- [ ] **Step 4: Verify fingerprint 非混入**

Assert `createCurrentSafetyFingerprint` inputs unchanged (no hints field). Existing fingerprint tests still pass.

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/diversity-hints.test.ts netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-service.test.ts
docker compose run --rm --no-deps app npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 新規生成に最近料理のソフト多様性ヒントを載せる"
```

---

### Task 8: E2E / a11y 追随 + 受け入れゲート

**Files:**
- Modify: `e2e/specs/*` が audience 順・empty dialog・disabled Next に依存する箇所
- Modify: `src/app/accessibility.test.tsx` 必要箇所
- Run focused e2e if stack available

- [ ] **Step 1: Grep and update selectors**

```bash
# host
rg -n "家族に合わせて|alertdialog|メイン食材を選んでください|disabled.*次へ|targetMode" e2e src/app/accessibility.test.tsx
```

Update:

- radio order / household select helpers
- ingredient empty: alert/status text instead of alertdialog
- incomplete next: expect visible message

- [ ] **Step 2: Focused Vitest a11y + planner**

```bash
docker compose run --rm --no-deps app npm test -- --run src/app/accessibility.test.tsx src/features/planner/
```

- [ ] **Step 3: E2E（スタック up 時）**

```bash
./scripts/run-e2e.sh e2e/specs/<planner-or-audience-related>.ts
```

人間オペレータ実行でも可。失敗を修正。

- [ ] **Step 4: Plan 完了ゲート（focused → 可能なら §8）**

```bash
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git commit -m "test: 献立UX改善のE2Eとa11yを追随する"
```

---

## Spec coverage (self-review)

| 設計要件 | Task |
|----------|------|
| AppToast L7 / §6.3 | 1–2, 4 |
| meal/cuisine/ingredients incomplete | 2 |
| audience L9 + 選択サマリー + ヒント | 3 |
| 家族 validation toast §12.6 | 4 |
| 選択のみ安全 監査 + §12.3a | 5 |
| 補助文 + pending メタ §12.3b | 6 |
| 多様性 soft L1–L5 L12–L14 | 7 |
| E2E / a11y | 8 |
| 確認 CTA toast 追加しない | 対象外（触らない） |
| 再生成 hard 除外維持 | Task 7 で非変更をテスト |

## Placeholder scan

TBD / 「同様に」のみの手順なし。Locked interfaces と文言は固定。

## Type consistency

- `RecentDishHint` / `recentDishHints` は new_menu のみ。
- Helper copy 単一ソース `HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY`。
- pending meta `idempotencyKey` は `pending.request.idempotencyKey` と一致比較。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-30-ux-diversity-safety.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — executing-plans in this session with checkpoints  

Which approach?
