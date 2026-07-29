# 利用回数コピー簡素化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 確認・再生成・生成終端と API `issueMessages` から dual 残数・運用用語を取り除き、低リテラシー向けの1数字＋行動文に揃える（設計 `2026-07-29-quota-copy-simplification-design.md`）。

**Architecture:** 枠の数値・DB・`usage/today` shape は触らない。利用者向け日本語だけを変える。message 文字列の正本は `shared/contracts/generation.ts` の `issueMessages`。Function の `failureCopy[code].message` はそれを参照する。UI は success 残の常時1行、blocker 時のトーン分け、再生成は確認と同じ事前 disable（案 A）。

**Tech Stack:** TypeScript strict、Vitest、React Testing Library、既存 `formatFreeTierQuotaCopy`、Docker 経由 `npm`（`docker compose run --rm --no-deps app …`）。

## Global Constraints

- 設計正本: `docs/superpowers/specs/2026-07-29-quota-copy-simplification-design.md`（Approved）。矛盾時は設計が MVP §10.3/§14 利用者表示を supersede。
- 再導出禁止ロック L1–L10（設計の表）。特に **L8 再生成案 A**、**L9 明日0:00**、**L10 freemium allowlist は本設計が正**。
- 利用者向け禁止部分文字列: `成功回数` / `別の上限` / `AIへの送信` / `通信試行` / `問い合わせ` / `attempt`（ユーザー向け表示・issueMessages 値）。
- attempts0 body は **`今日は…`**（`本日は` 禁止 → 「無料版は本日は」回避）。
- 個人枠制限説明のみ `formatFreeTierQuotaCopy`。global には付けない。
- 未消費時の「作成回数は減っていません」は **UI 1行のみ**（message 本文に埋め込まない）。
- Node コマンドは Docker: `docker compose run --rm --no-deps app <cmd>`。コマンドは連結しない。
- コミットは日本語 Conventional Commits。push / PR 作成禁止。

## File map

| ファイル | 役割 |
|----------|------|
| `shared/contracts/generation.ts` | `issueMessages` 本文改訂 |
| `shared/contracts/generation.test.ts` | 新文言・禁止文字列・（必要なら）exact |
| `netlify/functions/_shared/generation-service.ts` | `failureCopy.message` を `issueMessages` 参照に |
| `netlify/functions/_shared/generation-service.test.ts` 他 | message fixture 更新 |
| `src/features/planner/components/review-step.tsx` | 常時1行・hide 条件・バナー文言 |
| `src/features/planner/components/planner-wizard.test.tsx` 等 | 確認 UI 期待 |
| `src/features/history/components/regeneration-sheet.tsx` | 案 A disabled + 文 |
| `src/features/history/components/regeneration-sheet.test.tsx` | 同上 |
| `src/features/generation/components/generation-status-panel.tsx` | dual 残数削除・未減文・読込失敗文 |
| `src/features/generation/components/generation-status-panel.test.tsx` | 同上 |
| `src/features/generation/pages/generation-page.test.tsx` | fixture message |
| `docs/superpowers/specs/2026-07-28-season-freemium-quota-design.md` | §2.1 superseded 注記 |

---

### Task 1: `issueMessages` 改訂と `failureCopy` 単一ソース

**Files:**
- Modify: `shared/contracts/generation.ts`（`nonConflictIssueMessages`）
- Modify: `shared/contracts/generation.test.ts`
- Modify: `netlify/functions/_shared/generation-service.ts`（`failureCopy`）
- Modify: message を hardcode している Function / panel テスト（少なくとも `generation-service.test.ts`、`generation-status.test.ts`、`generate-menu.test.ts` を grep して更新）

**Interfaces:**
- Consumes: `GenerationFailureCode`, 既存 `issueMessages` export
- Produces: 設計 §4 表の確定 message 文字列。`failureCopy[code].message === issueMessages[code]` が全 failure code で成立

- [ ] **Step 1: 契約テストを RED に更新**

`shared/contracts/generation.test.ts` の `describe("generationIssueCodes and issueMessages")` に追加:

