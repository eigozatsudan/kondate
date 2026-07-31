# 対象外食事の明示と表示文言の明確化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 家族追加前に対象外事情の確認ダイアログを出し、フォームの親質問・3選択肢・説明を「このアプリで作れない事情」軸に揃えて誤解を防ぐ（enum/DB/生成拒否は不変）。

**Architecture:** `src/features/household/unsupported-diet-copy.ts` に全ユーザー向け文言を単一ソース化。schema・onboarding validate・settings/onboarding UI がそれを参照。追加操作は createDraft/start の前に modal 確認（削除確認と同型 a11y）。E2E は `confirmAddScopeNotice` ヘルパーで全経路を通す。

**Tech Stack:** React 19 / TypeScript strict / Vitest / RTL / Playwright / Zod

**仕様書:** `docs/superpowers/specs/2026-07-31-unsupported-diet-copy-clarity-design.md`（Approved r2）  
**敵対的レビュー:** `docs/superpowers/specs/2026-07-31-unsupported-diet-copy-clarity-adversarial-review.md`（I1–I7 / M1–M3 addressed）

## Global Constraints

- Node.js `>=24 <25`。Node/npm は `docker compose run --rm --no-deps app ...`。**コマンドを `&&` / `;` で連結しない**（AGENTS.md）。
- RED → GREEN → focused verify → 日本語 Conventional Commit。**1 Task = 1 単位**（CLAUDE.md）。
- UI・コメント・コミットは日本語。識別子・テスト名は英語。`any` / 未検査 cast 禁止。
- **enum / DB / medical-scope / 生成エラーキー / planner 拒否コピー変更禁止**（設計 §3 / §8.3）。
- 検証は `format:check`（`format` の write は使わない）。
- `git push` / PR / 本番 deploy / `--no-verify` 禁止。
- プレースホルダ禁止: `// ...`、「同様に」「流用」だけのステップを置かない。
- 旧文言ゼロ確認は **`src/features/household/**` のみ**（設計 §9）。`docs/**` と planner/generation 拒否文は意図的残置。
- タッチターゲット 44×44 CSS px。320px 横スクロールなし。

## Locked interfaces produced by this plan

| 名前 | 場所 | 契約 |
|------|------|------|
| `UNSUPPORTED_DIET_STATUS_LABEL` | `unsupported-diet-copy.ts` | 親質問全文（設計 §6） |
| `UNSUPPORTED_DIET_STATUS_HELP` | 同 | 親直下ヘルプ全文 |
| `UNSUPPORTED_DIET_KIND_LABELS` | 同 | `Record<UnsupportedDietKind, string>` 3キー |
| `UNSUPPORTED_DIET_KINDS_LEGEND` | 同 | `該当する事情` |
| `UNSUPPORTED_DIET_PRESENT_HELP` | 同 | present 時説明全文 |
| `UNSUPPORTED_DIET_UNCONFIRMED_HELP` | 同 | 未確認メッセージ全文 |
| `UNSUPPORTED_DIET_STATUS_REQUIRED` | 同 | status 未選択バリデーション |
| `UNSUPPORTED_DIET_KINDS_REQUIRED` | 同 | kinds 空バリデーション |
| `UNSUPPORTED_DIET_ONBOARDING_INTRO` | 同 | オンボーディング導入文 |
| `UNSUPPORTED_DIET_EMPTY_ADD_HELP` | 同 | settings 空状態ヘルプ |
| `ADD_SCOPE_NOTICE_*` | 同 | ダイアログ見出し・本文・箇条書き・補足・主/副ボタン |
| `confirmAddScopeNotice(page)` | `e2e/fixtures/household.ts` | dialog の「登録を続ける」をクリック |

### 確定文言（再導出禁止・設計 r2 と同一）

