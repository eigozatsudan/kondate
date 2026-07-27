# Plan 8 有料 OpenRouter — live ゲート証跡（2026-07-27）

**結論: ゲート不合格（PASS 0 構成）。response-format 改訂後の exact 3 構成 N=10 再評価でも合格なし。本番 `OPENROUTER_MODELS` を確定できない。本番適用は行わない。**

## Live gate evidence（第1ラウンド・履歴）

> 現行の post-revision ゲート結果は下記 **第4ラウンド** を正とする。本節は改訂前の個別 ID N=10 履歴。

- Date: 2026-07-27T05:0x–05:2xZ (UTC) / 2026-07-27 14:0x–14:2x JST
- Worktree: `.worktrees/plan8-paid-openrouter` / Branch: `plan8/paid-openrouter-models`
- HEAD (ベンチ実行時): `525dbc5`（本書記載時 HEAD は `89b3f06`。差分は smoke test 追加のみでベンチ経路に影響なし）
- Key: 実キー（`is_free_tier: false`）。**total limit = $1 設定済み**、実行後 usage $0.0002665 / remaining $0.9997335
- `verify-openrouter-models.mjs --remote`（候補5本を設定した場合）: **FAIL** — `google/gemma-3-27b-it exceeds max prompt+completion USD per 1M tokens`
- N=10 ベンチ (`benchmark-paid-openrouter-models.mjs`): **exit 1 / PASS models = (none)**
- Recommended `OPENROUTER_MODELS` = **n/a（合格 0 本のため提案しない）**
- `OPENROUTER_BASE_URL` = `https://openrouter.ai/api/v1`（公式 exact・変更なし）
- Quota locks: 3 / 6 / 20（変更なし）
- privacyNoticeVersion: `2026-07-26.v1`（変更なし）
- Key total limit: **operator 設定済み（$1、API 応答で確認）**
- Production deploy: **NOT done（人間承認待ち・そもそもゲート不合格）**

## 機械フィルタ（§4.4.1）

| ID | 判定 | 理由 / prompt+completion USD per 1M |
|----|------|-------------------------------------|
| `mistralai/mistral-small-3.2-24b-instruct` | KEEP | 0.4000 |
| `openai/gpt-oss-120b` | KEEP | 0.2070 |
| `google/gemma-3-27b-it` | **EXCLUDE** | 単価超過 0.53 > 0.50 |
| `qwen/qwen3-30b-a3b-instruct-2507` | KEEP | 0.2412 |
| `meta-llama/llama-3.1-8b-instruct` | KEEP | 0.1300 |

structured_outputs AND response_format は survivor 4 本とも充足（AND 判定・緩和なし）。

## レイテンシ/形状ゲート（§4.4.2, N=10, 20s）

1 回でも落ちた時点で残試行を打ち切る（課金抑制・全試行合格が必須のため結果は確定）。

| ID | 結果 | 初回失敗 |
|----|------|----------|
| `mistralai/mistral-small-3.2-24b-instruct` | FAIL (1/10 で終了) | 20004ms `invalid_json_envelope`（20s 予算で abort） |
| `openai/gpt-oss-120b` | FAIL (1/10 で終了) | 18345ms `outcome_not_success` |
| `qwen/qwen3-30b-a3b-instruct-2507` | FAIL (1/10 で終了) | 20001ms `invalid_json_envelope`（20s 予算で abort） |
| `meta-llama/llama-3.1-8b-instruct` | FAIL (1/10 で終了) | 18687ms `materialize_fail:duplicate_ref` |

PASS した model ID: **なし**。退出コード **1**。

## 参考: 非ゲート診断（時間予算 60s・各1回・合否判定には使わない）

20s 予算が唯一の原因かを人間の判断材料として切り分けるための追加計測。**ゲート条件の緩和ではない。**

| ID | elapsed | detail |
|----|---------|--------|
| `mistralai/mistral-small-3.2-24b-instruct` | 53056ms | `materialize_fail:pantry_name_mismatch` |
| `openai/gpt-oss-120b` | 38211ms | `materialize_fail:pantry_unit_mismatch` |
| `qwen/qwen3-30b-a3b-instruct-2507` | 60001ms | 60s でも未完了 |
| `meta-llama/llama-3.1-8b-instruct` | 10864ms | `materialize_fail:duplicate_ref` |

