# 指定 6 モデルの機械フィルタ + closed subcode 診断（2026-07-28）

**初回診断（P\*=$1）。** その後ユーザー指示 A で **P\*=$4** に再改訂し N=10 を実施  
→ 結果は `docs/archive/bugfix/2026-07-28-pstar4-user6-n10-gate.md`（**grok-4.3 10/10 PASS**）。

P\*（この文書の診断時点）= **$1.00 / 1M**。  
診断スクリプト: `scripts/diagnose-paid-models-closed.mjs`  
（EXCLUDE モデルでも 1 回だけ production harness を試行し、closed code のみ記録）

## 機械フィルタ結果（Models API 現物）

| Model ID | カタログ | 機械フィルタ | USD/1M | structured_outputs | response_format | 判定理由 |
|----------|----------|--------------|-------:|:------------------:|:---------------:|----------|
| `qwen/qwen3.7-flash` | あり | **EXCLUDE** | 0.16 | no | yes | AND 不足（`structured_outputs` 欠落） |
| `openai/gpt-5.4-nano` | あり | **EXCLUDE** | **1.45** | yes | yes | 単価超過 > $1 |
| `google/gemini-3.5-flash-lite` | あり | **EXCLUDE** | **2.80** | yes | yes | 単価超過 > $1 |
| `deepseek/deepseek-v4-flash` | あり | **KEEP** | 0.42 | yes | yes | 機械通過（ただし過去 EX-B / 20s timeout 履歴） |
| `minimax/minimax-m3` | あり | **EXCLUDE** | **1.50** | yes | yes | 単価超過 > $1 |
| `x-ai/grok-4.3` | あり | **EXCLUDE** | **3.75** | yes | yes | 単価超過 > $1 |

**本番 N=10 / freeze に載せられるのは現状 `deepseek/deepseek-v4-flash` のみ。**  
他 5 本は **P\*=$1 または AND 契約で fail-closed**。

## Live N=1 closed 診断（production harness）

| Model ID | failureCodes | diagnosticCodes | totalMs | 解釈 |
|----------|--------------|-----------------|--------:|------|
| `qwen/qwen3.7-flash` | `model_unavailable` | （空） | 432 | 送信前〜プロバイダ境界で不可用（schema 到達前） |
| `openai/gpt-5.4-nano` | `model_unavailable` | （空） | 250 | 同上（require_parameters / provider 条件含む可能性） |
| `google/gemini-3.5-flash-lite` | `model_unavailable` | （空） | 435 | 同上 |
| `deepseek/deepseek-v4-flash` | `generation_timeout` | （空） | 20004 | **20s 内に envelope 未完了**（EX-B 再確認） |
| `minimax/minimax-m3` | `invalid_ai_response` | **`wire_or_envelope_invalid`** | 3147 | HTTP 応答はあるが wire/envelope 不正 |
| `x-ai/grok-4.3` | `invalid_ai_response` | **`invalid_provider_menu`** | 9684 | wire 通過後、menu schema/materialize で `invalid_provider_menu` |

raw 出力・API キーは記録していない。

## 本筋（invalid_provider_menu）への含意

1. **本番 shortlist 候補として使えるのは現状 deepseek-v4-flash のみ**だが、**timeout** で class B と同型 → R1 EX-B に既に近い。
2. **P\* を上げないと** 5.4-nano / gemini-3.5-flash-lite / minimax-m3 / grok-4.3 は **機械フィルタで永远に EXCLUDE**。
3. grok-4.3 は高価帯でも **9.7s で応答**し、失敗は **`invalid_provider_menu`（形状）** — 上位モデル＋形状問題の典型。
4. qwen3.7-flash は安いが **structured_outputs 非公開** → 現行 AND ロックでは採用不可（緩和は別設計）。

## 本筋 mock 再現（idea ベンチ固定・鶏もも肉 2 人・朝食）

再現テスト: `netlify/functions/_shared/invalid-provider-menu-idea-bench.repro.test.ts`

| 変異 | closed diagnosticCodes | 解釈 |
|------|------------------------|------|
| mock `idea-servings-2` そのまま | （空）= 成功 | harness 固定入力と mock 成功形は一致 |
| breakfast dishes=1（モデルがよく返す形） | **`invalid_menu_structure`** | AI payload は 1–5 品を許すが、内部 schema は朝/昼=ちょうど2・夕=3。以前はこれが **`invalid_provider_menu` に潰れ** repair 評価不能だった |
| breakfast dishes=3 | **`invalid_menu_structure`** | 同上（超過も拒否） |
| idea なのに adaptations 付き | `unknown_member_ref` | メンバー不在。opaque ではない |
| 空 pantry で pantry_1 を捏造 | `unknown_pantry_ref` / `dangling_ref` | 同上 |
| 主材料「鶏もも肉」欠落 | `main_ingredient_missing` | materialize 通過後の validate |

### 実施した修正（gate 緩和ではない）

1. **materializer**: 確定品数不一致および最終 `generatedMenuSchema` 失敗を  
   `invalid_provider_menu` ではなく **`invalid_menu_structure`** に閉じる  
   （payload 自体の Zod 失敗は従来どおり `invalid_provider_menu`）。
2. **system prompt**: mealType ごとの確定品数・役割・timeline 時間整合・mainIngredients を明示  
   （設計 §7.3 / §11.3 と materialize 条件を揃える）。

これで live 診断が `invalid_provider_menu` 一色から、品数由来は `invalid_menu_structure` として分離される想定。  
**本番 ship 判定・P\*・AND は未変更。** N=10 再ゲートは別途。

## 次アクション候補

| 優先 | 内容 |
|------|------|
| A | **P\* 再改訂**（例: $4 で grok/gemini/5.4-nano を機械通過させる）→ 再 snapshot → N=10 |
| B | 本筋修正後、**P\* 内 shortlist**（4o-mini 等）で N=1 / N=10 を再実行し `invalid_menu_structure` 比率を確認 |
| C | deepseek-v4-flash を EX-B 確定として shortlist から外す |

ユーザー指定 6 本を本番候補にするなら **A が必須**。B は P\* 内でも pass 率改善の本筋。
