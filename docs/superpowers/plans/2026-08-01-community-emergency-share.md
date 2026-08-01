# 匿名緊急共有レシピ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 共有同意と上限内ランダム抽選により、緊急適格な完成献立を 2 パス AI で匿名カノニカル化し、緊急献立 API の第 2 ソースとして配信する。

**Architecture:** finalize 成功後に **public SECURITY DEFINER RPC** で原子的 enqueue。Pass1/2 は generate 同期寿命外の worker。private 表は **GRANT なし**（本リポジトリ不変条件）。緊急 GET は public definer fetch RPC で S2 を bound 取得し、S1 優先で既存 Stage S を共用。

**Tech Stack:** TypeScript strict、Zod、Supabase private 表 + public definer RPC、Netlify Functions、OpenRouter structured outputs、Vitest、pgTAP、Playwright（薄い）。

**Spec:** `docs/superpowers/specs/2026-08-01-community-emergency-share-design.md`（レビュー反映版）

**Plan reviews:** 2026-08-01 一次/二次/敵対的 → 下記に反映（private 直アクセス禁止、空 allergen メタ禁止、Task7 分割、RED 固定）

## Global Constraints

- Node `>=24 <25`、ESM、`strict: true`、境界は Zod、`any` 禁止
- ユーザー向け文言は日本語。コメント・コミットは日本語。識別子・テスト名は英語
- OpenRouter は Netlify Functions のみ。本番有料 allowlist
- 生プロンプト・生 AI・氏名・メール・アレルギー自由記述・menu_payload をログ/永続化しない
- browser は `@shared/safety/*` 禁止
- **private 表に service_role / authenticated の TABLE GRANT を付けない**（`rls_inventory` 不変条件）。操作はすべて **public SECURITY DEFINER RPC**
- 共有化 AI を `generate-menu` / finalize のリクエスト寿命に載せない（MUST）
- 共有化 AI 台帳は通常 generate / `GLOBAL_DAILY_AI_LIMIT` / `reserve_ai_generation` と**完全独立**
- 本番 DB リセット前提・後方互換なし
- Docker: unit は `docker compose run --rm --no-deps app …`；db-test / e2e はホスト compose
- 手編集禁止: `package-lock.json`、`infra/supabase/**`、`src/shared/types/database.generated.ts`
- push / PR / 本番デプロイ禁止（明示指示がない限り）

## DB アクセス面（全 Task 共通・ロック）

| public RPC | role | 用途 |
| --- | --- | --- |
| `public.upsert_my_share_consent(p_version text, p_accept boolean)` | authenticated | 同意 on/off（off は revoke） |
| `public.get_my_share_consent()` | authenticated | 現行同意状態 |
| `public.try_enqueue_share_job(p_menu_id uuid)` | **service_role only** | consent・caps・lottery・unique job・attempt 予約。`menus.user_id` から contributor 解決。`p_user_id` 引数なし |
| `public.claim_share_generalization_jobs(p_limit int)` | service_role | pending→running、**global/user concurrent running cap** 適用 |
| `public.heartbeat_share_generalization_job(p_job_id uuid)` | service_role | lease 延長 |
| `public.finish_share_generalization_job(p_job_id uuid, p_status text, p_code text, …)` | service_role | terminal status + 台帳 |
| `public.publish_shared_emergency_recipe(p_job_id uuid, p_payload jsonb, p_meal_type text, p_total_elapsed int, p_standard_allergen_ids text[], p_eligible_age_bands text[])` | service_role | **同一トランザクション**で consent 再確認 + pool INSERT + origin + success 台帳。revoke なら publish せず skipped |
| `public.list_active_shared_emergency_recipes(p_meal_type text, p_limit int, p_salt text)` | service_role | bound fetch（LIMIT 必須、active のみ、順序 hash） |
| `public.list_my_shared_emergency_recipes()` | authenticated | 本人 title + shared_on(date) のみ。`auth.uid()` 固定 |
| `public.reap_stale_share_jobs()` | service_role | lease 超過 running → failed `lease_expired`。`run_kondate_maintenance` から呼ぶ |

