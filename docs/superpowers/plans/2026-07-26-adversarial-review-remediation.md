# 敵対的レビュー指摘 Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/bugfix/2026-07-26-adversarial-review-findings.md` の Critical 全件と、推奨着手順の Important を設計に沿って修正し、誤挙動を固定しているテストを書き換える。

**Architecture:** 安全性（照合・表示）→ 認証導線 → プランナー袋小路 → 買い物リスト回復不能 → 生成パイプライン ops の順。A-C1 と A-I1 は同一照合器をセットで直す。locked 値（5/12/4/600s/45/20s/50s 等）は変更しない。

**Tech Stack:** React 19 / Vite 8 / TypeScript strict / Vitest / Supabase SQL migrations / Netlify Functions

**Workspace:** `/home/dev/projects/kondate/.worktrees/fix-adversarial-2026-07-26` only（`.worktrees/` 他は編集禁止）

## Global Constraints

- Node `>=24 <25`, ESM, TypeScript `strict: true`, no `any` at network/DB boundaries
- All user-facing copy is Japanese; code comments and commit messages in Japanese
- Mobile-first 320px, 44×44 touch targets
- Never log/persist free-form PII beyond design-allowed snapshots
- Do not change locked quota/origin/TTL values
- Docker for Node commands: `docker compose run --rm --no-deps app …`
- TDD: RED → verify fail → GREEN → verify pass → commit
- Conventional Commits in Japanese
- No `git push`, no PR, no `--no-verify`

## Human decisions applied (findings 推奨値)

| ID | Decision |
|---|---|
| A-C1 | kana fold + alias 追加（玉子/ミルク/小麦加工品/サーモン等）。辞書 version は `jp-caa-2026-04.v1` のまま INSERT |
| A-I1 | 短 alias に語境界（ひらがな連続中の 2 文字部分一致を拒否 + 既知除外 豆乳/鶏もも） |
| A-I11 | body cap **1MiB** |
| A-I12 | `safetyTags.max(32)` |
| A-I7 | soft gap（設計どおり non-blocking）— Wave 2 |
| B-I5 | 裸 `/` は RootEntry へ（sanitize が `/` を許可） |
| B-I2 | 本 wave では据え置き（仕様厳格化は人間確認残） |
| E-U1 | 未確認のまま据え置き |

---

### Task 1: A-C1 + A-I1 アレルゲン照合（kana fold・alias・語境界）

**Files:**
- Modify: `shared/safety/allergens.ts`
- Modify: `shared/safety/allergens.test.ts`
- Modify: `netlify/functions/_shared/current-safety.ts` (`additionalAliasValues`)
- Create: `supabase/migrations/20260726200000_allergen_alias_coverage.sql`
- Test: `shared/safety/allergens.test.ts`, `netlify/functions/_shared/current-safety.test.ts`（manifest 経由で自動追随）

**Interfaces:**
- Produces: `normalizeFoodText` with katakana→hiragana fold; `foodTextContainsAlias(source, alias)` used by `evaluateAllergens`

- [ ] **Step 1: RED — failing tests for fold / 玉子 / ミルク / false positives**

`shared/safety/allergens.test.ts` に追加:

