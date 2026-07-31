# 利用回数コピー簡素化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 確認・再生成・生成終端と API `issueMessages` から dual 残数・運用用語を取り除き、低リテラシー向けの1数字＋行動文に揃える（設計 `2026-07-29-quota-copy-simplification-design.md`）。

**Architecture:** 枠の数値・DB・`usage/today` shape は触らない。利用者向け日本語だけを変える。message 文字列の正本は `shared/contracts/generation.ts` の `issueMessages`。Function の failure copy は `message: issueMessages[code]` を参照し、**全 failure code で一致を単体テストする**（export して検証可能にする）。UI は success 残の常時1行、blocker 時のトーン分け、再生成は確認と同じ事前 disable（案 A）。

**Tech Stack:** TypeScript strict、Vitest、React Testing Library、既存 `formatFreeTierQuotaCopy`、Docker 経由 `npm`（`docker compose run --rm --no-deps app …`）。

**Plan revision:** 敵対的レビュー `docs/archive/reviews/2026-07-29-quota-copy-simplification-plan-adversarial.md`（P-C1〜P-I11）を本版に反映済み。

## Global Constraints

- 設計正本: `docs/archive/superpowers/specs/2026-07-29-quota-copy-simplification-design.md`（Approved）。矛盾時は設計が MVP §10.3/§14 利用者表示を supersede。
- 再導出禁止ロック L1–L10。特に **L8 再生成案 A**、**L9 明日0:00**、**L10 freemium allowlist は本設計が正**。
- 利用者向け禁止部分文字列（**issueMessages の全 value** および **ユーザー向け UI リテラル**）: `成功回数` / `別の上限` / `AIへの送信` / `通信試行` / `問い合わせ` / `attempt`。
- コメント内の歴史的語は必須ゼロではない。**文字列リテラル・テスト期待・issueMessages** をゼロにする。
- attempts0 body は **`今日は…`**（`本日は` 禁止 → 「無料版は本日は」回避）。
- 個人枠制限説明のみ `formatFreeTierQuotaCopy`。global には付けない。
- 未消費時の「作成回数は減っていません」は **UI 1行のみ**（message 本文に埋め込まない）。
- `failureCopy[code].message === issueMessages[code]` を **全 `generationFailureCodes` で assert**。目視・「足りる」逃げ禁止。
- Node コマンドは Docker。**1 ツール呼び出し = 1 コマンド**（`&&` / `;` 連結禁止）。
- コミットは日本語 Conventional Commits。push / PR 作成禁止。

## File map

| ファイル | 役割 |
|----------|------|
| `shared/contracts/generation.ts` | `issueMessages` 本文改訂 |
| `shared/contracts/generation.test.ts` | 新文言 exact・禁止断片（全 issueMessages） |
| `netlify/functions/_shared/generation-service.ts` | `failureCopy` を `issueMessages` 参照 + **test 用 export** |
| `netlify/functions/_shared/generation-service.test.ts` | message 一致 assert + 旧 fixture 更新 |
| `netlify/functions/_tests/generation-status.test.ts` | 旧 message fixture |
| `netlify/functions/_tests/generate-menu.test.ts` | 旧 message fixture（grep ヒット時） |
| `src/features/planner/components/review-step.tsx` | 常時1行・hide・バナー |
| `src/features/planner/components/planner-wizard.test.tsx` | 確認 UI（success0∧attempts0 含む全置換） |
| `src/features/history/components/regeneration-sheet.tsx` | 案 A disabled + 文 |
| `src/features/history/components/regeneration-sheet.test.tsx` | attempts0 / shortWindow 全文 |
| `src/features/generation/components/generation-status-panel.tsx` | dual 削除・未減・retryAt・request-local |
| `src/features/generation/components/generation-status-panel.test.tsx` | 同上 |
| `src/features/generation/pages/generation-page.test.tsx` | fixture message |
| `shared/copy/free-tier.test.ts` | ヘルパ例文を受け付け口調へ + attempts0 接頭回帰（**必須**。Task 5 grep の false red 防止） |
| `docs/archive/superpowers/specs/2026-07-28-season-freemium-quota-design.md` | §2.1 superseded 注記 |
| `e2e/` | Task 5 grep 対象（ヒットしたら期待更新） |

