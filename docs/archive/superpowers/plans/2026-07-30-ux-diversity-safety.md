# 献立 UX・多様性ヒント・選択メンバー安全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ウィザード未入力のトースト UX、作る相手ページの並びと選択メンバー安全の誤認解消、家族フォームの validation toast、新規生成のソフト多様性ヒントを、生成不能を増やさずに届ける。

**Architecture:** ブラウザは薄い `AppToast` と step ローカル validation。安全条件は既存どおり `targetMemberIds` のみ。確認/conflict 補助文は pending メタ（localStorage・pending と同一 TTL）で `targetMode` を保持。多様性は Functions 内 fail-open loader + `buildGenerationMessages` の `new_menu` 合成のみ（検証・fingerprint 非介入）。

**Tech Stack:** React 19 / React Router 8 / TanStack Query 5 / TypeScript strict / Vitest / RTL / Playwright / Netlify Functions / Supabase JS / Zod

**仕様書:** `docs/archive/superpowers/specs/2026-07-30-ux-diversity-safety-design.md`  
**ブランチ / worktree:** `feat/ux-diversity-safety` / `.worktrees/ux-diversity-safety`  
**状態:** **Approved for implementation**（1次・2次・敵対的 + 再レビュー反映、0 残件想定）

## Global Constraints