```ts
const forbiddenUserCopyFragments = [
  "成功回数",
  "別の上限",
  "AIへの送信",
  "通信試行",
  "問い合わせ",
  "attempt",
] as const;

const expectedQuotaMessages = {
  user_daily_limit:
    "本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。",
  user_attempt_limit:
    "今日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。",
  user_short_window_limit:
    "短い時間に何度も作成を試したため、少し待つ必要があります。しばらくしてから再度お試しください。",
  global_daily_limit:
    "ただいま混雑しています。明日0:00（日本時間）以降にお試しください。",
  model_unavailable: "AIが混み合っています。",
  invalid_ai_response: "献立を正しく確認できませんでした。",
  generation_timeout: "作成に時間がかかりました。",
  internal_error: "献立を作成できませんでした。",
  duplicate_output: "元の献立とほぼ同じ案だったため保存しませんでした。",
} as const;

it("uses the simplified quota and soft-failure copy", () => {
  for (const [code, message] of Object.entries(expectedQuotaMessages)) {
    expect(issueMessages[code as keyof typeof issueMessages]).toBe(message);
  }
});

it("keeps user-facing issueMessages free of operator jargon", () => {
  for (const code of generationIssueCodes) {
    const text = issueMessages[code];
    for (const fragment of forbiddenUserCopyFragments) {
      expect(text.includes(fragment), `${code} contains ${fragment}`).toBe(false);
    }
  }
});
```

（`expect` の第2引数メッセージがプロジェクトの vitest 版で非対応なら `expect({ code, fragment, text }).toEqual(...)` 形式に読み替え。）

- [ ] **Step 2: RED を確認**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/generation.test.ts
```

Expected: FAIL（旧 `今日は3回利用` / `別の上限` 等）

- [ ] **Step 3: `issueMessages` を設計表どおりに更新**

`shared/contracts/generation.ts` の該当キーのみ置換（他コードは触らない）:

```ts
  user_daily_limit:
    "本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。",
  user_attempt_limit:
    "今日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。",
  user_short_window_limit:
    "短い時間に何度も作成を試したため、少し待つ必要があります。しばらくしてから再度お試しください。",
  global_daily_limit:
    "ただいま混雑しています。明日0:00（日本時間）以降にお試しください。",
  model_unavailable: "AIが混み合っています。",
  invalid_ai_response: "献立を正しく確認できませんでした。",
  generation_timeout: "作成に時間がかかりました。",
  internal_error: "献立を作成できませんでした。",
  duplicate_output: "元の献立とほぼ同じ案だったため保存しませんでした。",
```

- [ ] **Step 4: `failureCopy` を参照化**

`generation-service.ts` で `issueMessages` を import（既存 generation import に追加）。

```ts
import {
  // ...existing
  issueMessages,
  // ...
} from "../../../shared/contracts/generation.js";
```

`failureCopy` の各 `message` を文字列リテラルから `issueMessages.<code>` に置換。例:

```ts
const failureCopy: Record<GenerationFailureCode, { message: string; retryable: boolean }> = {
  consent_required: { message: issueMessages.consent_required, retryable: false },
  // ... 全 GenerationFailureCode
  user_daily_limit: { message: issueMessages.user_daily_limit, retryable: false },
  user_attempt_limit: { message: issueMessages.user_attempt_limit, retryable: false },
  user_short_window_limit: { message: issueMessages.user_short_window_limit, retryable: false },
  global_daily_limit: { message: issueMessages.global_daily_limit, retryable: false },
  // retryable フラグは現行値を維持（model_unavailable / invalid_ai_response / generation_timeout / internal_error / duplicate_output 等）
};
```

全キーを手で埋め、`message` に生文字列を残さない。

`generation-service.test.ts` に（または契約テスト側に）追加してもよい:

```ts
import { generationFailureCodes, issueMessages } from "../../../shared/contracts/generation.js";
// failureCopy が export されていない場合は、失敗レスポンスの message を issueMessages と比較する既存テストの fixture を更新する
```

export しない方針なら、サービス内で message を組み立てる経路の fixture を新文言に更新し、次を契約テストに置く:

```ts
// generation.test.ts で issueMessages が正本であることの固定で足りる。
// service 側は message リテラルが残っていないことを実装時に目視 + fixture 更新で担保。
```

- [ ] **Step 5: Function テスト fixture を一括更新**

ホストで:

```bash
grep -rn "成功回数には含まれません\|別の上限\|10分間の通信試行\|今日は3回利用\|AIへの送信上限" netlify shared src --include='*.ts' --include='*.tsx'
```

ヒットしたテスト期待・fixture を新文言へ。

- [ ] **Step 6: GREEN**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/generation.test.ts
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/generation-service.test.ts
```

