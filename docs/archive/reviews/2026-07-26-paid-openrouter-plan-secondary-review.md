# Plan 8 Secondary Review — 2026-07-26

## Verdict
**REVISE_BEFORE_EXECUTE**

## Summary
設計（`2026-07-26-paid-openrouter-models-design.md`）の敵対的ロック（structured **AND**、mock は exact `OPENROUTER_BASE_URL` のみ、privacy 互換なし、quota 3/6/20 相互作用）は Plan の Global Constraints / Task 2–4 に概ね正しく固定されている。PR1–5 と Task 1–5 の対応、matrix とテスト title の同一 Task 改訂、ベンチ 0 合格で ship 不可も設計と一致する。

ただし **Task 2 の検証コマンドがそのままだと現行 `openrouter.test.ts` / `env.test.ts` / preflight fixtures で必ず落ちる**のに、逆転すべきランタイム拒否ケースや context 付き呼び出しの更新手順が Step に落ちていない。**Task 3 は SQL の権威 migration が関数ごとに異なり、`get_ai_generation_status` を明示していない**うえ、`userDailyLimit: 5` / `limit: 5|12` を持つ Vitest 面が広く、検証スコープが狭すぎてコミット後 CI が赤のまま残りやすい。加えて設計 §8.1 の **CLAUDE.md / 運用エージェント向け free-only・5/12/45 文言**が Plan の Task から漏れている。実行前に Plan を改訂すべき。

## Adversarial lock check

| Constraint | Design | Plan | Code today | Status |
|------------|--------|------|------------|--------|
| structured_outputs **AND** response_format（OR 禁止） | §4.1.6 / §12-3 | Global + Task 2 `verifyRemoteModels` に `\|\|` 拒否 | `verify-openrouter-models.mjs` L41 が既に AND | **OK** — 緩和なし |
| mock 例外は **OPENROUTER_BASE_URL** exact mock のみ | §4.2.1 | Global + `isExactLocalMockBaseUrl`；isLocal 禁止を明記 | mock 判定は `openrouter.ts` のみ；パーサは base 非依存・`:free` 必須 | **OK** — 設計どおり拡張 |
| パーサは context 必須・3 鏡像 | §4.2.2 | Locked interface + env/verify/preflight | `parseOpenRouterModels(value)` のみ（preflight も同） | **OK**（実装前） |
| privacy version bump・旧同意無効・互換パーサなし・300s | §7 | Task 4 + rollout 注記 | `privacyNoticeVersion = "2026-07-11.v1"`；copy は無料前提 | **OK** |
| quota 3/6/20 相互作用 intentional | §5.2 / §12-4 | Global + Task 1 一文 + Task 3 | releaseQuota 5/12、SQL `<> 5` / `>= 12` / `1..45`、文言「5回」 | **OK**（値は Task 3） |
| 時間 20/50/180・短期 4/600 据え置き | §3 / §5 | Global で固定 | env ロック済み | **OK** |
| ルーター拒否集合 auto/free/auto-beta | §4.1.2 | Global + runtime snippet | 現行は実質 `auto` と「非 `:free`」のみ | **OK**（拡張予定） |
| 単価 prompt+completion ≤ $0.50、request/cache 無視 | §4.1.7 / §12-8 | Global + `verifyRemoteModels` | 未実装（remote は構造化のみ） | **OK**（Task 2） |
| 有料キー total limit / ベンチは完了ゲート | §4.4 / Open Q | Task 5 + ship 不可 | smoke は `:free` 期待 | **OK** |

## Spec coverage gaps

