# strict json_schema + require_parameters 探索（2026-07-28）

## 目的

コンソールに載る ID のうち、**本番 OpenRouter 送信と同型**で endpoint が乗れるものを洗い出す。

本番条件（`openrouter.ts`）:

- `response_format` = 献立用 **strict** `json_schema`（`kondate_menu_generation`）
- `provider.require_parameters = true`
- `models: [id]`（単一）

## 手順

```bash
docker compose run --rm --no-deps app node scripts/probe-openrouter-strict-schema.mjs --concurrency=5
```

1. Models API 取得  
2. 機械フィルタ（SO **AND** RF、P\*=$4、`:free`/router 拒否）  
3. 各 survivor に chat 1 回（`max_tokens=32`）  
4. **HTTP 200 + envelope** なら `accept`（raw 本文は保存しない）

成果物: `docs/archive/bugfix/artifacts/strict-schema-probe-2026-07-28.json`

## 結果サマリ

| 指標 | 値 |
|------|---:|
| P* | $4.00 / 1M |
| 機械 KEEP | 155 |
| probe 完了 | 155 |
| **accept（endpoint が乗る）** | **117** |
| reject | 38 |

### reject の内訳（メッセージクラスタ）

| クラスタ | 件数 | 意味 |
|----------|-----:|------|
| Provider returned error | 18 | プロバイダが schema 要求を拒否（400 が多い） |
| TimeoutError（20s） | 10 | 応答前に打ち切り（routing 可否の判定としては未確定） |
| No endpoints found that can handle the requested parameters | 7 | **require_parameters で乗れる endpoint なし**（404） |
| その他 | 3 | schema 非対応・マルチターン不可など |

## 指定6モデルとの対応

| Model | 機械 | strict probe | 本番 harness 備考 |
|-------|------|--------------|-------------------|
| `qwen/qwen3.7-flash` | EXCLUDE（SO 欠） | プローブ対象外 | — |
| `openai/gpt-5.4-nano` | KEEP | **404 no endpoints** | `model_unavailable` |
| `google/gemini-3.5-flash-lite` | KEEP | **400 provider error** | `model_unavailable` |
| `deepseek/deepseek-v4-flash` | KEEP | **accept** | N=10 では **generation_timeout**（routing は通るが 20s 内未完） |
| `minimax/minimax-m3` | KEEP | **accept** | N=10 u1 は **constraint_conflict** |
| `x-ai/grok-4.3` | KEEP | **accept** | **N=10 10/10 PASS** |

→ **「schema に乗れる」≠「idea 生成 N=10 合格」**。accept は routing 可否の必要十分条件のうち **必要条件**。

## 安い accept 候補（非 VL・非 thinking 寄り・USD/1M 昇順・抜粋）

| USD/1M | ID |
|-------:|----|
| 0.04 | `inclusionai/ling-2.6-flash` |
| 0.05 | `mistralai/mistral-nemo` |
| 0.13 | `meta-llama/llama-3.1-8b-instruct` |
| 0.13 | `mistralai/mistral-small-24b-instruct-2501` |
| 0.20 | `mistralai/ministral-3b-2512` |
| 0.50 | `openai/gpt-4.1-nano` |
| 0.53 | `meta-llama/llama-3.3-70b-instruct` |
| 0.75 | `openai/gpt-4o-mini` |
| 0.76 | `qwen/qwen-2.5-72b-instruct` |
| 1.50 | `minimax/minimax-m3` |
| 3.75 | `x-ai/grok-4.3`（既に N=10 合格） |

完全リストは artifact の `accept` 配列（117 件）。

## 使い方（再実行）

```bash
# 全機械 KEEP
docker compose run --rm --no-deps app node scripts/probe-openrouter-strict-schema.mjs

# 安い順に先頭 N 件だけ
docker compose run --rm --no-deps app node scripts/probe-openrouter-strict-schema.mjs --limit=40

# 特定 ID だけ
docker compose run --rm --no-deps app node scripts/probe-openrouter-strict-schema.mjs \
  --ids=openai/gpt-4o-mini,x-ai/grok-4.3
```

次段: accept のうち idea 固定入力で **closed materialize/validate** が通るものを `diagnose-paid-models-closed.mjs` / N=10 で絞る。