（後者パスが無ければ `_tests` 配下の該当ファイル。Step 5 の grep 結果に従う。）

- [ ] **Step 7: Commit**

```bash
git add shared/contracts/generation.ts shared/contracts/generation.test.ts netlify/functions/_shared/generation-service.ts
# 更新した fixture / 他テストも add
git commit -m "feat: 生成失敗メッセージを低リテラシー向けに簡素化し正本を統一"
```

---

### Task 2: 確認画面 `review-step` の表示簡素化

**Files:**
- Modify: `src/features/planner/components/review-step.tsx`
- Modify: `src/features/planner/components/planner-wizard.test.tsx`
- Modify: 他に review 文言を掴むテストがあれば同様

**Interfaces:**
- Consumes: `usageRemaining`, `attemptsRemaining`, `globalAvailable`, `shortWindowRetryAt`, `formatFreeTierQuotaCopy`
- Produces: 設計 §1 の表示条件（常時1行 / hide / バナー）

- [ ] **Step 1: テストを RED に更新**

`planner-wizard.test.tsx` 等:

```ts
// 常時
expect(screen.getByText("無料版は本日あと3回まで献立の作成を受け付けます")).toBeVisible();
expect(screen.queryByText(/AIへの問い合わせ/u)).not.toBeInTheDocument();

// attempts 0（success > 0）: 常時行なし + 受付停止
expect(screen.queryByText(/本日あと.*受け付けます/u)).not.toBeInTheDocument();
expect(
  screen.getByText("無料版は今日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。"),
).toBeVisible();

// success 0
expect(
  screen.getByText("無料版は本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。"),
).toBeVisible();

// global
expect(
  screen.getByText("ただいま混雑しています。明日0:00（日本時間）以降にお試しください。"),
).toBeVisible();
// 無料版は が global 文に付かないこと
```

旧「作成できます」「問い合わせ」「0時」期待を削除。

- [ ] **Step 2: RED**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/components/planner-wizard.test.tsx
```

- [ ] **Step 3: `review-step.tsx` 実装**

常時 success 行:

```tsx
const showSuccessRemaining =
  usageRemaining !== null && usageRemaining > 0 && attemptsRemaining !== 0;

// ...
{showSuccessRemaining ? (
  <p role="status">
    {formatFreeTierQuotaCopy(
      `本日あと${String(usageRemaining)}回まで献立の作成を受け付けます`,
    )}
  </p>
) : null}
// attempt 常時行は削除
```

バナー body（抜粋）:

```tsx
{usageRemaining === 0 && (
  <p className="usage-limit-banner-body">
    {formatFreeTierQuotaCopy(
      "本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。",
    )}
  </p>
)}
{attemptsRemaining === 0 && usageRemaining !== 0 && (
  <p className="usage-limit-banner-body">
    {formatFreeTierQuotaCopy(
      "今日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。",
    )}
  </p>
)}
{globalAvailable === false && (
  <p className="usage-limit-banner-body">
    ただいま混雑しています。明日0:00（日本時間）以降にお試しください。
  </p>
)}
// shortWindow: 既存の日時付き平易文を維持（0:00 統一は日次文のみ。短時間は日時フォーマット維持）
```

コメントを設計参照に更新（§10.3 dual 常時は supersede 済みと明記）。

- [ ] **Step 4: GREEN**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/components/planner-wizard.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 確認画面の利用回数表示を1数字と行動文に簡素化"
```

---

### Task 3: 再生成シート案 A

**Files:**
- Modify: `src/features/history/components/regeneration-sheet.tsx`
- Modify: `src/features/history/components/regeneration-sheet.test.tsx`

**Interfaces:**
- Consumes: `RegenerationUsageView`（`successRemaining`, `attemptsRemaining`, `shortWindowRemaining`, `shortWindowRetryAt`）
- Produces: attempt 常時行なし; attempts0 / shortWindow で disabled + 1文

- [ ] **Step 1: テスト RED**

