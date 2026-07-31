# 上位モデル検証 shortlist（prompt 改訂後・2026-07-28）

| フィールド | 値 |
|------------|-----|
| snapshot | `docs/archive/bugfix/artifacts/r1-models-snapshot-2026-07-27.json`（P*=$1） |
| prompt | structural/refs/pantryUsage/outcome 契約を system に追加 |
| approver | session operator |

## shortlist（評価順）

| 順位 | ID | USD/1M | 根拠 |
|-----:|----|-------:|------|
| 1 | `openai/gpt-4o-mini` | 0.75 | 既に 20s 内応答。prompt 改訂で invalid 改善を狙う |
| 2 | `meta-llama/llama-3.3-70b-instruct` | 0.53 | 上位 instruct・P* 内 |
| 3 | `deepseek/deepseek-v3.2` | 0.669 | 上位・非 thinking |
| 4 | `qwen/qwen-2.5-72b-instruct` | 0.76 | 上位 instruct |
| 5 | `openai/gpt-4.1-nano` | 0.50 | 高速 repair スロット（単独は第4 identical 禁止） |

除外: VL/thinking、R1 timeout EX-B、CFG-REPAIR-SLOW。

## exact 構成

1. `["openai/gpt-4o-mini"]`
2. `["meta-llama/llama-3.3-70b-instruct"]`
3. `["deepseek/deepseek-v3.2"]`
4. `["qwen/qwen-2.5-72b-instruct"]`
5. `["openai/gpt-4o-mini", "openai/gpt-4.1-nano"]`
6. `["meta-llama/llama-3.3-70b-instruct", "openai/gpt-4.1-nano"]`

hard_limit $1 / est_pass_all ≈ $0.90 (C=6) → covers=yes
