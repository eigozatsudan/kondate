# R1-replay 意思決定記録（R2+R3 後・2026-07-27）

| フィールド | 値 |
|------------|-----|
| snapshotDate | 2026-07-27T23:52:30.265Z |
| survivorArtifactPath | `docs/archive/bugfix/artifacts/r1-models-snapshot-2026-07-27.json` |
| P* | $1.00 / 1M |
| R2 | name trusted 上書き + prompt 契約（`ce30f7c`） |
| entryCount | 340 |
| mechanicalSurvivors | 69 |
| postEx survivors（snapshot 時点） | 62（EX-B 拡張前） |
| approver | session operator |
| disagreementNote | none |

## EX 更新

表 A EX-B に R1 live timeout を追加:

- `openai/gpt-oss-20b`
- `mistralai/mistral-small-24b-instruct-2501`

（`scripts/snapshot-openrouter-models-catalog.mjs` の closed 集合を更新。本 shortlist 選定時も除外。）

## shortlist（評価順）

| 順位 | ID | USD/1M | 根拠 |
|-----:|----|-------:|------|
| 1 | `openai/gpt-4o-mini` | 0.75 | 新規 $1 帯・OpenAI structured 実績・L/S 期待 |
| 2 | `openai/gpt-4.1-nano` | 0.50 | 既知 L 高。R2 で name 整合強化 |
| 3 | `mistralai/ministral-3b-2512` | 0.20 | 小型・未評価 |
| 4 | `meta-llama/llama-3.1-8b-instruct` | 0.13 | 20s 内実績。repair 候補 |
| 5 | `microsoft/phi-4` | 0.21 | 中型 instruct 未評価 |

除外: R1 timeout 帯、CFG-REPAIR-SLOW `gpt-oss-120b`、thinking/VL 優先度下げ、第4 identical 必須再掲なし。

## exact 構成（評価順）

1. `["openai/gpt-4o-mini"]`
2. `["microsoft/phi-4"]`
3. `["mistralai/ministral-3b-2512"]`
4. `["openai/gpt-4o-mini", "meta-llama/llama-3.1-8b-instruct"]`
5. `["openai/gpt-4.1-nano", "microsoft/phi-4"]`（nano 単独は第4 identical のため不可）
6. `["mistralai/ministral-3b-2512", "meta-llama/llama-3.1-8b-instruct"]`

不変条件: set equality、⊆ survivors、repair-slow 非 `configuration[1]`、第4 identical 非含有。

## hard-limit

C=6（single 3 + pair 3）、P=0、U_hi=$0.01 → S_pass_all=90 → est_pass_all=$0.90  
hard_limit $1 → covers=yes（実行前再確認）
