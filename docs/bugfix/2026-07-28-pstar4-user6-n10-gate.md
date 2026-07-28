# P*=$4 再改訂 + 指定6モデル N=10 gate（2026-07-28）

## 背景

指定6モデル診断（P*=$1）では 5/6 が機械 EXCLUDE または timeout。ユーザー指示 **A** =  
**P* 再改訂 → 再 snapshot → N=10**。

併せて直前の本筋修正（品数不一致 → `invalid_menu_structure`、prompt に確定品数契約）が有効。

## P* 改訂

| 項目 | 値 |
|------|-----|
| 旧 | $1.00 / 1M |
| 新 | **$4.00 / 1M** |
| 正本 | `scripts/verify-openrouter-models.mjs` → `maxPromptPlusCompletionUsdPerMillion = 4` |
| 根拠 | grok-4.3 = $3.75 を機械通過させる（他 nano/gemini/minimax も P* 内） |

設計追記: `docs/superpowers/specs/2026-07-27-openrouter-r2-prompt-materialize-r3-price-cap-design.md` §15.1

## Snapshot（P*=4）

- `docs/bugfix/artifacts/r1-models-snapshot-2026-07-28.json`
- entryCount 341 / mechanicalSurvivors **155** / postEx **138**

## N=10 結果（要約）

| 構成 | 結果 |
|------|------|
| **`["x-ai/grok-4.3"]`** | **10/10 PASS**（primary_success） |
| 他4構成（nano / gemini-lite / minimax / deepseek-v4-flash） | unit1 FAIL |

詳細: `docs/bugfix/artifacts/r1-user6-p4-decision-record-2026-07-28.md`

## 本番提案

```bash
OPENROUTER_MODELS=x-ai/grok-4.3
```

（単一 ID exact 構成。repair 第2 ID は本 round では freeze しない。）

## Ship 状態

- **exact 構成 N=10 合格あり** → 初めて recommendedConfiguration が非 null
- デプロイは運用者が hard limit・env を確認のうえ実施（本エージェントは push/deploy しない）
- qwen3.7-flash は SO AND 不足のまま別設計が必要