- Node.js `>=24 <25`。Node/npm は `docker compose run --rm --no-deps app <cmd>`。コマンドを `&&` / `;` で連結しない。
- 各 Task: RED → GREEN → focused 検証（Vitest / typecheck / lint / format:check / `git diff --check`）→ レビュー（Critical/Important/**Minor ゼロ**）→ 日本語 Conventional Commit。
- UI 文言・コメント・コミットは日本語。識別子・テスト名は英語。`any` / 未検査 cast 禁止。
- 320 CSS px・44×44・横スクロールなし。新カラー体系禁止。
- 後方互換不要。`git push` / PR / 本番デプロイ / `--no-verify` 禁止。
- 設計 L1–L14 を再導出しない。多様性は生成成功より弱い。
- OpenRouter / service key をブラウザに出さない。hints はサーバーのみ。
- 生成・ログに名前・アレルギー・自由文・raw AI・hints 料理名を出さない。

## Locked interfaces produced by this plan

| 名前 | 場所 | 契約 |
|------|------|------|
| `HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY` | `src/features/planner/household-safety-helper-copy.ts` | `"献立には今回選んだ家族の条件だけが使われます。"` |
| `AppToastProvider` / `useAppToast` | `src/shared/ui/app-toast.tsx` | 下記。**validation 用途の `show` は planner 質問 step と household 追加・編集のみ** |
| `PendingGenerationMeta` | `src/features/generation/model/pending-generation-meta.ts` | 下記 |
| `clearPendingGeneration` | `pending-generation.ts` | **内部で必ず `clearPendingGenerationMeta` を呼ぶ** |
| `DIVERSITY_HINTS_ENABLED` / `DIVERSITY_SYSTEM_MARKER` | `netlify/functions/_shared/diversity-hints.ts` | flag default `true`；マーカー `"【多様性ヒント】"` |
| `loadRecentDishHints` | 同上 | fail-open・200ms・10 menus / 24 hints・never throw |
| `RecentDishHint` | 同上 | `{ dishName: string; role?: string }` |
| `GenerationExecutionContext` new_menu | `generation-service.ts` | `recentDishHints: readonly RecentDishHint[]` を **new_menu のみ** |

```ts
// app-toast.tsx
export type ShowAppToastInput = {
  message: string;
  tone: "error" | "info";
  durationMs?: number; // default 6000
};
export function AppToastProvider(props: { children: React.ReactNode }): React.JSX.Element;
export function useAppToast(): {
  show: (input: ShowAppToastInput) => void;
  dismiss: () => void;
};
// CSS: .app-toast { z-index: 20; pointer-events: auto; }  // hover pause 必須
```

```ts
// pending-generation-meta.ts
export type PendingGenerationMeta = {
  kind: "new_menu";
  targetMode: "household" | "idea";
  idempotencyKey: string;
  ownerUserId: string;
  createdAt: string; // ISO
};
export function savePendingGenerationMeta(meta: PendingGenerationMeta, storage?: Storage): void;
/** pending と突合。欠落・owner/TTL/key 不一致は null */
export function readPendingGenerationMeta(
  userId: string,
  now: Date,
  storage?: Storage,
): PendingGenerationMeta | null;
export function clearPendingGenerationMeta(storage?: Storage): void;
// key: "kondate:generation:v3:meta"
// TTL: PENDING_GENERATION_TTL_MS と同じ（pending-generation.ts から import）
```

```ts
// diversity-hints.ts
export const DIVERSITY_HINTS_ENABLED = true as const;
export const DIVERSITY_SYSTEM_MARKER = "【多様性ヒント】" as const;
export const RECENT_DISH_HINTS_TIMEOUT_MS = 200 as const;
export const RECENT_MENUS_LIMIT = 10 as const;
export const RECENT_DISH_HINTS_MAX = 24 as const;
export type RecentDishHint = { dishName: string; role?: string };
export function loadRecentDishHints(input: {
  ownerClient: unknown; // user-scoped Supabase
  userId: string;
  timeoutMs?: number;
}): Promise<readonly RecentDishHint[]>; // never throws
```

**Incomplete 文言ロック（toast = inline 同一）:**

| Step | 文言 |
|------|------|
| meal | `食事の時間帯を選んでください` |
| ingredients | `メイン食材を1つ以上選んでください`（`mainIngredientRequiredMessage` もこの文字列に更新） |
| cuisine | `ジャンルを選んでください` |
| audience mode | `作る相手の選び方を選んでください` |
| audience household 0 | `献立に合わせる家族を1人以上選んでください` |
| audience idea servings | `人数を選んでください` |

## File Structure

| ファイル | 責務 |
|----------|------|
| `src/shared/ui/app-toast.tsx` + `.test.tsx` | Provider / hook |
| `src/styles.css` | `.app-toast` z=20, pointer-events auto |
| `src/app/providers.tsx` | Provider マウント |
| `src/features/planner/components/meal-step.tsx` | incomplete UX |
| `src/features/planner/components/cuisine-step.tsx` | incomplete UX |
| `src/features/planner/components/ingredient-step.tsx` | dialog 廃止 + incomplete UX |
| `src/features/planner/components/audience-step.tsx` | 並び・サマリー・incomplete |
| `src/features/planner/components/planner-wizard.tsx` | `suppressValidationToast={autosaveState==="error"}` |
| `src/features/planner/components/review-step.tsx` | household 補助文 |
| `src/features/planner/household-safety-helper-copy.ts` | 固定文 |
| `src/features/household/*` | validation toast |
| `src/features/generation/model/pending-generation-meta.ts` | meta API |
| `src/features/generation/model/pending-generation.ts` | clear で meta も clear；regenerate save で meta clear |
| `src/features/planner/planner-route.tsx` | new_menu 時 **だけ** meta upsert（`draft.targetMode`） |
| `src/features/generation/components/generation-status-panel.tsx` | conflict 補助文 1 回 |
| `netlify/functions/_shared/diversity-hints.ts` | load + constants |
| `netlify/functions/_shared/generation-service.ts` | new_menu に hints |
| `netlify/functions/_shared/generation-prompt.ts` | CORE_BODY+DIVERSITY+SEASON |
| `netlify/functions/_shared/generation-quality-review-entry.ts` | recentDishHints: [] |
| `e2e/specs/*` | セレクタ追随 |

**共通 verify（各 Task Step 末尾で実行）:**

```bash
docker compose run --rm --no-deps app npm test -- --run <task-test-files>
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
git diff --check
```

---

### Task 1: AppToast 共通部品

**Files:** Create `src/shared/ui/app-toast.tsx`, `src/shared/ui/app-toast.test.tsx`; Modify `src/styles.css`, `src/app/providers.tsx`, `src/app/providers.test.tsx` if needed

**Interfaces:** Produces `AppToastProvider`, `useAppToast`

- [ ] **Step 1: Write failing tests**

```tsx
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppToastProvider, useAppToast } from "./app-toast";
import { vi } from "vitest";

function Probe({ msg }: { msg: string }) {
  const t = useAppToast();
  return (
    <>
      <button type="button" onClick={() => t.show({ message: msg, tone: "error" })}>
        show
      </button>
      <button type="button" onClick={() => t.show({ message: "二件目", tone: "error" })}>
        show2
      </button>
    </>
  );
}

it("shows status toast and replaces on second show", async () => {
  const user = userEvent.setup();
  render(
    <AppToastProvider>
      <Probe msg="食事の時間帯を選んでください" />
    </AppToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "show" }));
  expect(screen.getByRole("status")).toHaveTextContent("食事の時間帯を選んでください");
  expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  await user.click(screen.getByRole("button", { name: "show2" }));
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("二件目");
});

it("does not dismiss while hovered", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <AppToastProvider>
      <Probe msg="保持" />
    </AppToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "show" }));
  const toast = screen.getByRole("status");
  await user.hover(toast);
  await act(async () => {
    vi.advanceTimersByTime(7000);
  });
  expect(screen.getByRole("status")).toHaveTextContent("保持");
  await user.unhover(toast);
  await act(async () => {
    vi.advanceTimersByTime(7000);
  });
  expect(screen.queryByRole("status")).toBeNull();
  vi.useRealTimers();
});
```

- [ ] **Step 2: RED**

```bash
docker compose run --rm --no-deps app npm test -- --run src/shared/ui/app-toast.test.tsx
```

Expected: FAIL module not found

- [ ] **Step 3: Implement**

- Context + state; `show` 後勝ち; error/info とも **role=status aria-live=polite**
- default 6000ms; hover / focus-within でタイマー停止
- CSS: `.app-toast { z-index: 20; pointer-events: auto; ... }`（autosave 見た目トークン流用）
- `AppProviders` で wrap

- [ ] **Step 4: Verify**（共通 verify ブロック）

- [ ] **Step 5: Commit** `feat: 入力漏れ用の AppToast を追加する`

---

### Task 2: ウィザード meal / cuisine / ingredients incomplete UX

**Files:**  
- Modify: `meal-step.tsx`, `cuisine-step.tsx`, `ingredient-step.tsx`, `planner-wizard.tsx`  
- Modify: 対応 `*.test.tsx`, `planner-wizard.test.tsx`

**Interfaces:** Consumes `useAppToast`. Produces incomplete 押下可 + toast + alert + focus.  
**必須:** `suppressValidationToast` prop。wizard が `autosaveState === "error"` のとき true。

- [ ] **Step 1: Failing tests（3 step すべて全文）**

```tsx
// meal
it("meal incomplete next: toast+alert+focus, no onNext", async () => {
  const onNext = vi.fn();
  const user = userEvent.setup();
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
  expect(screen.getByRole("radiogroup").querySelector("input:not([disabled])")).toHaveFocus();
});

it("meal incomplete with suppressValidationToast: alert+focus only, no status toast", async () => {
  const user = userEvent.setup();
  render(
    <AppToastProvider>
      <MealStep value={null} onChange={vi.fn()} onNext={vi.fn()} suppressValidationToast />
    </AppToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "次へ" }));
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.queryByRole("status")).toBeNull();
});

it("cuisine incomplete next: toast+alert+focus", async () => {
  const onNext = vi.fn();
  const user = userEvent.setup();
  render(
    <AppToastProvider>
      <CuisineStep value={null} onChange={vi.fn()} onNext={onNext} />
    </AppToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "次へ" }));
  expect(onNext).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("ジャンルを選んでください");
  expect(screen.getByRole("status")).toHaveTextContent("ジャンルを選んでください");
  expect(screen.getByRole("radiogroup").querySelector("input:not([disabled])")).toHaveFocus();
});

it("ingredients incomplete: no alertdialog; toast+alert with locked copy", async () => {
  const user = userEvent.setup();
  render(
    <AppToastProvider>
      <IngredientStep value={[]} onChange={vi.fn()} onNext={vi.fn()} />
    </AppToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "次へ" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent("メイン食材を1つ以上選んでください");
  expect(screen.getByRole("status")).toHaveTextContent("メイン食材を1つ以上選んでください");
  // focus はメイン食材 text input（チップ button ではない）
  expect(screen.getByRole("textbox")).toHaveFocus();
});
```

- [ ] **Step 2: RED**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/components/meal-step.test.tsx src/features/planner/components/cuisine-step.test.tsx src/features/planner/components/ingredient-step.test.tsx src/features/planner/components/planner-wizard.test.tsx
```

（テストファイル名が違う場合は実在パスに合わせる）

- [ ] **Step 3: Implement**

1. incomplete でも `disabled={disabled}` のみ  
2. errorMessage state; Next incomplete → set + toast（`!suppressValidationToast`）+ focusFirstEnabled  
3. complete → dismiss toast, clear error, onNext  
4. `mainIngredientRequiredMessage = "メイン食材を1つ以上選んでください"`  
5. ingredient empty alertdialog **削除**  
6. `planner-wizard.tsx`: 各 step に `suppressValidationToast={autosaveState === "error"}`  
7. **focus は設計 §6.3 行ごと**（汎用 querySelector 一行は禁止）:
   - meal / cuisine: 当該 `radiogroup` 内の先頭 `input:not([disabled])`
   - ingredients: **メイン食材の text `input` を優先**（無ければ先頭の未選択チップ button）
8. **ライフサイクル（必須）:**
   - value が complete になったら inline error を clear
   - unmount / step 離脱で `toast.dismiss()` + inline clear
9. wizard: `suppressValidationToast={autosaveState === "error"}`

- [ ] **Step 4: Verify** + **Step 5: Commit** `feat: プランナー質問stepの未入力トーストを追加する`

---

### Task 3: audience 並び・選択サマリー・incomplete

**Files:** `audience-step.tsx` + tests; `planner-wizard.tsx`（suppress 伝播）; a11y tests

**文言（ロック）:**  
常時ヒント / household0 toast = `献立に合わせる家族を1人以上選んでください`  
mode 未選択 = `作る相手の選び方を選んでください`  
servings null = `人数を選んでください`  
一覧注記 = `一覧の表示は選ぶときの参考です。チェックしていない人の条件は献立に入りません。`  
選択0本文 = `家族を選ぶと、その人の条件がここに表示されます。`  
選択1+注記 = `ここに出ている条件だけが献立に使われます。選んでいない家族は含まれません。`

- [ ] **Step 1: Tests**

```tsx
it("orders idea radio before household", () => {
  render(<AudienceStep ... household with members />);
  const radios = screen.getAllByRole("radio");
  expect(radios[0]).toHaveAccessibleName(/人数だけ/);
  expect(radios[1]).toHaveAccessibleName(/家族に合わせて/);
});

it("summary lists only selected members under checkboxes", () => { /* A selected B not in summary section */ });

