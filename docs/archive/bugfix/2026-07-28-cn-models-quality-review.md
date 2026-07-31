# 中国系モデル品質レビュー（luna 近傍価格帯・2026-07-28）

## 条件

- idea / breakfast / 2 人 / 主材料 **鶏もも肉** / 15 分 / pantry 空
- 本番同型: strict schema + `require_parameters`（**temperature 非送信**後）
- 価格帯: おおよそ **$1–3.5 / 1M**（`openai/gpt-5.6-luna` = $3.50 を錨）
- ツール: `scripts/review-generation-quality.mjs`（各 2 trials）
- N=10: 有望 3 構成のみ

## 候補選定

strict-schema accept かつ CN ベンダー（deepseek / qwen / z-ai / moonshotai / minimax / …）で  
$0.8–4.0、非 VL・非 thinking から、価格と系統がばらけるように抽出。

## 結果サマリ

| Model | USD/1M | quality 成功 | 機械スコア | レイテンシ | 定性 |
|-------|-------:|-------------:|-----------|------------|------|
| **`openai/gpt-5.6-luna`**（錨） | 3.50 | **2/2** | 21/21 | ~8s | 日本語安定・手順厚い |
| **`minimax/minimax-m2.7`** | 1.25 | **2/2** | 21/21 | ~15–18s | 手順は厚いが **言語汚染**あり |
| **`moonshotai/kimi-k2.6`** | 3.37 | **1/2** | 21/21 | ~9s / fail | 成功時は実用寄り |
| `minimax/minimax-m3` | 1.50 | 1/2 | 21/21 | ~19s / TO | 成功時は簡素だが可 |
| `deepseek/deepseek-v4-pro` | 1.31 | 0/2 | — | 20s TO | 20s 予算内未完 |
| `deepseek/deepseek-chat` | 1.00 | 0/2 | — | 20s TO | 同上 |
| `qwen/qwen3.7-plus` | 1.60 | 0/2 | — | 20s TO | 同上 |
| `qwen/qwen-plus` | 1.04 | 0/2 | — | 20s TO | 同上 |
| `z-ai/glm-4.7` | 2.15 | 0/2 | — | 20s TO | 同上 |
| `z-ai/glm-5.2` | 3.06 | 0/2 | — | 20s TO | 同上 |
| `z-ai/glm-4.6` | 2.50 | 0/2 | — | 20s TO | 同上 |
| `moonshotai/kimi-k2-0905` | 3.10 | 0/2 | — | invalid/TO | wire or timeout |

TO = generation_timeout（20s/attempt）

## N=10（有望のみ）

| Exact configuration | Result | 備考 |
|---------------------|--------|------|
| `["minimax/minimax-m2.7"]` | FAIL u2 | u1 成功 → u2 `wire_or_envelope_invalid` |
| `["moonshotai/kimi-k2.6"]` | FAIL u1 | timeout |
| `["moonshotai/kimi-k2-0905"]` | FAIL u1 | timeout |

**中国系は N=10 合格ゼロ。** freeze への追加は見送り。

## 定性メモ（成功サンプル）

### minimax/minimax-m2.7（$1.25・中身は厚いが問題あり）

- 生姜焼き＋味噌汁、照り焼き＋卵焼きなど **手順・分量は詳細**
- **致命的:** 日本語 UI 向けなのに **アラビア語・ロシア語・中国語が本文に混入**  
  （例: description に非日本語、`酱油` / `约200g` / `盐胡椒`）
- 検証は通るが、**ユーザー向け品質としては不合格寄り**

### moonshotai/kimi-k2.6（$3.37・luna に近い価格）

- 成功 trial: 照り焼き（タレ材料あり）＋わかめ味噌汁、日本語きれい
- 1/2 は `dangling_ref`、N=10 は timeout → **安定性不足**

### minimax/minimax-m3（$1.50）

- 成功 trial: 照り焼きは可、副菜が「キャベツの千切り」のみで薄い
- 1/2 timeout

### 大型 deepseek / qwen / glm

- schema 経路は乗り得るが、**本番 20s 予算ではほぼ timeout**
- 現状の attempt budget では候補に向かない

## luna との比較（同条件）

| 観点 | luna | 最良中国系（m2.7 / k2.6） |
|------|------|---------------------------|
| 価格 | $3.50 | m2.7 $1.25 / k2.6 $3.37 |
| 成功安定（2 trials） | 2/2 | m2.7 2/2 だが言語汚染 / k2.6 1/2 |
| N=10 | **10/10** | **0/10** |
| 日本語品質 | 安定 | m2.7 汚染、k2.6 は成功時良好 |
| 手順の厚さ | 厚い | m2.7 厚い、k2.6 良好 |

→ **中国系で luna 近傍の「品質＋安定」は未達。**  
コストを下げたいなら m2.7 は魅力だが、**多言語汚染と N=10 失敗**で本番推奨にできない。

## 結論・推奨

1. **本番推奨は引き続き `openai/gpt-5.6-luna`（品質）または `gpt-4.1-mini` / `mercury-2`（コスト）**
2. 中国系を再挑戦するなら優先度:
   - `moonshotai/kimi-k2.6`（価格≈luna、中身は良いが安定化が必要）
   - `minimax/minimax-m2.7`（安い・詳細だが **言語フィルタ or 拒否**が必要）
3. deepseek / qwen-plus / glm 大モデルは **timeout 支配** → 20s ロック下では見送り

## 再実行

```bash
docker compose run --rm --no-deps app node scripts/review-generation-quality.mjs \
  --models=minimax/minimax-m2.7,moonshotai/kimi-k2.6,openai/gpt-5.6-luna \
  --trials=2
```