private 表: `share_generalization_jobs`, `shared_emergency_recipes`, `shared_emergency_recipe_origins`, 共有日次台帳。  
列名: jobs/origins は `contributor_user_id`（**`user_id` 禁止**）。pool に contributor 列なし。

## File map

| Path | Responsibility |
| --- | --- |
| `shared/contracts/share-consent.ts` | version |
| `shared/contracts/share-quota.ts` | caps（running 含む） |
| `shared/contracts/share-job.ts` | status / skip / failure enums |
| `shared/contracts/share-denylist.v1.ts` | 保証表現・PII パターン版付き |
| `shared/emergency/share-eligibility.ts` | 適格ゲート |
| `shared/emergency/share-canonical.ts` | カノニカル + UUID 再採番 |
| `shared/emergency/share-publish-metadata.ts` | standardAllergenIds / eligibleAgeBands（保守的・空 allergen 禁止） |
| `shared/emergency/filter-emergency-menus.ts` | 多ソース + remap 共有 |
| `supabase/migrations/<ts>_share_community_emergency.sql` | 表 + public RPCs |
| `supabase/tests/database/share_community_emergency.test.sql` | RLS/RPC/削除/reaper |
| `supabase/tests/database/rls_inventory.test.sql` | expected 更新 |
| `supabase/tests/database/account_deletion.test.sql` | inventory + residual pool |
| `docs/testing/database-access-matrix.md` | 表・RPC 追記 |
| `docs/runbooks/account-deletion.md` | 方針 B 追記 |
| `netlify/functions/_shared/generation-service.ts` | **唯一**の enqueue フック |
| `netlify/functions/_shared/share-enqueue.ts` | eligibility + try_enqueue RPC（OpenRouter 禁止） |
| `netlify/functions/share-generalize-worker.ts` | worker entry |
| `netlify/functions/_shared/share-*.ts` | claim/pipeline/gate/openrouter |
| `netlify/functions/emergency-menus.ts` | S2 via list_active RPC |
| `netlify/functions/_shared/maintenance-db.ts` | reaper count keys |
| `netlify/functions/maintenance-cleanup.ts` | reaper 呼び出し |
| `src/features/privacy/*` | dual consent UI/API |
| `src/features/household/household-settings-page.tsx` | トグル・管理一覧セクション |

---

### Task 1: 共有 contract 定数

**Files:**
- Create: `shared/contracts/share-consent.ts`
- Create: `shared/contracts/share-quota.ts`
- Create: `shared/contracts/share-job.ts`
- Create: `shared/contracts/share-consent.test.ts`
- Create: `shared/contracts/share-quota.test.ts`
- Create: `shared/contracts/share-job.test.ts`

**Produces:**
```ts
export const shareConsentVersion = "2026-08-01.v1" as const;
export const shareQuota = {
  lotteryPercent: 20,
  perUserDailySuccessCap: 1,
  perUserDailyAttemptCap: 2,
  appDailyAiSuccessCap: 200,
  appDailyAiCallCap: 500,
  jobLeaseMinutes: 15,
  emergencyMaxCandidates: 5,
  sharePoolFetchLimit: 20,
  maxGlobalRunning: 4,
  maxPerUserRunning: 1,
} as const;
// shareSkipReasons: not_emergency_duration | pantry_bound | consent_revoked | ineligible_structure | ...
// shareFailureCodes: lease_expired | server_gate_failed | openrouter_failed | ...
// consent_revoked は skip 側のみ（failure に入れない）
export function isCurrentShareConsent(row: {
  consent_version: string;
  revoked_at: string | null;
}): boolean;
```

- [ ] **Step 1: RED** — version 固定、旧版 reject、`consent_revoked` が skip にあり failure にない、running caps が数値で存在

- [ ] **Step 2:** `docker compose run --rm --no-deps app npx vitest run shared/contracts/share-consent.test.ts shared/contracts/share-quota.test.ts shared/contracts/share-job.test.ts` → FAIL

- [ ] **Step 3: GREEN 実装**

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat: 共有同意・抽選枠・jobコードの契約を追加`

---

### Task 2: 適格ゲートとカノニカル（構造のみ・メタなし）

**Files:**
- Create: `shared/emergency/share-eligibility.ts` + `.test.ts`
- Create: `shared/emergency/share-canonical.ts` + `.test.ts`
- Use fixture helper: `shared/testing/factories.ts` の `makeValidatedMenu` 系

**Produces:**
```ts
evaluateShareEligibility(menu: ValidatedMenu):
  | { ok: true }
  | { ok: false; reason: ShareSkipReason };

