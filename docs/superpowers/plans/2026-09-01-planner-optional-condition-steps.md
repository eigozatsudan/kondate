# 追加条件を1問1ページのウィザードstepへ移す 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 確認画面にある選択式の追加条件4つ（調理時間・予算・材料の使い方・献立の雰囲気）を、1問1ページのウィザード step へ移し、選択した瞬間に次のページへ自動遷移させる。

**Architecture:** `plannerSteps` に `timeLimit` / `budget` / `ingredientPreference` / `novelty` を audience と review の間へ挿入し、4ページは新規 `OptionalChoiceStep` の設定違いとして描画する。値の更新は radio の `onChange`、遷移は `<label>` の `onPointerUp` と radio の Space `onKeyUp` で受け、活性化単位の mutex と mount 後 350ms のガードで二重発火と自動遷移直後の誤タップを防ぐ。確認画面からは4つのカード UI を削除し、サマリ行＋「変更」ボタンに置き換える。

**Tech Stack:** React 19.2.7+ / TypeScript strict / Vite 8 / Tailwind CSS 4 / React Router 8 Data Mode / TanStack Query 5 / Vitest + Testing Library / Playwright

**Spec:** `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md`
（第4デルタで APPROVE 済み。レビューは `docs/superpowers/reviews/2026-09-01-planner-optional-condition-steps-*.md`）
計画レビュー（`34f5e2d3`）の Important 9 系統は本文へ埋め込み済み。

## Global Constraints

- Node.js `>=24 <25` のみ。ESM。TypeScript `strict: true`。`any` と境界での無検査キャスト禁止。
- 利用者向け文言はすべて日本語。コメントとコミットメッセージも日本語。識別子とテスト名は英語。
- モバイル最優先。320 CSS px で横スクロールを起こさない。タッチ対象は 44×44 CSS px 以上。
- 所有境界を跨がない。`src/features` はブラウザ専用。ブラウザからの safety 系 import は `@shared/safety-pure/*` のみ（`@shared/safety/*` 禁止）。
- `shared/contracts`、送信ペイロード、生成 Function 側は**一切変更しない**。
- 生成ファイルの手編集禁止（`package-lock.json`、`infra/supabase/**`、`src/shared/types/database.generated.ts`）。
- `git push` / PR 作成 / デプロイ禁止。`--no-verify` 禁止。
- Node コマンドは Docker 経由で実行する。
  - `docker compose run --rm --no-deps app npm test -- --run <files>`
  - `docker compose run --rm --no-deps app npm run typecheck`
  - `docker compose run --rm --no-deps app npm run lint`
  - `docker compose run --rm --no-deps app npm run format:check`（`format` ではなく `format:check`）
  - E2E は `./scripts/run-e2e.sh` をホストで直接。`app` コンテナ内から `npm run e2e` は動かない。
- `firstIncompletePlannerStep` は変更しない（`?resume=review` 深リンク契約 4b の前提）。
- `noveltyPreference` を `PlannerFieldName` に足さない。
- `Number(selected)` 禁止（`Number("") === 0` が `plannerDraftSchema` を落とす）。`""` は必ず親側で `null` へ畳む。
- 自動遷移は新しい追加条件4ページだけ。食事・メイン食材・ジャンル・対象の操作方法は変えない。

---

### Task 1: step モデルへ4つの任意 step を挿入する

**Files:**
- Modify: `src/features/planner/model/planner-wizard.ts`
- Test: `src/features/planner/model/planner-wizard.test.ts`

**Interfaces:**
- Consumes: なし（先頭タスク）
- Produces:
  - `plannerSteps: readonly ["meal","ingredients","cuisine","audience","timeLimit","budget","ingredientPreference","novelty","review"]`
  - `PlannerStep = (typeof plannerSteps)[number]` — 以降のタスクはこの union に `"timeLimit" | "budget" | "ingredientPreference" | "novelty"` が含まれることに依存する
  - `buildPlannerSubmissionFieldErrors(...).firstInvalidStep` が `timeLimitMinutes` → `"timeLimit"`、`budgetPreference` → `"budget"`、`ingredientPreference` → `"ingredientPreference"` を返す

- [ ] **Step 1: 失敗するテストを書く**

`src/features/planner/model/planner-wizard.test.ts` の末尾に追記する。既存 import（`:3–9`）には `plannerSteps` も `buildPlannerSubmissionFieldErrors` も無いので、**両方**を import 文へ足す（P-T1-IMPORT）。

```ts
test("inserts the four optional condition steps between audience and review", () => {
  expect([...plannerSteps]).toEqual([
    "meal",
    "ingredients",
    "cuisine",
    "audience",
    "timeLimit",
    "budget",
    "ingredientPreference",
    "novelty",
    "review",
  ]);
});

test("routes optional condition submission errors to their own step", () => {
  const timeLimit = buildPlannerSubmissionFieldErrors([
    { path: ["timeLimitMinutes"], message: "調理時間が不正です" },
  ]);
  expect(timeLimit.firstInvalidStep).toBe("timeLimit");

  const budget = buildPlannerSubmissionFieldErrors([
    { path: ["budgetPreference"], message: "予算が不正です" },
  ]);
  expect(budget.firstInvalidStep).toBe("budget");

  const ingredient = buildPlannerSubmissionFieldErrors([
    { path: ["ingredientPreference"], message: "材料の使い方が不正です" },
  ]);
  expect(ingredient.firstInvalidStep).toBe("ingredientPreference");
});

test("keeps avoid / memo / pantry errors on the review step", () => {
  const result = buildPlannerSubmissionFieldErrors([
    { path: ["avoidIngredients", 0], message: "避ける食材が不正です" },
  ]);
  expect(result.firstInvalidStep).toBe("review");
});
```

- [ ] **Step 2: テストを実行して落ちることを確認する**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/model/planner-wizard.test.ts
```

期待: 新規3テストが FAIL（`plannerSteps` の配列不一致、`firstInvalidStep` が `"review"`）。

- [ ] **Step 3: 最小の実装を書く**

`src/features/planner/model/planner-wizard.ts` の `plannerSteps` を差し替える。

```ts
/**
 * ウィザードのstep順序。質問順（meal→ingredients→cuisine→audience）のあとに
 * 任意の追加条件4問（timeLimit→budget→ingredientPreference→novelty）を挟み、
 * reviewを続けた固定配列。UI・resume判定・focus順の唯一の正とする。
 */
export const plannerSteps = [
  "meal",
  "ingredients",
  "cuisine",
  "audience",
  "timeLimit",
  "budget",
  "ingredientPreference",
  "novelty",
  "review",
] as const;
```

同ファイルの `stepByField` の3行だけを付け替える（avoid / memo / pantry は `review` のまま）。

```ts
  timeLimitMinutes: "timeLimit",
  budgetPreference: "budget",
  ingredientPreference: "ingredientPreference",
```

`firstIncompletePlannerStep` は**変更しない**。追加条件は任意なので未完了にならず、必須4問が揃えば従来どおり `review` を返す。

- [ ] **Step 4: テストを実行して通ることを確認する**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/model/planner-wizard.test.ts
```

期待: PASS。

- [ ] **Step 5: コミットする**

```bash
docker compose run --rm --no-deps app npm run format:check
git add src/features/planner/model/planner-wizard.ts src/features/planner/model/planner-wizard.test.ts
git commit -m "feat(planner): 追加条件4問をウィザードのstep順序へ挿入する"
```

---

### Task 2: `OptionalChoiceStep` を新設する

**Files:**
- Create: `src/features/planner/components/optional-choice-step.tsx`
- Test: `src/features/planner/components/optional-choice-step.test.tsx`

**Interfaces:**
- Consumes: Task 1 の `PlannerStep`（型としては使わないが、呼び出し側が `key={step}` に使う）
- Produces:
  ```ts
  export type OptionalChoiceOption = { readonly value: string; readonly label: string };
  export type OptionalChoiceStepProps = {
    id: string;
    title: string;
    options: readonly OptionalChoiceOption[];
    value: string;
    onSelect: (selected: string) => void;
    onNext: () => void;
    onBack: () => void;
    disabled?: boolean;
    errorMessage?: string | null;
    description?: string;
    onSkipRest?: () => void;
    backLabel?: string;
  };
  export function OptionalChoiceStep(props: OptionalChoiceStepProps): JSX.Element;
  ```
  Task 3 はこの props 名をそのまま使う。`nextLabel` は**存在しない**（「次へ」を持たないため）。

- [ ] **Step 1: 失敗するテストを書く**

`src/features/planner/components/optional-choice-step.test.tsx` を新規作成する。

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi, afterEach } from "vitest";
import { OptionalChoiceStep } from "./optional-choice-step";

const options = [
  { value: "", label: "指定なし" },
  { value: "15", label: "15分以内" },
  { value: "30", label: "30分以内" },
] as const;

type Handlers = {
  onSelect: ReturnType<typeof vi.fn>;
  onNext: ReturnType<typeof vi.fn>;
  onBack: ReturnType<typeof vi.fn>;
};

