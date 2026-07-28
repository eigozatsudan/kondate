# 指定6モデル + P*=$4 freeze 決定記録（2026-07-28）

| フィールド | 値 |
|------------|-----|
| P* | **$4.00 / 1M**（prompt+completion 和・inclusive） |
| snapshot | `docs/bugfix/artifacts/r1-models-snapshot-2026-07-28.json` |
| mechanicalSurvivors | 155 |
| postEx survivors | 138 |
| approver | session operator（指示「A」） |
| 前提 | idea 品数 → `invalid_menu_structure` 切り分け + prompt 品数契約（`770b21b` 系） |

## 指定6モデル: 機械 + live N=1（P*=4）

| Model ID | 機械 | USD/1M | Live N=1 |
|----------|------|-------:|----------|
| `qwen/qwen3.7-flash` | EXCLUDE | 0.16 | `model_unavailable`（SO AND 不足） |
| `openai/gpt-5.4-nano` | KEEP | 1.45 | `model_unavailable` |
| `google/gemini-3.5-flash-lite` | KEEP | 2.80 | `model_unavailable`（R1 shortlist は EX-GEM だが bench 機械は KEEP） |
| `deepseek/deepseek-v4-flash` | KEEP | 0.42 | `generation_timeout`（EX-B 継続） |
| `minimax/minimax-m3` | KEEP | 1.50 | N=1: timeout / N=10 u1: `constraint_conflict`+`allergen_pantry_conflict` |
| `x-ai/grok-4.3` | KEEP | 3.75 | **primary_success** |

## Live N=10（exact 構成）

Date: 2026-07-28（ログ: `.superpowers/sdd/n10-user6-p4-2026-07-28.log`）

| Exact configuration | Result | firstAttemptSuccesses | 備考 |
|---------------------|--------|----------------------:|------|
| `["x-ai/grok-4.3"]` | **PASS 10/10** | 10 | 全 unit `primary_success`、8–11s |
| `["openai/gpt-5.4-nano"]` | FAIL u1 | 0 | `model_unavailable` |
| `["google/gemini-3.5-flash-lite"]` | FAIL u1 | 0 | `model_unavailable` |
| `["minimax/minimax-m3"]` | FAIL u1 | 0 | `constraint_conflict` |
| `["deepseek/deepseek-v4-flash"]` | FAIL u1 | 0 | `generation_timeout` |

**Gate:** `ok=true`  
**recommendedConfiguration:** `["x-ai/grok-4.3"]`  
**passedConfigurations:** `[["x-ai/grok-4.3"]]`

## Freeze（本決定で確定）

- `candidateModelIds` = `["x-ai/grok-4.3"]`
- `paidOpenRouterModelConfigurations` = `[["x-ai/grok-4.3"]]`
- 本番提案: `OPENROUTER_MODELS=x-ai/grok-4.3`

## 非採用（本 round）

- qwen3.7-flash: AND 不足（P* 非依存）
- gpt-5.4-nano / gemini-3.5-flash-lite: プロバイダ `model_unavailable`
- minimax-m3 / deepseek-v4-flash: conflict または EX-B timeout