示唆: 時間予算を伸ばしても 4 本とも materialize/validate に到達できない（または 60s でも完了しない）。
**「20s/50s を緩めれば通る」という筋ではない。** 候補 ID の入れ替え、またはベンチプロンプト/設計の再検討が必要であり、
どちらも設計書 §4.4 に戻して人間が判断する事項。

## ローカル本番相当チェック（ゲートとは独立に実施）

| 項目 | 結果 |
|------|------|
| `npm run typecheck` (Docker) | PASS |
| `npm run lint` (Docker) | PASS (exit 0) |
| `node --test scripts/{verify-openrouter-models,benchmark-paid-openrouter-models,preflight-production}.test.mjs` | PASS 124/124 |
| pgTAP `docker compose --profile test run --rm db-test` | PASS — Files=24, Tests=813, Result: PASS（`paid_quota_upgrade_path.test.sql` を含む） |
| preflight 3/6/20 + 公式 base + 有料 allowlist | preflight ユニットテストで PASS。ただし**本番に載せる ID は未確定**（合格 0 本） |

本番 Netlify / Supabase には一切書き込んでいない。本番データにも触れていない。

## 第2ラウンド: 候補入れ替え（2026-07-27, 人間指示による）

単価上限 ≤ $0.50/1M かつ structured_outputs AND response_format を満たす **全 40 本**を Models API から列挙し、
上位帯（新しい・schema 準拠が強い・高速）から 6 本を評価。設計 §4.4 の `candidateModelIds` 定数は変更せず、
`runPaidBenchmark({ candidateIds })` に渡す評価実行として行った。

| ID | USD/1M | 結果 | 初回失敗 |
|----|--------|------|----------|
| `google/gemini-2.5-flash-lite` | 0.5 | FAIL | 1393ms `http_400` |
| `openai/gpt-5-nano` | 0.45 | FAIL | 445ms `http_404` |
| `openai/gpt-4.1-nano` | 0.5 | FAIL | 787ms `http_400` |
| `deepseek/deepseek-v4-flash` | 0.42 | FAIL | 20006ms `invalid_json_envelope`（20s abort） |
| `qwen/qwen3.5-flash-02-23` | 0.325 | FAIL | 20001ms `invalid_json_envelope`（20s abort） |
| `z-ai/glm-4.7-flash` | 0.46 | FAIL | 20003ms `invalid_json_envelope`（20s abort） |

**PASS 0 本 / exit 1。** 累計 2 ラウンドで合格 0 本。

### 400/404 の原因（provider メタデータのみ・AI 出力は扱わない）

| 検証 | 結果 |
|------|------|
| 本番 `menuResponseFormat` → `openai/gpt-4.1-nano` | 400 `Invalid schema for response_format: In context=(), 'oneOf' is not permitted.` |
| 本番 `menuResponseFormat` → `google/gemini-2.5-flash-lite` | 400 `The specified schema produces a constraint that has too many states for serving.` |
| 単純 root object schema → 両者 | **200**（キー・接続・課金は正常） |
| success ブランチのみを root object 化した variant (7060 bytes) → `openai/gpt-4.1-nano` | **200** |
| 同 variant → `google/gemini-2.5-flash-lite` | 400（依然 schema 複雑度超過） |

`menuResponseFormat` は `z.toJSONSchema(aiGenerationResponseSchema)` 由来で **root が `oneOf`**（success / constraint_conflict の union）。
OpenAI strict structured outputs は root `oneOf` を許可しないため、**OpenAI 系は本番 schema では到達不能**。
Gemini は複雑度上限で拒否する。いずれもモデル品質やレイテンシではなく **request schema の構造問題**。

## 設計 §4.4.2 形状要件レビュー（人間指示の第2段）

観測から、失敗は 3 クラスに分かれる。

**クラス A — strict provider（OpenAI / Gemini）: 本番 `response_format` を受理しない。**
モデル側の問題ではない。§4.4.2 を緩めても解決しない。`menuResponseFormat` の構造（root `oneOf`・schema サイズ）を
変えない限り、schema 準拠が最も強い層を候補にできない。`shared/contracts/generation.ts` の locked interface に触るため人間判断。

