# 生成品質レビュー（idea 固定・2026-07-28）

## 固定入力

- idea / breakfast / 2 人 / 主材料 **鶏もも肉** / japanese / 15 分 / pantry 空
- 本番と同型: strict `json_schema` + `require_parameters`
- ツール: `scripts/review-generation-quality.mjs`（2 trials）
- 成果物: `docs/bugfix/artifacts/quality-review-2026-07-28.json`

## 機械スコアについて

検証通過時の cookability チェックリストは **21/21 満点が並びやすい**（品数・主材料・手順の有無など）。  
**「作れないレシピ」の差は、主に人間が読む分量・手順・時間整合**に出る。

## openai/gpt-5.6-luna との比較は「経路上できない」

| 項目 | 値 |
|------|-----|
| カタログ | あり・SO∧RF・**$3.50/1M**（P\*=$4 内） |
| strict schema probe | **404** No endpoints for requested parameters |
| 品質レビュー | **2/2 `model_unavailable`** |

→ コンソールの「高性能モデル」でも、本番の **strict json_schema + require_parameters** に乗らない。  
レシピ品質の横並び比較対象に **入れられない**（コスト以前の問題）。

同系統で機械 KEEP でも 404 の例: `gpt-5-mini` ($2.25)、`gpt-5-nano`、`gpt-5.4-nano`。

## 成功率（2 trials）

| Model | USD/1M | 成功 | 機械スコア | レイテンシ目安 |
|-------|-------:|-----:|-----------|----------------|
| `inception/mercury-2` | 1.00 | 2/2 | 21/21 | ~3–5s |
| `openai/gpt-4.1-mini` | 2.00 | 2/2 | 21/21 | ~11s |
| `x-ai/grok-4.3` | 3.75 | 2/2 | 21/21 | ~10s |
| `openai/gpt-4.1-nano` | 0.50 | 1/2 | 21/21（成功時） | ~5–7s |
| `openai/gpt-5.6-luna` | 3.50 | **0/2** | — | ~0.3s（不可用） |

## 調理可能性・中身の定性比較

### `openai/gpt-4.1-mini` — **いま一番「作れる」**

両 trial とも:

- 主菜: 鶏もも照り焼き（切る → 焼く → 醤油/みりん/砂糖）
- 副菜: ほうれん草おひたし
- 15 分枠・並行 timeline が現実的
- 日本語が安定

弱点:

- `quantityText: 大さじ1` なのに `unit: "ml"` など **単位のズレ**（家庭では推測可能だが厳密ではない）

コストは mercury の約 2 倍だが、**再現性の質は最良**。

### `inception/mercury-2` — **安く速い。当たり外れあり**

- Trial 1: 照り焼き（タレ分量あり）+ ほうれん草胡麻和え → **実用寄り・良い**
- Trial 2: 鶏卵炒め + 「ごはん」を **後から 5 分で炊く** → **時間整合が弱い**（総 13 分だが炊飯が実質無理）

N=10 安定・$1/1M は魅力。品質の下振れは「炊飯を短時間にねじ込む」系。

### `x-ai/grok-4.3` — **通るが薄すぎる（実質レシピ不足）**

両 trial ほぼ同型:

- 主菜「照り焼き」なのに材料が **鶏ももだけ**（タレ無し）
- 手順が **「鶏もも肉を焼く」1 行**
- 味噌汁も **「味噌を溶かす」だけ**（だし・具なし）
- timeline が `mainを調理` など **英語混じり・抽象**

機械検証は通るが、**「作れない」というより「レシピとして足りない」**。  
N=10 合格でも品質推奨には向かない。

### `openai/gpt-4.1-nano` — **不安定**

- Trial 1: materialize 失敗（`invalid_menu_structure`）
- Trial 2: 照り焼き + 味噌汁（だし・豆腐あり）で **内容はそこそこ**

repair 枠向き。単独 primary は品質・安定とも不足。

## コスト vs 品質の整理

| 優先 | 推奨 | 理由 |
|------|------|------|
| **品質優先（作れないを減らす）** | `openai/gpt-4.1-mini` | 材料・手順が揃い、2 回とも実用レベル |
| **コスト優先（当面）** | `inception/mercury-2` | 半額・高速。下振れ時の炊飯など要注意 |
| **品質+余裕** | mercury + 将来の上位（schema 可） | luna は現状 **経路不可** |
| **非推奨（品質）** | `x-ai/grok-4.3` 単独 | 検証通過しても中身が薄い |
| **比較不能** | `openai/gpt-5.6-luna` | strict schema 404 |

## 本番 env の提案（品質寄り）

```bash
# 品質寄り（+コスト中）
OPENROUTER_MODELS=openai/gpt-4.1-mini

# コスト寄り（現状 freeze 推奨だったもの）
OPENROUTER_MODELS=inception/mercury-2

# 品質 primary + 安い repair（repair は品質保証ではない）
OPENROUTER_MODELS=openai/gpt-4.1-mini,openai/gpt-4.1-nano
```

## 次に品質を上げるなら（コード）

1. **時間整合の強化**: 炊飯・浸水など長時間工程を `totalElapsedMinutes` / timeline と照合する validate  
2. **単位の一貫性**: `大さじ` vs `ml` の粗検出  
3. **「照り焼きなのにタレ材料が無い」** など role vs 材料の軽い整合（過検知に注意）  
4. luna 級を使いたい場合は **P\* と schema 経路の別設計**（現状 404 は P\* では解けない）

## 再実行

```bash
docker compose run --rm --no-deps app node scripts/review-generation-quality.mjs \
  --models=inception/mercury-2,openai/gpt-4.1-mini,x-ai/grok-4.3 \
  --trials=2
```
