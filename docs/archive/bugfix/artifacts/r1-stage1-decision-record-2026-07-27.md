# R1 Stage 1 意思決定記録（2026-07-27）

設計: `docs/archive/superpowers/specs/2026-07-27-openrouter-candidate-configuration-reslist-design.md` §5.4  
Snapshot: `docs/archive/bugfix/artifacts/r1-models-snapshot-2026-07-27.json`

| フィールド | 値 |
|------------|-----|
| snapshotDate | 2026-07-27T14:11:04.555Z |
| survivorArtifactPath | `docs/archive/bugfix/artifacts/r1-models-snapshot-2026-07-27.json` |
| enumerationMethod | B（Stage-1 60s / 8 MiB 単一応答） |
| entryCount | 342 |
| postEx survivors | 32 |
| approver | session operator（本記録の freeze 指示） |
| disagreementNote | none |

## EX 適用

- 表 A: snapshot `exIdRulesApplied`（EX-B 5 + EX-404 1 + EX-GEM 1）
- 表 B: CFG-REPAIR-SLOW = `openai/gpt-oss-120b`（`configuration[1]` 禁止）

## shortlist 最終（順序 = 総合優先）

| 順位 | ID | L | S | J | C | 1 行根拠 |
|-----:|----|---|---|---|---|----------|
| 1 | `openai/gpt-oss-20b` | 中 | 中高 | 未知 | 0.170 | 120b より小さく L 余地。OpenAI 系 S。未評価。CFG-REPAIR-SLOW 外 |
| 2 | `inclusionai/ling-2.6-flash` | 未知 | 未知 | 未知 | 0.040 | 単価最小帯。R1 主戦場の新規 ID |
| 3 | `mistralai/mistral-small-24b-instruct-2501` | 未知 | 未知 | 未知 | 0.130 | EX-B の mistral-small-3.2 とは別 ID。instruct |
| 4 | `meta-llama/llama-3.1-8b-instruct` | 中 | 中 | 低 | 0.130 | 20s 内実績あるが duplicate_ref 履歴。repair 候補 |
| 5 | `openai/gpt-4.1-nano` | 高 | 高 | 低 | 0.500 | wire 後 L/S 優秀。第4 J 不足。後方・2-ID primary のみ検討 |

### shortlist から外した survivor（代表）

| ID | 理由 |
|----|------|
| `openai/gpt-oss-120b` | CFG-REPAIR-SLOW。単独も 18s 級で L 厳しい。本ラウンド shortlist 外 |
| その他 27 survivors | 件数 3–5 上限。価格帯上位・未知を優先し残りは rejectedFromShortlist=capacity |

## exact 構成（評価順 = 推奨タイブレーク）

| # | configuration | 種別 | 理由 |
|---|---------------|------|------|
| 1 | `["openai/gpt-oss-20b"]` | single | 最優先 primary |
| 2 | `["inclusionai/ling-2.6-flash"]` | single | 最安・新規 |
| 3 | `["mistralai/mistral-small-24b-instruct-2501"]` | single | instruct 新規 |
| 4 | `["openai/gpt-oss-20b", "mistralai/mistral-small-24b-instruct-2501"]` | pair | primary+repair（repair は CFG-REPAIR-SLOW 外） |
| 5 | `["openai/gpt-4.1-nano", "openai/gpt-oss-20b"]` | pair | nano L/S + 非 120b repair。**第4 identical ではない** |
| 6 | `["inclusionai/ling-2.6-flash", "meta-llama/llama-3.1-8b-instruct"]` | pair | 安価 primary + llama repair |

### 不変条件チェック

- 件数 6 ∈ [3,6]
- set(shortlist) === union(configs)
- shortlist ⊆ survivors
- 第4 identical 3 配列は **含まない**
- どの 2-ID も `configuration[1]` ∉ CFG-REPAIR-SLOW

### pairCandidatesConsidered（要約）

| pair | code |
|------|------|
| oss-20b + mistral-small-24b | adopt |
| nano + oss-20b | adopt |
| ling-flash + llama-3.1-8b | adopt |
| nano + llama-3.1-8b | reject_r4_identical（第4 と同一配列） |
| nano + oss-120b | reject_r4_identical / reject_repair_slow_slot |
| any + oss-120b as repair | reject_repair_slow_slot |

## hard-limit 予報（N=10 前に再計算必須）

C=6（single 3 + pair 3）、P=0、U_hi=$0.01:

- S_pass_all = 3×10×1 + 3×10×2 = 90 → est_pass_all = **$0.90**
- hard_limit $1 なら covers=yes（実行前に operator 再確認）

## 次

定数 freeze + CLI 済み後、任意 preflight → N=10（eligible CLI のみ）。
