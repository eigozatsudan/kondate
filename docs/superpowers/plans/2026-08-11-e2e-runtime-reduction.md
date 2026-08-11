# E2E 実行時間短縮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Playwright E2E の壁時計を、製品 quota / Auth / 受け入れ契約を壊さずに Phase 1→2→3 で段階短縮する（PR smoke ≤12 分、full ≤22→15→10 分目安）。

**Architecture:** (1) Playwright タグと `KONDATE_E2E_SUITE` で smoke/full と project 役割を分離 (2) setup `storageState` と DB seed onboarding で認証固定費を削減 (3) `compose.e2e.yaml` 限定の高い `GLOBAL_DAILY_AI_LIMIT` と `workers≥2` で並列化する。製品 `compose.yaml` の limit=20 と preflight は触らない。

**Tech Stack:** Playwright 1.61、Compose e2e profile、GitHub Actions、`scripts/run-e2e.sh`、Vitest/node:test tooling、Docker `app` 経由の静的検証。

**Spec:** `docs/superpowers/specs/2026-08-11-e2e-runtime-reduction-design.md`（**レビュー反映後**）  
**Reviews:** `docs/superpowers/reviews/2026-08-11-e2e-runtime-reduction-{primary,adversarial,secondary}.md`

## Global Constraints

- Node.js `>=24 <25`、ESM、`strict: true`、境界で `any` 禁止
- ユーザー向け文言は日本語。コードコメント・コミットメッセージは日本語（Conventional Commits）
- Docker: `docker compose run --rm --no-deps app <cmd>`（エージェントは `&&` / `;` でコマンド連結しない）
- E2E 実行は host の `./scripts/run-e2e.sh`（app コンテナ内で `npm run e2e` の full wrapper 代替にしない）
- 製品 `GLOBAL_DAILY_AI_LIMIT` の通常 local 既定 **20** と本番 preflight 契約を変えない。E2E 緩和は `compose.e2e.yaml` のみ
- CI: `PLAYWRIGHT_DISABLE_TRACE=1` と `KONDATE_ASSERT_PRIVACY_LOGS=1` を維持
- `git push` / 本番 deploy / 破壊的 git は人間の明示指示なしで行わない
- acceptance-matrix の owning title を変える PR は verify スクリプトと同じ変更セットにする

## File map

| ファイル | 責務 |
| --- | --- |
| `playwright.config.ts` | `grepInvert`、setup project（dependsOn なし）、workers |
| `e2e/fixtures/auth.ts` | Phase 2 seed / storageState / quota 範囲 / generateLink |
| `e2e/fixtures/seed-onboarding.ts` | **新規 (P2)** service role で完了状態を投入 |
| `e2e/fixtures/session-auth.ts` | **新規 (P2/P3)** storageState 読取・session 注入 |
| `e2e/fixtures/reset-global-ai-quota.ts` | 生成直前専用ヘルパ名の明確化（P2） |
| `e2e/specs/*.spec.ts` | `@smoke` 等タグ、fixture 切替 |
| `scripts/run-e2e.sh` | `KONDATE_E2E_SUITE`、setup 1 回、CI cleanup 短縮 |
| `tests/tooling/e2e-smoke-tags.test.mjs` | **新規** smoke 必須ファイル×最低本数 |
| `compose.e2e.yaml` | E2E 専用 `GLOBAL_DAILY_AI_LIMIT`（P3） |
| `.github/workflows/ci.yml` / `scripts/ci.sh` | smoke/full |
| `tests/tooling/compose.test.mjs` 他 | シーケンス・suite 契約の固定 |
| `docs/local-development.md` | 開発者向けコマンド |
| `.gitignore` | `e2e/.auth/` |

---

# Phase 1 — タグ・project 役割・CI レーン

### Task 1: project フィルタを config `grepInvert` に固定

**Files:**
- Modify: `playwright.config.ts`
- Modify: `tests/tooling/project-config.test.mjs`（grepInvert の存在を固定してよい）

**Interfaces:**
- Spec §4.1: skip の単一入口は **config のみ**（fixture beforeEach は使わない）

- [ ] **Step 1: playwright.config.ts の projects を更新**