| 設計 | Plan 対応 | 判定 |
|------|-----------|------|
| §4 モデル規則・mock・runtime・AND・単価 | Task 2 | 方向は十分。実行手順・fixture 逆転が不足（Findings） |
| §4.4 N=10 ゲート | Task 5 | あり。クレジット未解消で完了不可を明記 |
| §5 quota env+SQL+copy | Task 3 | あり。SQL 関数列挙とテスト面が不足 |
| §5.3 文言 2 鏡像 | Task 3（generation.ts + generation-service.ts） | OK |
| §7 privacy | Task 4 | 概ね OK。旧 version 拒否テストは薄い |
| §8.1 docs: MVP / netlify / runbook / checklist / matrix / README | Task 1–2, 5 | **CLAUDE.md（と roadmap Locked Contract 参照）漏れ** |
| §8.1 compose / secrets / CI env | Task 3「compose/CI」 | compose はリストにあるが `tests/tooling/compose.test.mjs` 未明示 |
| §9 単体（isLocal だけでは mock 不可） | Task 2 に「isLocal 禁止」文言のみ | **明示 RED ケースが弱い** |
| §9 privacy 旧拒否・再同意 | Task 4 | 部分的 |
| §14 PR 分割と matrix 先行禁止 | Task 1 が matrix 触らない；Task 2 で matrix | OK |

## Findings

### F1 — Severity: Critical
- **Location:** Plan Task 2 Step 6–9 / 現行 `netlify/functions/_shared/openrouter.test.ts`
- **Evidence:**
  - 現行ガード（`openrouter.ts` L116–121）は `openrouter/auto` または **`:free` で終わらない ID** を `model_unavailable`。
  - テスト `rejects %s configured models before fetch` に **`["non-free", ["paid/model"]]`** があり、**有料 ID 拒否を期待**している（L394–411）。
  - 同ファイルの `config` は `parseServerEnv` で `OPENROUTER_MODELS` が `*:free`、`OPENROUTER_BASE_URL` が `http://mock.invalid/v1`（exact mock ではない）（L19–30）。
  - Plan Step 6 の新ガードは **有料を正常系**、`:free` を real API で拒否する。Step 9 は `openrouter.test.ts` を実行する。
- **Impact:** 手順どおり GREEN すると Step 9 で必ず FAIL。実装者が「有料も拒否のまま」と誤解すると設計を弱める。
- **Required fix:** Task 2 に明示:
  1. `non-free` ケースを削除し、**real base 上の `:free` 拒否**（および router 集合）ケースへ置換。
  2. 正常系 models を **有料 ID**にするか、free を使うなら base を **exact mock URL** にする（`parseServerEnv` が context 付き規則で落ちないこと）。
  3. `getServerEnvMock` 経路でも baseUrl と models の組み合わせを新規則と一致させる。

### F2 — Severity: Critical
- **Location:** Plan Task 2 Step 1/4 / 現行 `env.test.ts`・`preflight-production.test.mjs`・契約テスト
- **Evidence:**
  - `env.test.ts` は `parseOpenRouterModels(raw)` を **引数 1 個**で呼び、`acceptedFreeModelLists` を直接回す（L34–40）。`validServerEnv` は free ID 列かつ **OPENROUTER_BASE_URL 未設定 → 既定公式 URL**（`env.ts` L60）。
  - `preflight-production.test.mjs` の `completeEnv` は `OPENROUTER_MODELS: "...:free"` + 公式 base（L31 付近）。
  - `verify-openrouter-models.test.mjs` の remote 成功ケースは pricing なし（L56–67）。Plan の `verifyRemoteModels` は pricing 必須。
  - Step 9 は上記スクリプト／env／preflight テストをすべて実行する。