```ts
import { foodTextContainsAlias, normalizeFoodText, evaluateAllergens } from "./allergens.js";

describe("normalizeFoodText", () => {
  it("folds katakana to hiragana", () => {
    expect(normalizeFoodText("サーモン")).toBe(normalizeFoodText("さーもん"));
    expect(normalizeFoodText("タマゴ")).toBe(normalizeFoodText("たまご"));
  });
});

describe("foodTextContainsAlias", () => {
  it("detects 玉子 for egg alias たまご after fold", () => {
    // 玉子 is kanji — alias list includes 玉子; fold alone is insufficient
    expect(foodTextContainsAlias("玉子焼き", "玉子")).toBe(true);
  });
  it("detects ミルク for milk", () => {
    expect(foodTextContainsAlias("ミルクティー", "ミルク")).toBe(true);
  });
  it("does not match 乳 inside 豆乳", () => {
    expect(foodTextContainsAlias("豆乳スープ", "乳")).toBe(false);
  });
  it("does not match もも inside 鶏もも肉", () => {
    expect(foodTextContainsAlias("鶏もも肉のソテー", "もも")).toBe(false);
  });
  it("does not match かに mid-hiragana phrase", () => {
    expect(foodTextContainsAlias("やわらかになるまで煮る", "かに")).toBe(false);
  });
  it("does not match そば as location particle", () => {
    expect(foodTextContainsAlias("コンロのそばで冷ます", "そば")).toBe(false);
  });
  it("matches real buckwheat dish after kana fold", () => {
    expect(foodTextContainsAlias("ざるソバ", "そば")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/safety/allergens.test.ts
```

- [ ] **Step 3: GREEN — implement normalize + contains + aliases**

`shared/safety/allergens.ts`:

```ts
/** カタカナ（ァ-ヶ）を対応するひらがなへ折り畳む。濁点付きも含む。 */
function foldKatakanaToHiragana(value: string): string {
  return value.replace(/[\u30a1-\u30f6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  );
}

export function normalizeFoodText(value: string): string {
  return foldKatakanaToHiragana(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/\p{Cf}/gu, "")
    .replace(/[\s\u3000、。・,./（）()「」『』]/gu, "");
}

const HIRAGANA = /[\u3041-\u3096]/u;

/**
 * アレルゲン alias 照合。正規化後の部分一致を基本とし、
 * 2 文字以下の短い alias は「ひらがな連続の途中」での偶然一致を拒否する。
 * 既知の別アレルゲン複合（豆乳の乳）と部位名（鶏もも）も除外する。
 */
export function foodTextContainsAlias(sourceText: string, alias: string): boolean {
  const source = normalizeFoodText(sourceText);
  const needle = normalizeFoodText(alias);
  if (needle.length === 0) return false;
  if (!source.includes(needle)) return false;

  // 既知の誤検知除外（正規化後）
  if (needle === "乳" && source.includes("豆乳")) {
    // 豆乳のみ・または 乳 が 豆乳 の一部としてしか出ない場合は milk 不一致
    const withoutTounyu = source.replaceAll("豆乳", "");
    if (!withoutTounyu.includes("乳")) return false;
  }
  if (needle === "もも" && /[鶏鳥]もも/.test(sourceText.normalize("NFKC"))) {
    const stripped = source.replaceAll("鶏もも", "").replaceAll("鳥もも", "");
    if (!stripped.includes("もも")) return false;
  }

  if (needle.length <= 2 && [...needle].every((ch) => HIRAGANA.test(ch))) {
    // ひらがな短 alias: 前後がひらがななら「語の途中」とみなし拒否
    let from = 0;
    while (from <= source.length) {
      const idx = source.indexOf(needle, from);
      if (idx === -1) return false;
      const before = idx > 0 ? source[idx - 1]! : "";
      const after = idx + needle.length < source.length ? source[idx + needle.length]! : "";
      const midWord =
        (before !== "" && HIRAGANA.test(before)) || (after !== "" && HIRAGANA.test(after));
      if (!midWord) return true;
      // そば: 「のそば」は位置表現として拒否（前が の）
      if (needle === "そば" && before === "の") {
        from = idx + 1;
        continue;
      }
      if (midWord) {
        from = idx + 1;
        continue;
      }
      return true;
    }
    return false;
  }
  return true;
}
```

`evaluateAllergens` 内の照合を `foodTextContainsAlias(source.text, alias.normalizedAlias)` に置換。

`current-safety.ts` の `additionalAliasValues` に追加（既存の後ろ）:

```ts
  ["egg", "玉子", "direct", false],
  ["milk", "ミルク", "direct", false],
  ["milk", "みるく", "direct", false],
  ["wheat", "うどん", "derived", false],
  ["wheat", "パスタ", "derived", false],
  ["wheat", "ラーメン", "derived", false],
  ["wheat", "そばつゆ", "processed", true],
  ["salmon", "サーモン", "direct", false],
  ["salmon", "さーもん", "direct", false],
  ["mackerel", "サバ", "direct", false],
  ["walnut", "クルミ", "direct", false],
  ["buckwheat", "ソバ", "direct", false],
```

Migration `supabase/migrations/20260726200000_allergen_alias_coverage.sql`:

```sql
-- A-C1: 高頻度表記 alias を dictionary version 固定のまま追加
insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version) values
  ('egg', '玉子', '玉子', 'direct', false, 'jp-caa-2026-04.v1'),
  ('milk', 'ミルク', 'ミルク', 'direct', false, 'jp-caa-2026-04.v1'),
  ('milk', 'みるく', 'みるく', 'direct', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'うどん', 'うどん', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'パスタ', 'パスタ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'ラーメン', 'ラーメン', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'そばつゆ', 'そばつゆ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('salmon', 'サーモン', 'サーモン', 'direct', false, 'jp-caa-2026-04.v1'),
  ('salmon', 'さーもん', 'さーもん', 'direct', false, 'jp-caa-2026-04.v1'),
  ('mackerel', 'サバ', 'サバ', 'direct', false, 'jp-caa-2026-04.v1'),
  ('walnut', 'クルミ', 'クルミ', 'direct', false, 'jp-caa-2026-04.v1'),
  ('buckwheat', 'ソバ', 'ソバ', 'direct', false, 'jp-caa-2026-04.v1')
on conflict (allergen_id, normalized_alias, dictionary_version) do update set
  alias = excluded.alias,
  alias_kind = excluded.alias_kind,
  requires_label_confirmation = excluded.requires_label_confirmation;
```

注: `normalizedAlias` は DB では生の alias 文字列（既存パターン）。照合時に `normalizeFoodText` が fold する。

`food-rules.ts` の forbidden `includes` も可能なら `foodTextContainsAlias` へ（A-I2）。Task 1 で一緒に直す。

- [ ] **Step 4: GREEN verify**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/safety/allergens.test.ts shared/safety/food-rules.test.ts netlify/functions/_shared/current-safety.test.ts
docker compose run --rm --no-deps app npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add shared/safety/allergens.ts shared/safety/allergens.test.ts shared/safety/food-rules.ts netlify/functions/_shared/current-safety.ts supabase/migrations/20260726200000_allergen_alias_coverage.sql
git commit -m "$(cat <<'EOF'
fix: アレルゲン照合にかな折り畳みと alias を追加する

