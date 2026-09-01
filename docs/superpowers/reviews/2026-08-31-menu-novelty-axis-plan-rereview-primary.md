# 献立ひねり軸 Implementation Plan — 再レビュー（一次）

- 日付: 2026-08-31
- 対象: `docs/superpowers/plans/2026-08-31-menu-novelty-axis.md` @ `66a5d0fc`
- Spec: 未変更（APPROVE のまま）
- 判定: **REVISE — Critical 0。P-01/P-03/P-05 は閉じた。P-04 と P-06 の実行面、および P-02 の ai_control 貼り付けが残る。**

## P-01〜P-06

| ID | 判定 | 根拠 |
| --- | --- | --- |
| P-01 | **Closed** | 14 引数 GRANT、`rls_inventory:284`、03a `to_regprocedure(...,jsonb,text)`。呼び出しだけ `,null` |
| P-02 | **部分** | `03_pantry` persist 4 / wild 5、`no_plan()` 維持は正しい。ai_control はプレースホルダ +「直前シナリオの値」で selected_only 往復へ戻れる |
| P-03 | **Closed** | `pg_proc` count = 1 |
| P-04 | **Open** | `db:types` と z.infer 説明は入った。overlay は Task 2 のままなのに Task 1 が typecheck 全緑を要求する。Step 14 `git add` が factories 等の sweep を含まない |
| P-05 | **Closed** | `<select>` 固定。E2E は `full-journey.spec.ts:73–90`。`selectOption("twist")` は value |
| P-06 | **Open（実行）** | select 文字列ロックの要求は書いてある。live `planner-api.test.ts` に `getPlannerDraft` / `from().select()` ヘルパーは無い。コピペではコンパイルしない |

## 新規 Important

1. Task 1 typecheck 全緑 vs Task 2 overlay。regen 後 `SaveDraftArgs` は `p_novelty_preference: string` 必須。`buildSaveGenerationDraftArgs` と `database.test.ts` の `satisfies SaveDraftArgs` が赤。`noveltyPreference: null` では直らない。
2. Step 9b のファイルがどの commit にも入らない。
3. `plan(46)` のあと任意の `has_column` で `plan(47)`。両方やると件数不一致。
4. P-06 テストが live スタブと不一致。
5. ai_control 専用往復が in-flight の `…0001` を再利用し得る。

## Assessment

GRANT / overload / select UI / full-journey は直っている。実装開始は、typecheck 境界と ai_control の DO ブロックと git add 範囲を本文で閉じてから。
