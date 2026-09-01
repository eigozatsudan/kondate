# 献立ひねり軸 Implementation Plan — 再レビュー（敵対的）

- 日付: 2026-08-31
- 対象: `docs/superpowers/plans/2026-08-31-menu-novelty-axis.md` @ `66a5d0fc`
- 姿勢: デルタを忠実実行して Task 1 GREEN が嘘になる経路
- 判定: **REVISE — Critical 0。P-04 と P-02 の ai_control が未閉鎖。**

## P-01〜P-06

| ID | 判定 |
| --- | --- |
| P-01 | Closed（REVOKE 例から `authenticated` 欠は live ロール踏襲の但し書きで migrate は止まない） |
| P-02 | **Open** — 03_pantry は閉じた。ai_control プレースホルダ +「直前の値」は selected_only 往復（`:1158–1253`、revision 1）へ差し戻す |
| P-03 | Closed |
| P-04 | **Open** — `db:types` は正しい。全緑要求と overlay Task 2 が両立しない。Step 14 が sweep を落とす |
| P-05 | Closed。details は初期 open。`selectOption("twist")` は value |
| P-06 | Closed（要求としては）。スタブ摩擦は攻撃として成立しない。pin 無しなら `assertBrowserDataPlaneAligned` は no-op |

## 成立した攻撃

- **I-1** regen 後 `p_novelty_preference: string` 必須。Task 1 全緑と Task 2 overlay RED は同時に成り立たない。`noveltyPreference: null` は RPC キーを直さない。
- **I-2** Step 14 `git add` が `shared/testing/factories.ts` を含まない。commit 後の tree が赤。
- **I-3** ai_control が JWT 未設定位置で save するか、draft `3000…0001` を idea/rev 2 へ進め後続 `p_draft_revision = 1` を conflict にする。
- **I-4** `plan(46)` と `plan(47)` の二言。

## 不成立

- GRANT 例のロール欠は EXECUTE 集合を変えない（PUBLIC revoke + GRANT authenticated）。
- E2E が閉じた details の中 — `additionalOpen` 初期 true。
- PromptPreferences が 39 ファイル grep で汚染 — typecheck が正。手書き subset。`expectExactKeys` が保険。
- 13 引数 DROP / reserve 正本 / 単一 commit / radio 混在は再開しない。

## Assessment

P-01/P-03/P-05/P-06 要求文は入った。type パイプラインと ai_control の独立往復がまだ false-green。実装禁止。