```ts
projects: [
  {
    name: "mobile-chromium",
    use: { ...devices["iPhone SE"], browserName: "chromium" },
    grepInvert: /@desktop-only/,
  },
  {
    name: "desktop-chromium",
    use: { ...devices["Desktop Chrome"] },
    grepInvert: /@mobile-only/,
  },
],
```

（Phase 2 で setup project を足すときも mobile/desktop から `dependencies` を付けない。）

- [ ] **Step 2: tooling で grepInvert を固定（任意だが推奨）**

`project-config.test.mjs` に `grepInvert` と `@mobile-only` / `@desktop-only` の文字列が config にあることを assert。

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts tests/tooling/project-config.test.mjs
git commit -m "feat(e2e): project の grepInvert で mobile/desktop only を分ける"
```

---

### Task 2: `@smoke` / `@mobile-only` を spec に付与

**Files:**
- Modify: Spec 記載の smoke セットに該当する `e2e/specs/*.spec.ts`
- Modify: `e2e/specs/mobile-accessibility.spec.ts`（ファイル全体または describe に `@mobile-only`）

**Interfaces:**
- Playwright: `test("title", { tag: ["@smoke"] }, async …)`  
  複数: `{ tag: ["@smoke", "@mobile-only"] }`  
  幅ループ内: 320 の household のみ `@smoke`、全 test に `@mobile-only`

- [ ] **Step 1: mobile-accessibility を mobile-only 化**

`for (const width of [320, 375, 430])` 内の各 `test(...)` に `{ tag: ["@mobile-only"] }` を付与。  
320 かつ household wizard+result の 1 本だけ追加で `@smoke`:

```ts
test(
  `the household wizard and result fit ${String(width)}px with usable targets`,
  {
    tag: width === 320 ? ["@mobile-only", "@smoke"] : ["@mobile-only"],
  },
  async ({ completedOnboardingPage: page }) => {
    // 既存本体のまま
  },
);
```

他 4 シナリオ（start / idea / shell / history）は `@mobile-only` のみ（smoke なし）。

- [ ] **Step 2: Spec §4.2 の smoke セットにタグを付与**

対象（exact title はファイルを読んで一致させる）:

| ファイル | 方針 |
| --- | --- |
| `foundation.spec.ts` | 全 test に `@smoke` |
| `oauth-mock.spec.ts` | 全 test に `@smoke` |
| `full-journey.spec.ts` | 両 test に `@smoke` |
| `auth-callback-security.spec.ts` | cancel + expired の 2 本に `@smoke` |
| `auth-recovery.spec.ts` | same-browser 1 本に `@smoke` |
| `generation-recovery-results.spec.ts` | connectionreset recovery 1 + shows result details 1 に `@smoke` |
| `shopping-list.spec.ts` | preserves protected rows 1 に `@smoke` |
| `shopping-list-races.spec.ts` | reuses one idempotency key 1 に `@smoke` |
| `history-safety-change.spec.ts` | automatically revalidates on mount 1 に `@smoke` |
| `history-regeneration.spec.ts` | **does not consume a success for duplicate output に `@smoke`（MVP #13）** |
| `menu-domain-pantry.spec.ts` | **pantry CRUD… 1 本に `@smoke`（MVP #9）** |
| `onboarding.spec.ts` | 全 test に `@smoke` |
| `settings.spec.ts` | adds, edits, and deletes… 1 に `@smoke` |

`account-deletion` / `billing-plus` は **smoke を付けない**。

- [ ] **Step 3: タグ漏れの静的ガード（必須・最低本数）**

`tests/tooling/e2e-smoke-tags.test.mjs`（node:test）で Spec §4.2 表の **必須ファイル × 最低本数**を固定する（「`@smoke` ≥1」だけでは不合格）。

例（実装時に exact 本数を表と一致させる）:

```js
const required = [
  ["e2e/specs/foundation.spec.ts", 1],
  ["e2e/specs/oauth-mock.spec.ts", 2],
  ["e2e/specs/full-journey.spec.ts", 2],
  ["e2e/specs/history-regeneration.spec.ts", 1],
  ["e2e/specs/menu-domain-pantry.spec.ts", 1],
  // …表の残り
];
// 各ファイル内の tag: に '@smoke' が含まれる test 定義数 ≥ 最低本数
```

`mobile-accessibility.spec.ts` に `@mobile-only` があることも assert。

CI の node:test 列挙（`ci.yml` / `ci.sh` / `project-config` が列挙を固定している場合）にパスを追加。

- [ ] **Step 4: Commit**

```bash
git add e2e/specs tests/tooling/e2e-smoke-tags.test.mjs scripts/ci.sh .github/workflows/ci.yml tests/tooling/project-config.test.mjs
git commit -m "feat(e2e): smoke と mobile-only タグを付与する"
```

---

### Task 3: `KONDATE_E2E_SUITE` を `run-e2e.sh` に実装

**Files:**
- Modify: `scripts/run-e2e.sh`
- Modify: `tests/tooling/compose.test.mjs` および/または `tests/tooling/local-development-scripts.test.mjs`（run-e2e の文字列・分岐を固定）

**Interfaces:**
- Env: `KONDATE_E2E_SUITE=full|smoke`（未設定は `full`）
- smoke 時の追加引数: `--project=mobile-chromium` と `--grep=@smoke`（または `--grep @smoke`。Playwright が受け付ける形式に合わせる）
- 呼び出し側が既に `--project` を含む場合は project を追加しない（現行 `e2e_args_have_project` を再利用・拡張）
- 呼び出し側が既に `--grep` / `-g` を含む場合は grep を追加しない

- [ ] **Step 1: `e2e_args_have_grep` と完成形の引数組立**

`e2e_args_have_project` と同様に `--grep` / `-g` / `--grep=*` を検出。

`run_e2e_commands` 内（stack 起動・quota 初期化の後）:

```sh
suite=${KONDATE_E2E_SUITE:-full}
case "$suite" in
  full|smoke) ;;
  *)
    echo "KONDATE_E2E_SUITE must be full or smoke" >&2
    return 2
    ;;
esac

if [ "$suite" = "smoke" ]; then
  # 1 段のみ。desktop 段・project 境界 reset なし（開始時 reset は済）。
  smoke_args="$*"
  if ! e2e_args_have_project $smoke_args; then
    # shell の配列が無い /bin/sh では、明示的に前置する:
    # run_playwright --project=mobile-chromium ...user args...
    set -- --project=mobile-chromium "$@"
  fi
  if ! e2e_args_have_grep "$@"; then
    set -- "$@" --grep=@smoke
  fi
  run_playwright "$@" || return $?
  return 0
fi

# full: 現行どおり（project 指定あり → 1 回 / なし → mobile → reset → desktop）
if e2e_args_have_project "$@"; then
  run_playwright "$@" || return $?
else
  mobile_status=0
  desktop_status=0
  run_playwright --project=mobile-chromium "$@" || mobile_status=$?
  run_child "$script_dir/reset-e2e-ai-quota.sh" || return $?
  run_playwright --project=desktop-chromium "$@" || desktop_status=$?
  # 現行と同様に mobile 失敗を優先して return
  ...
fi
```

**固定:** grep 形式は **`--grep=@smoke`**（等号付き）。呼び出し側が `--grep` / `--project` を既に付けていれば二重付与しない。

- [ ] **Step 2: tooling テストを更新（必須）**

| ファイル | 更新内容 |
| --- | --- |
| `tests/tooling/compose.test.mjs` | `KONDATE_E2E_SUITE`、`must be full or smoke`、smoke 時 desktop 二段を踏まないこと |
| `tests/tooling/local-development-scripts.test.mjs` | `expectedE2EInvocations` を suite 分岐。smoke: playwright 1 回・中間 quota reset なし。full: 現行 mobile→reset→desktop |

Run:

```bash
docker compose run --rm --no-deps app node --test tests/tooling/compose.test.mjs
docker compose run --rm --no-deps app node --test tests/tooling/local-development-scripts.test.mjs
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add scripts/run-e2e.sh tests/tooling/compose.test.mjs tests/tooling/local-development-scripts.test.mjs
git commit -m "feat(e2e): KONDATE_E2E_SUITE で smoke/full を切り替える"
```

---

### Task 4: CI を PR smoke / push full に分岐

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/ci.sh`（既定 full を維持。コメントで smoke を文書化）
- Modify: `tests/tooling/project-config.test.mjs`（両方に `./scripts/run-e2e.sh` が残ること、LOCAL_MOCK 等）

- [ ] **Step 1: workflow の E2E ステップを分岐**

```yaml
      - name: E2E with privacy log assertion
        env:
          LOCAL_MOCK_MODELS: mock/kondate-primary:free,mock/kondate-repair:free
          KONDATE_ASSERT_PRIVACY_LOGS: "1"
          PLAYWRIGHT_DISABLE_TRACE: "1"
          KONDATE_E2E_SUITE: ${{ github.event_name == 'pull_request' && 'smoke' || 'full' }}
        run: ./scripts/run-e2e.sh
```

- [ ] **Step 2: ci.sh は full 既定**

```bash
export KONDATE_E2E_SUITE="${KONDATE_E2E_SUITE:-full}"
export LOCAL_MOCK_MODELS=...
export KONDATE_ASSERT_PRIVACY_LOGS=1
export PLAYWRIGHT_DISABLE_TRACE=1
./scripts/run-e2e.sh
```

- [ ] **Step 3: ゲート順テスト**

Run:

```bash
docker compose run --rm --no-deps app node --test tests/tooling/project-config.test.mjs
```

Expected: PASS（`extractSharedCiGateOrder` が e2e を検出）

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml scripts/ci.sh tests/tooling/project-config.test.mjs
git commit -m "ci: PR の E2E を smoke、それ以外を full にする"
```

---

### Task 5: ドキュメントと Phase 1 検証

**Files:**
- Modify: `docs/local-development.md`（E2E 節）
- 必要なら `README.md` の検証コマンド付近に 1 行

- [ ] **Step 1: local-development に表を追加**

| 目的 | コマンド |
| --- | --- |
| full（release 相当） | `./scripts/run-e2e.sh` |
| smoke（PR 相当） | `KONDATE_E2E_SUITE=smoke ./scripts/run-e2e.sh` |
| 1 ファイル | `./scripts/run-e2e.sh -- e2e/specs/foo.spec.ts --project=mobile-chromium` |

**必須の注意文:** 「PR の smoke は受け入れ E2E 全量の代替ではない。full は push / `ci.sh` / release-checklist。account-deletion 等は full のみ。」

stale lock の説明は残す。`docs/README.md` の local-development 行に smoke/full を括弧追記してよい。

- [ ] **Step 2: 人間または Verifier が実測**

```bash
KONDATE_E2E_SUITE=smoke ./scripts/run-e2e.sh
./scripts/run-e2e.sh
```

記録（PR 説明用。git にログを載せない）:

- smoke の `N passed (T)`
- full の mobile / desktop 各 `N passed (T)`
- desktop で `mobile-accessibility` が skip されていること

Expected: smoke が full より明確に短い。desktop の a11y 本体が走っていない。

- [ ] **Step 3: Commit docs**

```bash
git add docs/local-development.md README.md
git commit -m "docs: E2E の smoke/full の使い方を追記する"
```

**Phase 1 完了ゲート:** Spec §5.5 をすべて満たす。

---

# Phase 2 — 認証再利用と seed

### Task 6: onboarding seed ヘルパ

**Files:**
- Create: `e2e/fixtures/seed-onboarding.ts`
- Modify: `e2e/fixtures/auth.ts`（`completedOnboardingPage` が seed を使う）
- 既存 UI path: `onboarding.spec.ts` / `full-journey` は UI 完了を維持（seed に置き換えない）

**Interfaces:**

```ts
/**
 * ログイン済み page のユーザに対し、最低限の家族1名・allergy none・
 * onboarding 完了・privacy 同意相当を service role / REST で投入し、
 * /planner で使える状態にする。page に service key を渡さない。
 */