buildShareCanonicalMenu(menu: ValidatedMenu, idFactory: () => string):
  | { ok: true; menu: ValidatedMenu }
  | { ok: false; reason: ShareSkipReason };
// ※ standardAllergenIds / eligibleAgeBands はここでは返さない・付けない
```

**Rules:**
- ≤15 分、dish 最低構成、steps/timeline 非空、全 `pantrySelectionId === null`
- 全 id 再採番（source と不一致）
- `labelConfirmations: []`、pantry 空
- adaptations を**ソースからコピーしない**。中立 `member_1` テンプレのみ。ソース `portionText` が残っていたらテスト失敗
- safetyActions を決定論 rebind 不能 → `ok: false`
- 表示名スナップショットを自由文に残さない

- [ ] **Step 1: RED（必須ケース）**

```ts
it("rejects totalElapsedMinutes > 15", …);
it("rejects any pantrySelectionId non-null", …);
it("assigns menuId different from source", …);
it("does not copy source adaptation portionText", () => {
  const source = makeValidatedMenuWithPortion("太郎は骨を取り除いて少なめ");
  const result = buildShareCanonicalMenu(source, testIdFactory);
  expect(result.ok).toBe(true);
  if (result.ok) {
    for (const a of result.menu.adaptations) {
      expect(a.portionText).not.toContain("太郎");
      expect(a.anonymousMemberRef).toBe("member_1");
    }
  }
});
it("fails closed when safetyActions cannot be rebound", …);
it("never returns empty adaptations array on ok:true", …);
```

- [ ] **Step 2–4: RED→GREEN→PASS**

- [ ] **Step 5: Commit** `feat: 共有化の緊急適格とカノニカル構造化を追加`

---

### Task 3: DB・public definer RPCs・pgTAP・inventory

**Files:**
- Create: `supabase/migrations/<ts>_share_community_emergency.sql`
- Create: `supabase/tests/database/share_community_emergency.test.sql`
- Modify: `supabase/tests/database/account_deletion.test.sql`
- Modify: `supabase/tests/database/rls_inventory.test.sql`
- Modify: `docs/testing/database-access-matrix.md`
- typegen: `./scripts/generate-database-types.sh`（成功時 commit に含める。失敗時 Task 停止）

**Must implement RPCs** listed in「DB アクセス面」。

**try_enqueue_share_job:**
1. menu exists + owner
2. **does not** reserve attempt until lottery wins path; eligibility is enforced by caller TS **and** worker; attempt only after job insert
3. consent current version + revoked_at is null
4. caps
5. lottery
6. unique insert job pending
7. attempt++

**publish_shared_emergency_recipe:** 単一トランザクションで:
```sql
-- pseudocode
IF NOT consent_valid(contributor) THEN mark job skipped consent_revoked; RETURN;
INSERT pool …;
INSERT origin …;
success ledger++;
mark job succeeded;
```

**pgTAP RED/GREEN cases（Step 1 に全部書く）:**
- private 表に service_role table grant が **無い**
- jobs/origins/pool に列名 `user_id` が **0 本**
- authenticated が pool/jobs/origins を SELECT できない
- `list_my_shared_emergency_recipes` as other user → 0 rows
- revoke 後 `try_enqueue` が job を作らない
- auth.users 削除後: consent 消滅、pool 行数不変、origins.contributor_user_id IS NULL
- `reap_stale_share_jobs`: running + old heartbeat → failed lease_expired、同一 source_menu 再 enqueue 不可（unique）

- [ ] **Step 1: テスト SQL を書く**

- [ ] **Step 2: migration + RPCs**

- [ ] **Step 3:** `docker compose --profile test run --rm db-test`（またはプロジェクト正の db-test）

- [ ] **Step 4: typegen + account_deletion + rls_inventory + access matrix**

- [ ] **Step 5: Commit** `feat: 共有プールのスキーマとpublic definer RPCを追加`

---

### Task 4: `/privacy` dual checkbox + share API + privacy-copy

**Files:**
- Modify: `src/features/privacy/privacy-notice-page.tsx`
- Modify: `src/features/privacy/privacy-notice-page.test.tsx`
- Modify: `src/features/privacy/privacy-copy.ts` + test
- Create: `src/features/privacy/share-consent-api.ts` + test
- Create: `src/features/privacy/share-consent-queries.ts`

**Behavior:**
- 共有は**別カード**、既定 unchecked
- primary enable = privacy チェックのみ
- 進む: privacy accept + （share on なら）`upsert_my_share_consent(version, true)`
- 必須フレーズ（`privacy-copy` 定数配列）を `toContain` で RED 固定:
  1. ランダム / 選べない
  2. 家族名・アレルギー設定そのものは共有しない
  3. 一般化してから使う
  4. 誰が作ったかは出ない
  5. 止めても既提供分は残る
  6. 安全保証しない
- 削除後に匿名緊急本文が残ることがある、を privacy-copy に追記

- [ ] **Step 1–4: RED→GREEN→vitest `src/features/privacy`**

- [ ] **Step 5: Commit** `feat: 初回privacyに任意の共有同意を追加`

---

### Task 5: 設定トグルと管理一覧

**Files:**
- Modify: `src/features/household/household-settings-page.tsx`
- Create: `src/features/privacy/share-consent-settings-section.tsx` + test
- 既存 `share-consent-api` に revoke/reaccept/list を追加

**Behavior:**
- トグル off → upsert accept=false（revoke）。確認文に「既提供分は残る」
- トグル on → 現行 version で reaccept
- 一覧: `list_my_shared_emergency_recipes` → title + date only

- [ ] **Step 1–4: RED→GREEN→vitest**

- [ ] **Step 5: Commit** `feat: 共有同意トグルと提供管理一覧を追加`

---

### Task 6: finalize 後 enqueue（OpenRouter 禁止）

**Files:**
- Create: `netlify/functions/_shared/share-enqueue.ts` + `.test.ts`
- Modify: `netlify/functions/_shared/generation-service.ts`  
  **唯一のフック:** `succeedOrConflict` 内、`status.status === "succeeded"` かつ `completed_menu_id` hydrate 後。conflict/timeout/failed では呼ばない。
- Modify: 関連 generation-service test

**Produces:**
```ts
export async function maybeEnqueueShareJob(input: {
  menuId: string;
  menu: ValidatedMenu;
  admin: SupabaseClient; // service role → public.try_enqueue_share_job のみ
}): Promise<void>; // never throws
```

**Rules:**
- `evaluateShareEligibility` が false なら RPC しない（attempt 不消費）
- RPC のみ。OpenRouter / Pass pipeline を import しない
- レスポンス wire に share フィールドを足さない
- 失敗は握りつぶし（生成成功を壊さない）

- [ ] **Step 1: RED**

```ts
it("does not call rpc when over 15 minutes", …);
it("does not call rpc when pantry-bound", …);
it("calls try_enqueue_share_job once when eligible", …);
it("swallows rpc errors", …);
it("module does not import share-generalize-pipeline or openrouter share helpers", () => {
  // static: read source or dependency graph assertion
});
```

- [ ] **Step 2–4: GREEN + generation-service 接続テスト**

- [ ] **Step 5: Commit** `feat: 生成成功後に共有化jobをenqueueする`

---

### Task 7a: claim / lease / reaper / concurrent caps（AI なし）

**Files:**
- Modify: migration 追補が必要なら `<ts>_share_claim_reaper.sql`（または Task 3 に未実装ならここで完成）
- Modify: `netlify/functions/_shared/maintenance-db.ts`（`MaintenanceCounts` に `stale_share_jobs_reaped` 等を**閉じたキー**で追加）
- Modify: `netlify/functions/maintenance-cleanup.ts` + tests
- Create: `netlify/functions/share-generalize-worker.ts` スケルトン（claim のみ）
- Create: tests for claim single-winner、cap、reaper

- [ ] **Step 1: RED** — double claim 1 winner; maxGlobalRunning; lease_expired via reap; maintenance counts parse

- [ ] **Step 2–4: GREEN**

- [ ] **Step 5: Commit** `feat: 共有jobのclaimとlease reaperを追加`

---

### Task 7b: サーバー関門・denylist・publish metadata（AI なし）

**Files:**
- Create: `shared/contracts/share-denylist.v1.ts` + test
- Create: `shared/emergency/share-publish-metadata.ts` + test
- Create: `netlify/functions/_shared/share-server-gate.ts` + test

**Produces:**
```ts
computeSharePublishMetadata(menu, allergenCatalog):
  { standardAllergenIds: string[]; eligibleAgeBands: AgeBand[] };
