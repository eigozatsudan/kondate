# 安い strict-accept 帯の N=1 / N=10（2026-07-28）

前提: P\*=$4、strict schema probe accept、idea 固定入力（鶏もも肉・2人）。

## N=1 closed 診断（抜粋）

### Round 1（安い帯中心）

| Model | USD/1M | 結果 | diagnosticCodes / 備考 |
|-------|-------:|------|------------------------|
| `inclusionai/ling-2.6-flash` | 0.04 | timeout | |
| `meta-llama/llama-3.1-8b-instruct` | 0.13 | invalid | `wire_or_envelope_invalid` |
| `mistralai/ministral-3b-2512` | 0.20 | invalid | `unknown_pantry_ref` |
| `microsoft/phi-4` | 0.21 | timeout | |
| `mistralai/mistral-small-3.2-24b-instruct` | 0.40 | **success** 11.5s | |
| `openai/gpt-4.1-nano` | 0.50 | **success** 3.2s | |
| `meta-llama/llama-3.3-70b-instruct` | 0.53 | timeout | |
| `openai/gpt-4o-mini` | 0.75 | conflict | `dish_count_conflict` |
| `qwen/qwen-2.5-72b-instruct` | 0.76 | timeout | |
| `z-ai/glm-4.7-flash` | 0.46 | timeout | |
| `qwen/qwen3-30b-a3b-instruct-2507` | 0.24 | **success** 19.7s | 予算ギリギリ |
| `mistralai/ministral-14b-2512` | 0.40 | **success** 18.3s | |
| `deepseek/deepseek-v3.2-exp` | 0.68 | timeout | |
| `xiaomi/mimo-v2.5` | 0.42 | timeout | |

### Round 2（中堅）

| Model | USD/1M | 結果 | 備考 |
|-------|-------:|------|------|
| `openai/gpt-4.1-mini` | 2.00 | **success** 11s | |
| `mistralai/mistral-medium-3.1` | 2.40 | **success** 19s | 予算ギリギリ |
| `inception/mercury-2` | 1.00 | **success** 4s | |
| `mistralai/ministral-8b-2512` | 0.30 | **success** 9s | |
| `minimax/minimax-m2.7` | 1.25 | **success** 19s | |
| 他 | — | timeout / pantry / structure | |

## N=10 結果

### Round 1（N=1 成功 4 本 + repair）

| Exact configuration | Result | firstAttempt |
|---------------------|--------|-------------:|
| `["openai/gpt-4.1-nano"]` | FAIL u3 `constraint_conflict` | 2 |
| `["mistralai/mistral-small-3.2-24b-instruct"]` | FAIL u1 timeout | 0 |
| `["mistralai/ministral-14b-2512"]` | FAIL u1 conflict | 0 |
| `["qwen/qwen3-30b-a3b-instruct-2507"]` | FAIL u1 timeout | 0 |
| `["mistral-small…","gpt-4.1-nano"]` | FAIL u1 timeout | 0 |
| `["ministral-14b…","gpt-4.1-nano"]` | FAIL u5 timeout | 4 |

### Round 2

| Exact configuration | Result | firstAttempt |
|---------------------|--------|-------------:|
| **`["inception/mercury-2"]`** | **PASS 10/10** | 10 |
| `["mistralai/ministral-8b-2512"]` | FAIL u1 conflict | 0 |
| **`["openai/gpt-4.1-mini"]`** | **PASS 10/10** | 10 |
| `["minimax/minimax-m2.7"]` | FAIL u1 timeout | 0 |
| `["mistralai/mistral-medium-3.1"]` | FAIL u1 timeout | 0 |
| **`["inception/mercury-2","openai/gpt-4.1-nano"]`** | **PASS 10/10** | 10 |
| `["ministral-8b…","gpt-4.1-nano"]` | FAIL u3 conflict | 2 |

**Gate ok=true**  
**recommendedConfiguration（評価順先頭）:** `["inception/mercury-2"]`

## Freeze 更新

| 順位 | 構成 | USD/1M 目安 | 役割 |
|-----:|------|------------:|------|
| 1 | `["inception/mercury-2"]` | 1.00 | **推奨 primary**（最安の N=10 PASS） |
| 2 | `["openai/gpt-4.1-mini"]` | 2.00 | 予備 primary |
| 3 | `["inception/mercury-2","openai/gpt-4.1-nano"]` | 1.00+0.50 | repair 付き |
| 4 | `["x-ai/grok-4.3"]` | 3.75 | 既存 PASS 予備 |

本番提案（単一・最安）:

```bash
OPENROUTER_MODELS=inception/mercury-2
```

repair 付き:

```bash
OPENROUTER_MODELS=inception/mercury-2,openai/gpt-4.1-nano
```

## ログ

- `.superpowers/sdd/` には未コピー可。ホスト `/tmp/cheap-diag-n1.log` / `mid-diag-n1.log` / `cheap-n10.log` / `cheap-n10-round2.log`