- **Impact:** context 追加・有料規則・単価ゲート導入後、fixture 未更新なら Task 2 検証が通らない。実装者が preflight だけ旧 free を残すと本番 preflight と契約が割れる。
- **Required fix:** Task 2 Steps に fixture 更新を必須チェックとして列挙:
  - 契約配列を baseUrl 付きに（または accept を paid-path / mock-path に分割）し、**全呼び出しが context を渡す**。
  - `validServerEnv` / preflight `completeEnv` を **公式 base + 有料 ID** または **mock base + mock/*:free** に。
  - remote フィクスチャに `pricing.prompt` / `pricing.completion` を追加し、欠落・超過の拒否テストを RED で先に書く。
  - 契約 export 名が `acceptedFreeModelLists` のままなら、少なくともコメント／名称を有料規則に合わせて誤解を防ぐ。

### F3 — Severity: Important
- **Location:** Plan Task 3 Step 3–4 / SQL 現状
- **Evidence:**
  - Plan が列挙する関数: `reserve_ai_generation`、`reserve_ai_repair_call`、`get_ai_usage_today` **等**。
  - **最新の `reserve_ai_generation` 本体**は `supabase/migrations/20260722225217_generation_command_v2.sql`（`p_user_limit <> 5`、`between 1 and 45`、`>= 12`）。
  - **`reserve_ai_repair_call` / `get_ai_generation_status`** は `20260711002000_ai_control_and_quota.sql` が最後の CREATE（status 側も `p_user_limit <> 5` と usage 内 `'limit', 5/12`）。
  - **`get_ai_usage_today` 最新**は `20260726120000_adversarial_review_fixes.sql`（`default 45`、`between 1 and 45`、`greatest(5 - …)` / `greatest(12 - …)`、`'limit', 5/12`）。
  - Plan の CHECK 例は架空名 `ai_user_daily_usage_reserved_count_success_count_check`；実 DDL は **無名 table CHECK**（`<= 5` / `<= 12`）。`\d` 確認注記はあるが attempt 側は drop 手順が薄い。
- **Impact:** `get_ai_generation_status` を落とすと env は 3 なのに status RPC が `release_quota_mismatch` または表示 limit 5 のまま。古い migration から丸コピーすると generation_command.v2 以降の HMAC/integrity を巻き戻す危険。
- **Required fix:** Task 3 に **関数ごとの権威ファイル**を表で固定し、`get_ai_generation_status` を必須に。CHECK は `pg_constraint` で conname 解決してから drop/add。global は table CHECK が無いこと（関数帯のみ）を明記。コピー元を「最新 migration 全文」ではなく **HEAD で `\sf+` / 最終 CREATE を特定**と書く。

### F4 — Severity: Important
- **Location:** Plan Task 3 Files / Step 4 検証範囲 vs リポジトリ実態
- **Evidence（ハードコード 5/12/45 の例、抜粋）:**
  - `compose.yaml` L140–144；`tests/tooling/compose.test.mjs` L284–288
  - `netlify/functions/_tests/usage-today.test.ts`（limit 5/12、global 45；matrix 行 17 の title 保有）
  - `generation-repository.test.ts` の `p_user_limit: 5` / `globalDailyLimit: 45`
  - 多数の UI/hooks テストの `userDailyLimit: 5`（`generation-page`、`generation-machine`、`use-generation-recovery` 等）
  - `scripts/preflight-production.mjs` exact 5/12 と global max 45（Task 3 で変更と書いてあるが Step 4 で preflight テストを回していない）
  - Zod `z.literal(releaseQuota.userDailySuccessLimit)` により、`user_daily_limit: 5 as const` 系 fixture は releaseQuota 更新後に実行時失敗しやすい
- **Impact:** Step 4 が `generation.test.ts` + `env.test.ts` + pgTAP のみだと、**Task 3 コミット直後にフル Vitest / compose tooling が赤**になりやすい。設計の「env と SQL 同時」は満たしてもアプリ層の期待値ドリフトが残る。
- **Required fix:**
  1. Task 3 に `rg` による残存スキャン手順（`USER_DAILY_AI_LIMIT.: .5`、`userDailyLimit: 5`、`p_user_limit: 5`、`limit: 12`、`globalDailyLimit: 45`、`between 1 and 45` 等）を必須化。
  2. 検証に少なくとも `usage-today.test.ts`、`preflight-production.test.mjs`、`tests/tooling/compose.test.mjs`、generation 関連の `userDailyLimit` 使用テストを含めるか、Task 3 完了条件を「上記 rg が AI クォータ文脈で 0」にする。
  3. **feedback の `p_limit default 5`**（別機能）を誤置換しない注記。

### F5 — Severity: Important
- **Location:** Plan File Structure / Tasks vs 設計 §8.1・現行 `CLAUDE.md` / roadmap
- **Evidence:**
  - 設計 §8.1: README / **CLAUDE.md** / 必要なら AGENTS.md を free-only・5 回と矛盾なく更新。
  - `CLAUDE.md` L99–100: only `:free`；L108–110: 5 / 12 / 45。
  - `docs/archive/superpowers/plans/2026-07-11-kondate-mvp-00-roadmap.md` Locked Environment Contract も free-only と 5/12/45（CLAUDE が「roadmap の値を正」と指示）。
  - Plan Task 1 は MVP 設計本文のみ；Task 2 は netlify/runbook/checklist；**CLAUDE.md / roadmap なし**。
- **Impact:** 実装中エージェントが CLAUDE/roadmap の free-only を権威と誤読し、有料 allowlist を「仕様違反」として戻す。プロセス文書とコードが分裂する。
- **Required fix:** Task 1 または独立 docs ステップで **CLAUDE.md の free-only と 5/12/45 を本設計値へ**。roadmap Locked Contract も同様（または「Plan 8 以降は paid design が上書き」と明示クロスリファレンス）。AGENTS.md に該当が無ければ「該当なし」と書いて閉じる。

### F6 — Severity: Important
- **Location:** Plan Task 2 Step 8（matrix 行 17 の数値仮置き）
- **Evidence:** 設計は acceptance-matrix とテスト title を **PR2 同一**で更新し、数値改訂は PR3。Plan は行 17 を Task 2 で 3/6/20 に寄せても「Task 3 で確定でも可」と両論。
  - `verify-acceptance-matrix.mjs` は **Scenario 文中の 5/12 ではなく citation title の部分一致**のみ検証（L107–111）。
  - 行 18 は今も `rejects unsafe model configuration` を緊急献立の証拠に載せている（モデル規則と無関係な結合）。
- **Impact:** 重大な CI 割れにはなりにくいが、受入行列が Task 2 終了時点で「3/6/20 と書いてコードは 5/12」または逆になり、レビュー混乱・誤 ship 判断の元。
- **Required fix:** 行 17 の **数値 Scenario は Task 3 のみ**と固定。Task 2 は行 19（と必要なら 18 の emergency 文言）と **モデル系 title** だけ。行 18 から model verify title を外すか、emergency 専用 title のみ残す。

### F7 — Severity: Important
- **Location:** Plan Task 2 `main` mock remote skip / ローカル `.env` 実 API free
- **Evidence:**
  - Plan: mock base なら `--remote` でも remote skip。
  - 設計: ローカル origin でも公式 base なら有料規則のみ。
  - ホスト `.env` が公式 base + `:free` MODELS のとき、compose は `${OPENROUTER_MODELS}` を取り込み、Task 2 後 **app predev の `verify:openrouter:config` が起動失敗**し得る（compose 既定 mock は上書きされる）。
- **Impact:** 実装者のローカル dev が「Plan のバグ」に見える。README/runbook 更新が Task 2/5 に分散し、Task 2 時点で dev 手順が無い。
- **Required fix:** Task 2 の運用 docs に「公式 base では `:free` 不可。ローカルは mock base+mock models、または有料 ID+クレジット」を必須追記。`generate-local-secrets` は既に mock でよい旨を確認済みと書く。

### F8 — Severity: Minor
- **Location:** Plan Task 2 Step 3 と Locked interface；`parseConfiguredModels(raw, context = {})`
- **Evidence:** 設計の TS 契約は `context: OpenRouterModelsParseContext` 必須。Plan の JS は default `{}` → 公式 base。preflight は公式 URL 明示渡しでよい。
- **Impact:** 鏡像間で「必須 vs 省略可」の差。テストが context 省略に依存すると TS 側と乖離。
- **Required fix:** JS も「省略時は公式」を契約コメントで固定し、env.ts は必須のまま。省略可をテストの主経路にしない。

### F9 — Severity: Minor
- **Location:** Plan Task 1 Step 4；Task 3 RED/GREEN 混在；Task 5 と Open Questions
- **Evidence:**
  - 本設計の状態行は既に「実装 Plan 作成済み」。Step 4 は実質 no-op。
  - Task 3 Step 1 が `releaseQuota` 本体変更とテスト期待更新を同じ「RED」に置いており、純粋 RED が取りにくい。
  - Task 5 はクレジット必須を正しくゲート。API key 未解消時はスクリプト追加のみで Plan 完了不可と明記済み — **外部 blocker の扱い自体は妥当**。
- **Impact:** プロセスの明瞭さのみ。
- **Required fix:** Task 1 Step 4 を削除または「実装中」へ更新。Task 3 は「テスト期待を先に 3/6/20 に → RED → 実装」と順序を分離。

### F10 — Severity: Minor
- **Location:** Plan Task 4 privacy copy；設計 §7.1
- **Evidence:** `src/features/privacy/privacy-copy.ts` の `providerExplanation` が「無料モデル」「無料モデル提供者」。Task 4 Step 2 は更新指示あり。`schemaVersion: "2026-07-11.v1"`（menu 等）を触らない注記は正しい。
- **Impact:** 手順に従えば足りる。旧 version を意図的に 1 本残して reject するテストを「必須」と書いていない点だけ弱い。
- **Required fix:** 「旧 `2026-07-11.v1` を privacy フィールドに載せた request が Zod で失敗するテストを 1 本必須」と追記。

## Primary-independent notes

実行を止める／高確率で止める点（一次レビュー有無に依存しない）:

1. **Task 2 は現行テストの意味反転（有料拒否 → 有料許可）を書かないと Step 9 が成立しない**（F1–F2）。
2. **Task 3 の SQL は関数ごとに最終 migration が違う**。`get_ai_generation_status` 漏れと v2 巻き戻しが最大の DB リスク（F3）。
3. **quota 数値の参照面が Plan 記載より広い**。狭い検証のままコミットするとブランチ CI が赤（F4）。
4. **エージェント向け権威文書（CLAUDE.md / roadmap ロック表）が free-only のまま**だと、後続 Task が設計を再導出する（F5）。
5. 敵対ロック（AND / mock URL / privacy 非互換 / 3×6×20 相互作用）自体を Plan が弱めている箇所は **見つからなかった**。

## Recommended plan edits (if REVISE)

1. **Task 2:** F1/F2 の fixture・テスト逆転チェックリストを Step 化。remote pricing RED を追加。`openrouter.test.ts` / `env.test.ts` / `preflight-production.test.mjs` / `verify-openrouter-models.test.mjs` を「必須更新ファイル」として Files に残しつつ Steps から参照。
2. **Task 2 Step 8:** matrix 行 17 の数値は Task 3 専任；行 18/19 の title と Scenario の責務を分離。
3. **Task 2 docs:** ローカル `.env` が公式 base + free のときの起動失敗と、mock への戻し方を runbook/README に書く。
4. **Task 3:** 関数×権威 migration 表 + `get_ai_generation_status` 必須。CHECK は conname 解決。全リポジトリ rg スキャンと検証ファイル拡張。feedback limit 5 の除外。
5. **Task 1 または docs サブステップ:** `CLAUDE.md` と roadmap Locked Environment Contract を有料 allowlist・3/6/20 に整合（または上書き参照）。
6. **Task 4:** 旧 privacy version 拒否の必須テスト 1 本。
7. **Global / Self-Review:** 上記を spec coverage 表に反映。Task 間で「中間コミット後に `npx vitest run` が緑である」ことを Task 2/3 完了条件に近づける。

## What is fine (do not re-litigate)

- structured **AND** 維持、単価 ≤0.5（境界含む）、request/cache 非加算。
- mock 信号を `SERVER_SITE_ORIGIN` / isLocal に混ぜない方針。
- privacy 互換パーサ禁止・同一デプロイ・continuation 300s fail-closed の文書化。
- 成功 3 × attempt 6 × global 20 の相互作用を「成功保証しない」と明示する判断。
- matrix のテスト title 連動をモデル契約 Task に閉じ、PR1 で matrix 先行しないこと。
- 時間予算・短期窓・ledger/HMAC/repair 骨格を触らない非目標。
- Task 5 の有料ベンチを外部クレジット依存の完了ゲートとし、0 合格で本番有効化しないこと。
- preflight が常に公式 base 前提で mock 例外到達不能、という設計ミラー。
- コミットメッセージ日本語・識別子英語・Docker 経由の検証コマンド方針。
