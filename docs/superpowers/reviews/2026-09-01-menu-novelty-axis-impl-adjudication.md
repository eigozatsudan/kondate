# 献立ひねり軸 実装レビュー裁定

- Date: 2026-09-01
- Range: `039c01a6`..`24234683` (`main` HEAD `2423468345216a20f204284990c1de6eaffacec9`)
- Package: `.superpowers/sdd/review-039c01a6..24234683.diff`
- 対象: Tasks 1–6 実装（契約・RPC・snapshot・辞書・prompt・UI・E2E・Vite edgeFunctions 無効化）
- 一次: `docs/superpowers/reviews/2026-09-01-menu-novelty-axis-impl-primary.md`
- 敵対的: `docs/superpowers/reviews/2026-09-01-menu-novelty-axis-impl-adversarial.md`
- 二次: `docs/superpowers/reviews/2026-09-01-menu-novelty-axis-impl-secondary.md`
- 裁定: 親エージェント（二次判定の独立確認。指摘の新規発見はしない）

## 最終判定

**成立 Critical / Important / Minor は 0。未確定の Critical / Important は 0。マージを止める欠陥は無い。**

一次の Spec Compliance は PASS。敵対的の Minor+ 候補は無し。二次は一次 Minor 1 件を Nit へ下げ、Nit 2 件を棄却、Nit 5 件を成立とした。

このレビューではコードを変更していない。

## 指摘一覧

| ID | 由来 | 一次/敵対 severity | 裁定 | 最終 severity | 理由 |
| --- | --- | --- | --- | --- | --- |
| P1 | 一次 | Minor | **成立** | **Nit** | `generation-prompt.ts:243-246` と `:499-502` の案内コメントが合成式（diversity + novelty + SEASON）とずれている。実行時失敗経路は一次自身も「なし」。Minor の実害基準を満たさない |
| P-N1 | 一次 Nit | Nit | **棄却** | — | `snapshotRowSchema` の `z.enum(["standard","twist"])` 直書きは spec §3.3 / plan Task 1 の指定。`ingredient_preference` と同型。欠陥経路ではない |
| P-N2 | 一次 Nit | Nit | **棄却** | — | wizard テストが DOM の select 値を見るのは、計画が「材料の使い方」と同じ取得方法を指定している。制御コンポーネントなので draft 非反映の抜けにはならない |
| P-N3 | 一次 Nit | Nit | **成立** | Nit | 生成型 snapshot Returns の `novelty_preference` は非 null `string`。overlay は Args の `p_*` だけ。実行時は Zod `.nullable()`。Meta の既存癖 |
| A1 | 敵対 | Nit | **成立** | Nit | option「ひねりたい（主菜を定番から外す）」は plan Task 5 指定どおり。コメントは保証しないと書くが利用者向けではない。安全保証リークではない。効きの弱さは spec §9 の既知残件 |
| A2 | 敵対 | Nit | **成立** | Nit | `use-draft-autosave.test.tsx:46` のテスト名が日本語。AGENTS.md / plan Global Constraints は英語。同ファイルの既存テスト名も日本語が多く、機能欠陥ではない |
| A3 | 敵対 | Nit | **成立** | Nit | `ai_control_and_quota.test.sql:1992` が「最終 13 引数」のまま（直下は 14 引数）。prompt JSDoc 部分は P1 と部分重複 |
| NEW-1 | 二次 deep-dive | 未判定 | **成立** | Nit | `review-step.tsx:192-193` の任意条件列挙に「献立の雰囲気」が無い。実行時非影響。P1 と同型のコメント陳腐化 |

## 重複

- P1 と A3 は **partial**。共有指紋は `buildNewMenuSystemPrompt` の JSDoc。P1 のみ `buildGenerationMessages` 案内、A3 のみ pgTAP コメント。

## 棄却の確認（Critical / Important は対象なし）

Critical / Important の棄却は 0 件のため、二重確認義務の対象は無い。

棄却した Nit:

- **P-N1**: spec/plan のリテラル指定そのもの。親も `generation-context.ts:76` を確認。
- **P-N2**: 計画の「既存 select テストを真似る」指示。制御コンポーネントの DOM 値は親 state 経由。

## 計画外 Extra

`vite.config.ts` の `edgeFunctions: { enabled: false }`（`a11f6273`）は計画外。リポジトリに `netlify/edge-functions` は無く、ローカル Deno `--allow-scripts` 落ちの修正。本番 Functions 経路ではない。一次・敵対的ともマージ阻害にしていない。

## 残す Nit（修正しない）

Nit は完了をブロックしない。今回はユーザーが Nit 修正を明示していないためコードは触らない。

1. prompt / review-step / pgTAP の陳腐化コメント（P1 / A3 / NEW-1）
2. twist option の約束の強さ（A1）。直すなら plan 指定文言との差分になるので、コピー変更は別判断
3. 新規テスト名の日本語（A2）。当該ファイルは既存も日本語
4. 生成型 snapshot Returns の非 null（P-N3）。既存 `ingredient_preference` と同型

## 検証したこと（このレビュー）

- 独立サブエージェント 3 本（一次・敵対的・二次）。同一コンテキストでの発見と真偽判定の兼任なし。
- 親は二次の file:line を再読し、P1 の合成式、A2 のテスト名、A3 の 14 引数呼び出し、NEW-1 の列挙コメントを確認した。
- ソースツリーは汚していない。追加されたのは本ディレクトリのレビュー成果物のみ。

## 結論

実装は spec / plan の契約経路（`.strict()` + 同一 commit の mapSnapshot、14 引数 RPC、new_menu のみ注入、再生成非接触、辞書は Functions 専用、fingerprint/quota/validate 非入力）を満たしている。**Ready to merge: Yes。**