function setup(overrides: Partial<Parameters<typeof OptionalChoiceStep>[0]> = {}): Handlers {
  const handlers: Handlers = { onSelect: vi.fn(), onNext: vi.fn(), onBack: vi.fn() };
  render(
    <OptionalChoiceStep
      id="planner-time-limit"
      title="5. 調理時間"
      options={options}
      value=""
      onSelect={handlers.onSelect}
      onNext={handlers.onNext}
      onBack={handlers.onBack}
      {...overrides}
    />,
  );
  return handlers;
}

/** 実機と同じ経路（label の pointerup）を通すため、input ではなく .wizard-option を叩く。 */
function optionLabel(name: string): HTMLElement {
  const input = screen.getByRole("radio", { name });
  const label = input.closest("label.wizard-option");
  if (label === null) throw new Error(`.wizard-option が見つからない: ${name}`);
  return label as HTMLElement;
}

/** mount 後 350ms のガード（設計 P-03）を抜けるまで進める。 */
async function passActivationGuard(): Promise<void> {
  vi.setSystemTime(Date.now() + 400);
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

test("selects 指定なし by default", () => {
  setup();
  expect(screen.getByRole("radio", { name: "指定なし" })).toBeChecked();
});

test("does not render a 次へ button", () => {
  setup();
  expect(screen.queryByRole("button", { name: "次へ" })).not.toBeInTheDocument();
});

test("advances once when tapping an unselected card", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup();
  await passActivationGuard();
  await user.click(optionLabel("15分以内"));
  expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  expect(handlers.onSelect).toHaveBeenCalledWith("15");
  expect(handlers.onNext).toHaveBeenCalledTimes(1);
});

test("advances once when re-tapping the already selected 指定なし", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup();
  await passActivationGuard();
  await user.click(optionLabel("指定なし"));
  expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  expect(handlers.onSelect).toHaveBeenCalledWith("");
  expect(handlers.onNext).toHaveBeenCalledTimes(1);
});

test("advances once when re-tapping an already selected non-default card", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup({ value: "30" });
  await passActivationGuard();
  await user.click(optionLabel("30分以内"));
  expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  expect(handlers.onNext).toHaveBeenCalledTimes(1);
});

test("advances once when pressing Space on a focused radio", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup();
  await passActivationGuard();
  screen.getByRole("radio", { name: "15分以内" }).focus();
  await user.keyboard(" ");
  expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  expect(handlers.onSelect).toHaveBeenCalledWith("15");
  expect(handlers.onNext).toHaveBeenCalledTimes(1);
});

test("updates the value without advancing on an arrow-key change", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup();
  await passActivationGuard();
  screen.getByRole("radio", { name: "指定なし" }).focus();
  await user.keyboard("{ArrowDown}");
  expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  expect(handlers.onNext).not.toHaveBeenCalled();
});

test("ignores the first activation inside the 350ms guard", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup();
  await user.click(optionLabel("15分以内"));
  expect(handlers.onSelect).not.toHaveBeenCalled();
  expect(handlers.onNext).not.toHaveBeenCalled();
});

test("ignores a change inside the 350ms guard", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup();
  screen.getByRole("radio", { name: "指定なし" }).focus();
  await user.keyboard("{ArrowDown}");
  expect(handlers.onSelect).not.toHaveBeenCalled();
});

test("stays usable after an activation was blocked by the guard", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup();
  await user.click(optionLabel("15分以内"));
  expect(handlers.onNext).not.toHaveBeenCalled();
  await passActivationGuard();
  await user.click(optionLabel("30分以内"));
  expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  expect(handlers.onSelect).toHaveBeenCalledWith("30");
  expect(handlers.onNext).toHaveBeenCalledTimes(1);
});

test("hides the skip button unless onSkipRest is given", async () => {
  setup();
  expect(
    screen.queryByRole("button", { name: "以降は指定なしでスキップ" }),
  ).not.toBeInTheDocument();
});

test("shows the skip button when onSkipRest is given", async () => {
  const onSkipRest = vi.fn();
  setup({ onSkipRest });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "以降は指定なしでスキップ" }));
  expect(onSkipRest).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: テストを実行して落ちることを確認する**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/components/optional-choice-step.test.tsx