```ts
// unsupported-diet-copy.ts に置く値（文字列リテラルはこれ以外にしない）
export const UNSUPPORTED_DIET_STATUS_LABEL =
  "離乳食・飲み込みの不安・治療食など、このアプリで献立を作れない事情はありますか";
export const UNSUPPORTED_DIET_STATUS_HELP =
  "アレルギーや苦手なものは別の項目です。ここでは上の3つだけを答えます。";
export const UNSUPPORTED_DIET_KIND_LABELS = {
  weaning_food: "離乳食が必要",
  swallowing_concern: "飲み込み・むせに不安がある",
  therapeutic_diet: "医師等から治療食の指示がある",
} as const satisfies Record<UnsupportedDietKind, string>;
export const UNSUPPORTED_DIET_KINDS_LEGEND = "該当する事情";
export const UNSUPPORTED_DIET_PRESENT_HELP =
  "選んだ場合、このメンバー向けの通常の献立は作れません。対象から外すか、専門職の指示に従ってください。治療食の指示内容はここでは入力できません（このアプリでは作れないためです）。";
export const UNSUPPORTED_DIET_UNCONFIRMED_HELP =
  "作れない事情を確認するまで、このメンバーは献立生成に使えません。";
export const UNSUPPORTED_DIET_STATUS_REQUIRED = "作れない事情があるか選んでください";
export const UNSUPPORTED_DIET_KINDS_REQUIRED = "該当する事情を選んでください";
export const UNSUPPORTED_DIET_ONBOARDING_INTRO =
  "年齢のめやす、アレルギー、作れない事情の3項目から始めます。";
export const UNSUPPORTED_DIET_EMPTY_ADD_HELP =
  "「家族を追加」を押すと、登録の前に確認が表示されます。続けたあと、1人目の入力が始まります。呼び名・年齢・アレルギーなどを順に入れられます。";

export const ADD_SCOPE_NOTICE_TITLE = "登録の前に";
export const ADD_SCOPE_NOTICE_BODY =
  "当てはまる方がいる場合、その方個人向けのメニューには対応していません。他の家族向けの献立はこれまでどおり作れます。";
export const ADD_SCOPE_NOTICE_ITEMS = [
  "離乳食が必要",
  "飲み込み・むせに不安がある",
  "医師等から治療食の指示がある",
] as const;
export const ADD_SCOPE_NOTICE_FOOTNOTE =
  "それでも登録する場合は、「この人には献立を作らない」という明示として名簿に残せます。通常の献立の対象にはなりません。専門職の指示に従ってください。";
export const ADD_SCOPE_NOTICE_CONTINUE = "登録を続ける";
export const ADD_SCOPE_NOTICE_CANCEL = "やめる";
```

## File Structure

| ファイル | 責務 |
|----------|------|
| `src/features/household/unsupported-diet-copy.ts` | 全ユーザー向け文言の単一ソース |
| `src/features/household/unsupported-diet-copy.test.ts` | 設計文字列の固定テスト |
| `household-settings-schema.ts` | Zod メッセージを共有定数参照 |
| `household-settings-page.tsx` | フォーム文言 + 追加前ダイアログ + 空状態ヘルプ |
| `household-onboarding-page.tsx` | フォーム文言 + 追加前ダイアログ + ローカル validate |
| `household-settings-page.test.tsx` / `household-onboarding-page.test.tsx` | 文言・ダイアログ・非表示経路 |
| `e2e/fixtures/household.ts` | `confirmAddScopeNotice` |
| `e2e/fixtures/auth.ts` / `history.ts` | 追加フローにヘルパー挿入 |
| `e2e/specs/onboarding.spec.ts` / `settings.spec.ts` / `menu-domain-pantry.spec.ts` | 同上 |
| 触らない | `shared/contracts/domain.ts`, `medical-scope.ts`, planner 拒否文, DB |

---

### Task 1: 共有文言モジュール + schema メッセージ

**Files:**
- Create: `src/features/household/unsupported-diet-copy.ts`
- Create: `src/features/household/unsupported-diet-copy.test.ts`
- Modify: `src/features/household/household-settings-schema.ts`

**Interfaces:**
- Consumes: `UnsupportedDietKind` from `@shared/contracts/domain`
- Produces: Locked interfaces 表の全 export（上記リテラル）

- [ ] **Step 1: 失敗するテストを書く**