export async function seedCompletedOnboardingState(page: Page): Promise<void>;
```

- 実装は `e2e/fixtures/history.ts` の `seedGeneratedMenu` や `acceptance.ts` の admin クライアントと同様に `.env` から service role を読む。
- 投入対象は実装のスキーマに合わせる（`profiles` / `household_members` / `privacy_consents` 等）。**実装が正**。不足カラムは migrations と generated types を読んで埋める。
- seed 後 `page.goto("/planner")` と heading/URL アサーション。

- [ ] **Step 1: seed 関数を実装（必須契約）**

参照（実装が正）:

- `e2e/fixtures/acceptance.ts` の `createServiceAdmin` / owned seed パターン
- `shared/contracts/domain.ts` の `privacyNoticeVersion`（現行 **`2026-07-29.v1`** — 契約更新時は追随）
- 最低投入: 対象 user の profile onboarding 完了相当、`household_members` ≥1、`privacy_consents.notice_version = privacyNoticeVersion`

service role を page に渡さない。seed 後 `page.goto("/planner")` で welcome に戻らないことを assert。

- [ ] **Step 2: `completedOnboardingPage` を切替**

```ts
completedOnboardingPage: async ({ authenticatedPage: page }, provide) => {
  await seedCompletedOnboardingState(page);
  // Task 8 まで: 生成直前 reset へ移す前はここで ensureAiQuota してもよい
  await provide(page);
},
```

UI クリック（家族情報を登録する…）は **削除**。`onboarding.spec.ts` / full-journey household は seed を使わない。

- [ ] **Step 3: 焦点 E2E**

```bash
./scripts/run-e2e.sh -- e2e/specs/settings.spec.ts e2e/specs/onboarding.spec.ts --project=mobile-chromium
```

Expected: settings は seed 経由で緑。onboarding は UI path のまま緑。

- [ ] **Step 4: Commit**

```bash
git add e2e/fixtures/seed-onboarding.ts e2e/fixtures/auth.ts
git commit -m "feat(e2e): 完了 onboarding を DB seed で用意する"
```

---

### Task 7: setup project と storageState

**Files:**
- Modify: `playwright.config.ts`
- Create: `e2e/specs/auth.setup.ts`（setup 専用。testDir 外または project testMatch）
- Create: `e2e/fixtures/session-auth.ts`
- Modify: `.gitignore`（`e2e/.auth/`）
- Modify: 汚染しない spec 数本（例: `billing-plus.spec.ts` の表示系）を reused fixture へ

**Interfaces:**

```ts
// session-auth.ts
export const STORAGE_STATE_PATH = "e2e/.auth/user.json";

