# 献立ひねり軸 — R-01 再裁定 (a2a7a4fb)

- 日付: 2026-08-31
- 裁定者: 親エージェント
- 対象: R-01 一次、R-01 敵対的、親の live 再照合
- 最終判定: **APPROVE。Critical 0、Important 0。R-01 は閉じた。Implementation Plan 作成を許可する。**

## 1. 裁定方法

`a2a7a4fb` の §3.3 / §7 / §8 / §10 を、直前裁定が要求した 3 点と live の
`plannerSubmissionSchema`（両枝 `.strict()`）/ `mapSnapshot`（リテラル直渡し）/
`invalidRequest()` → HTTP 422 へ照合した。一次と敵対的は独立スレッド。Important の不一致が無いため
二次は省略し、親が両レビューと live を再読して確定した。

## 2. R-01

| 要求 | 裁定 |
| --- | --- |
| §8 の契約・migration・mapSnapshot を同一 Task・同一 commit | **Closed** — 「分割してはならない」「上記 4 要素を分けて commit しない」。番号 2 はクライアント永続面であり契約ではない |
| §3.3 に `submissionCommonShape` 先行必須、両枝 `.strict()`、`parse(unknown)` は型で守れない | **Closed** |
| §7 に mapSnapshot → PlannerSubmission round-trip（standard / twist / null）。schema 単体では不足 | **Closed** |

採った案は「単一 commit」であり、中間 commit 禁止をレビュー規約に頼らない。R-01 の成立手順
（1+3 を契約より先に積む typecheck 緑 commit）は仕様が指示する経路から消えた。

live 前提は維持:

- `shared/contracts/planner.ts` 136–153 行 — 両枝 `.strict()`
- `netlify/functions/_shared/generation-context.ts` 211–226 行 — リテラル直渡し
- 同 291–294、141–142 行 — throw → HTTP 422

## 3. F-01〜F-05

再開しない。R-01 デルタは到達経路・DROP・PromptPreferences 禁止・辞書照合を触っていない。

## 4. 新規指摘

Important / Critical なし。

敵対的 M-01（`mapSnapshot` が非 export で round-trip 入口が未固定）は **Minor**。本番
`loadGenerationContext` 経由でも、テスト用 export でも 422 と twist 保持をロックできる。
Plan の Task 1 で入口を 1 つ指名すれば足りる。仕様ブロッカーではない。

Task 1 の型再生成を overlay（Task 2）より前に置くのは typecheck 赤で止まる。前回どおり Minor。
14 引数 RPC と旧 13 引数ブラウザの並走は Task 間の既知残差であり、今回の束ねが新規に開いた穴ではない。

## 5. Plan が吸収する Minor（仕様再改訂は不要）

1. overlay 識別子は live の `NullableDraftArgs`（Omit 対象と明示フィールドの両方）
2. `NOVELTY_HINTS_ENABLED = true as const`
3. user payload トップレベルキー名を 1 語ロック（既存 6 キーと非衝突）
4. 除外リスト件数上限の整数
5. `get_ai_generation_submission_snapshot` の DROP `(uuid, uuid)`
6. 14 引数 GRANT / `rls_inventory` / 既存 pgTAP 位置引数
7. round-trip は `loadGenerationContext` 経由、または `mapSnapshot` をテスト用に export

## 6. 修正後判定

**APPROVE。** Implementation Plan に落としてよい。