```ts
it("disables submit when attempts remaining is zero", () => {
  render(
    <RegenerationSheet
      targetMode="idea"
      usage={{
        successRemaining: 3,
        attemptsRemaining: 0,
        shortWindowRemaining: 4,
        shortWindowRetryAt: null,
        loading: false,
        error: false,
      }}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(
    screen.getByText(
      "無料版は今日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。",
    ),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "別案を作る" })).toBeDisabled();
  expect(screen.queryByText(/AIへの問い合わせ/u)).not.toBeInTheDocument();
});

it("disables submit when short window is blocked", () => {
  // shortWindowRemaining === 0 && shortWindowRetryAt 非 null
  // 待ち文可視 + 別案を作る disabled
});
```

既存の attempt 常時行期待があれば削除。success 文は据え置き（`別の献立が完成した場合に1回使用・現在残りN回`）。

- [ ] **Step 2: RED**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/history/components/regeneration-sheet.test.tsx
```

- [ ] **Step 3: 実装**

```tsx
const successBlocked = usage.successRemaining === 0;
const attemptsBlocked = usage.attemptsRemaining === 0;
const shortWindowBlocked =
  usage.shortWindowRemaining === 0 && usage.shortWindowRetryAt !== null;

const submitDisabled =
  form.formState.isSubmitting ||
  !actionsEnabled ||
  usage.loading ||
  usage.error ||
  successBlocked ||
  attemptsBlocked ||
  shortWindowBlocked ||
  expiredUnconfirmed;
```

表示ブロック（loading/error 以外）:

```tsx
{/* success 文は既存 */}
{/* attempt 常時行は削除 */}
{successBlocked && (
  <p className="type-small" role="status">
    {formatFreeTierQuotaCopy(
      "本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。",
    )}
  </p>
)}
{attemptsBlocked && !successBlocked && (
  <p className="type-small" role="status">
    {formatFreeTierQuotaCopy(
      "今日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。",
    )}
  </p>
)}
{shortWindowBlocked && (
  <p className="type-small" role="status">
    {formatFreeTierQuotaCopy(
      `しばらく続けて作成を試したため、${new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(usage.shortWindowRetryAt!))}以降に再試行してください`,
    )}
  </p>
)}
```

- [ ] **Step 4: GREEN + Commit**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/history/components/regeneration-sheet.test.tsx
git commit -m "feat: 再生成シートでも受付不能を事前に止め利用回数表示を簡素化"
```

---

### Task 4: 生成ステータスパネルと freemium 設計注記

**Files:**
- Modify: `src/features/generation/components/generation-status-panel.tsx`
- Modify: `src/features/generation/components/generation-status-panel.test.tsx`
- Modify: `src/features/generation/pages/generation-page.test.tsx`（旧 message / AI通信試行）
- Modify: `docs/superpowers/specs/2026-07-28-season-freemium-quota-design.md`（§2.1 冒頭に superseded）

**Interfaces:**
- Consumes: Task 1 の `issueMessages`（failure 表示は code ラップ継続）、`useUsageToday`
- Produces: dual 残数なし、未減1行、retryAt 表示維持

- [ ] **Step 1: テスト RED**

```ts
// TerminalGenerationUsage
expect(screen.getByText("無料版は本日あと2回まで献立の作成を受け付けます")).toBeVisible();
expect(screen.queryByText(/AI通信試行/u)).not.toBeInTheDocument();
expect(screen.queryByText(/10分間の通信試行/u)).not.toBeInTheDocument();

// !consumed
expect(screen.getByText("献立は完成していないので、作成回数は減っていません")).toBeVisible();
expect(screen.queryByText("成功回数には含まれません")).not.toBeInTheDocument();

// usage fetch error
expect(screen.getByText("本日の作成回数を確認できません。再読み込みしてください")).toBeVisible();
```

