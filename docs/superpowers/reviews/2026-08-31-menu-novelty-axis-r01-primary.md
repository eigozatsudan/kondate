# 献立ひねり軸 — R-01 一次レビュー (a2a7a4fb)

- 日付: 2026-08-31
- 対象: spec @ `a2a7a4fb`（`docs/superpowers/specs/2026-08-31-menu-novelty-axis-design.md`）
- 入力: 改訂再レビュー裁定（R-01 が残る唯一の Important）
- 実施者: 読み取り専用 Reviewer（製品コード・仕様は編集しない）
- 判定: **APPROVE — Critical 0、Important 0**

## 1. Verdict

R-01 が求めた 3 点（同一 commit、§3.3 の先行必須、§7 の mapSnapshot round-trip）は本文に固定された。
live の両枝 `.strict()` / `parse` リテラル直渡し / catch → HTTP 422 は変わっていない。
この delta が新たに開ける typecheck 通過 + 本番 422 の穴は無い。

## 2. R-01 — **Closed**

裁定が求めた修正はすべて入った。

| 要求 | spec @ a2a7a4fb |
| --- | --- |
| §8 の 1・2・3 を同一 Task かつ同一 commit | §8（243–256 行）。冒頭「Task 1 は契約・migration・サーバー読み取り面を 1 つの commit で閉じる。分割してはならない」。番号 1 に契約（`draftShape` と `submissionCommonShape`）+ migration + 型再生成 + `snapshotRowSchema` / `mapSnapshot` + 契約テスト / pgTAP / mapSnapshot round-trip。末尾「上記 4 要素を分けて commit しない」 |
| §3.3 に `submissionCommonShape` を先行必須として書く。両枝 `.strict()`。`parse(unknown)` は余剰キーを型で落とさない | §3.3（114–121 行）。「両枝とも `.strict()`」「`submissionCommonShape` への追加は、`mapSnapshot` にとって任意ではなく**先行必須**」「`parse` の引数は `unknown` なので、余剰キーは typecheck を素通りする」 |
| §7 に mapSnapshot → `PlannerSubmission` round-trip。`snapshotRowSchema` 単体では不足。`standard` / `twist` / `null` | §7（233–237 行）。「`mapSnapshot` → `PlannerSubmission` の round-trip 1 本」「`snapshotRowSchema` の単体テストはこれを検知しない」「`standard` / `twist` / `null` の 3 値を通す」 |

代替案（契約先行 → 1+3、中間 commit 禁止）は採らず、より強い「単一 commit」を選んでいる。R-01 の成立手順（1+3 を契約より先に commit）は文言どおりには歩けない。

## 3. live 照合

R-01 の実行時前提は維持されている。

- `shared/contracts/planner.ts` 136–153 行。`plannerSubmissionSchema` は `discriminatedUnion` の両枝が `.strict()`。`submissionCommonShape`（118–134 行）に `noveltyPreference` はまだ無い。
- `netlify/functions/_shared/generation-context.ts` 211–226 行。`mapSnapshot` は `plannerSubmissionSchema.parse({ ... })` にオブジェクトリテラルを直渡しする（`ingredientPreference` まで）。
- 同 141–142 行 `invalidRequest()` は HTTP 422。291–294 行が `mapSnapshot` の throw をそれに写す。282–283 行の `snapshotRowSchema.safeParse` 失敗も同じ 422。

Zod の `parse` 引数が `unknown` である前提は、直渡しリテラルの余剰キーが typecheck を素通りする、という R-01 の型側証明と矛盾しない。

## 4. 新規指摘

なし。Critical 0、Important 0。

Task 1 が型再生成を含み overlay（§3.4 / Task 2）を後段に残す点は、裁定が「fail-closed typecheck」と切り分けたクラスである。`SaveDraftArgs` は generated の必須 `string` をそのまま残すため、`buildSaveGenerationDraftArgs`（`planner-api.ts` 64–82 行）は `p_novelty_preference` 欠落で `tsc` が落ちる。`null` を直渡ししても overlay 前は `string` に入らない。仕様どおり実装した Task 1 を typecheck 通過のまま出荷して全 new_menu を 422 にする経路は無い。

## 5. 再掲しない（既裁定 Minor）

次は Important に上げない。delta はこれらを本番破壊へ戻していない。

- overlay 型名 `SaveDraftNullableArgKeys`（正本は `NullableDraftArgs`）
- factories / テストリテラル未列挙（`z.infer` 必須化は typecheck が拾う）
- 14 引数 GRANT / `rls_inventory` exact / 既存 pgTAP 位置引数
- kill-switch `true as const`
- user payload トップレベルキー名
- 除外リスト件数上限の整数
- `get_ai_generation_submission_snapshot` の DROP `(uuid, uuid)`
- UI「隣に」

F-01〜F-05、安全ゲート・quota/HMAC・fingerprint・temperature / 2 パスも再開しない。