it("household zero selection shows empty fixed body", () => {
  // targetMode household, targetMemberIds []
  expect(screen.getByText("家族を選ぶと、その人の条件がここに表示されます。")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /家族設定を変更/ })).toBeInTheDocument();
});

it("household zero next: toast+alert+focus members group", async () => {
  const user = userEvent.setup();
  const onNext = vi.fn();
  render(
    <AppToastProvider>
      <AudienceStep
        value={{ targetMode: "household", targetMemberIds: [], servings: null }}
        eligibleMembers={[memberA]}
        onChange={vi.fn()}
        onNext={onNext}
      />
    </AppToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "次へ" }));
  expect(onNext).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("献立に合わせる家族を1人以上選んでください");
  expect(screen.getByRole("status")).toHaveTextContent("献立に合わせる家族を1人以上選んでください");
  // focus はメンバー checkbox 群（mode radio ではない）
  expect(screen.getByRole("checkbox")).toHaveFocus();
});

it("mode null next focuses mode radiogroup", async () => {
  const user = userEvent.setup();
  render(
    <AppToastProvider>
      <AudienceStep
        value={{ targetMode: null, targetMemberIds: [], servings: null }}
        eligibleMembers={[memberA]}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />
    </AppToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "次へ" }));
  expect(screen.getByRole("alert")).toHaveTextContent("作る相手の選び方を選んでください");
  expect(screen.getAllByRole("radio")[0]).toHaveFocus();
});