Create `src/features/household/unsupported-diet-copy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { unsupportedDietKinds } from "@shared/contracts/domain";
import {
  ADD_SCOPE_NOTICE_BODY,
  ADD_SCOPE_NOTICE_CANCEL,
  ADD_SCOPE_NOTICE_CONTINUE,
  ADD_SCOPE_NOTICE_FOOTNOTE,
  ADD_SCOPE_NOTICE_ITEMS,
  ADD_SCOPE_NOTICE_TITLE,
  UNSUPPORTED_DIET_EMPTY_ADD_HELP,
  UNSUPPORTED_DIET_KIND_LABELS,
  UNSUPPORTED_DIET_KINDS_LEGEND,
  UNSUPPORTED_DIET_KINDS_REQUIRED,
  UNSUPPORTED_DIET_ONBOARDING_INTRO,
  UNSUPPORTED_DIET_PRESENT_HELP,
  UNSUPPORTED_DIET_STATUS_HELP,
  UNSUPPORTED_DIET_STATUS_LABEL,
  UNSUPPORTED_DIET_STATUS_REQUIRED,
  UNSUPPORTED_DIET_UNCONFIRMED_HELP,
} from "./unsupported-diet-copy";
import { householdSettingsSchema } from "./household-settings-schema";

describe("unsupported-diet-copy", () => {
  it("exposes design-locked status and kind labels", () => {
    expect(UNSUPPORTED_DIET_STATUS_LABEL).toBe(
      "離乳食・飲み込みの不安・治療食など、このアプリで献立を作れない事情はありますか",
    );
    expect(UNSUPPORTED_DIET_STATUS_HELP).toContain("アレルギーや苦手");
    expect(UNSUPPORTED_DIET_KIND_LABELS.weaning_food).toBe("離乳食が必要");
    expect(UNSUPPORTED_DIET_KIND_LABELS.swallowing_concern).toBe(
      "飲み込み・むせに不安がある",
    );
    expect(UNSUPPORTED_DIET_KIND_LABELS.therapeutic_diet).toBe(
      "医師等から治療食の指示がある",
    );
    expect(Object.keys(UNSUPPORTED_DIET_KIND_LABELS).sort()).toEqual(
      [...unsupportedDietKinds].sort(),
    );
    expect(UNSUPPORTED_DIET_KINDS_LEGEND).toBe("該当する事情");
    expect(UNSUPPORTED_DIET_PRESENT_HELP).toContain("治療食の指示内容はここでは入力できません");
    expect(UNSUPPORTED_DIET_UNCONFIRMED_HELP).toContain("作れない事情を確認するまで");
    expect(UNSUPPORTED_DIET_STATUS_REQUIRED).toBe("作れない事情があるか選んでください");
    expect(UNSUPPORTED_DIET_KINDS_REQUIRED).toBe("該当する事情を選んでください");
    expect(UNSUPPORTED_DIET_ONBOARDING_INTRO).toContain("作れない事情の3項目");
    expect(UNSUPPORTED_DIET_EMPTY_ADD_HELP).toContain("登録の前に確認が表示されます");
  });

  it("exposes design-locked add-scope notice copy", () => {
    expect(ADD_SCOPE_NOTICE_TITLE).toBe("登録の前に");
    expect(ADD_SCOPE_NOTICE_BODY).toContain("その方個人向け");
    expect(ADD_SCOPE_NOTICE_BODY).toContain("他の家族向け");
    expect(ADD_SCOPE_NOTICE_ITEMS).toEqual([
      "離乳食が必要",
      "飲み込み・むせに不安がある",
      "医師等から治療食の指示がある",
    ]);
    expect(ADD_SCOPE_NOTICE_FOOTNOTE).toContain("この人には献立を作らない");
    expect(ADD_SCOPE_NOTICE_CONTINUE).toBe("登録を続ける");
    expect(ADD_SCOPE_NOTICE_CANCEL).toBe("やめる");
  });

  it("schema validation messages use shared copy constants", () => {
    const missingStatus = householdSettingsSchema.safeParse({
      displayName: null,
      ageBand: "adult",
      allergyStatus: "none",
      // unsupportedDietStatus omitted → invalid
      unsupportedDietKinds: [],
      requiredSafetyConstraints: [],
      portionSize: "normal",
      spiceLevel: "normal",
      easePreferences: [],
    });
    expect(missingStatus.success).toBe(false);
    if (!missingStatus.success) {
      const messages = missingStatus.error.issues.map((i) => i.message);
      expect(messages).toContain(UNSUPPORTED_DIET_STATUS_REQUIRED);
    }

    const presentEmptyKinds = householdSettingsSchema.safeParse({
      displayName: null,
      ageBand: "adult",
      allergyStatus: "none",
      unsupportedDietStatus: "present",
      unsupportedDietKinds: [],
      requiredSafetyConstraints: [],
      portionSize: "normal",
      spiceLevel: "normal",
      easePreferences: [],
    });
    expect(presentEmptyKinds.success).toBe(false);
    if (!presentEmptyKinds.success) {
      const messages = presentEmptyKinds.error.issues.map((i) => i.message);
      expect(messages).toContain(UNSUPPORTED_DIET_KINDS_REQUIRED);
    }
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run src/features/household/unsupported-diet-copy.test.ts
```