// standardAllergenIds は材料照合ヒットを保守的付与。
// 「計算不能」や「意図的に空で全通し」は禁止:
//   材料からアレルゲン候補が1つも取れない一般食材のみ [] を許可するが、
//   egg 等を含む材料名があるのに [] は fail（RED で固定）

runShareServerGate(menu): { ok: true } | { ok: false; code: ShareFailureCode };
// Zod + graph 不変入力比較 + denylist on all text including ingredient.name
```

- [ ] **Step 1: RED**

```ts
it("flags egg-like ingredient into standardAllergenIds", …);
it("rejects guarantee phrase アレルギーでも安心", …);
it("rejects ingredient name containing 太郎の", …);
it("rejects graph quantity mutation vs locked snapshot", …);
it("under-six household filter drops community with only neutral portion and no bound safetyActions", …);
// 最後の1つは filter 側でも再掲可。ここでは canonical+metadata の組み合わせを固定
```

- [ ] **Step 2–4: GREEN**

- [ ] **Step 5: Commit** `feat: 共有publishのサーバー関門とメタ算出を追加`

---

### Task 7c: Pass1 / Pass2 OpenRouter（generate 台帳非接触）

**Files:**
- Create: `netlify/functions/_shared/share-openrouter.ts` + test
- Create: `netlify/functions/_shared/share-generalize-pipeline.ts`（AI 段）+ test
- 既存 openrouter ヘルパを流用するが **reserve_ai_generation を呼ばない**

- [ ] **Step 1: RED**

```ts
it("records two AI call ledger increments on Pass1+Pass2 success", …);
it("records AI call on Pass failure without success publish", …);
it("never calls reserve_ai_generation", …);
it("merges model free-text but restores ingredient quantities from lock", …);
it("does not publish when Pass2 fails after Pass1 ok", …);
```

- [ ] **Step 2–4: GREEN**

- [ ] **Step 5: Commit** `feat: 共有一般化のPass1/Pass2 OpenRouterを追加`

---

### Task 7d: worker 結合 — consent 再確認 publish + ログ

**Files:**
- Modify: `netlify/functions/share-generalize-worker.ts`
- Modify: `netlify/functions/_shared/logger.ts`（`SafeLogEvent` に share 用の閉じたフィールドのみ追加: jobId, failureCode, sourceCounts 等。自由文キー禁止）
- Create: `netlify/functions/_tests/share-generalize-worker.test.ts`

**Pipeline order（固定）:**
1. claim
2. load menu
3. eligibility + canonical（構造）
4. Pass1 → Pass2
5. server gate
6. computeSharePublishMetadata（空 publish 禁止ルール適用）
7. `publish_shared_emergency_recipe` RPC（原子的 consent+insert）
8. finish job / AI call 台帳

- [ ] **Step 1: RED**

```ts
it("skips publish when consent revoked before publish RPC", …);
it("never inserts pool when gate fails", …);
it("payload menuId !== source menu id", …);
it("safeLog payload does not include dish titles or prompts", …);
it("worker entry is not imported from generation-service", …);
```

- [ ] **Step 2–4: GREEN**

- [ ] **Step 5: Commit** `feat: 共有一般化workerをpublishまで結合する`

---

### Task 8: emergency filter 多ソース化

**Files:**
- Modify: `shared/emergency/filter-emergency-menus.ts`
- Modify: `shared/emergency/filter-emergency-menus.test.ts`
- Modify: `shared/emergency/contracts.ts`（`no_matching_fixture` = S1∪S2 通過ゼロ とコメント）
- `remapFixtureForMembers` をコアから共有（export または candidates 経路内でのみ使用）

**Produces:**
```ts
filterEmergencyMenuCandidates(input: {
  …既存;
  candidates: EmergencySourceCandidate[];
  maxCandidates: number;
}): EmergencyFilterResult & { sourceCounts: { fixture: number; community: number } };
// S1 を先に Stage S し max まで採用 → 空きだけ community
// 一括 merge 後の source ソートだけにしない
```

- [ ] **Step 1: RED**

```ts
it("prefers fixture slots before community", …);
it("stops at maxCandidates", …);
it("drops community with empty adaptations", …);
it("does not return unconstrained community for post_weaning_to_2 requiredSafetyConstraints", …);
it("existing fixture-only wrapper still passes prior tests", …);
```

- [ ] **Step 2–4: GREEN + 全既存 filter テスト**

- [ ] **Step 5: Commit** `feat: 緊急献立フィルタを多ソース候補対応にする`

---

### Task 9: emergency-menus に S2 接続

**Files:**
- Modify: `netlify/functions/emergency-menus.ts`
- Modify: emergency 関連 function tests

**Behavior（household と idea の両 path）:**
1. S1 candidates を構築し Stage S
2. 採用数が `emergencyMaxCandidates` 未満のときだけ  
   `list_active_shared_emergency_recipes(meal_type, sharePoolFetchLimit, salt)`
3. community を candidates 化（metadata は DB 列）→ コア filter
4. S2 例外 → S1 のみ 200
5. `safeLog` に `sourceCounts` のみ（contributor 禁止）
6. `status=disabled` は RPC 側で除外

- [ ] **Step 1: RED**

```ts
it("passes LIMIT === shareQuota.sharePoolFetchLimit to list RPC", …);
it("does not call list RPC when S1 already filled maxCandidates", …);
it("response candidates length <= emergencyMaxCandidates", …);
it("returns 200 with fixtures only when list RPC throws", …);
it("applies S2 on both household and idea paths", …);
```

- [ ] **Step 2–4: GREEN**

- [ ] **Step 5: Commit** `feat: 緊急献立APIに共有プールを接続する`

---

### Task 10: e2e 薄締め・runbook

**Files:**
- e2e: privacy に共有チェックが見える / 未チェックでも生成導線が死なない（既存フローに最小 assert）
- Modify: `docs/runbooks/account-deletion.md`（pool 残存・origin unlink）
- 全体: `typecheck` / `lint` / focused vitest / db-test

**本 Task に新しいユニット責務を押し込みない**（§14 は各 Task RED に割当済み）。

- [ ] **Step 1–4: e2e or component + typecheck + lint**

- [ ] **Step 5: Commit** `test: 共有同意と緊急プールの受け入れを補強`

---

## 依存関係

```text
1 → 2 → 3 → 4
           → 5
           → 6
           → 7a → 7b → 7c → 7d
           → 8 → 9