**クラス B — 20s 超過（deepseek-v4-flash / qwen3.5-flash / glm-4.7-flash / mistral-small-3.2 / qwen3-30b）。**
本番 `OPENROUTER_TIMEOUT_MS` も 20s のため、**本番でも同じく timeout する**。ゲート固有の厳しさではなく実運用不能。
60s 診断でも materialize/validate に到達しない（qwen3-30b は 60s でも未完了）。時間予算は据え置きが設計ロック。

**クラス C — 20s 内に応答するが初回で materialize/validate 落ち（llama-3.1-8b 10.9s `duplicate_ref`、gpt-oss-120b `outcome_not_success`）。**
ここだけが「§4.4.2 の形状要件が本番より厳しい」論点に該当する。本番経路は
`generation-service.ts` で `GenerationOutputError` を `kind: "invalid"` として受け、**repair 送信（1 生成あたり最大 2 外部送信）で回復し得る**。
一方 §4.4.2 は **repair なしの初回 10/10** を要求する。この差は意図的（N=10 の意味を保つ）だが、
「本番で成功する構成」を選ぶ基準としては保守側に振れている。

### 選択肢（いずれも設計改訂であり、実装は人間承認後）

1. **§4.4.2 を本番経路準拠に改訂**: 1 試行 = primary + 必要時 repair（外部送信 ≤2・合計 50s 以内）を 1 単位とし、
   その単位で 10/10 を要求する。20s/50s・3/6/20・AND・単価上限は不変。クラス C のみ救済される可能性がある。
2. **`menuResponseFormat` の構造改訂**: root union をやめ root object 化（`outcome` + nullable ブランチ）。
   probe で OpenAI 系は 200 になることを確認済み。Gemini はさらに schema 縮小が必要。
   locked interface（`shared/contracts`）とモック fixture に波及。最も有望だが影響範囲が最大。
3. **単価上限 $0.50/1M の見直し**（設計 §4.1.7 のロック値）。上位帯に候補を広げる。

クラス A/B は 1 では解決しない。1 単独で救済され得るのはクラス C のみである点に注意。

## 第3ラウンド: 選択肢 2 の実現可能性 probe（2026-07-27, 人間指示による）

リポジトリを変更せず、使い捨てスクリプトで root object 化 wire schema を実測した。

| 検証 | 結果 |
|------|------|
| 提案 wire schema (7644 bytes) 受理 | `openai/gpt-4.1-nano` **200** / `openai/gpt-5-nano` **200** / `google/gemini-2.5-flash-lite` 400（複雑度） |
| 提案 wire schema + **本番 `buildGenerationMessages`** + 本番 app gate (gpt-4.1-nano, 5 試行) | 全試行 **2.2–2.5s**・schema 適合。失敗は `materialize_fail:pantry_name_mismatch` |
| 同 + 本番同型 repair 送信 1 回（5 単位） | 全単位 FAIL（`outcome_not_success` / `invalid_provider_menu`）。合計 3.5–6.2s で時間予算内 |
| 同 + prompt 逐語コピー指示（5 単位） | 全単位 FAIL。失敗コードが全て `invalid_provider_menu` に潰れ**評価不能**になった |
| `openai/gpt-5-nano` の chat | `require_parameters: true` 下で 404（条件を満たす provider 無し）→ 候補外 |

判明した構造的問題: `toRepairDiagnostics` は `generationRepairCodes` に無いコードを `invalid_provider_menu` に
潰すため、**どの検査で落ちたか特定できない**（`generation-repair.ts` L93-107）。
また本番 system prompt は pantry `name`/`unit` の逐語一致を指示していないのに materializer は正規化後完全一致を要求する
（`generation-prompt.ts` L102-109/L191-198 vs `generation-materializer.ts` L148/L241）。

→ 改訂案は `docs/superpowers/specs/2026-07-27-paid-openrouter-response-format-revision-proposal.md` に分離。

## 次アクション（人間の判断が必要）

1. ~~上記選択肢 1 / 2 / 3（併用可）のどれを設計改訂として採るか~~ → 選択肢 1+2 相当を response-format 改訂として承認・実装済み（Tasks 6–8）
2. ~~決定後に設計書 §4.4 / §4.4.2 を改訂し、再度 N=10 を実行する~~ → 第4ラウンドで exact 構成 N=10 再評価済み（合格 0）
3. 合格 **最大 2 本**（exact 構成）が出て初めて本番 env を提案する — **未達のまま**。候補 ID / prompt / 別設計判断が必要