Expected: FAIL（module missing または schema が旧メッセージ）

- [ ] **Step 3: 最小実装**

Create `src/features/household/unsupported-diet-copy.ts` with the Locked リテラルブロック above（`import type { UnsupportedDietKind } from "@shared/contracts/domain"`）。

Modify `household-settings-schema.ts`:

```ts
import {
  UNSUPPORTED_DIET_KINDS_REQUIRED,
  UNSUPPORTED_DIET_STATUS_REQUIRED,
} from "./unsupported-diet-copy";

// z.enum の第2引数:
unsupportedDietStatus: z.enum(unsupportedDietStatuses, UNSUPPORTED_DIET_STATUS_REQUIRED),

// superRefine present && kinds.length === 0:
message: UNSUPPORTED_DIET_KINDS_REQUIRED,
```

`superRefine` の「対象外状態と項目を確認してください」は **据え置き**（設計 §6）。

- [ ] **Step 4: テストを実行し成功を確認**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run src/features/household/unsupported-diet-copy.test.ts
```

Expected: PASS

- [ ] **Step 5: typecheck / format:check（スコープ）**

Run（連結しない）:

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

- [ ] **Step 6: Commit**

```bash
git add src/features/household/unsupported-diet-copy.ts src/features/household/unsupported-diet-copy.test.ts src/features/household/household-settings-schema.ts
git commit -m "$(cat <<'EOF'
feat: 対象外食事の表示文言を共有定数に集約する