/** storageState を読んだ page。welcome 振り分け検証には使わない */
export async function applyReusedStorageState(/* config use */): Promise<void>;
```

`playwright.config.ts` 概形（**dependencies は付けない** — Spec §6.3）:

```ts
projects: [
  {
    name: "setup",
    testMatch: /auth\.setup\.ts$/,
  },
  {
    name: "mobile-chromium",
    use: { ...devices["iPhone SE"], browserName: "chromium" },
    grepInvert: /@desktop-only/,
  },
  {
    name: "desktop-chromium",
    use: { ...devices["Desktop Chrome"] },
    grepInvert: /@mobile-only/,
  },
],
```

**run-e2e.sh（固定シーケンス）:**

```sh
# full かつ --project 未指定
run_playwright --project=setup
run_playwright --project=mobile-chromium "$@"
reset-e2e-ai-quota.sh
run_playwright --project=desktop-chromium "$@"

# smoke
run_playwright --project=setup
run_playwright --project=mobile-chromium --grep=@smoke "$@"
```

`tests/tooling/local-development-scripts.test.mjs` の `expectedE2EInvocations` に **setup 1 回**を必須挿入。

- [ ] **Step 1: gitignore**

```
e2e/.auth/
```

- [ ] **Step 2: auth.setup.ts**

magic-link で 1 ユーザを作り、`page.context().storageState({ path: "e2e/.auth/user.json" })`。  
onboarding は seed で完了させ、planner 到達を確認。

- [ ] **Step 3: reused fixture**

```ts
// 例: test.extend で storageState 付き context
// @ephemeral-auth タグの test は従来 authenticatedPage を使う
```

billing-plus などから段階的に移行。

- [ ] **Step 4: 焦点 E2E + Commit**

```bash
./scripts/run-e2e.sh -- e2e/specs/billing-plus.spec.ts --project=mobile-chromium
git add playwright.config.ts e2e/specs/auth.setup.ts e2e/fixtures/session-auth.ts .gitignore e2e/specs/billing-plus.spec.ts scripts/run-e2e.sh
git commit -m "feat(e2e): setup project と storageState で認証を再利用する"
```

---

### Task 8: global AI quota reset を生成直前のみに

**Files:**
- Modify: `e2e/fixtures/reset-global-ai-quota.ts`（`ensureAiQuotaForGeneration` を export。旧名は re-export 可）
- Modify: `e2e/fixtures/auth.ts`（authenticated / completed / idea から **自動 truncate を削除**）
- Modify: 生成を行う全 spec / fixture（full-journey, generation-*, history-regeneration, mobile-accessibility の生成、shopping で generate する場合、history seed 前など）

**Interfaces:**

```ts
/** 外部 AI 送信（generate 等）の直前にだけ呼ぶ。製品 limit は変えない。 */
export async function ensureAiQuotaForGeneration(): Promise<void>;
```

- [ ] **Step 1: 呼び出し箇所を grep で列挙**

```bash
# host
grep -Rn "setMockScenario\|/functions/v1/generate\|献立を作る\|generate" e2e/ --include='*.ts'
```

各生成直前に `ensureAiQuotaForGeneration()` を追加。

- [ ] **Step 2: fixture 入口の truncate 削除**

- [ ] **Step 3: full または生成系焦点 E2E**

```bash
./scripts/run-e2e.sh -- e2e/specs/full-journey.spec.ts e2e/specs/generation-recovery-results.spec.ts --project=mobile-chromium
```

Expected: 枠枯渇なしで PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(e2e): AI 共有枠リセットを生成直前のみにする"
```