---

## 第4ラウンド: response-format 改訂後の exact 構成 N=10（Plan 8 Task 9, 2026-07-27）

設計改訂（root object wire / production-service harness / exact 順序付き構成単位）を Tasks 6–8 まで実装したうえで、
承認済み exact 3 構成を live N=10 で再評価した。

### 実行前提（秘密は記録しない）

- Date: 2026-07-27T11:34:29Z – 11:35:10Z (UTC) / 2026-07-27 20:34–20:35 JST
- Worktree: `.worktrees/plan8-response-format-revision` / Branch: `plan8/response-format-revision`
- HEAD (ベンチ実行時): `c5d4478f516a916a9437dee828a26b9db5e5f5ce`
- Command: `docker compose run --rm --no-deps app node scripts/benchmark-paid-openrouter-models.mjs`
- `OPENROUTER_BASE_URL`（プロセス）: ベンチは公式 exact `https://openrouter.ai/api/v1` を使用
- Key: funded 実キー（値は非記録）。**total credit hard limit = $1**（operator 確認）
- Operator: 外部ネットワーク / 有料実行を本セッションで承認
- Quota locks: 3 / 6 / 20（変更なし）
- 時間境界: per-send 20s / 送信前残 22s / 単位 50s / repair 最大 1（変更なし）

### 評価対象（順序固定・再結合禁止）

1. `["openai/gpt-4.1-nano"]`
2. `["openai/gpt-4.1-nano", "meta-llama/llama-3.1-8b-instruct"]`
3. `["openai/gpt-4.1-nano", "openai/gpt-oss-120b"]`

機械フィルタ段階の `EXCLUDE` 行はなし（3 構成とも member が survivor として chat 評価へ進行）。

### 構成単位結果（§4.4.2 production harness, fresh unit, 失敗で打ち切り）

| Exact configuration | 結果 | first-attempt successes | 初回失敗 unit | outcome | closed failure codes | totalElapsedMs |
|---|---|---:|---|---|---|---:|
| `["openai/gpt-4.1-nano"]` | FAIL (1/10 で終了) | 0 | 1 | `failure` | `invalid_ai_response` | 2936 |
| `["openai/gpt-4.1-nano", "meta-llama/llama-3.1-8b-instruct"]` | FAIL (1/10 で終了) | 0 | 1 | `failure` | `invalid_ai_response` | 13307 |
| `["openai/gpt-4.1-nano", "openai/gpt-oss-120b"]` | FAIL (1/10 で終了) | 0 | 1 | `failure` | `generation_timeout` | 23440 |

### Per-send 証跡（許可フィールドのみ）

**Config 1** unit 1:

| send | models | responseModel | excludedModel | elapsedMs |
|---:|---|---|---|---:|
| 1 | `["openai/gpt-4.1-nano"]` | `openai/gpt-4.1-nano` | null | 2928 |

**Config 2** unit 1:

| send | models | responseModel | excludedModel | elapsedMs |
|---:|---|---|---|---:|
| 1 (primary) | `["openai/gpt-4.1-nano", "meta-llama/llama-3.1-8b-instruct"]` | `openai/gpt-4.1-nano` | null | 2521 |
| 2 (repair) | `["meta-llama/llama-3.1-8b-instruct"]` | `meta-llama/llama-3.1-8b-instruct` | `openai/gpt-4.1-nano` | 10784 |

**Config 3** unit 1:

| send | models | responseModel | excludedModel | elapsedMs |
|---:|---|---|---|---:|
| 1 (primary) | `["openai/gpt-4.1-nano", "openai/gpt-oss-120b"]` | `openai/gpt-4.1-nano` | null | 3433 |
| 2 (repair) | `["openai/gpt-oss-120b"]` | null | `openai/gpt-4.1-nano` | 20005 |

### 最終判定

- Final exit code: **1**
- `passedConfigurations`: **[]**
- `recommendedConfiguration`: **null**
- Recommended production `OPENROUTER_MODELS`: **n/a（合格 0 構成のため提案しない）**
- README / runbook の本番推奨更新: **なし**（PASS 条件未達）
- Production deploy: **NOT done**
- 記録していないもの: API キー、prompt、path/message、raw model output、provider body、無制限 error text