親質問・kind・ダイアログ・バリデーション短文を単一ソース化し、
schema の Zod メッセージも同定数を参照する。
EOF
)"
```

---

### Task 2: 家族設定 — 追加前ダイアログ + フォーム文言

**Files:**
- Modify: `src/features/household/household-settings-page.tsx`
- Modify: `src/features/household/household-settings-page.test.tsx`

**Interfaces:**
- Consumes: Task 1 の全 copy export
- Produces: settings で追加前 `role=dialog`（設計 §5.3）。`requestCreateDraft` は dialog OK 後のみ

#### 実装契約（settings）

1. state: `addScopeNoticeOpen: boolean`、`addScopeTriggerRef: RefObject<HTMLButtonElement | null>`
2. 「家族を追加」クリック: `createDraft` を呼ばず `addScopeNoticeOpen = true`、押した button を trigger に記録
3. Dialog markup（削除確認と同系統の backdrop/panel）:
   - `role="dialog"` `aria-modal="true"` `aria-labelledby` → 可視 `h2` id（見出し `ADD_SCOPE_NOTICE_TITLE`）
   - 本文 `ADD_SCOPE_NOTICE_BODY`
   - `ul` > `li` for `ADD_SCOPE_NOTICE_ITEMS`
   - 補足 `ADD_SCOPE_NOTICE_FOOTNOTE`
   - 主ボタン `ADD_SCOPE_NOTICE_CONTINUE` → close + 既存 `requestCreateDraft()`
   - 副ボタン `ADD_SCOPE_NOTICE_CANCEL` → close only
4. Escape: open 中に keydown Escape で close（creating 中は createDraft の existing ref で二重防止）。backdrop click では閉じない
5. open 時: 主ボタンへ focus。close 時: trigger へ focus
6. フォーム: 親 label/aria を `UNSUPPORTED_DIET_STATUS_LABEL`、直下に help、legend/kind labels/present help、空状態ヘルプを定数化
7. ローカル `unsupportedDietKindLabels` 定義を削除し定数を import

- [ ] **Step 1: 失敗するテストを更新・追加**

`household-settings-page.test.tsx` で次を行う（既存 it を新文言・ダイアログ経路に直す）:

**A. 既存の「家族を追加」直後に `createDraft` を期待する it をすべて次の形に変更:**

```ts
await userEvent.click(await screen.findByRole("button", { name: /^家族を追加$/u }));
expect(createDraft).not.toHaveBeenCalled();
await userEvent.click(screen.getByRole("button", { name: "登録を続ける" }));
await waitFor(() => {
  expect(createDraft).toHaveBeenCalledTimes(1);
});
```

対象（少なくとも）: `does not start completion while creating another draft`、`still completes the original member after createDraft fails`、createDraft 成功でフォームが開く系、`createDraft` を呼ぶ全 it。

**B. 新規 it を追加:**

```ts
it("shows add-scope notice before createDraft and cancel does not create", async () => {
  const createDraft = vi.fn().mockResolvedValue({
    /* 既存 draft factory と同じ shape を使う */
  });
  await renderSettings({ createDraft }, { startClosed: true });
  await userEvent.click(await screen.findByRole("button", { name: /^家族を追加$/u }));
  const dialog = screen.getByRole("dialog", { name: "登録の前に" });
  expect(dialog).toBeVisible();
  expect(dialog).toHaveTextContent("その方個人向け");
  expect(dialog).toHaveTextContent("他の家族向け");
  expect(createDraft).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "やめる" }));
  expect(screen.queryByRole("dialog", { name: "登録の前に" })).not.toBeInTheDocument();
  expect(createDraft).not.toHaveBeenCalled();
});

it("does not open add-scope notice when editing an existing member", async () => {
  await renderSettings(); // 既存 complete メンバーが開く/編集できる前提の既存 helper
  expect(screen.queryByRole("dialog", { name: "登録の前に" })).not.toBeInTheDocument();
  // 編集領域が表示されていること（既存 assert を再利用）
});
```

**C. 文言系 it を新ラベルへ:**

```ts
// getByLabelText("食べない食事はありますか") →
// getByLabelText(/このアプリで献立を作れない事情はありますか/)
// checkbox name: "離乳食" → "離乳食が必要"
// getByText kinds: 新3ラベル
// 空状態: UNSUPPORTED_DIET_EMPTY_ADD_HELP の一部
// present 選択後: UNSUPPORTED_DIET_PRESENT_HELP の一部
```

実装時はファイル内の旧文字列を検索し、settings テスト内の `食べない食事` / 旧 kind ラベルをすべて置換する。

- [ ] **Step 2: テストを実行し失敗を確認**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run src/features/household/household-settings-page.test.tsx
```

Expected: ダイアログ未実装・旧文言で FAIL

- [ ] **Step 3: 最小実装**

`household-settings-page.tsx`:

1. import copy constants
2. 削除したローカル kind map を `UNSUPPORTED_DIET_KIND_LABELS` に置換
3. 親 select の label / 空状態 p / present fieldset legend+help を定数化
4. 親の直下に `UNSUPPORTED_DIET_STATUS_HELP` を `p.type-small` 等で常時表示
5. dialog state + Escape effect（削除確認の keydown パターンを流用。`deleteTarget` と干渉しないよう `addScopeNoticeOpen` のときだけ）
6. 全 `requestCreateDraft()` 呼び出し元（空状態・一覧の「家族を追加」）を「open notice」に変更。OK だけが `requestCreateDraft()`

削除確認 dialog の既存挙動は変更しない。

- [ ] **Step 4: テストを実行し成功を確認**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run src/features/household/household-settings-page.test.tsx
```

Expected: PASS

- [ ] **Step 5: typecheck / lint スコープ**

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/features/household/household-settings-page.tsx src/features/household/household-settings-page.test.tsx
git commit -m "$(cat <<'EOF'
feat: 家族設定に追加前確認ダイアログと対象外文言を入れる

createDraft 前に対象外事情を示し、フォームの親質問・選択肢・
空状態ヘルプを設計 r2 の共有文言に揃える。
EOF
)"
```