**注:** `planner-route*.test.tsx` に利用者向け旧文言の固定が無ければ触らない。

---

### Task 1: `issueMessages` 改訂と `failureCopy` 単一ソース（一致 assert Must）

**Files:**
- Modify: `shared/contracts/generation.ts`
- Modify: `shared/contracts/generation.test.ts`
- Modify: `netlify/functions/_shared/generation-service.ts`
- Modify: `netlify/functions/_shared/generation-service.test.ts`
- Modify: `netlify/functions/_tests/generation-status.test.ts`
- Modify: その他 Step 5 grep ヒット

**Interfaces:**
- Consumes: `GenerationFailureCode`, `generationFailureCodes`, `issueMessages`
- Produces:
  - 設計表どおりの `issueMessages` 文字列
  - `export function getGenerationFailureCopy(code: GenerationFailureCode): { message: string; retryable: boolean }`（または同等の export。内部表の message は必ず `issueMessages[code]`）
  - 全 failure code で `getGenerationFailureCopy(code).message === issueMessages[code]`

- [ ] **Step 1: 契約テストを RED に更新**

`shared/contracts/generation.test.ts` に追加（既存 describe 内可）:

```ts
import { generationFailureCodes, generationIssueCodes, issueMessages } from "./generation.js";

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

it("keeps every issueMessages value free of operator jargon fragments", () => {
  for (const code of generationIssueCodes) {
    const text = issueMessages[code];
    for (const fragment of forbiddenUserCopyFragments) {
      expect({ code, fragment, text }).toEqual({
        code,
        fragment,
        text: expect.not.stringContaining(fragment),
      });
    }
  }
});
```

- [ ] **Step 2: RED（契約）**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/generation.test.ts
```

Expected: FAIL（旧 `今日は3回利用` / `別の上限` 等）

- [ ] **Step 3: `issueMessages` を設計表どおり更新**

`shared/contracts/generation.ts` の該当キーのみ:

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

- [ ] **Step 4: `failureCopy` を参照化し export**

`generation-service.ts`:

```ts
import {
  // existing…
  generationFailureCodes,
  issueMessages,
  type GenerationFailureCode,
} from "../../../shared/contracts/generation.js";

const failureRetryable: Record<GenerationFailureCode, boolean> = {
  consent_required: false,
  draft_not_found: false,
  invalid_request: false,
  generation_in_progress: true,
  user_daily_limit: false,
  user_attempt_limit: false,
  user_short_window_limit: false,
  global_daily_limit: false,
  // … 現行 failureCopy の retryable 値をすべて転記（true/false を変えない）
  model_unavailable: true,
  invalid_ai_response: true,
  generation_timeout: true,
  internal_error: true,
  duplicate_output: true,
  // … 残りも現行どおり
};

/** テストとサービス本体の正。message は必ず issueMessages 参照。 */
export function getGenerationFailureCopy(code: GenerationFailureCode): {
  message: string;
  retryable: boolean;
} {
  return {
    message: issueMessages[code],
    retryable: failureRetryable[code],
  };
}
```

呼び出し側の `failureCopy[code]` を `getGenerationFailureCopy(code)` に置換（または内部で同関数を使う薄い alias）。**message に文字列リテラルを残さない。**

`generation-service.test.ts` に Must:

```ts
import { generationFailureCodes, issueMessages } from "../../../shared/contracts/generation.js";
import { getGenerationFailureCopy } from "./generation-service.js";

it("uses issueMessages as the only failure message source", () => {
  for (const code of generationFailureCodes) {
    expect(getGenerationFailureCopy(code).message).toBe(issueMessages[code]);
  }
});
```

（`getGenerationFailureCopy` の import が循環・バンドル上つらい場合のみ、同ファイルから export した `failureCopy` オブジェクトを `message: issueMessages[code]` で組み立てて export し、同じ assert を書く。いずれにせよ **一致 assert は必須**。）

- [ ] **Step 5: 旧 message fixture を更新**

ホストで（1 コマンド）:

```bash
grep -rn "成功回数には含まれません\|別の上限\|10分間の通信試行\|今日は3回利用\|AIへの送信上限\|成功回数とは別" netlify shared src e2e --include='*.ts' --include='*.tsx'
```

既知: `netlify/functions/_shared/generation-service.test.ts`、`netlify/functions/_tests/generation-status.test.ts`。ヒットを新 `issueMessages` 文言へ。

- [ ] **Step 6: GREEN（契約 + service）**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/generation.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/generation-service.test.ts
```