it("idea servings null next focuses person chips", async () => {
  const user = userEvent.setup();
  render(
    <AppToastProvider>
      <AudienceStep
        value={{ targetMode: "idea", targetMemberIds: [], servings: null }}
        eligibleMembers={[]}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />
    </AppToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "次へ" }));
  expect(screen.getByRole("alert")).toHaveTextContent("人数を選んでください");
  expect(screen.getByRole("button", { name: "1人" })).toHaveFocus();
});
```

- [ ] **Step 2: RED** → **Step 3: Implement**

1. ラジオ順 idea → household  
2. ラジオ上サマリー削除  
3. household: ヒント → checks → selected filter のサマリー  
4. selected.length===0: 独自 empty section（見出し+固定文+リンク+免責）または CurrentSafetySummary を empty でもマウントし **audience-step 側**で固定文を出す（共有コンポーネントに補助文を埋め込まない）  
5. incomplete Next = Task 2 パターン + suppressValidationToast  
6. `isComplete` を disabled に使わない  
7. focus: mode 未選択 → mode radiogroup; household 0 → **members チェック群**; idea servings null → chips（7+ は select）  
8. complete 時 inline clear; unmount で toast dismiss（Task 2 ライフサイクルと同じ）  

- [ ] **Step 4–5: Verify + Commit** `feat: 作る相手stepの並びと選択安全表示を直す`

---

### Task 4: 家族 validation toast

**Files:** `household-onboarding-page.tsx`, `household-settings-page.tsx`, tests

- [ ] **Step 1: Test**

```tsx
it("shows toast field error and focuses first invalid on incomplete save", async () => {
  // empty required fields → click 保存/完了
  expect(screen.getByRole("status")).toHaveTextContent(/選んでください|確認してください|入力内容/);
  // form-level: 先頭 role=alert は1つ（または先頭 field error のみ alert）
  expect(document.activeElement).toBeTruthy(); // first invalid
});
```

- [ ] **Step 2: RED** → **Step 3:** safeParse → fieldErrors + toast(先頭 message) + focus; 成功時 dismiss; フィールドが valid になったら form alert clear; ルート離脱で toast dismiss; ネット失敗は既存 alert のみ  
- [ ] **Step 4–5: Verify + Commit** `feat: 家族設定の必須漏れにトーストを出す`

---

### Task 5: 選択メンバー安全監査 + §12.3a

**Files:** generation-context/prompt/fingerprint tests; audit note in Task report

- [ ] **Step 1: Strong regression**

```ts
it("§12.3a A-only excludes allergic B from context prompt preflight fingerprint", async () => {
  // A none, B allergen
  const ctx = await loadGenerationContext(..., targetMemberIds: [A]);
  expect(ctx.safety.members.map((m) => m.householdMemberId)).toEqual([A]);
  expect(ctx.submission.targetMemberIds).toEqual([A]);
  const payload = userPayload(buildGenerationMessages(newMenuExec(ctx, [])));
  expect(payload.members).toHaveLength(1);
  expect(JSON.stringify(payload)).not.toContain(B);
  const preflight = validateGenerationPreflight(ctx, now);
  expect(preflight.ok).toBe(true);
  const fpA = createCurrentSafetyFingerprint(ctx.safety);
  const fpAB = createCurrentSafetyFingerprint(safetyWithBoth);
  expect(fpA).not.toBe(fpAB);
});
```

Audit checklist 1–6: record pass/fail with file:line. Fail → minimal code fix.

- [ ] **Step 2–5: RED/GREEN/Verify/Commit** `test: 選択メンバーのみの安全経路を回帰固定する`

---

### Task 6: household 補助文 + pending メタ

**Files:**  
`household-safety-helper-copy.ts`, `pending-generation-meta.ts` + test,  
`pending-generation.ts`（**clear で meta clear**; regenerate 系 save で meta clear）,  
`planner-route.tsx`（new_menu のみ **upsert meta with draft.targetMode**）,  
`review-step.tsx`, `generation-status-panel.tsx` + tests

**Meta write rule:**  
- Upsert **only** in planner-route after createPending/savePending for new_menu:  

```ts
savePendingGeneration(pending);
// submit 直前は plannerSubmissionSchema 通過後、または明示 narrow:
const mode = draft.targetMode;
if (mode !== "household" && mode !== "idea") {
  // 生成開始不可の既存経路へ（meta を書かない）
  throw new Error("target_mode_required");
}
savePendingGenerationMeta({
  kind: "new_menu",
  targetMode: mode,
  idempotencyKey: pending.request.idempotencyKey,
  ownerUserId: userId,
  createdAt: pending.createdAt,
});
```

- `clearPendingGeneration` **must** call `clearPendingGenerationMeta`  
- `savePendingGeneration` when kind !== new_menu → clear meta  
- **Do not** upsert meta inside savePending without targetMode arg  

- [ ] **Step 1: Tests**

```ts
it("clearPendingGeneration clears meta", () => { /* ... */ });
it("readPendingGenerationMeta returns null when pending missing or key mismatch", () => { /* ... */ });
// Status panel:
it("same-session new_menu household conflict shows helper once", () => { /* ... */ });
it("reload: rehydrate pending+meta shows helper once", () => {
  // write storage, remount panel, constraint_conflict
});
it("after regenerate pending helper is absent", () => { /* ... */ });
// review:
it("household review shows helper even when zero selected members", () => {
  // targetMode household, targetMemberIds []
  expect(screen.getByText(HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY)).toBeInTheDocument();
});
it("idea review does not show helper", () => { /* ... */ });
```

- [ ] **Step 3: review-step**

```tsx
{value.targetMode === "household" && (
  <>
    {targetSafetyMembers.length > 0 ? (
      <CurrentSafetySummary members={targetSafetyMembers} />
    ) : null}
    <p>{HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY}</p>
  </>
)}
```

Panel algorithm: design 擬似コードどおり `readPendingGeneration` + `readPendingGenerationMeta(userId, now)`.

- [ ] **Step 4–5: Verify + Commit** `feat: 選択家族のみの安全補助文とpendingメタを追加する`

---

### Task 7: recentDishHints soft diversity

**Files:**  
`diversity-hints.ts` + test,  
`generation-service.ts`（loadExecutionContext new_menu）,  
`generation-prompt.ts` + test,  
`generation-quality-review-entry.ts`（`recentDishHints: []`）,  
`generation-service.test.ts` / `paid-openrouter-benchmark-harness.ts` 等の new_menu execution 組み立て,  
helpers in `generation-prompt.test.ts` / adversarial

**Rules:**  
- `buildBaseGenerationMessages` **変更しない**（hints 引数なし）  
- `buildGenerationMessages` のみ diversity 合成 + user JSON に `recentDishHints`  
- never throw on hints  
- call site: `DIVERSITY_HINTS_ENABLED ? loadRecentDishHints(...) : []`  
- parallel: `Promise.all([loadGenerationContext, hintsPromise])` OK  
- select: `dishes(id, name, role, position)`; sort position then id  
- DIVERSITY_PARAGRAPH starts with `DIVERSITY_SYSTEM_MARKER`

- [ ] **Step 1: Tests**

```ts
it("timeout returns [] without throw", async () => { /* ... */ });
it("flattens max 24; same position sorts by id", async () => { /* ... */ });
it("L13 off: loadRecentDishHints not called; payload []; no DIVERSITY_SYSTEM_MARKER", async () => { /* mock flag or inject enabled */ });
it("new_menu includes recentDishHints and marker before season", () => {
  const system = systemText(messages);
  expect(system.indexOf(DIVERSITY_SYSTEM_MARKER)).toBeLessThan(system.indexOf("seasonContext") >= 0 ? system.indexOf("旬") : system.length);
  expect(userPayload(messages).recentDishHints).toEqual([...]);
});
it("regenerate has no recentDishHints key and no marker", () => { /* ... */ });
it("§12.5 validateGeneratedMenu still ok with similar dish names when hints present", () => {
  // existing validate success fixture + non-empty hints on execution only — validate ignores hints
});
it("fingerprint unchanged by recentDishHints on execution", () => { /* safety-only fingerprint */ });
```

- [ ] **Step 3: loadExecutionContext**

```ts
const ownerClient = createUserScopedSupabase(user.accessToken);
const hintsPromise = DIVERSITY_HINTS_ENABLED
  ? loadRecentDishHints({ ownerClient, userId: user.userId })
  : Promise.resolve([]);