---

### Task 3: オンボーディング — 追加前ダイアログ + フォーム文言 + ローカル validate

**Files:**
- Modify: `src/features/household/household-onboarding-page.tsx`
- Modify: `src/features/household/household-onboarding-page.test.tsx`

**Interfaces:**
- Consumes: Task 1 copy
- Produces: onboarding の startMutation 前 dialog。ローカル validate が `UNSUPPORTED_DIET_STATUS_REQUIRED` / `UNSUPPORTED_DIET_KINDS_REQUIRED` を使用

#### 実装契約（onboarding）

1. `unsupportedDietOptions` ローカル配列を削除し `UNSUPPORTED_DIET_KIND_LABELS` + `unsupportedDietKinds` から map
2. complete 前 validate:  
   `errors.unsupportedDietStatus = UNSUPPORTED_DIET_STATUS_REQUIRED`  
   `errors.unsupportedDietKinds = UNSUPPORTED_DIET_KINDS_REQUIRED`
3. 導入文・親 label/aria・help・legend・present help・unconfirmed help を定数化
4. 「家族設定を始める」「続けて家族を追加」: 直接 `startMutation.mutate()` せず dialog → OK で mutate
5. a11y は Task 2 と同契約（Escape / focus 復帰 / backdrop 非クローズ / single-flight via `startMutation.isPending`）
6. コメント内の「食べない食事」は新語に合わせてよい（ゲート対象外だが推奨）

- [ ] **Step 1: 失敗するテストを更新・追加**

`household-onboarding-page.test.tsx`:

1. 全 `getByLabelText("食べない食事はありますか")` → 新ラベル（部分一致 regex 可）
2. checkbox `離乳食` → `離乳食が必要`
3. `続けて家族を追加` で即 `createDraft` を期待する it（`adds another member from next-action...`）を dialog 経路に変更
4. 新規:

```ts
it("shows add-scope notice before starting onboarding and cancel does not create", async () => {
  const createDraft = vi.fn();
  // メンバー0・draftなしの初期画面を既存 helper で描画
  await user.click(screen.getByRole("button", { name: "家族設定を始める" }));
  expect(createDraft).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "登録の前に" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "やめる" }));
  expect(createDraft).not.toHaveBeenCalled();
});
```

5. present 保存で kinds が `weaning_food` のままである既存 assert は維持

- [ ] **Step 2: RED**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/household/household-onboarding-page.test.tsx
```

Expected: FAIL

- [ ] **Step 3: GREEN 実装**

Task 2 と同じ dialog 構造を onboarding に実装（コンポーネント抽出は任意。DRY なら `AddScopeNoticeDialog` を同ディレクトリに切ってよいが必須ではない。切る場合は Task 2 で抽出済みなら import するだけ）。

- [ ] **Step 4: PASS**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/household/household-onboarding-page.test.tsx
```

- [ ] **Step 5: household 全体 + 旧文言ゼロ確認**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/household/
```

```bash
# ホスト。src/features/household 内の旧ユーザー向け文言がテスト期待・本番に残っていないこと
grep -RIn --include='*.ts' --include='*.tsx' \
  -e '食べない食事はありますか' \
  -e '食べない食事があるか選んでください' \
  -e '食べない食事を確認するまで' \
  -e '飲み込み・むせの不安' \
  -e '医師等から指示された治療食' \
  src/features/household || true
```

Expected: ヒットなし（コメントのみなら設計上許容だが、可能なら新語へ）。

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

- [ ] **Step 6: Commit**

```bash
git add src/features/household/household-onboarding-page.tsx src/features/household/household-onboarding-page.test.tsx
# dialog 共通化した場合はそのファイルも
git commit -m "$(cat <<'EOF'
feat: オンボーディングに追加前確認と対象外文言を入れる