4,5,6,7d,9 → 10
```

4∥5∥6∥7a∥8 は Task 3 完了後に並行可（同一 worktree なら single-writer で直列でも可）。

## Spec coverage

| 設計 | Task |
| --- | --- |
| §6–6.6 データ・RPC・原子性 | 3, 6, 7a, 7d |
| §7 UI / copy | 4, 5, 10 |
| §8 適格・抽選定数 | 1, 2, 6 |
| §9 カノニカル・2パス・関門・メタ | 2, 7b, 7c, 7d |
| §10 緊急合成 | 8, 9 |
| §11 RLS・削除・worker・ログ | 3, 7a, 7d, 10 |
| §14 各テスト | 各 Task RED（10 に押し込み禁止） |

## レビュー反映（計画）

| 指摘 | 対応 |
| --- | --- |
| private 直 SELECT/rpc | public definer 一覧に固定 |
| 空 standardAllergenIds fail-open | Task 2 から除去、7b で必須算出 |
| Task7 メガコミット | 7a–7d |
| reaper あいまい | 7a + maintenance counts |
| finalize / settings パス未固定 | generation-service / household-settings-page |
| under-six / PII / LIMIT / revoke 原子 / CASCADE / ログ | 各 Task の RED に具体ケース |
| consent_revoked を failure に入れない | Task 1 |
| generate 台帳分離 | 7c RED |
| access matrix / rls_inventory | Task 3 |
