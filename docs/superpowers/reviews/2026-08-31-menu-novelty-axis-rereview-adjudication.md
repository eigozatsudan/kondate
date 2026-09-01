# 献立ひねり軸 — 改訂再レビュー裁定 (3a2e52d0)

- 日付: 2026-08-31
- 裁定者: 親エージェント
- 対象: 改訂一次、改訂敵対的、改訂二次
- 最終判定: **REVISE。F-01〜F-05 は閉じた。残る計画ブロッカーは Important 1 件（§8 の契約抜け）。Implementation Plan 作成は禁止。**

## 1. 裁定方法

改訂 spec（`3a2e52d0`）を live の migration / Zod `.strict()` / `mapSnapshot` / overlay 識別子へ再照合した。
初回裁決の F-01〜F-05 は再開しない。一次が Important とした 4 件のうち 3 件は出荷経路にならない
fail-closed として Minor へ落とし、敵対的 I-01 だけを計画停止として残す。

## 2. F-01〜F-05

| ID | 裁定 |
| --- | --- |
| F-01 生成到達経路 | **Closed** — reserve INSERT（20260808）+ snapshot RPC + `.strict()` schema を同一 Task 制約付きで本文化 |
| F-02 クライアント永続面 | **Closed** — overlay / select / autosave 空判定 / route の 4 面。残差は識別子名（Minor） |
| F-03 DROP シグネチャ | **Closed** — 現行 13 引数リテラル。12 引数コピー禁止 |
| F-04 PromptPreferences | **Closed** — 拡張禁止、new_menu 分岐注入、再生成不変回帰 |
| F-05 辞書照合 | **Closed** — 正規化後完全一致、漢字かなは alias 列挙 |

## 3. 確定した残件

| 統合ID | 元ID | 最終severity | 裁定 |
| --- | --- | --- | --- |
| R-01 | A-I-01 / P-I-4 | **Important** | §8 が契約（`submissionCommonShape`）を migration + `mapSnapshot` から外す。`plannerSubmissionSchema` は両枝 `.strict()`。`mapSnapshot` は `parse(data: unknown)` に `noveltyPreference` を直渡し、typecheck は余剰キーを落とさない。1+3 を契約より先に commit すると **全 new_menu が HTTP 422**（`generation-context.ts` 211–226、290–294、141–142 行）。§7 の `snapshotRowSchema` 単体テストでは閉じない |

必要な Spec 修正:

- §8 の 1・2・3 を **同一 Task かつ同一 commit** にする。または順序を **2（契約）→ 1+3（RPC と mapSnapshot）** に固定し、中間 commit を禁ずる。
- §3.3 の必須面に `submissionCommonShape` / `plannerSubmissionSchema` を足す。
- §7 に `mapSnapshot` が `novelty_preference: "twist"` の行を `PlannerSubmission` まで通す 1 本を足す。

## 4. 重大度を落としたもの / 偽陽性

| 項目 | 裁定 | 理由 |
| --- | --- | --- |
| P-I-1 overlay 名 `SaveDraftNullableArgKeys` | **Minor** | 正本は `NullableDraftArgs`。Omit 漏れの交差は `string` だが、§7 の `p_novelty_preference: null` テストと typecheck で止まる。出荷しない |
| P-I-2 factories / テストリテラル未列挙 | **Minor** | `z.infer` はキー必須。`tsc` が未列挙を全部拾う。Plan のファイルリスト項目 |
| P-I-3 既存 13 引数 pgTAP / rls_inventory | **Minor** | 更新必須だが spec が `db:test` を指定しているので未更新のまま出荷できない |
| snapshot Returns overlay | **False positive** | 実行時の正は `snapshotRowSchema` の `.nullable()`。現行 `ingredient_preference` も Returns overlay していない |
| F-01〜F-05 の再開、安全ゲート弱化、quota/HMAC、ログ漏洩、2 パス | **再開せず** | 改訂は対象外判断を維持 |

## 5. Plan 前に折り込み推奨の Minor（計画停止ではない）

1. overlay 識別子を live の `NullableDraftArgs` に直す（Omit 対象と明示フィールドの両方）。
2. `NOVELTY_HINTS_ENABLED = true as const`（env ではない）。
3. user payload トップレベルキー名を 1 語ロックする（既存 6 キーと衝突させない）。
4. 除外リスト件数上限の整数。
5. `get_ai_generation_submission_snapshot` の DROP `(uuid, uuid)`。
6. 14 引数 GRANT リテラルと `rls_inventory` exact、既存 pgTAP 位置引数の更新を §7 に一文。

## 6. 修正後判定

R-01 を Spec 本文に固定するまで Implementation Plan は書かない。
R-01 だけ直せば APPROVE し、Minor は Plan の Task 0 / ファイルリストで吸収してよい。