**Phase 2 完了ゲート:** Spec §6.6。full 実測を記録。

---

# Phase 3 — 並列と E2E 専用枠

### Task 9: compose.e2e で GLOBAL_DAILY_AI_LIMIT を上書き

**Files:**
- Modify: `compose.e2e.yaml`（app.environment）
- Modify: `tests/tooling/compose.test.mjs`（e2e override に limit があること、**通常 compose は 20 のまま**）

- [ ] **Step 1: override**

```yaml
services:
  app:
    environment:
      # 既存 OPENROUTER_* に加え:
      # E2E 並列・フルスイート用。製品 max 以下。通常 compose.yaml の 20 は変更しない。
      GLOBAL_DAILY_AI_LIMIT: "500"
```

- [ ] **Step 2: tooling**

- `compose.yaml` に `GLOBAL_DAILY_AI_LIMIT: "20"` が残る
- `compose.e2e.yaml` に E2E 用の値が存在する

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(e2e): E2E 専用に GLOBAL_DAILY_AI_LIMIT を上書きする"
```

---

### Task 10: test ごと global truncate 廃止と suite 境界のみ

**Files:**
- Modify: `e2e/fixtures/reset-global-ai-quota.ts` / 呼び出し
- Modify: 生成 test から `ensureAiQuotaForGeneration` を削除（suite 開始 + project 境界の shell reset に依存）
- コメントで「並列時に truncate 禁止」を日本語で明記

- [ ] **Step 1: 生成 test から per-test reset を除去**
- [ ] **Step 2: mobile 全件（または full）で枠枯渇しないことを確認**
- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(e2e): 並列前提で test ごとの AI 枠 truncate をやめる"
```