（status / generate-menu を Step 5 で触ったらそれぞれ単独で再実行。）

- [ ] **Step 7: Commit**

```bash
git add shared/contracts/generation.ts shared/contracts/generation.test.ts netlify/functions/_shared/generation-service.ts netlify/functions/_shared/generation-service.test.ts
```

（fixture 更新ファイルも add）

```bash
git commit -m "feat: 生成失敗メッセージを低リテラシー向けに簡素化し正本を統一"
```

---

### Task 2: 確認画面 `review-step` の表示簡素化

**Files:**
- Modify: `src/features/planner/components/review-step.tsx`
- Modify: `src/features/planner/components/planner-wizard.test.tsx`
- Modify: `shared/copy/free-tier.test.ts`

**Interfaces:**
- Consumes: `usageRemaining`, `attemptsRemaining`（`null` は未取得）, `globalAvailable`, `shortWindowRetryAt`, `formatFreeTierQuotaCopy`
- Produces: 設計 §1 表示条件

**常時 success 行（確定）:**

```ts
const showSuccessRemaining =
  usageRemaining !== null && usageRemaining > 0 && attemptsRemaining !== 0;
// attemptsRemaining === null → 行は出してよい（誤停止しない）
// attemptsRemaining === 0 → 行を出さない
```

- [ ] **Step 1: `planner-wizard.test.tsx` を RED に全面更新**

必須の書き換え（タイトル・期待を設計に合わせる）:

1. **旧** `成功残と attempts 残が同時に 0 のとき両方の理由を 1 つの警告にまとめる`  
   **新** success0 ∧ attempts0 では **作成上限文のみ**（attempts0 文・問い合わせは **出ない**）:

```ts
it("success0 and attempts0 together show only the creation-limit body", () => {
  render(
    <Harness
      initialStep="review"
      initialDraft={reviewDraft}
      usageRemaining={0}
      attemptsRemaining={0}
    />,
  );
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  const limit = screen.getByRole("alert");
  expect(limit).toHaveTextContent("いまは新しい献立を作れません");
  expect(limit).toHaveTextContent(
    "無料版は本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。",
  );
  expect(limit).not.toHaveTextContent("受け付けられません");
  expect(limit).not.toHaveTextContent("問い合わせ");
});
```

2. attempts0 のみ（success>0）: 常時「受け付けます」行なし + 受付停止文 + CTA disabled。旧「AIへの問い合わせ回数が上限」削除。

```ts
expect(screen.queryByText(/本日あと.*受け付けます/u)).not.toBeInTheDocument();
expect(
  screen.getByText(
    "無料版は今日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。",
  ),
).toBeVisible();
```

3. success0 のみ: 作成上限文（`0:00`、旧「作成回数の上限」「0時」削除）。

4. 常時 success 3: `無料版は本日あと3回まで献立の作成を受け付けます`。`queryByText(/AIへの問い合わせ/)` null。

5. **shortWindow のみ**（success 3, attempts 5, retryAt あり）: CTA disabled + 待ち文 + **常時受け付け行が残る**:

```ts
expect(screen.getByText("無料版は本日あと3回まで献立の作成を受け付けます")).toBeVisible();
expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
expect(screen.getByRole("alert")).toHaveTextContent(/少し待つ必要があります/u);
```

6. **global のみ**（success 3, attempts 5, global false）: 常時受け付け行あり + 混雑文（**無料版は付きなし**）+ CTA disabled:

```ts
expect(screen.getByText("無料版は本日あと3回まで献立の作成を受け付けます")).toBeVisible();
expect(
  screen.getByText("ただいま混雑しています。明日0:00（日本時間）以降にお試しください。"),
).toBeVisible();
expect(
  screen.queryByText("無料版はただいま混雑しています。明日0:00（日本時間）以降にお試しください。"),
).not.toBeInTheDocument();
```

7. ファイル内の `0時` / `作成できます`（常時行）/ `問い合わせ` 期待を残さない（`grep` で当該ファイル確認）。

8. **`shared/copy/free-tier.test.ts` を必須更新**（R-I2/R-I3: Task 5 の `本日あと.*作成できます` grep が旧例文に false red しないようにする）:

```ts
it("prefixes 無料版は", () => {
  expect(formatFreeTierQuotaCopy("本日あと3回まで献立の作成を受け付けます")).toBe(
    "無料版は本日あと3回まで献立の作成を受け付けます",
  );
});

it("does not double-prefix", () => {
  expect(formatFreeTierQuotaCopy("無料版は本日あと1回まで献立の作成を受け付けます")).toBe(
    "無料版は本日あと1回まで献立の作成を受け付けます",
  );
});

it("attempts0 body does not become 無料版は本日は", () => {
  const body =
    "今日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。";
  const out = formatFreeTierQuotaCopy(body);
  expect(out).toBe(`無料版は${body}`);
  expect(out).not.toMatch(/無料版は本日は/u);
});
```

- [ ] **Step 2: RED**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/components/planner-wizard.test.tsx
```

```bash
docker compose run --rm --no-deps app npm test -- --run shared/copy/free-tier.test.ts
```

- [ ] **Step 3: `review-step.tsx` 実装**

```tsx
const showSuccessRemaining =
  usageRemaining !== null && usageRemaining > 0 && attemptsRemaining !== 0;

{showSuccessRemaining ? (
  <p role="status">
    {formatFreeTierQuotaCopy(
      `本日あと${String(usageRemaining)}回まで献立の作成を受け付けます`,
    )}
  </p>
) : null}
{/* attempt 常時行は置かない */}

{hasActiveUsageBlocker && (
  <div className="usage-limit-banner" role="alert">
    <strong className="usage-limit-banner-title">いまは新しい献立を作れません</strong>
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
    {shortWindowRetryAt !== null && (
      <p className="usage-limit-banner-body">
        {formatFreeTierQuotaCopy(
          `短い時間に何度も作成を試したため、少し待つ必要があります。${new Intl.DateTimeFormat(
            "ja-JP",
            { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" },
          ).format(new Date(shortWindowRetryAt))}以降に再試行してください。`,
        )}
      </p>
    )}
  </div>
)}
```

コメント: 設計 2026-07-29 が dual 常時残数を supersede。`hasActiveUsageBlocker` 判定ロジックは維持。

- [ ] **Step 4: GREEN**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/components/planner-wizard.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/features/planner/components/review-step.tsx src/features/planner/components/planner-wizard.test.tsx shared/copy/free-tier.test.ts
```

```bash
git commit -m "feat: 確認画面の利用回数表示を1数字と行動文に簡素化"
```

---

### Task 3: 再生成シート案 A

**Files:**
- Modify: `src/features/history/components/regeneration-sheet.tsx`
- Modify: `src/features/history/components/regeneration-sheet.test.tsx`

**Interfaces:**
- Consumes: `RegenerationUsageView`
- Produces: attempt 常時行なし; `attemptsRemaining === 0`（**null では止めない**）/ shortWindow ブロックで disabled + 1文

- [ ] **Step 1: テスト RED（全文・空 it 禁止）**

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
  expect(screen.getByText(/別の献立が完成した場合に1回使用・現在残り3回/u)).toBeVisible();
});

it("disables submit when short window is blocked", () => {
  render(
    <RegenerationSheet
      targetMode="idea"
      usage={{
        successRemaining: 3,
        attemptsRemaining: 5,
        shortWindowRemaining: 0,
        shortWindowRetryAt: "2026-07-25T05:10:00.000Z",
        loading: false,
        error: false,
      }}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "別案を作る" })).toBeDisabled();
  expect(screen.getByText(/しばらく続けて作成を試したため/u)).toBeVisible();
  expect(screen.getByText(/以降に再試行してください/u)).toBeVisible();
});