A-C1/A-I1: カタカナ→ひらがな正規化、玉子/ミルク/小麦加工品等の alias、
短いひらがな alias の語中一致拒否で誤検知を抑える。
EOF
)"
```

---

### Task 2: A-C2 利用者向け issue 本文の人間向け化

**Files:**
- Modify: `shared/safety/allergens.ts` (`evaluateAllergens` message)
- Modify: `shared/safety/food-rules.ts` (required constraint messages)
- Modify: `netlify/functions/_shared/revalidation-adapter.ts` (pantry allergen messages)
- Modify: related tests that assert English IDs / member_1 in user-facing messages

**Approach:**
- `evaluateAllergens`: catalog `displayName` + member の表示名。`CurrentSafetyContext.members` に `displayName` があるか確認し、無ければ `anonymousRef` を「家族1」形式にマップしない — context の `displayNameSnapshot` または catalog のみで「卵」等を出す。
- Message template: `「${memberLabel}」さんの登録アレルギー「${allergenDisplayName}」が献立に残っています`
- memberLabel: `member.displayName` if present else `ご家族`（member_1 は出さない）
- food-rules required: map `cut_small` → 日本語（既存 user_message / constraint labels を流用）

- [ ] **Step 1–5:** RED tests asserting messages contain 卵 not egg; GREEN implement; commit `fix: 安全 issue の利用者向け文言から内部 ID を除く`

---

### Task 3: D-C1 履歴削除後の買い物リスト恒久停止

**Files:**
- Modify: `src/features/history/pages/history-detail-page.tsx` — create 用の disabled を `shoppingGate.blocked` から分離
- Modify: `src/features/shopping/pages/shopping-list-page.tsx` — unverifiable 時に回復説明 + 履歴導線
- Modify: `src/features/history/components/history-card.tsx` — 削除確認に買い物リスト影響の注意
- Optionally: SQL archive-or-detach when menu deleted (prefer client recovery path first)

**Approach (minimal, design-aligned):**
1. `canCreateShoppingList = actionsEnabled && !createList.isPending`（active list gate と独立）
2. Create sheet `mode: "new"` はゲート blocked でも開ける（SQL が旧 list をアーカイブ）
3. shopping-list-page: `safetyGate` blocked + source_menu_unavailable のとき、全操作 disabled のまま「献立が削除されたため操作できません。履歴から新しいリストを作成してください」+ link `/history`
4. history delete dialog: 「この献立を元にした買い物リストがある場合、そのリストの確認操作ができなくなります。新しいリストは履歴から作り直せます。」

- [ ] RED/GREEN/commit `fix: 献立削除後も買い物リストを新規作成できるようにする`

---

### Task 4: D-C2 reconcile が正常行を誤削除候補にする

**Files:**
- Modify: `shared/shopping/diff.ts` — protected の `takeCandidateByName` が non-protected の唯一候補を奪わない
- Modify: `shared/shopping/diff.test.ts` — findings の入出力ケース
- Modify: `src/features/shopping/components/reconcile-list-sheet.tsx` — remove の初期チェックを **空** に

**Approach:**
1. Protected fallback `takeCandidateByName` は、同名候補が **複数** あるときだけ使う、または name フォールバックで取った候補は `pantryCheckRequired` add のみで、他行の remove を誘発しないよう **候補を消費しない peek** にする。
2. 推奨: protected 行は exact key のみ消費。name fallback は「レビュー用 add（pantryCheckRequired）」を **候補を bucket から消さずに** 出す（copy）。こうすると i-plain が exact match で残る。
3. ReconcileListSheet: `useState(() => new Set())` for removeIds（add/replace は現状維持 or 同様に unchecked — findings は remove を強調）

Findings 入出力をテストに固定:

```ts
// current: checked にんじん 適量 + plain にんじん 100g; next: にんじん 150g
// expect: remove に i-plain が無い（または plain が replace/keep）
```

- [ ] commit `fix: 買い物差分が保護行のために正常行を消さないようにする`

---

### Task 5: C-C1 オンボーディング離脱導線

**Files:**
- Modify: `src/features/household/household-onboarding-page.tsx`
- Modify: `src/features/household/household-api.ts` / types if `setProgress` only allows complete|in_progress
- Modify: `src/features/household/household-onboarding-page.test.tsx`（非表示固定を削除し CTA 要求）

**Approach:**
- 両段階に「あとで設定する（アイデアから始める）」ボタン
- `setOnboardingStatus(..., "skipped")` を呼ぶ（welcome / planner と同じ RPC）
- `HouseholdOnboardingApi.setProgress` の型を `"in_progress" | "complete" | "skipped"` に拡張
- navigate `/planner` after skip

- [ ] commit `fix: オンボーディングにスキップ導線を追加する`

---

### Task 6: C-C2 ブロッキングエラー操作が details 内で不可視

**Files:**
- Modify: `src/features/planner/components/review-step.tsx`

**Approach:**
- `hasUnavailablePantrySelections || medicalBlocked || fieldErrors present` のとき `<details open>`
- またはブロッキング UI（解除ボタン・メモ）を details 外へ移動
- 推奨: `const detailsOpen = hasUnavailablePantrySelections || medicalBlocked || Boolean(fieldError…)` を `open={detailsOpen}` に

- [ ] commit `fix: 確認画面のブロック理由の操作を折りたたみ外でも見えるようにする`

---

### Task 7: B-C1 deposited に最初からやり直す CTA

**Files:**
- Modify: `src/features/auth/auth-callback-page.tsx`
- Modify: `src/features/auth/auth-callback-page.test.tsx`

**Approach:**
- deposited UI に番号付き手順 + `Link`/`button` → `navigate("/login", { replace: true })`
- セッション作成・continuation 再消費はしない

- [ ] commit `fix: マジックリンク deposited 画面にやり直し導線を追加する`

---

### Task 8: B-I3 returnTo path collapse open redirect

**Files:**
- Modify: `src/features/auth/auth-flow.ts` `sanitizeReturnPath`
- Modify: `src/features/auth/auth-flow.test.ts`
- Modify: `src/features/auth/auth-provider.tsx` / gateway / callback — re-sanitize before navigate

**Approach:**
```ts
export function sanitizeReturnPath(value: string | null | undefined): string {
  if (value === undefined || value === null || value === "") return "/planner";
  // Allow bare "/" for RootEntry (B-I5)
  if (value === "/") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/planner";
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin) return "/planner";
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    // post-normalize: pathname must be /^\/[^/]/ or exactly "/"
    if (parsed.pathname === "/") return `/${parsed.search}${parsed.hash}`.replace(/^\//, "/") === "/" 
      ? `/${parsed.search}${parsed.hash}`.replace(/^\/+/, "/") // simplify: return "/" + search
      : "/planner";
    if (!/^\/[^/]/u.test(parsed.pathname)) return "/planner";
    if (parsed.pathname.startsWith("//")) return "/planner";
    return path;
  } catch {
    return "/planner";
  }
}
```
（実装時に整理。`/planner/..//evil` → pathname `//evil` → reject）