```

期待: FAIL（`./optional-choice-step` が解決できない）。

- [ ] **Step 3: 最小の実装を書く**

`src/features/planner/components/optional-choice-step.tsx` を新規作成する。

```tsx
import { useEffect, useRef } from "react";
import { Button } from "@/shared/ui/button";
import { Inset, Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";

/**
 * 自動遷移直後の誤タップを弾く猶予（設計 P-03）。
 * 4ページとも .wizard-option が同じ座標に並ぶため、~300ms 後の2発目が
 * 次ページの同位置カードへ落ちる。mount からこの間の活性化と change は無視する。
 */
const activationGuardMs = 350;

export type OptionalChoiceOption = {
  readonly value: string;
  readonly label: string;
};

export type OptionalChoiceStepProps = {
  /** radio の name と各種 id の接頭辞 */
  id: string;
  /** 「5. 調理時間」など。radiogroup の名前はこの heading 側に持たせる */
  title: string;
  /** 先頭は必ず「指定なし」（value: ""） */
  options: readonly OptionalChoiceOption[];
  /** 現在値。null は "" として渡す */
  value: string;
  onSelect: (selected: string) => void;
  onNext: () => void;
  onBack: () => void;
  disabled?: boolean;
  errorMessage?: string | null;
  description?: string;
  /** 渡されたときだけ「以降は指定なしでスキップ」を出す */
  onSkipRest?: () => void;
  backLabel?: string;
};

/**
 * 任意の追加条件を1問1ページで選ばせる step。選んだ瞬間に次のページへ進むため
 * 「次へ」は持たない。
 *
 * 遷移の受け口を cuisine-step と変えているのは意図的（設計 P-02 / D-03）。
 * native radio の onChange を遷移トリガにすると、既定で checked の「指定なし」を
 * 再タップしても change が出ずページから出られず、矢印キーの change でページが飛ぶ。
 * そこで値の更新（onChange）と活性化（label の pointerup / radio の Space keyup）を
 * 分け、活性化単位の mutex で同一ジェスチャの後続イベントを吸収する。
 *
 * mountedAt / activating は instance ローカルなので、呼び出し側は key={step} を渡すこと。
 * 4ページは同一 component type で <main> の形も同じため、key が無いと React が
 * instance を再利用し、mutex が立ったまま次ページへ持ち越される。
 */
export function OptionalChoiceStep({
  id,
  title,
  options,
  value,
  onSelect,
  onNext,
  onBack,
  disabled = false,
  errorMessage = null,
  description,
  onSkipRest,
  backLabel = "戻る",
}: OptionalChoiceStepProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mountedAt = useRef(Date.now());
  // 活性化 mutex（instance ごと）。同一ジェスチャの後続 click / change を落とす。
  const activating = useRef(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const titleId = `${id}-title`;
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;

  /**
   * 350ms ガードと disabled は mutex より先に見る。ここで弾いたときは mutex を立てない。
   * 逆順にすると弾かれた操作が mutex を立て、「戻る」しか無い 6〜8 ページ目から出られなくなる。
   */
  const blocked = (): boolean => disabled || Date.now() - mountedAt.current < activationGuardMs;

  const activate = (optionValue: string): void => {
    if (blocked() || activating.current) return;
    activating.current = true;
    onSelect(optionValue);
    onNext();
  };

  /** 値だけの更新（矢印キー・プログラム的変更）。mutex は立てない。 */
  const handleChange = (optionValue: string): void => {
    if (blocked() || activating.current) return;
    onSelect(optionValue);
  };

  const describedBy =
    errorMessage != null ? errorId : description !== undefined ? descriptionId : undefined;

  return (
    <section aria-labelledby={titleId}>
      <Surface>
        <Inset pad={5}>
          <Stack gap={5}>
            <h2 id={titleId} tabIndex={-1} ref={headingRef}>
              {title}
            </h2>
            <div
              className="wizard-option-list"
              role="radiogroup"
              aria-labelledby={titleId}
              aria-describedby={describedBy}
            >
              {options.map((option) => (
                <label
                  key={option.value}
                  className="wizard-option"
                  onPointerUp={(event) => {
                    // キーボードは pointer event を出さないので矢印キーはここに来ない。
                    // WebKit の label 転送 click は detail が 0 固定なので detail は見ない。
                    if (event.button === 0 && event.isPrimary) {
                      activate(option.value);
                    }
                  }}
                >
                  <input
                    type="radio"
                    name={id}
                    disabled={disabled}
                    checked={value === option.value}
                    aria-invalid={errorMessage != null ? "true" : undefined}
                    onChange={() => {
                      handleChange(option.value);
                    }}
                    onKeyUp={(event) => {
                      if (event.key === " ") {
                        activate(option.value);
                      }
                    }}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            {description !== undefined && (
              <p id={descriptionId} className="type-small">
                {description}
              </p>
            )}
            {errorMessage != null && (
              <p id={errorId} role="alert">
                {errorMessage}
              </p>
            )}
            <div className="wizard-actions">
              <Button variant="secondary" disabled={disabled} onClick={onBack}>
                {backLabel}
              </Button>
              {onSkipRest !== undefined && (
                <Button variant="secondary" disabled={disabled} onClick={onSkipRest}>
                  以降は指定なしでスキップ
                </Button>
              )}
            </div>
          </Stack>
        </Inset>
      </Surface>
    </section>
  );
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/components/optional-choice-step.test.tsx
docker compose run --rm --no-deps app npm run typecheck
```

期待: どちらも PASS。もし jsdom の `pointerup` が userEvent から出ていない兆候（活性化テストだけが 0 回）なら、`userEvent.setup({ pointerEventsCheck: 0 })` ではなく **テスト側の期待を変えずに**、jsdom が `PointerEvent` を持つかを確認する（`vitest.setup.ts` の polyfill 有無）。実装の受け口（`onPointerUp`）は設計ロックなので変更しない。

- [ ] **Step 5: コミットする**

```bash
docker compose run --rm --no-deps app npm run format:check
git add src/features/planner/components/optional-choice-step.tsx src/features/planner/components/optional-choice-step.test.tsx
git commit -m "feat(planner): 選択で自動遷移する任意条件stepを追加する"
```

---

### Task 3: ウィザードへ4ページを配線する（P-01 / P-05 / スキップ）

**Files:**
- Modify: `src/features/planner/components/planner-wizard.tsx`
- Modify: `src/features/planner/components/review-step.tsx:444`（見出しのみ `5. 確認` → `9. 確認`）
- Modify: `src/features/planner/planner-route-conflict.test.tsx:289,308`
- Modify: `src/app/accessibility.test.tsx:487`
- Test: `src/features/planner/components/planner-wizard.test.tsx`

**Interfaces:**
- Consumes: Task 1 の `plannerSteps` / `PlannerStep`、Task 2 の `OptionalChoiceStep` と `OptionalChoiceStepProps`
- Produces: audience の「次へ」で `5. 調理時間`、4ページを選び切ると `9. 確認`。5ページ目のスキップで4フィールドが `null` のまま `9. 確認`。Task 4 以降はこの見出し名（`9. 確認`）に依存する。

- [ ] **Step 1: 失敗するテストを書く**

`src/features/planner/components/planner-wizard.test.tsx` に追記する。live の `Harness`（`:51–158`）は `useState` の draft を返さない。`renderWizardAtTimeLimit` / `renderWizardAtAudienceForHousehold` / `latestDraft()` はファイルに無いので発明しない（P-T3-API）。到達は `<Harness initialStep=… initialDraft=… />`。draft を読むテストだけ、Harness にテスト専用 `draftBox` を足す。

既存 `afterEach`（`:18–20`、leave flush 解除）へ `vi.useRealTimers()` を足す。fake timer テストが失敗したときに漏れないようにする。

```tsx
function Harness({
  // 既存 props はそのまま
  draftBox,
}: {
  // 既存の型はそのまま
  draftBox?: { current: PlannerDraftInput };
}) {
  const [step, setStep] = useState<PlannerStep>(initialStep);
  const [draft, setDraft] = useState<PlannerDraftInput>(initialDraft);
  if (draftBox !== undefined) {
    draftBox.current = draft;
  }
  // 以降の return は現行どおり
```

```tsx
/** 自動遷移直後の 350ms ガード（設計 P-03）を抜ける。 */
async function passActivationGuard(): Promise<void> {
  vi.setSystemTime(Date.now() + 400);
  await Promise.resolve();
}

/** .wizard-option（label）を叩く。input 直 click では pointerup の受け口を通らない。 */
function optionLabel(name: string): HTMLElement {
  const input = screen.getByRole("radio", { name });
  const label = input.closest("label.wizard-option");
  if (label === null) throw new Error(`.wizard-option が見つからない: ${name}`);
  return label as HTMLElement;
}

function renderAtTimeLimit(overrides: Partial<PlannerDraftInput> = {}) {
  const initialDraft = { ...reviewDraft, ...overrides };
  const draftBox: { current: PlannerDraftInput } = { current: initialDraft };
  render(
    <Harness initialStep="timeLimit" initialDraft={initialDraft} draftBox={draftBox} />,
  );
  return { latestDraft: () => draftBox.current };
}
```

追加するテスト。`it(...)` でも `test(...)` でもよい（ファイルは `it` が主）。idea 側の `onIdeaAudienceConfirmed` は resolve しないと audience に留まる。

```tsx
test("moves from audience to the time limit step for household", async () => {
  const user = userEvent.setup();
  render(<Harness initialStep="audience" initialDraft={reviewDraft} />);
  await user.click(screen.getByRole("button", { name: "次へ" }));
  expect(screen.getByRole("heading", { name: "5. 調理時間" })).toBeInTheDocument();
});

test("moves from audience to the time limit step for idea", async () => {
  const user = userEvent.setup();
  render(
    <Harness
      initialStep="audience"
      initialDraft={{
        ...emptyDraft,
        mealType: "dinner",
        mainIngredients: ["鶏肉"],
        cuisineGenre: "japanese",
        targetMode: "idea",
        targetMemberIds: [],
        servings: 2,
      }}
      onIdeaAudienceConfirmed={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  await user.click(screen.getByRole("button", { name: "次へ" }));
  expect(await screen.findByRole("heading", { name: "5. 調理時間" })).toBeInTheDocument();
});

test("walks the four optional steps into the review step and keeps the picks", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const { latestDraft } = renderAtTimeLimit();
  await passActivationGuard();
  await user.click(optionLabel("15分以内"));
  expect(screen.getByRole("heading", { name: "6. 予算" })).toBeInTheDocument();
  await passActivationGuard();
  await user.click(optionLabel("節約優先"));
  expect(screen.getByRole("heading", { name: "7. 材料の使い方" })).toBeInTheDocument();
  await passActivationGuard();
  await user.click(optionLabel("多め"));
  expect(screen.getByRole("heading", { name: "8. 献立の雰囲気" })).toBeInTheDocument();
  await passActivationGuard();
  await user.click(optionLabel("ひねりたい（主菜を定番から外す）"));
  expect(screen.getByRole("heading", { name: "9. 確認" })).toBeInTheDocument();
  expect(latestDraft()).toMatchObject({
    timeLimitMinutes: 15,
    budgetPreference: "economy",
    ingredientPreference: "more",
    noveltyPreference: "twist",
  });
});

test("stores null rather than an empty string when 指定なし is picked", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const { latestDraft } = renderAtTimeLimit();
  await passActivationGuard();
  await user.click(optionLabel("指定なし"));
  expect(latestDraft().timeLimitMinutes).toBeNull();
  expect(latestDraft().timeLimitMinutes).not.toBe("");
});

test("skips the rest of the optional steps with all four fields null", async () => {
  const user = userEvent.setup();
  const { latestDraft } = renderAtTimeLimit();
  await user.click(screen.getByRole("button", { name: "以降は指定なしでスキップ" }));
  expect(screen.getByRole("heading", { name: "9. 確認" })).toBeInTheDocument();
  expect(latestDraft()).toMatchObject({
    timeLimitMinutes: null,
    budgetPreference: null,
    ingredientPreference: null,
    noveltyPreference: null,
  });
});

test("ignores the first click on a newly mounted optional step", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const { latestDraft } = renderAtTimeLimit();
  await passActivationGuard();
  await user.click(optionLabel("15分以内"));
  expect(screen.getByRole("heading", { name: "6. 予算" })).toBeInTheDocument();
  // 6ページ目 mount 直後の初回 click は 350ms ガードで落ちる
  await user.click(optionLabel("節約優先"));
  expect(screen.getByRole("heading", { name: "6. 予算" })).toBeInTheDocument();
  expect(latestDraft().budgetPreference).toBeNull();
});

test("returns to review when the audience is edited from the review screen (household)", async () => {
  const user = userEvent.setup();
  render(<Harness initialStep="review" initialDraft={reviewDraft} />);
  await user.click(screen.getByRole("button", { name: "対象を変更" }));
  expect(screen.getByRole("heading", { name: "4. 作る相手" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "確認に戻る" }));
  expect(screen.getByRole("heading", { name: "9. 確認" })).toBeInTheDocument();
});

test("returns to review when the audience is edited from the review screen (idea)", async () => {
  const user = userEvent.setup();
  render(
    <Harness
      initialStep="review"
      initialDraft={{
        ...emptyDraft,
        mealType: "dinner",
        mainIngredients: ["鶏肉"],
        cuisineGenre: "japanese",
        targetMode: "idea",
        targetMemberIds: [],
        servings: 2,
      }}
    />,
  );
  await user.click(screen.getByRole("button", { name: "対象を変更" }));
  await user.click(screen.getByRole("button", { name: "確認に戻る" }));
  expect(await screen.findByRole("heading", { name: "9. 確認" })).toBeInTheDocument();
});
```

「調理時間を変更」からの編集戻りテストは **Task 4** へ移す（P-T3-EDIT）。Task 3 時点では確認の変更ボタンが食事 / メイン食材 / ジャンル / `aria-label="対象を変更"` までしか無い。Task 3 の P-01 回帰は上の「対象を変更 → 確認に戻る」だけ。

同ファイルの既存テストを新しい step 数へ更新する（P-T3-HEADING / P-T3-GUARD）。`"5. 確認"` の **正アサーション** は次の全件。queryByRole 不在（555, 712, 828, 854）は見出し差し替え後も緑なので触らない。

| 行 | テスト | Task 3 での期待 |
| --- | --- | --- |
| 323 | sequential `:301–333` | audience の次は `5. 調理時間`。そこから `passActivationGuard` + `optionLabel("指定なし")` で 4 ページ歩き、`9. 確認`。戻るは確認から数えて ×8 で `1. 食事` |
| 536 | idea confirm resolve 後の着地 | `5. 調理時間`（review ではない） |
| 576 | household audience 次へ | `5. 調理時間` |
| 616 | idea 二重送信 resolve 後 | `5. 調理時間` |
| 647 | P1 reset disabled resolve 後 | `5. 調理時間` |
| 764 | 「戻るで1つ前の質問へ…」 | 確認からの戻る1回は `8. 献立の雰囲気`。`passActivationGuard` のあと `optionLabel("いつもの")` で `9. 確認`。この区間で `getByRole("button", { name: "次へ" })` を使わない |
| 773, 794, 799, 804 | 編集戻り着地 | `9. 確認` |
| 1543 | 保存失敗で step 維持（`initialStep="review"`） | `9. 確認` |

sequential の歩き部分は次を本文とする（P-T3-GUARD。audience 次へ直後の click は 350ms に食われる）。

```tsx
    await user.click(screen.getByRole("button", { name: "次へ" }));

    expect(screen.getByRole("heading", { name: "5. 調理時間" })).toBeInTheDocument();
    await passActivationGuard();
    await user.click(optionLabel("指定なし"));
    expect(screen.getByRole("heading", { name: "6. 予算" })).toBeInTheDocument();
    await passActivationGuard();
    await user.click(optionLabel("指定なし"));
    expect(screen.getByRole("heading", { name: "7. 材料の使い方" })).toBeInTheDocument();
    await passActivationGuard();
    await user.click(optionLabel("指定なし"));
    expect(screen.getByRole("heading", { name: "8. 献立の雰囲気" })).toBeInTheDocument();
    await passActivationGuard();
    await user.click(optionLabel("指定なし"));

    expect(screen.getByRole("heading", { name: "9. 確認" })).toBeInTheDocument();

    for (let i = 0; i < 8; i += 1) {
      await user.click(screen.getByRole("button", { name: "戻る" }));
    }
    expect(screen.getByRole("heading", { name: "1. 食事" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "夕食" })).toBeChecked();
```

sequential 本体は fake timer が必要なので、この `it` の先頭で `vi.useFakeTimers({ shouldAdvanceTime: true })` と `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` に切り替える。

「追加条件」系4テスト（717「任意条件はデフォルトで開き…」、893、934、983）は Task 3 ではカード UI が残るので**緑のまま**。Task 4 で書き換える。`describe.skip` にしない。

見出し名の更新（同一コミット内）:

- `src/features/planner/planner-route-conflict.test.tsx:289,308` の `"5. 確認"` → `"9. 確認"`。
- `src/app/accessibility.test.tsx:487` の `heading: "5. 確認"` → `heading: "9. 確認"`。

- [ ] **Step 2: テストを実行して落ちることを確認する**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/components/planner-wizard.test.tsx
```

期待: FAIL（audience の次が `review` のまま、`5. 調理時間` が見つからない）。

- [ ] **Step 3: 最小の実装を書く**

**3-a. `review-step.tsx:444` の見出しだけ差し替える。**

```tsx
              9. 確認
```

**3-b. `planner-wizard.tsx` の import に足す。**

```tsx
import { OptionalChoiceStep } from "./optional-choice-step";
import { ingredientPreferenceLabel, ingredientPreferenceLabels, noveltyPreferenceLabel, noveltyPreferenceLabels } from "../model/planner-labels";
```

**3-c. `editReturnActionLabels` の直後に、任意 step 用の backLabel だけを用意する。**

```tsx
  // 追加条件 step は「次へ」を持たないので nextLabel は渡さない。
  // 編集戻りは「選択で advanceFromEditOr」「戻るで returnToReviewIfQuestionsComplete」の両方が確認へ帰る。
  const optionalStepBackLabel = returnToReviewAfterEdit ? { backLabel: "やめる" } : {};

  /** 5ページ目の「以降は指定なしでスキップ」。4フィールドだけを null にして確認へ直行する。 */
  const skipRestOfOptionalSteps = (): void => {
    onDraftChange({
      ...draft,
      timeLimitMinutes: null,
      budgetPreference: null,
      ingredientPreference: null,
      noveltyPreference: null,
    });
    goToStep("review");
  };
```

**3-d. audience の `onNext` を差し替える（P-01）。** `goToStep("timeLimit")` は禁止。`setReturnToReviewAfterEdit(false)` を先に呼んでから行先を直指定する形も禁止（同一クロージャの `returnToReviewAfterEdit` は `setState` しても変わらないため、解除は `advanceFromEditOr` → `returnToReviewIfQuestionsComplete` に任せる）。

idea 側の `await` 成功後（現行 `setReturnToReviewAfterEdit(false); goToStep("review");`）:

```tsx
                if (confirmGeneration !== ideaConfirmGenerationRef.current) return;
                confirmingIdeaAudienceRef.current = false;
                setConfirmingIdeaAudience(false);
                advanceFromEditOr("timeLimit");
```

household 側（現行 `setReturnToReviewAfterEdit(false);` から末尾まで）:

```tsx
            // household 等: 未完成 audience / 非 eligible のまま先へ進めない（P2/P7）
            // firstIncomplete へ直指定する。advanceFromEditOr に変えるとフラグが落ち、
            // 次の「次へ」が timeLimit へ進んで確認へ帰らなくなる。
            if (!isAudienceComplete(draft, eligibleMemberIdSet)) {
              goToStep(firstIncompletePlannerStep(draft, eligibleMemberIdSet));
              return;
            }
            advanceFromEditOr("timeLimit");
```

**3-e. `if (step === "audience") { … }` ブロックの直後に4つの分岐を足す。**

```tsx
  if (step === "timeLimit") {
    return (
      <main ref={containerRef} className="page-frame stack guided-planner-theme">
        {conflictChrome}
        {autosaveChrome}
        {resetChrome}
        <OptionalChoiceStep
          key={step}
          id="planner-time-limit"
          title="5. 調理時間"
          value={draft.timeLimitMinutes === null ? "" : String(draft.timeLimitMinutes)}
          options={[
            { value: "", label: "指定なし" },
            { value: "15", label: "15分以内" },
            { value: "30", label: "30分以内" },
            { value: "45", label: "45分以内" },
          ]}
          onSelect={(selected) => {
            // Number(selected) は禁止（Number("") === 0 が plannerDraftSchema を落とす）。
            onDraftChange({
              ...draft,
              timeLimitMinutes:
                selected === "15" ? 15 : selected === "30" ? 30 : selected === "45" ? 45 : null,
            });
          }}
          onNext={() => {
            advanceFromEditOr("budget");
          }}
          onBack={() => {
            backFromEditOr("audience");
          }}
          disabled={isSaving}
          errorMessage={fieldErrors.timeLimitMinutes ?? null}
          description="選んだ内容はあとから確認画面で変えられます。"
          {...(returnToReviewAfterEdit ? {} : { onSkipRest: skipRestOfOptionalSteps })}
          {...optionalStepBackLabel}
        />
        {error !== null && <p role="alert">{error}</p>}
        {footer}
      </main>
    );
  }
  if (step === "budget") {
    return (
      <main ref={containerRef} className="page-frame stack guided-planner-theme">
        {conflictChrome}
        {autosaveChrome}
        {resetChrome}
        <OptionalChoiceStep
          key={step}
          id="planner-budget"
          title="6. 予算"
          value={draft.budgetPreference ?? ""}
          options={[
            { value: "", label: "指定なし" },
            { value: "economy", label: "節約優先" },
            { value: "standard", label: "標準" },
          ]}
          onSelect={(selected) => {
            onDraftChange({
              ...draft,
              budgetPreference:
                selected === "economy" ? "economy" : selected === "standard" ? "standard" : null,
            });
          }}
          onNext={() => {
            advanceFromEditOr("ingredientPreference");
          }}
          onBack={() => {
            backFromEditOr("timeLimit");
          }}
          disabled={isSaving}
          errorMessage={fieldErrors.budgetPreference ?? null}
          {...optionalStepBackLabel}
        />
        {error !== null && <p role="alert">{error}</p>}
        {footer}
      </main>
    );
  }
  if (step === "ingredientPreference") {
    return (
      <main ref={containerRef} className="page-frame stack guided-planner-theme">
        {conflictChrome}
        {autosaveChrome}
        {resetChrome}
        <OptionalChoiceStep
          key={step}
          id="planner-ingredient-preference"
          title="7. 材料の使い方"
          value={draft.ingredientPreference ?? ""}
          options={[
            { value: "", label: ingredientPreferenceLabel(null) },
            { value: "more", label: ingredientPreferenceLabels.more },
            { value: "less", label: ingredientPreferenceLabels.less },
            { value: "selected_only", label: ingredientPreferenceLabels.selected_only },
            { value: "auto", label: ingredientPreferenceLabels.auto },
          ]}
          onSelect={(selected) => {
            onDraftChange({
              ...draft,
              ingredientPreference:
                selected === "more"
                  ? "more"
                  : selected === "less"
                    ? "less"
                    : selected === "selected_only"
                      ? "selected_only"
                      : selected === "auto"
                        ? "auto"
                        : null,
            });
          }}
          onNext={() => {
            advanceFromEditOr("novelty");
          }}
          onBack={() => {
            backFromEditOr("budget");
          }}
          disabled={isSaving}
          errorMessage={fieldErrors.ingredientPreference ?? null}
          description="材料の量や、買い足しの範囲の目安です。調味料の基本（塩・しょうゆ・油など）はどの選択でも使えます。"
          {...optionalStepBackLabel}
        />
        {error !== null && <p role="alert">{error}</p>}
        {footer}
      </main>
    );
  }
  if (step === "novelty") {
    return (
      <main ref={containerRef} className="page-frame stack guided-planner-theme">
        {conflictChrome}
        {autosaveChrome}
        {resetChrome}
        <OptionalChoiceStep
          key={step}
          id="planner-novelty-preference"
          title="8. 献立の雰囲気"
          value={draft.noveltyPreference ?? ""}
          options={[
            { value: "", label: noveltyPreferenceLabel(null) },
            { value: "standard", label: noveltyPreferenceLabels.standard },
            { value: "twist", label: noveltyPreferenceLabels.twist },
          ]}
          onSelect={(selected) => {
            onDraftChange({
              ...draft,
              noveltyPreference:
                selected === "standard" ? "standard" : selected === "twist" ? "twist" : null,
            });
          }}
          onNext={() => {
            advanceFromEditOr("review");
          }}
          onBack={() => {
            backFromEditOr("ingredientPreference");
          }}
          disabled={isSaving}
          {...optionalStepBackLabel}
        />
        {error !== null && <p role="alert">{error}</p>}
        {footer}
      </main>
    );
  }
```

**3-f. 最終分岐を exhaustive にする。** 現行の `// review` コメント＋無条件 `return` を `if (step === "review") { … }` へ変え、その後ろに次を置く。

```tsx
  // 新 step の追加漏れを最終 else の ReviewStep が隠さないよう、未知 step で落とす。
  const unknownStep: never = step;
  throw new Error(`未知の planner step: ${String(unknownStep)}`);
```

**3-g. review の `onBack` を `novelty` へ変える。**

```tsx
        onBack={() => {
          // 1ページずつ戻る（novelty ← ingredientPreference ← … は各 step の onBack が担う）
          setReturnToReviewAfterEdit(false);
          goToStep("novelty");
        }}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/components/planner-wizard.test.tsx src/features/planner/planner-route-conflict.test.tsx
docker compose run --rm --no-deps app npm run typecheck
```

期待: PASS（「追加条件」系4テストも Task 3 では緑。typecheck も PASS。`ReviewFieldErrors` の余剰キーは代入側を壊さない）。

- [ ] **Step 5: コミットする**

```bash
docker compose run --rm --no-deps app npm run format:check
git add src/features/planner/components/planner-wizard.tsx src/features/planner/components/review-step.tsx src/features/planner/components/planner-wizard.test.tsx src/features/planner/planner-route-conflict.test.tsx src/app/accessibility.test.tsx
git commit -m "feat(planner): 追加条件4ページをウィザードへ配線する"
```

---

### Task 4: 確認画面からカード UI を外し、サマリ行へ置き換える

**Files:**
- Modify: `src/features/planner/components/review-step.tsx`
- Modify: `src/features/planner/components/planner-wizard.tsx`（`buildReviewFieldErrors`）
- Modify: `src/app/accessibility.test.tsx`（axe 表に新4ページを追加）
- Test: `src/features/planner/components/planner-wizard.test.tsx`（「追加条件」系4テストの書き換え）

**Interfaces:**
- Consumes: Task 3 の `9. 確認` 見出しと `onEditStep(step)` が新4 step を受け取れること
- Produces: `ReviewFieldErrors = Partial<Record<"avoidIngredients" | "memo" | "pantrySelections", string>>`。確認サマリに「調理時間」「予算」「材料の使い方」「献立の雰囲気」の4行と `aria-label="…を変更"` ボタン。

- [ ] **Step 1: 失敗するテストを書く**

`planner-wizard.test.tsx` の既存「追加条件」系4テストを、確認サマリの検証へ書き換える。到達は live の Harness を使う（P-T3-API）。`renderWizardAtReviewWithDraft` はファイルに無いので、次をテストファイルへ足してから使う。

```tsx
function renderWizardAtReviewWithDraft(overrides: Partial<PlannerDraftInput> = {}) {
  render(
    <Harness
      initialStep="review"
      initialDraft={{ ...reviewDraft, ...overrides }}
    />,
  );
}
```

名前で対象にする既存テスト:

- `it("任意条件はデフォルトで開き、閉じたあと再度開いて編集できる")`（`:717`。P-T4-717。名前検索から漏れやすい）
- `it("追加条件は field 縦積みで狭幅でも崩れない構造を持つ")`（`:893`）
- `it("追加条件の材料の使い方を選び draft に反映できる")`（`:934`）
- `it("追加条件の献立の雰囲気を選び draft に反映できる")`（`:983`）

`:717` は details の開閉だけ残し、radio 操作（`radiogroup`「献立全体の調理時間」）を削除する。

```tsx
  it("任意条件はデフォルトで開き、閉じたあと再度開いて編集できる", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...emptyDraft,
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "household",
          targetMemberIds: [eligibleMember.id],
        }}
      />,
    );

    const summary = screen.getByText("追加条件");
    const details = summary.closest("details");
    expect(details).toHaveAttribute("open");
    await user.click(summary);
    expect(details).not.toHaveAttribute("open");
    await user.click(summary);
    expect(details).toHaveAttribute("open");
    expect(screen.getByRole("textbox", { name: /今回だけ避ける食材/u })).toBeInTheDocument();
  });
```

Task 3 から移した「調理時間を変更」の編集戻り（P-T3-EDIT）。このテストはサマリ行の変更ボタンが生えてからでないと書けない。

```tsx
test("returns to review right after picking on an optional step opened from 変更", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<Harness initialStep="review" initialDraft={reviewDraft} />);
  await user.click(screen.getByRole("button", { name: "調理時間を変更" }));
  expect(screen.getByRole("heading", { name: "5. 調理時間" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "以降は指定なしでスキップ" }),
  ).not.toBeInTheDocument();
  await passActivationGuard();
  await user.click(optionLabel("30分以内"));
  expect(screen.getByRole("heading", { name: "9. 確認" })).toBeInTheDocument();
});
```

サマリ行の検証。

```tsx
test("shows the optional condition answers as review summary rows", () => {
  renderWizardAtReviewWithDraft({
    timeLimitMinutes: 30,
    budgetPreference: "economy",
    ingredientPreference: "more",
    noveltyPreference: "twist",
  });
  expect(screen.getByText("調理時間")).toBeInTheDocument();
  expect(screen.getByText("30分以内")).toBeInTheDocument();
  expect(screen.getByText("予算")).toBeInTheDocument();
  expect(screen.getByText("節約優先")).toBeInTheDocument();
  expect(screen.getByText("材料の使い方")).toBeInTheDocument();
  expect(screen.getByText("多め")).toBeInTheDocument();
  expect(screen.getByText("献立の雰囲気")).toBeInTheDocument();
  expect(screen.getByText("ひねりたい（主菜を定番から外す）")).toBeInTheDocument();
});

test("shows 指定なし for unanswered optional conditions", () => {
  renderWizardAtReviewWithDraft({
    timeLimitMinutes: null,
    budgetPreference: null,
    ingredientPreference: null,
    noveltyPreference: null,
  });
  expect(screen.getAllByText("指定なし")).toHaveLength(4);
});

test("no longer renders the optional condition radios on the review screen", () => {
  renderWizardAtReviewWithDraft({});
  expect(screen.queryByRole("radiogroup", { name: "献立全体の調理時間" })).not.toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: "15分以内" })).not.toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: "節約優先" })).not.toBeInTheDocument();
});

test("opens the matching optional step from the review 変更 buttons", async () => {
  const user = userEvent.setup();
  renderWizardAtReviewWithDraft({});
  await user.click(screen.getByRole("button", { name: "予算を変更" }));
  expect(screen.getByRole("heading", { name: "6. 予算" })).toBeInTheDocument();
});

test("keeps avoid / memo / pantry inside the additional conditions details", () => {
  renderWizardAtReviewWithDraft({});
  expect(screen.getByRole("textbox", { name: /今回だけ避ける食材/u })).toBeInTheDocument();
});
```

- [ ] **Step 2: テストを実行して落ちることを確認する**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/components/planner-wizard.test.tsx
```

期待: 新規5テストのうちサマリ行と `変更` ボタン、radio 不在の主張が FAIL。

- [ ] **Step 3: 最小の実装を書く**

**4-a. `review-step.tsx` から `ReviewChoiceField` 関数定義（`:99` 付近から）と `ReviewChoiceOption` 型、そして `<details>` 内の4つの `<ReviewChoiceField … />` 呼び出しを削除する。** 併せて削除するもの:

- `{fieldErrors?.timeLimitMinutes != null && (<p id="review-time-limit-error" role="alert">…</p>)}`
- `{fieldErrors?.budgetPreference != null && (<p id="review-budget-error" role="alert">…</p>)}`
- `{fieldErrors?.ingredientPreference != null && (<p id="review-ingredient-preference-error" role="alert">…</p>)}`
- `<p id="review-ingredient-preference-hint" className="type-small">…</p>`（同じ文言は Task 3 で 7ページ目の `description` へ移した）

**4-b. `ReviewFieldErrors` を3フィールドへ縮める。**

```ts
export type ReviewFieldErrors = Partial<
  Record<"avoidIngredients" | "memo" | "pantrySelections", string>
>;
```

**4-c. `forceAdditionalOpen` から3条件を外す**（直しどころが details 内に無くなったため）。

```ts
  const forceAdditionalOpen =
    hasUnavailablePantrySelections ||
    hasUnconfirmedExpiredPantry ||
    medicalBlocked ||
    fieldErrors?.avoidIngredients != null ||
    avoidIngredientLocalError != null ||
    fieldErrors?.memo != null ||
    fieldErrors?.pantrySelections != null;
```

**4-d. サマリ `dl` の「対象」行の直後に4行を足す。**

```tsx
              <div className="wizard-review-item">
                <dt>調理時間</dt>
                <dd className="review-answer-cell">
                  <span>
                    {value.timeLimitMinutes === null
                      ? "指定なし"
                      : `${String(value.timeLimitMinutes)}分以内`}
                  </span>
                  {onEditStep !== undefined && (
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      aria-label="調理時間を変更"
                      onClick={() => {
                        onEditStep("timeLimit");
                      }}
                    >
                      変更
                    </Button>
                  )}
                </dd>
              </div>
              <div className="wizard-review-item">
                <dt>予算</dt>
                <dd className="review-answer-cell">
                  <span>
                    {value.budgetPreference === "economy"
                      ? "節約優先"
                      : value.budgetPreference === "standard"
                        ? "標準"
                        : "指定なし"}
                  </span>
                  {onEditStep !== undefined && (
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      aria-label="予算を変更"
                      onClick={() => {
                        onEditStep("budget");
                      }}
                    >
                      変更
                    </Button>
                  )}
                </dd>
              </div>
              <div className="wizard-review-item">
                <dt>材料の使い方</dt>
                <dd className="review-answer-cell">
                  <span>{ingredientPreferenceLabel(value.ingredientPreference)}</span>
                  {onEditStep !== undefined && (
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      aria-label="材料の使い方を変更"
                      onClick={() => {
                        onEditStep("ingredientPreference");
                      }}
                    >
                      変更
                    </Button>
                  )}
                </dd>
              </div>
              <div className="wizard-review-item">
                <dt>献立の雰囲気</dt>
                <dd className="review-answer-cell">
                  <span>{noveltyPreferenceLabel(value.noveltyPreference)}</span>
                  {onEditStep !== undefined && (
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      aria-label="献立の雰囲気を変更"
                      onClick={() => {
                        onEditStep("novelty");
                      }}
                    >
                      変更
                    </Button>
                  )}
                </dd>
              </div>
```

**4-e. 説明文を9ページ構成へ合わせる。** 追加条件のページには「次へ」も「確認に戻る」も無く、選ぶだけで確認へ帰るため。

```tsx
              <p className="type-small">
                「戻る」で1つ前の質問へ、「変更」でその質問へ直接戻れます。必須の質問を直したあとは「確認に戻る」で、追加条件のページでは選び直すと、この画面に戻ります。
              </p>
```

**4-f. 未使用になった import を落とす。** `ingredientPreferenceLabels` / `noveltyPreferenceLabels` は `review-step.tsx` では未使用になる（Task 3 で `planner-wizard.tsx` へ移した）。`ingredientPreferenceLabel` / `noveltyPreferenceLabel` は 4-d で使うので残す。lint の `no-unused-vars` が拾う。

**4-g. `planner-wizard.tsx` の `buildReviewFieldErrors` から3フィールドを外す。**

```ts
function buildReviewFieldErrors(
  fieldErrors: Partial<Record<PlannerFieldName, string>>,
): ReviewFieldErrors {
  const result: ReviewFieldErrors = {};
  if (fieldErrors.avoidIngredients !== undefined)
    result.avoidIngredients = fieldErrors.avoidIngredients;
  if (fieldErrors.memo !== undefined) result.memo = fieldErrors.memo;
  if (fieldErrors.pantrySelections !== undefined)
    result.pantrySelections = fieldErrors.pantrySelections;
  return result;
}
```

**4-h. `src/app/accessibility.test.tsx` の axe 表へ新4ページを足す。** `it.each` は `step` が必須（P-T4-AXE）。`renderWizard` は `onStepChange={vi.fn()}` なので歩かない。各行を `step` 付きで直描画する。歩き parenthetical は書かない。primary は5ページ目がスキップ、6〜8ページ目は「戻る」。

```ts
    { step: "timeLimit" as const, heading: "5. 調理時間", primary: "以降は指定なしでスキップ" },
    { step: "budget" as const, heading: "6. 予算", primary: "戻る" },
    { step: "ingredientPreference" as const, heading: "7. 材料の使い方", primary: "戻る" },
    { step: "novelty" as const, heading: "8. 献立の雰囲気", primary: "戻る" },
```

`heading: "9. 確認"` の行の手前に置く。draft は任意 step なので `emptyDraft` でよい。

- [ ] **Step 4: テストを実行して通ることを確認する**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/components/planner-wizard.test.tsx src/features/planner/components/optional-choice-step.test.tsx src/app/accessibility.test.tsx
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint > /tmp/lint.log 2>&1 ; grep -nE 'error|FAIL' /tmp/lint.log || tail -n 20 /tmp/lint.log
```

期待: すべて PASS、lint に error 0 件。

- [ ] **Step 5: コミットする**

```bash
docker compose run --rm --no-deps app npm run format:check
git add src/features/planner/components/review-step.tsx src/features/planner/components/planner-wizard.tsx src/features/planner/components/planner-wizard.test.tsx src/app/accessibility.test.tsx
git commit -m "feat(planner): 確認画面の追加条件カードをサマリ行へ置き換える"
```

---

### Task 5: E2E のスキップ経路を通す

**Files:**
- Modify: `e2e/fixtures/history.ts`（`skipOptionalPlannerSteps` を追加、`seedGeneratedMenu` / `seedGeneratedIdeaMenu`、見出し名）
- Modify: `e2e/fixtures/shopping.ts`（`generateShoppingMenu`、見出し名）
- Modify: `e2e/shots/flows.ts`（`advanceToReviewWithHousehold`、見出し名）
- Modify: `e2e/specs/menu-domain-pantry.spec.ts`（`savePlannerMeal` / `advanceToReviewWithHousehold` / 戻る回数 / `:263–278`）
- Modify: `e2e/specs/generation-recovery-results.spec.ts`（`completeIdeaPlannerToReview` / `completeMinimumPlanner` / 見出し名）
- Modify: `e2e/specs/full-journey.spec.ts`（idea ジャーニーと見出し名）
- Modify: `e2e/specs/mobile-accessibility.spec.ts`（見出し名のみ。歩き替えは Task 6）

**Interfaces:**
- Consumes: Task 3 の「5. 調理時間」「以降は指定なしでスキップ」「9. 確認」
- Produces: `export async function skipOptionalPlannerSteps(page: Page): Promise<void>` — Task 6 は使わない（Task 6 の行は4ページを歩く）

- [ ] **Step 1: helper を追加する**

`e2e/fixtures/history.ts` の `clickWizardNext` の直後に足す。

```ts
/**
 * 5. 調理時間 の「以降は指定なしでスキップ」で追加条件4ページを飛ばし、9. 確認 まで進める。
 * 任意 step に「次へ」は無いので clickWizardNext は使えない。
 * スキップボタンは 350ms の活性化ガードの対象外なので待ちは要らない。
 */
export async function skipOptionalPlannerSteps(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "5. 調理時間" })).toBeVisible();
  const skip = page.getByRole("button", { name: "以降は指定なしでスキップ" });
  await expect(skip).toBeEnabled({ timeout: 15_000 });
  await skip.click();
  await expect(page.getByRole("heading", { name: "9. 確認" })).toBeVisible();
}
```

- [ ] **Step 2: 「手段 = skip」の walker へ差し込む**

下の各所で、audience の `clickWizardNext(page)` の直後にある `await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible();` を `await skipOptionalPlannerSteps(page);` に置き換える（この1行がスキップと `9. 確認` 到達の両方を主張する）。呼び出し元ファイルには `skipOptionalPlannerSteps` の import を足す。

**idea ジャーニーは置換ではない（P-T5-IDEA）。** `e2e/specs/full-journey.spec.ts:315` の `clickWizardNext(page)` の**直後**、disclaimer `:317`（「家族の年齢・アレルギーは確認されません」）の**前**へ `await skipOptionalPlannerSteps(page);` を**挿入**する。`:315` の次は現状 `"5. 確認"` ではないので「直後の `5. 確認` を skip に置換」では helper が入らない。`:336` の `"5. 確認"` は privacy 復帰の見出し主張なので **置換のみ**（helper にしない）。

| ファイル | 単位 |
| --- | --- |
| `e2e/fixtures/history.ts` | `seedGeneratedMenu`（`:237–238`） |
| `e2e/fixtures/history.ts` | `seedGeneratedIdeaMenu`（`:453–455`） |
| `e2e/fixtures/shopping.ts` | `generateShoppingMenu`（`:88–89`） |
| `e2e/shots/flows.ts` | `advanceToReviewWithHousehold`（`:36–37`） |
| `e2e/specs/full-journey.spec.ts` | idea ジャーニー（`:315` の直後へ **挿入**。`:336` は置換のみ） |
| `e2e/specs/menu-domain-pantry.spec.ts` | `savePlannerMeal`（`:119–120`） |
| `e2e/specs/menu-domain-pantry.spec.ts` | `advanceToReviewWithHousehold`（`:145–146`） |
| `e2e/specs/generation-recovery-results.spec.ts` | `completeIdeaPlannerToReview`（`:87–90`） |
| `e2e/specs/generation-recovery-results.spec.ts` | `completeMinimumPlanner`（`:141–142`） |

**触らないもの:**
- `e2e/fixtures/shopping.ts` の `ensurePlannerReady`（`:40–67`）は walker ではない（`1. 食事` の radio を出すところで止まる）。
- `e2e/fixtures/acceptance.ts` は `history.ts` からの re-export で wizard を歩かない。
- `generation-recovery-results.spec.ts:866–871` は「人数未選択で遷移しない」主張で audience に留まる。

- [ ] **Step 3: 戻る回数と pantry のインライン経路を直す**

`e2e/specs/menu-domain-pantry.spec.ts` `savePlannerMeal`（`:77–80`）の「確認から戻る×4 で `1. 食事`」は戻る×8 にする。

```ts
  for (let i = 0; i < 8; i += 1) {
    await page.getByRole("button", { name: "戻る" }).click();
  }
  await expect(page.getByRole("heading", { name: "1. 食事" })).toBeVisible();
```

`menu-domain-pantry.spec.ts:263–278`（対象を選び直して確認へ戻るインライン）は、確認の「対象を変更」→ audience で選び直し →「確認に戻る」へ書き換える。編集戻り中の primary は `editReturnActionLabels` の `nextLabel`＝「確認に戻る」であって「次へ」ではないので、`clickWizardNext`（`次へ` 専用）は使わない。`advanceFromEditOr` が `9. 確認` へ直帰するため skip も4ページ歩きも要らない。

```ts
  await page.getByRole("button", { name: "対象を変更" }).click();
  await expect(page.getByRole("heading", { name: "4. 作る相手" })).toBeVisible();
  await selectHouseholdAudienceWithMember(page);
  await page.getByRole("button", { name: "確認に戻る" }).click();
  await expect(page.getByRole("heading", { name: "9. 確認" })).toBeVisible();
```

- [ ] **Step 4: 見出し名の残りを機械置換する**

上の書き換えで消えなかった `"5. 確認"`（ASCII 引用符）を `"9. 確認"` へ置換する。privacy 復帰行（`e2e/fixtures/history.ts:468`、`e2e/specs/mobile-accessibility.spec.ts:96`、`e2e/specs/full-journey.spec.ts:336`、`e2e/specs/generation-recovery-results.spec.ts:103` / `:440`）はウィザードを進める処理ではなく `?resume=review` で戻った先の見出し主張なので、**置換だけ**を当てる。

```bash
docker compose run --rm --no-deps app npx tsc --noEmit -p e2e/tsconfig.json 2>/dev/null || true
grep -rn '"5\. 確認"' --include='*.ts' --include='*.tsx' e2e src
```

期待: `grep` の出力が空。

- [ ] **Step 5: 型と書式を確認してコミットする**

```bash
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run format:check
git add e2e/fixtures/history.ts e2e/fixtures/shopping.ts e2e/shots/flows.ts e2e/specs/menu-domain-pantry.spec.ts e2e/specs/generation-recovery-results.spec.ts e2e/specs/full-journey.spec.ts e2e/specs/mobile-accessibility.spec.ts
# Step 4 の grep で src に `"5. 確認"` が残って触ったファイルがあれば、それも add する。e2e src 一式の git add はしない。
git commit -m "test(e2e): 追加条件stepをスキップするヘルパを足し導線を9ページへ更新する"
```

（E2E の実行は Task 6 の完了後にまとめて行う。ここでは型と書式のみを確認する。）

---

### Task 6: 4ページを歩く E2E 行を書き換える

**Files:**
- Modify: `e2e/specs/full-journey.spec.ts`（household ジャーニー `:71–73` 付近）
- Modify: `e2e/specs/mobile-accessibility.spec.ts`（`answerAudienceAndReview` `:147–149` 付近）
- Modify: `e2e/specs/generation-recovery-results.spec.ts`（44px レイアウト走査 `:1259–1272` 付近、キーボード導線 `:1358–1385` 付近）

**Interfaces:**
- Consumes: Task 3 の4ページ（`5. 調理時間` / `6. 予算` / `7. 材料の使い方` / `8. 献立の雰囲気`）と 350ms の活性化ガード
- Produces: なし（最終タスク）

**この4箇所すべてに効く共通ルール:**

- **各ページで 350ms 待つ。** `blocked()` は**そのページの mount** から数えるので、heading が可視／focus になった直後の `.click()` や Space は食われる。ページごとに `await expect(heading).toBeVisible()`（キーボード導線は `toBeFocused()`）のあと `await page.waitForTimeout(350)` を置いてから操作する。
- **新4ページに「次へ」は無い。** `clickWizardNext` を使わない、`次へ` を `expectMajorActionAtLeast44` で測らない、`tabUntil(focus.name === "次へ")` を書かない（どれも 0 件で赤になる）。前進はカード（`.wizard-option`）の click か radio の Space。
- 「指定なし」のまま通過する場合も `.check()` ではなく label `.wizard-option` の `.click()`（既に checked の radio に対する `.check()` は no-op になり `pointerup` が出ない）。unit と同じ受け口を通す。
- クリック対象は `page.getByRole("radio", { name }).click()` ではなく `page.locator("label.wizard-option").filter({ hasText: name })`。

- [ ] **Step 1: `full-journey.spec.ts` household を4ページ歩きにする**

audience の「次へ」直後の `9. 確認` 到達を、4ページを歩く形へ置き換える。「ひねりたい」は `8. 献立の雰囲気` で選ぶ。ここだけスキップを使わず、自動遷移が効いていることも同時に主張する。

live `:77–88` は radiogroup `.check()` の**前に** `waitForResponse`（`"p_novelty_preference":"twist"`）を置いている。確認の `.check()` だけ消して `noveltySaved` を残す／消すと timeout か twist 未保存になる（P-T6-WAIT）。`waitForResponse` を **8 ページ目の「ひねりたい」click の直前**へ移し、`await noveltySaved` のあと `9. 確認` を主張する。確認画面の radiogroup `.check()` は削除する。

```ts
  await expect(page.getByRole("heading", { name: "5. 調理時間" })).toBeVisible();
  await page.waitForTimeout(350);
  await page.locator("label.wizard-option").filter({ hasText: "15分以内" }).click();

  await expect(page.getByRole("heading", { name: "6. 予算" })).toBeVisible();
  await page.waitForTimeout(350);
  await page.locator("label.wizard-option").filter({ hasText: "節約優先" }).click();

  await expect(page.getByRole("heading", { name: "7. 材料の使い方" })).toBeVisible();
  await page.waitForTimeout(350);
  await page.locator("label.wizard-option").filter({ hasText: "多め" }).click();

  await expect(page.getByRole("heading", { name: "8. 献立の雰囲気" })).toBeVisible();
  await page.waitForTimeout(350);
  const noveltySaved = page.waitForResponse((response) => {
    if (!new URL(response.url()).pathname.endsWith("/rest/v1/rpc/save_generation_draft")) {
      return false;
    }
    const postData = response.request().postData();
    return postData !== null && postData.includes('"p_novelty_preference":"twist"');
  });
  await page
    .locator("label.wizard-option")
    .filter({ hasText: "ひねりたい（主菜を定番から外す）" })
    .click();
  await noveltySaved;

  await expect(page.getByRole("heading", { name: "9. 確認" })).toBeVisible();
```

- [ ] **Step 2: `mobile-accessibility.spec.ts` の走査へ新4ページを足す**

`answerAudienceAndReview` の audience 直後を、各ページで `assertStepFits` を通しながら歩く形へ置き換える。`5. 調理時間` は `{ 以降は指定なしでスキップ: 1, 戻る: 1 }`、`6.`〜`8.` は `{ 戻る: 1 }`（「次へ」は存在しないので期待に書かない）。

```ts
  await expect(page.getByRole("heading", { name: "5. 調理時間" })).toBeVisible();
  await assertStepFits(page, { "以降は指定なしでスキップ": 1, 戻る: 1 });
  await page.waitForTimeout(350);
  await page.locator("label.wizard-option").filter({ hasText: "指定なし" }).click();

  await expect(page.getByRole("heading", { name: "6. 予算" })).toBeVisible();
  await assertStepFits(page, { 戻る: 1 });
  await page.waitForTimeout(350);
  await page.locator("label.wizard-option").filter({ hasText: "指定なし" }).click();

  await expect(page.getByRole("heading", { name: "7. 材料の使い方" })).toBeVisible();
  await assertStepFits(page, { 戻る: 1 });
  await page.waitForTimeout(350);
  await page.locator("label.wizard-option").filter({ hasText: "指定なし" }).click();

  await expect(page.getByRole("heading", { name: "8. 献立の雰囲気" })).toBeVisible();
  await assertStepFits(page, { 戻る: 1 });
  await page.waitForTimeout(350);
  await page.locator("label.wizard-option").filter({ hasText: "指定なし" }).click();

  await expect(page.getByRole("heading", { name: "9. 確認" })).toBeVisible();
```

`assertStepFits` の引数の形はファイル内の既存呼び出し（`{ 次へ: 1 }`）に合わせる。

- [ ] **Step 3: 44px レイアウト走査を書き換える**

現行は各 step で `expectMajorActionAtLeast44(page, "次へ")` を測り、`次へ` を focus して Enter で進めている。新4ページではこの形が使えない（「次へ」が 0 件で赤になる）。各ページで `expectNoHorizontalScroll` → 350ms 待ち → radio を `.focus()` して `activateFocusedWithKeyboard(page, "Space")` で進める形にし、測る対象を差し替える。

```ts
  await expect(page.getByRole("heading", { name: "5. 調理時間" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectMajorActionAtLeast44(page, "以降は指定なしでスキップ");
  await expectMajorActionAtLeast44(page, "戻る");
  await page.waitForTimeout(350);
  await page.getByRole("radio", { name: "指定なし" }).focus();
  await activateFocusedWithKeyboard(page, "Space");

  for (const title of ["6. 予算", "7. 材料の使い方", "8. 献立の雰囲気"]) {
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectMajorActionAtLeast44(page, "戻る");
    await page.waitForTimeout(350);
    await page.getByRole("radio", { name: "指定なし" }).focus();
    await activateFocusedWithKeyboard(page, "Space");
  }

  await expect(page.getByRole("heading", { name: "9. 確認" })).toBeVisible();
```

`activateFocusedWithKeyboard` の第2引数の受け方はファイル内の既存シグネチャに合わせる（Space を押す形が無ければ `page.keyboard.press("Space")` を直接書く）。

- [ ] **Step 4: キーボード導線テストを書き換える**

`onKeyUp` は **radio** に載るので、heading にフォーカスしたまま Space を押しても届かない。h2 は `tabIndex={-1}` で Tab 順にも入らない。各ページの手順は次の4手にする。この4ページでは `tabUntil(focus.name === "次へ")` を書かない。programmatic `.focus()` フォールバック禁止の既存ルールはそのまま。

```ts
  for (const title of ["5. 調理時間", "6. 予算", "7. 材料の使い方", "8. 献立の雰囲気"]) {
    await expect(page.getByRole("heading", { name: title })).toBeFocused();
    await page.waitForTimeout(350);
    await tabUntil(
      page,
      (focus) => (focus.role === "radio" || focus.type === "radio") && focus.name.includes("指定なし"),
      `${title} の「指定なし」へ Tab で到達できない`,
    );
    await page.keyboard.press("Space");
  }
  await expect(page.getByRole("heading", { name: "9. 確認" })).toBeFocused();
```

`tabUntil` の引数順・述語が受け取る `focus` の形はファイル内の既存呼び出しに合わせる。テスト名（"advances four questions to review and privacy using keyboard only"）も実態（8問）へ合わせて更新する。

- [ ] **Step 5: E2E を実行してコミットする**

出力が数百行になるため、次のコマンドは**エージェントの Bash ツールでは走らせず、人間の端末で実行してもらい、要約と失敗行だけを貼り戻してもらう**（`CLAUDE.md`「Keeping verification output cheap on tokens」）。

```bash
./scripts/run-e2e.sh
```

期待: 全 spec が PASS。

```bash
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run format:check
git add e2e
git commit -m "test(e2e): 追加条件4ページを歩く導線とキーボード操作を更新する"
```

---

## Self-Review

**Spec coverage:**

| Spec 節 | 実装タスク |
| --- | --- |
| step モデル（`plannerSteps` / `stepByField` / `firstIncomplete` 非変更） | Task 1 |
| 新 step コンポーネント（props 表） | Task 2 |
| P-02 イベント表 | Task 2 |
| D-03 mutex・ポインタ受け口・擬似コード・`key={step}` | Task 2（実装）/ Task 3（`key={step}` の付与） |
| P-03 350ms ガードと2段 unit | Task 2（単体）/ Task 3（ウィザード単位） |
| P-05 値とラベルの正本、`""`→`null` | Task 3 |
| 「以降は指定なしでスキップ」（編集戻り中は非表示） | Task 3 |
| P-01 audience の `advanceFromEditOr`、各 step の `onNext`/`onBack`、`nextLabel` 非伝播、exhaustive 分岐 | Task 3 |
| 確認画面（カード削除・サマリ4行・`forceAdditionalOpen`・`buildReviewFieldErrors`・説明文） | Task 4 |
| unit テスト網 | Task 2 / Task 3 / Task 4 |
| axe 表・`planner-route-conflict` 見出し | Task 3（見出し）/ Task 4（axe 表） |
| E2E `skipOptionalPlannerSteps` と skip 行9件 | Task 5 |
| 戻る回数、pantry `:263–278` | Task 5 |
| `"5. 確認"` 42件の置換、privacy 復帰行は置換のみ | Task 5 |
| 4ページ歩き4箇所と共通ルール（350ms / 「次へ」不在 / `.click()`） | Task 6 |

**Placeholder scan:** TBD / TODO / 「適切に」なし。コード手順はすべて実コードを含む。

**Type consistency:** `OptionalChoiceStepProps` の props 名（`id` / `title` / `options` / `value` / `onSelect` / `onNext` / `onBack` / `disabled` / `errorMessage` / `description` / `onSkipRest` / `backLabel`）は Task 2 の定義と Task 3 の呼び出しで一致。`nextLabel` はどこにも現れない。`ReviewFieldErrors` は Task 4 で3フィールドへ縮め、`buildReviewFieldErrors` を同時に合わせている。step 名（`timeLimit` / `budget` / `ingredientPreference` / `novelty`）は Task 1 の `plannerSteps`、Task 3 の分岐、Task 4 の `onEditStep` で一致。

**Plan review 9 系統（`34f5e2d3` 裁定 → 本本文へ埋め込み済み）:**

| ID | 入れた場所 |
| --- | --- |
| P-T1-IMPORT | Task 1 Step 1 の import に `buildPlannerSubmissionFieldErrors` |
| P-T3-API | Task 3 到達を live `Harness` + `draftBox`。Task 4 の `renderWizardAtReviewWithDraft` も Harness |
| P-T3-EDIT | 「調理時間を変更」を Task 4 へ。Task 3 の P-01 は「対象を変更 → 確認に戻る」 |
| P-T3-HEADING | `"5. 確認"` 正アサーション全件。追加条件 4 本は Task 3 では緑 |
| P-T3-GUARD | sequential に `passActivationGuard`。戻る×8 は確認から数える |
| P-T4-717 | `:717` を名前で書き、details 開閉だけ残す |
| P-T4-AXE | axe 行に `step`。直描画。歩き指示なし |
| P-T5-IDEA | idea は `:315` 直後へ skip 挿入。`:336` は置換のみ |
| P-T6-WAIT | `noveltySaved` を 8 ページ目 click の直前へ |