開始・続けて追加の前に対象外事情を示し、ローカル validate と
フォーム文言を共有定数に揃える。
EOF
)"
```

---

### Task 4: E2E ヘルパーと必須経路の追随

**Files:**
- Create: `e2e/fixtures/household.ts`
- Modify: `e2e/fixtures/auth.ts`
- Modify: `e2e/fixtures/history.ts`
- Modify: `e2e/specs/onboarding.spec.ts`
- Modify: `e2e/specs/settings.spec.ts`
- Modify: `e2e/specs/menu-domain-pantry.spec.ts`

**Interfaces:**
- Consumes: 本番ダイアログの主ボタン名 `登録を続ける`、親 label 新文言
- Produces: `confirmAddScopeNotice(page: Page): Promise<void>`

- [ ] **Step 1: ヘルパーを追加**

Create `e2e/fixtures/household.ts`:

```ts
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** 家族追加前の対象外事情ダイアログで「登録を続ける」を押す */
export async function confirmAddScopeNotice(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "登録の前に" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "登録を続ける" }).click();
  await expect(dialog).toHaveCount(0);
}
```

- [ ] **Step 2: 必須ファイルを更新**

`e2e/fixtures/auth.ts` — `completeMinimumOnboarding`:

```ts
await page.getByRole("button", { name: "家族設定を始める" }).click();
await confirmAddScopeNotice(page);
// ...
await page.getByLabel(/このアプリで献立を作れない事情はありますか/).selectOption("none");
```

`e2e/specs/onboarding.spec.ts`: 同様に「家族設定を始める」直後 + label 更新。

`e2e/specs/settings.spec.ts`:

```ts
await page.getByRole("button", { name: "家族を追加" }).click();
await confirmAddScopeNotice(page);
// label 更新
```

`e2e/specs/menu-domain-pantry.spec.ts`: 「家族を追加」直後 + label。

`e2e/fixtures/history.ts` — `openFirstMemberEditor`:

```ts
} else {
  await page.getByRole("button", { name: "家族を追加" }).click();
  await confirmAddScopeNotice(page);
}
```

- [ ] **Step 3: 静的確認（E2E 実行前）**

ホストで旧 label / 未追随追加を検索:

```bash
grep -RIn --include='*.ts' -e '食べない食事はありますか' e2e || true
```

Expected: ヒットなし。

- [ ] **Step 4: focused E2E（スタックが上がっている前提）**

人間または Verifier が実行:

```bash
./scripts/run-e2e.sh e2e/specs/onboarding.spec.ts e2e/specs/settings.spec.ts
```

Expected: PASS（または環境制約なら report に blocker を記録し、少なくとも fixture の静的追随を完了）。

`menu-domain-pantry` は時間がかかる場合、settings/onboarding を優先し、同一ヘルパー使用を静的確認で担保してもよい（ledger に明記）。

- [ ] **Step 5: Commit**

```bash
git add e2e/fixtures/household.ts e2e/fixtures/auth.ts e2e/fixtures/history.ts e2e/specs/onboarding.spec.ts e2e/specs/settings.spec.ts e2e/specs/menu-domain-pantry.spec.ts
git commit -m "$(cat <<'EOF'
test: 対象外食事ダイアログに E2E 追加経路を追随する

confirmAddScopeNotice を共通化し、onboarding/settings/history の
家族追加フローで登録を続けるを踏むようにする。
EOF
)"
```

---

## Plan self-review

| 設計要求 | Task |
|----------|------|
| 共有 copy 単一ソース | T1 |
| schema + onboarding validate 同一メッセージ | T1 + T3 |
| settings ダイアログ + フォーム + 空状態 | T2 |
| onboarding ダイアログ + フォーム | T3 |
| a11y Escape/focus/backdrop/single-flight | T2/T3 契約 |
| E2E 必須ファイル固定 | T4 |
| 旧文言ゼロ（household のみ） | T3 Step 5 + T4 Step 3 |
| enum/DB 不変 | Global Constraints |
| 親質問 3種別スコープ + ヘルプ | T1 リテラル |
| ダイアログ個人／他家族 | T1 リテラル |

Placeholder scan: なし（具体リテラル・ファイル・コマンド）。  
Type consistency: `UNSUPPORTED_DIET_*` / `ADD_SCOPE_NOTICE_*` / `confirmAddScopeNotice` を全 Task で同一名。

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-31-unsupported-diet-copy-clarity.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans checkpoints  

Which approach?