response-format 改訂後も exact 3 構成は N=10 を通過しなかった。個別 ID 結果の再結合による推奨構成の合成は行わない。本番 ship は引き続きブロック。

---

## R1 ラウンド: 新 shortlist / exact 6 構成の live N=10（2026-07-27）

設計: `docs/superpowers/specs/2026-07-27-openrouter-candidate-configuration-reslist-design.md`（Approved）  
Stage 1: `docs/bugfix/artifacts/r1-stage1-decision-record-2026-07-27.md`  
HEAD（実行時）: `222c1ec`

### 実行前提

- Date: 2026-07-27T14:15:13Z – 14:17:08Z (UTC)
- Command: `docker compose run --rm --no-deps app node scripts/benchmark-paid-openrouter-models.mjs`（frozen 全 6 構成・trialCount=10）
- Base: official exact `https://openrouter.ai/api/v1`（ベンチ固定）
- Key: funded 実キー（値非記録）
- hard_limit_usd: **$1**（operator 確認）。est_pass_all ≈ $0.90（C=6 混在・U_hi=$0.01）→ covers=yes
- Operator: 有料 N=10 実行承認
- preflight: 本実行ではスキップ（直接 N=10）

### 構成単位結果（失敗で打ち切り）

| Exact configuration | 結果 | first-attempt | outcome | closed failure | totalElapsedMs |
|---|---|---:|---|---|---:|
| `["openai/gpt-oss-20b"]` | FAIL unit1 | 0 | failure | `generation_timeout` | 20011 |
| `["inclusionai/ling-2.6-flash"]` | FAIL unit1 | 0 | failure | `invalid_ai_response` | 9010 |
| `["mistralai/mistral-small-24b-instruct-2501"]` | FAIL unit1 | 0 | failure | `generation_timeout` | 20001 |
| `["openai/gpt-oss-20b", "mistralai/mistral-small-24b-instruct-2501"]` | FAIL unit1 | 0 | failure | `generation_timeout` | 20001 |
| `["openai/gpt-4.1-nano", "openai/gpt-oss-20b"]` | FAIL unit1 | 0 | failure | `generation_timeout` | 20002 |
| `["inclusionai/ling-2.6-flash", "meta-llama/llama-3.1-8b-instruct"]` | FAIL unit1 | 0 | failure | `generation_timeout` | 20001 |

### Per-send（許可フィールドのみ・各構成 unit 1）

| Config | models | responseModel | excludedModel | elapsedMs |
|---|---|---|---|---:|
| 1 | `["openai/gpt-oss-20b"]` | null | null | 20007 |
| 2 | `["inclusionai/ling-2.6-flash"]` | `inclusionai/ling-2.6-flash` | null | 9004 |
| 3 | `["mistralai/mistral-small-24b-instruct-2501"]` | null | null | 20001 |
| 4 | `["openai/gpt-oss-20b", "mistralai/mistral-small-24b-instruct-2501"]` | null | null | 20000 |
| 5 | `["openai/gpt-4.1-nano", "openai/gpt-oss-20b"]` | null | null | 20001 |
| 6 | `["inclusionai/ling-2.6-flash", "meta-llama/llama-3.1-8b-instruct"]` | null | null | 20001 |

### 最終判定

- Final exit code: **1**
- `passedConfigurations`: **[]**
- `recommendedConfiguration`: **null**
- Recommended production `OPENROUTER_MODELS`: **n/a**
- README / runbook 本番推奨の合格置換: **なし**
- Production deploy: **NOT done**
- 記録していないもの: API キー、prompt、raw model output、provider body

### 示唆（設計判断用・ゲート緩和ではない）

- 6 本中 **5 本が unit1 で `generation_timeout`**（20s 境界）。class B 相当の再発が主。
- 唯一 20s 内に応答した `inclusionai/ling-2.6-flash` は **`invalid_ai_response`**（J/意味検証側）。
- R1 shortlist 差し替えだけでは **N=10 合格 0**。次は設計どおり **R2（prompt/materialize）** または **R3（単価帯拡大）**、あるいは別 Stage 1 shortlist（timeout 帯をさらに避ける）の人間判断。

本番 ship は引き続きブロック。個別 ID 結果の再結合による推奨合成は行わない。
