# 献立ひねり軸 Implementation Plan — デルタ再レビュー（二次）

- 日付: 2026-08-31
- 対象: `docs/superpowers/plans/2026-08-31-menu-novelty-axis.md` @ `72e4429f`
- 一次・敵対的とは独立。live 照合。
- 判定: **APPROVE。前回の 3 Important は live 上で閉じている。**

## 閉じた確認

- 9a は overlay + `p_novelty_preference: input.noveltyPreference`。typecheck 赤許容。9b だけ全 PASS。
- (ii) 3 行は live と一致: `toDraftInputFields:66`、`toPlannerDraftInput:135`、`submissionCandidate:1767`（計画は 1768 付近）。emptyDraft `:104` は (i)。
- `createPlannerDraftFromMenu` は表外だが typed 戻り値なので 9b の typecheck が要求する。heuristic は copy。spread 系は (ii) に乗る。
- Task 2 3 分岐と空判定 `:141`。`:104` は置き換えない。
- `…f9` 未使用。`$idea_finalize$;` は `:3488`。
- live `planner-api.test.ts:22` は `clientWithRpc` のみ。新設指示と一致。pin 無しなら `assertBrowserDataPlaneAligned` は no-op。

## 残 Minor

- Task 2 `Files:` が `:104/:145/:1776` のまま。本文が上書き。
- Step 14 `git add` 列挙不足。sandwich が後始末。
- サンプルヘルパー名と `{ from }` / `{ row }` の二形。
- 「3185 行目のブロックの後ろへ」が SQL の直前に残る。終端指示はフェンスの後ろ。

## 二次として一次へ足すもの

一次が APPROVE なら同意。git add 列挙不足と keepalive キー名は Important に上げない（失敗は fail-closed、本文が列挙に頼るなと書いている）。