it("does not treat null attemptsRemaining as blocked", () => {
  render(
    <RegenerationSheet
      targetMode="idea"
      usage={{
        successRemaining: 3,
        attemptsRemaining: null,
        shortWindowRemaining: 4,
        shortWindowRetryAt: null,
        loading: false,
        error: false,
      }}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  // 理由未選択のため submit は押せる見た目だが、attempts 理由では止めない
  // disabled は form 理由不足ではなく attempts 以外 — 実装では attemptsBlocked false
  expect(screen.queryByText(/受け付けられません/u)).not.toBeInTheDocument();
});
```

既存 attempt 常時行期待があれば削除。success 説明文は据え置き。

- [ ] **Step 2: RED**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/history/components/regeneration-sheet.test.tsx
```

- [ ] **Step 3: 実装**

```tsx
const successBlocked = usage.successRemaining === 0;
// null は未取得。0 のときだけ止める（確認画面と同方針）
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

表示（loading/error 分岐の外、success 説明の下）:

```tsx
{successBlocked ? (
  <p className="type-small" role="status">
    {formatFreeTierQuotaCopy(
      "本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。",
    )}
  </p>
) : null}
{attemptsBlocked && !successBlocked ? (
  <p className="type-small" role="status">
    {formatFreeTierQuotaCopy(
      "今日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。",
    )}
  </p>
) : null}
{shortWindowBlocked && usage.shortWindowRetryAt !== null ? (
  <p className="type-small" role="status">
    {formatFreeTierQuotaCopy(
      `しばらく続けて作成を試したため、${new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(usage.shortWindowRetryAt))}以降に再試行してください`,
    )}
  </p>
) : null}
```

attempt 常時残数行は削除。`!` non-null assertion は `shortWindowRetryAt !== null` ガード後のみ。

- [ ] **Step 4: GREEN**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/history/components/regeneration-sheet.test.tsx
```

- [ ] **Step 5: Commit（test と commit を連結しない）**

```bash
git add src/features/history/components/regeneration-sheet.tsx src/features/history/components/regeneration-sheet.test.tsx
```

```bash
git commit -m "feat: 再生成シートでも受付不能を事前に止め利用回数表示を簡素化"
```

---

### Task 4: 生成ステータスパネルと freemium 設計注記

**Files:**
- Modify: `src/features/generation/components/generation-status-panel.tsx`
- Modify: `src/features/generation/components/generation-status-panel.test.tsx`
- Modify: `src/features/generation/pages/generation-page.test.tsx`
- Modify: `docs/archive/superpowers/specs/2026-07-28-season-freemium-quota-design.md`

**Interfaces:**
- Consumes: Task 1 messages、`useUsageToday`、`state.data.quota`
- Produces: dual 残数なし、未減1行、**retryAt Must**、request-local 受け付け口調

- [ ] **Step 1: テスト RED**

```ts
// TerminalGenerationUsage（userId あり）
expect(screen.getByText("無料版は本日あと2回まで献立の作成を受け付けます")).toBeVisible();
expect(screen.queryByText(/AI通信試行/u)).not.toBeInTheDocument();
expect(screen.queryByText(/10分間の通信試行/u)).not.toBeInTheDocument();

// !consumed
expect(screen.getByText("献立は完成していないので、作成回数は減っていません")).toBeVisible();
expect(screen.queryByText("成功回数には含まれません")).not.toBeInTheDocument();

// usage fetch error
expect(screen.getByText("本日の作成回数を確認できません。再読み込みしてください")).toBeVisible();

// request-local failed（userId なし）: 受け付け口調 + retryAt
// fixture: remaining 2, retryAt 非 null, consumed false
expect(screen.getByText("無料版は本日あと2回まで献立の作成を受け付けます")).toBeVisible();
expect(screen.getByText(/再開/u)).toBeVisible();

// userId あり + failed + quota.retryAt 非 null（R-I1 Must）:
// Terminal は data.retryAt を出さない。パネル直下の「再開: …」が必ず1つ見える。
// 既存 failed fixture に retryAt があるものを userId 付きで render し:
expect(screen.getByText(/再開/u)).toBeVisible();
// 同一文言の二重がないこと（getAllByText の length === 1 でも可）
```

既存 dual 残数・「成功回数：」期待を削除。

- [ ] **Step 2: RED**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/components/generation-status-panel.test.tsx
```

- [ ] **Step 3: 実装**

`TerminalGenerationUsage`:

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
      {/* data.retryAt は出さない。failed/conflict パネル直下の quota.retryAt に一本化（R-I1） */}
    </section>
  );
}
```

**failed / constraint_conflict 共通:**

```tsx
{!state.data.quota.consumed ? (
  <p>献立は完成していないので、作成回数は減っていません</p>
) : null}
{userId !== undefined ? (
  <TerminalGenerationUsage userId={userId} />
) : (
  <>
    <p>
      {formatFreeTierQuotaCopy(
        `本日あと${String(state.data.quota.remaining)}回まで献立の作成を受け付けます`,
      )}
    </p>
  </>
)}
{/* retryAt Must: Terminal の usage に依存せず、request-local でも quota.retryAt を出す */}
{state.data.quota.retryAt !== null ? (
  <p>再開: {formatJstRetryTime(state.data.quota.retryAt, new Date())}</p>
) : null}
```

（userId ありで Terminal が `data.retryAt` を出す場合、**二重表示を避ける**なら:  
`userId === undefined` のときだけ上記 retryAt 行、**または** Terminal 内と役割分担を「quota.retryAt はパネル直下に必ず1回」と決め、Terminal の `data.retryAt` 行と重複しないよう片方に寄せる。  
**規則（確定）:** `state.data.quota.retryAt != null` のときはパネル直下に **必ず1行**。Terminal 側の `data.retryAt` 行は出してもよいが、同一時刻の二重は避けるため **Terminal では `data.retryAt` 行を出さず shortWindow.retryAt と success/global のみ** とする。）

したがって Terminal は:

```tsx
// data.retryAt 行は出さない（パネル直下の quota.retryAt に一本化）
{data.shortWindow.retryAt === null ? null : ( /* 待ち文 */ )}
```

failed パネル:

```tsx
{state.data.quota.retryAt !== null ? (
  <p>再開: {formatJstRetryTime(state.data.quota.retryAt, new Date())}</p>
) : null}
```

quota failure_code ラップ Set は維持: `user_daily_limit` | `user_attempt_limit` | `user_short_window_limit` のみ `formatFreeTierQuotaCopy(message)`。

- [ ] **Step 4: freemium 設計 superseded**

`#### 2.1 Allowlist` 直前:

```markdown
> **Superseded (表示 allowlist 本文):** 利用者向け残数・上限・失敗コピーの allowlist / 削除対象は
> `docs/archive/superpowers/specs/2026-07-29-quota-copy-simplification-design.md` が正。
> 本節の旧表は歴史的記録。新規実装は 2026-07-29 設計に従う。
```

- [ ] **Step 5: GREEN**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/components/generation-status-panel.test.tsx
```

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/pages/generation-page.test.tsx
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

- [ ] **Step 6: Commit（UI と docs を同一コミットでよい。両方 add）**

```bash
git add src/features/generation/components/generation-status-panel.tsx src/features/generation/components/generation-status-panel.test.tsx src/features/generation/pages/generation-page.test.tsx docs/archive/superpowers/specs/2026-07-28-season-freemium-quota-design.md
```

```bash
git commit -m "feat: 生成終端の利用回数表示を簡素化し無料版allowlistを後継設計へ"
```

---

### Task 5: 横断検証

**Files:** 原則変更なし。grep ヒットがあれば最小修正コミット。

- [ ] **Step 1: 旧文言・旧口調の残留 grep（ユーザー向けリテラル）**

```bash
grep -rn "AIへの問い合わせ\|AI通信試行\|成功回数には含まれません\|成功回数：本日\|別の上限\|10分間の通信試行\|今日は3回利用\|無料版は本日は\|本日あと.*作成できます\|明日0時\|作成回数の上限\|問い合わせ回数が上限\|AIへの送信上限" src shared netlify e2e --include='*.ts' --include='*.tsx'
```

Expected: **ヒットなし**（テスト名・コメントのみの歴史言及は、ユーザー向け文字列でなければ可。迷ったらリテラルを消す）。

- [ ] **Step 2: 焦点テスト（ファイルごと・連結しない）**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/generation.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/generation-service.test.ts
```

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/components/planner-wizard.test.tsx
```

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/history/components/regeneration-sheet.test.tsx
```

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/generation/components/generation-status-panel.test.tsx
```

- [ ] **Step 3: diff check**

```bash
git diff --check
```

漏れ修正があれば:

```bash
git commit -m "fix: 利用回数コピー簡素化の残留文言を除去"
```

---

## Spec coverage（self-review）

| 設計要求 | Task | テストで固定するか |
|----------|------|-------------------|
| issueMessages 改訂 L3 | 1 | exact 表 |
| failureCopy ≡ issueMessages | 1 | **export + 全 code assert（P-C1）** |
| 禁止断片 issueMessages | 1 | 全 value |
| 確認 常時1行・受け付け口調 | 2 | yes |
| attempts0 `今日は`・常時行 hide | 2 | yes |
| success0∧attempts0 は success0 のみ | 2 | **既存 it 書き換え（P-C3）** |
| short のみ success 行維持 | 2 | **明示 it（P-I2）** |
| global のみ success 行 + 0:00・非接頭 | 2 | **明示 it（P-I2）** |
| 再生成案 A attempts0 | 3 | 全文 it |
| 再生成 shortWindow | 3 | **全文 it（P-C2）** |
| attempts null は止めない | 3 | 明示 it |
| Terminal dual 削除・未減・読込失敗 | 4 | yes |
| request-local 受け付け口調 | 4 | **JSX + テスト（P-I3）** |
| quota.retryAt パネル直下 Must | 4 | 規則 + **userId あり/なし双方の expect（R-I1）** |
| 無料版は本日は 禁止 | 2 | free-tier.test **必須**（R-I3） |
| free-tier 例文を受け付け口調へ | 2 | Task 5 grep false red 防止（R-I2） |
| freemium superseded L10 | 4 | 文書 |
| 横断 grep（0時・作成できます等） | 5 | **拡張リスト（P-C4）**。free-tier は Task 2 で更新済み前提 |
| e2e 文言 | 5 | grep 対象に含む |
| 枠ロジック非変更 | 全 | API/DB 非編集 |
| コマンド非連結 | 全 | Step 分離（P-I1） |

## Placeholder scan

- 空の `it(...)` 本文なし（P-C2 解消）。
- 「目視で足りる」「必要なら」による Must 逃げなし（P-C1 解消）。
- request-local / retryAt はコード規則まで記載（P-I3/I4）。

## Adversarial plan findings 反映

| ID | 反映 |
|----|------|
| P-C1 | `getGenerationFailureCopy` export + 全 code assert |
| P-C2 | short-window 再生成テスト全文 |
| P-C3 | wizard 両文 it → success0 のみ |
| P-C4 | Task 5 grep 拡張・コメント緩和 |
| P-I1 | Task 3 commit 分離 |
| P-I2 | short/global success 行 it |
| P-I3 | request-local JSX |
| P-I4 | quota.retryAt パネル直下一本化 + userId あり expect |
| P-I5 | File map に既知 fixture パス |
| P-I6 | free-tier 接頭回帰を Task 2 **必須**（例文も受け付け口調へ） |
| P-I7 | null attempts 明示 it |
| P-I8 | 複数ファイル vitest を分割実行 |
| P-I9 | e2e を grep 対象 |
| P-I10 | docs を commit add に明記 |
| P-I11 | coverage / placeholder 自己レビューを事実に合わせて更新 |
| R-I1（再レビュー） | Task 4: userId あり retryAt expect + Terminal から data.retryAt 削除 |
| R-I2（再レビュー） | free-tier.test 例文更新を Task 2 必須化 |
| R-I3（再レビュー） | `無料版は本日は` 禁止 unit を必須化 |