B-I5: `"/"` → `"/"` を許可。login の default は従来通り returnTo 省略時 `/welcome`。protected root は returnTo `/`。

- [ ] commit `fix: returnTo 正規化後の open redirect を防ぐ`

---

### Task 9+: Wave 2 Important（推奨順）

各 ID を独立 Task として TDD。優先:

1. C-I6 緊急献立空文言 + RecoveryLinks mode
2. A-I8 finalize ログ status 分岐
3. A-I9 post-provider deadline abort
4. A-I11 OpenRouter 1MiB cap
5. A-I12 safetyTags.max(32)
6. A-I4 requestText を safety_snapshot から除去
7. A-I10 freeze 30 日掃除
8. A-I3 unconfirmed → 422 not 500
9. B-I1/B-I4 polling + resumeFlow
10. B-I6 getSession error keep session
11. C-I2 Link 化
12. C-I3/C-I4 audience/draft defaults
13. C-I5 ingredient Enter
14. C-I9 autosave status UI
15. D-I1–D-I15 買い物・履歴
16. E-I1 retryAt 時刻比較の正規化

Minor は Important 完了後。

---

### Final: クリーンコンテキスト再レビュー

- [ ] merge-base..HEAD の review-package を生成
- [ ] 別 subagent で findings ID ごとに修正有無・リグレッションを検証
- [ ] 残件（B-I2, E-U1, 未着手 Minor）を一覧化

---

## Spec coverage checklist

| ID | Task |
|---|---|
| A-C1, A-I1, A-I2 | Task 1 |
| A-C2 | Task 2 |
| D-C1 | Task 3 |
| D-C2 | Task 4 |
| C-C1 | Task 5 |
| C-C2 | Task 6 |
| B-C1 | Task 7 |
| B-I3, B-I5 | Task 8 |
| Other I/M | Task 9+ |
| B-I2, E-U1 | deferred |