---

### Task 11: workers≥2 と @serial（Task 10 と同一 PR 推奨）

**Files:**
- Modify: `playwright.config.ts`（`workers: 2`, `fullyParallel: true` — **定数**。`process.env.CI ?` 分岐は使わない）
- Modify: `tests/tooling/project-config.test.mjs`（`workers: 1` 固定を **新契約**へ: `workers: 2` と `fullyParallel: true`、動的 CI 分岐パターンは引き続き禁止）
- Create または Modify: tooling で test/fixture 入口の global truncate 呼び出し 0 を固定（Task 10 と共有）
- Modify: `e2e/specs/shopping-list-races.spec.ts` 等

```ts
test.describe.configure({ mode: "serial" });
```

- [ ] **Step 0: Task 10 完了（per-test truncate 0）を確認。未完了なら本 Task を開始しない**
- [ ] **Step 1: workers 2 + fullyParallel true + project-config 更新**
- [ ] **Step 2: race 系・同一 storageState describe を serial に**
- [ ] **Step 3: full を 2 回**

```bash
./scripts/run-e2e.sh
./scripts/run-e2e.sh
```

Expected: 2 連続 green。flaky なら共有状態を修正（workers を 1 に戻して緑にするだけの逃げは不可）。

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/tooling/project-config.test.mjs e2e/specs
git commit -m "feat(e2e): workers 並列と serial 区間を導入する"
```

---

### Task 12: 認証高速化（Admin generateLink 固定）

**Files:**
- Modify: `e2e/fixtures/session-auth.ts` / `auth.ts`
- 必要なら `e2e/specs/auth-recovery.spec.ts` または setup で Mailpit 成功 path を 1 本保証

**方式（固定）:** Spec §7.5 — Supabase Admin **`generateLink`（magiclink）** で URL 取得 → ブラウザで開く。session 手注入はしない。

- [ ] **Step 1: `loginAsNewUser(page, email)` を generateLink で実装**
- [ ] **Step 2: `authenticatedPage` の既定を高速経路に（使い捨て user は維持）**
- [ ] **Step 3: oauth-mock / auth-callback は UI path 維持。Mailpit 成功 path ≥1 本を smoke または full に残す**
- [ ] **Step 4: full 2 連続 green**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(e2e): 使い捨て認証を Admin generateLink 経路にする"
```