- [ ] **Step 2: RED**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/components/generation-status-panel.test.tsx
```

- [ ] **Step 3: `TerminalGenerationUsage` と failed/conflict を実装**

```tsx
function TerminalGenerationUsage({ userId }: { userId: string }) {
  const usage = useUsageToday(userId);
  if (usage.isPending) return <p role="status">最新の利用状況を確認しています</p>;
  if (!usage.isSuccess) {
    return <p role="alert">本日の作成回数を確認できません。再読み込みしてください</p>;
  }
  const data = usage.data;
  return (
    <section aria-label="今日あと何回作れるか">
      <p>
        {formatFreeTierQuotaCopy(
          `本日あと${String(data.success.remaining)}回まで献立の作成を受け付けます`,
        )}
      </p>
      <p>アプリ全体：{data.globalAvailable ? "作成できます" : "今日はここまで"}</p>
      {data.shortWindow.retryAt === null ? null : (
        <p>
          {formatFreeTierQuotaCopy(
            `短い時間に何度も作成を試したため、${formatRetryAt(data.shortWindow.retryAt)}以降に再試行してください。`,
          )}
        </p>
      )}
      {data.retryAt === null ? null : <p>現在の受付再開：{formatRetryAt(data.retryAt)}</p>}
    </section>
  );
}
```

failed / constraint_conflict:

```tsx
{!state.data.quota.consumed && (
  <p>献立は完成していないので、作成回数は減っていません</p>
)}
// request-local fallback の success 行も受け付け口調に
```

quota failure_code の `formatFreeTierQuotaCopy(state.data.error.message)` は継続（message は Task 1 の新文。global / model はラップしない既存 Set を維持: `user_daily_limit` | `user_attempt_limit` | `user_short_window_limit` のみ）。

- [ ] **Step 4: freemium 設計に superseded 追記**

`2026-07-28-season-freemium-quota-design.md` の `#### 2.1 Allowlist` 直前:

```markdown
> **Superseded (表示 allowlist 本文):** 利用者向け残数・上限・失敗コピーの allowlist / 削除対象は
> `docs/superpowers/specs/2026-07-29-quota-copy-simplification-design.md` が正。
> 本節の旧表は歴史的記録。新規実装は 2026-07-29 設計に従う。
```

- [ ] **Step 5: GREEN 一式**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/components/generation-status-panel.test.tsx
docker compose run --rm --no-deps app npm test -- --run src/features/generation/pages/generation-page.test.tsx
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: 生成終端の利用回数表示を簡素化し無料版allowlistを後継設計へ"
```

---

### Task 5: 横断検証と禁止文字列の最終確認

**Files:** 変更なし（検証のみ）。漏れがあれば最小修正コミット。

- [ ] **Step 1: 旧文言の残留 grep**

```bash
grep -rn "AIへの問い合わせ\|AI通信試行\|成功回数には含まれません\|成功回数：本日\|別の上限\|10分間の通信試行\|今日は3回利用\|無料版は本日は" \
  src shared netlify --include='*.ts' --include='*.tsx'
```

Expected: ヒットなし（コメントで歴史言及する場合は設計ドキュメントのみ可。コード・テストは不可）。

- [ ] **Step 2: 焦点テスト再実行**

```bash
docker compose run --rm --no-deps app npm test -- --run \
  shared/contracts/generation.test.ts \
  src/features/planner/components/planner-wizard.test.tsx \
  src/features/history/components/regeneration-sheet.test.tsx \
  src/features/generation/components/generation-status-panel.test.tsx
```

- [ ] **Step 3: 必要なら `git diff --check` と修正コミット**

```bash
git diff --check
# 修正があれば
git commit -m "fix: 利用回数コピー簡素化の残留文言を除去"
```

---

## Spec coverage（self-review）

| 設計要求 | Task |
|----------|------|
| issueMessages 改訂 L3 | 1 |
| failureCopy ≡ issueMessages | 1 |
| 禁止部分文字列テスト | 1, 5 |
| 確認 常時1行・受け付け口調 | 2 |
| attempts0 `今日は`・success0・0:00 | 2 |
| success0∧attempts0 は success0 のみ | 2 |
| 常時行 hide（attempts===0） | 2 |
| global 明日0:00 | 2 |
| short/global のみでは success 行維持 | 2 |
| 再生成案 A disabled | 3 |
| attempt 常時行削除（再生成） | 3 |
| Terminal dual 削除・未減文・読込失敗 | 4 |
| retryAt UI | 4（shortWindow.retryAt / data.retryAt） |
| freemium superseded L10 | 4 |
| 枠ロジック非変更 | 全 Task で API/DB 非編集 |

## Placeholder scan

なし（文言・条件・コマンド固定）。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-29-quota-copy-simplification.md`.

**Two execution options:**

1. **Subagent-Driven（推奨）** — タスクごとに新規サブエージェント、タスク間レビュー  
2. **Inline Execution** — このセッションで executing-plans に従い逐次実装  

どちらで進めますか？