const [generationContext, recentDishHints] = await Promise.all([
  loadGenerationContext(user, requestId, command.request),
  hintsPromise,
]);
return { kind: "new_menu", generationContext, recentDishHints, regeneration: null, ... };
```

- [ ] **Step 4–5: Verify + Commit** `feat: 新規生成に最近料理のソフト多様性ヒントを載せる`

---

### Task 8: E2E / a11y 追随

**Files:** e2e specs depending on audience order / alertdialog / disabled Next; `accessibility.test.tsx`

- [ ] **Step 1:** `rg` for old selectors; update to toast/alert/idea-first  
- [ ] **Step 2:** Vitest a11y + planner  
- [ ] **Step 3:** focused e2e if stack up  
- [ ] **Step 4:** format/lint/typecheck/vitest  
- [ ] **Step 5:** Commit `test: 献立UX改善のE2Eとa11yを追随する`

---

## Spec coverage

| 設計 | Task |
|------|------|
| AppToast + hover pause + z-index | 1 |
| meal/cuisine/ingredients incomplete + autosave suppress | 2 |
| audience L9 + empty summary + incomplete | 3 |
| 家族 toast §12.6 | 4 |
| §12.3a + audit 1–6 | 5 |
| §12.3b helper + meta reload/regen | 6 |
| L1–L5 L12–L14 diversity + L13 off + §12.5 | 7 |
| E2E/a11y | 8 |
| 確認 CTA validation toast 追加しない | 非対象（触らない） |

## Review fix log（本版で閉じた指摘）

- pointer-events auto + hover test  
- ingredients 文言単一ロック  
- clearPendingGeneration が meta clear の choke point  
- meta に ownerUserId/createdAt + read(userId,now)  
- meta upsert は planner-route のみ（draft.targetMode）  
- review helper は household 常時（0 選択でも）  
- audience empty 固定文の実装先  
- buildBase 非改変 / buildGenerationMessages のみ  
- dish id ソート・L13 call-site・§12.5 テスト  
- autosave suppress 必須 + tests  
- プレースホルダ「同様に」除去・verify サイクル統一  
- DIVERSITY_SYSTEM_MARKER  
- generation-quality-review-entry 更新  

## Execution Handoff

Plan complete at `docs/archive/superpowers/plans/2026-07-30-ux-diversity-safety.md`.

**1. Subagent-Driven (recommended)** · **2. Inline Execution**

Which approach?