---

### Task 13: CI cleanup 短縮と Phase 3 クローズ

**Files:**
- Modify: `scripts/run-e2e.sh`（`CI=true` のとき auth/app force-recreate 復元を省略または `docker compose stop` のみ、など **安全な短縮**）
- Modify: tooling テスト
- Modify: `docs/local-development.md`（workers、E2E limit、オプトイン `KONDATE_E2E_SKIP_RECREATE` を開発専用と明記）

- [ ] **Step 1: CI 分岐 cleanup**

ローカルは現行 restore を維持。CI は直後 down するため restore の `--wait` を省略可。

- [ ] **Step 2: 任意オプトイン**

```sh
# 開発反復のみ。CI では禁止（tooling または run-e2e が CI と同時指定で exit 2）
KONDATE_E2E_SKIP_RECREATE=1
```

- [ ] **Step 3: 最終 full 実測と Spec §7.8 チェックリスト**
- [ ] **Step 4: Commit**

```bash
git commit -m "perf(e2e): CI でのスタック復元を短縮し Phase 3 を閉じる"
```

**Phase 3 完了ゲート:** Spec §7.8。

---

## 検証コマンド早見（各 Task 後）

エージェントは必要最小限に絞る。Phase 完了時は広め。

```bash
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx vitest run e2e/fixtures/project-filter.test.ts
docker compose run --rm --no-deps app node --test tests/tooling/compose.test.mjs
docker compose run --rm --no-deps app node --test tests/tooling/project-config.test.mjs
KONDATE_E2E_SUITE=smoke ./scripts/run-e2e.sh
./scripts/run-e2e.sh
```

AGENTS.md の完全ゲート（db:test / e2e / build 全部）は **Phase 完了時または release 前**に人間/Verifier が実行。

---

## Plan self-review（レビュー反映後）

| Spec 節 | 対応 Task |
| --- | --- |
| §4 タグ / smoke / grepInvert | Task 1–2 |
| §4.3 suite モード | Task 3 + local-development-scripts ゴールデン |
| §5 CI / C1 merge 前提 / docs | Task 4–5 |
| §6 seed / setup shell 1 回 / quota | Task 6–8 |
| §7 limit / C2 fail-closed / workers / generateLink / cleanup | Task 9–13 |
| §8–9 成功指標・リスク | Phase ゲート + Task 5/8/13 実測 |
| 製品 limit 不変 | Task 9 tooling |

**レビューで塞いだ穴:** Task 1 は fixture filter ではなく config `grepInvert`。smoke に #9/#13。Task 3 は完成形 shell。Task 7 は `dependencies` 禁止。Task 11 は project-config + Task 10 同一 PR。Task 12 は generateLink 固定。

**残る実装時の注意:** Task 3 の `/bin/sh` 引数再構築は portable に注意（配列が使えない）。tooling の mock docker と実 argv を必ず一致させる。

---

## 実行の進め方

Plan 完了後の実装は:

1. **Subagent-Driven（推奨）** — Task ごとに fresh implementer → verifier → reviewer  
2. **Inline** — 同一セッションで executing-plans

**Phase 1（Task 1–5）を先にマージ可能な単位として完了**してから Phase 2 に進むこと。
