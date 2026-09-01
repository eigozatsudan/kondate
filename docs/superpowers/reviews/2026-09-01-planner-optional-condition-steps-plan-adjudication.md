# 追加条件ウィザードstep化 Implementation Plan — 裁定

- 日付: 2026-09-01
- 裁定者: 親エージェント
- 対象: `docs/superpowers/plans/2026-09-01-planner-optional-condition-steps.md`（`34f5e2d3`）
- Spec: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md`（`f7f7c1ad`、APPROVE）
- 入力: plan-primary（REVISE / Important 6）、plan-adversarial（REVISE / Important 9）、plan-secondary（REVISE / Important 9）、親の live 再照合
- 最終判定: **REVISE。Critical 0。確定 Important 9 系統を計画本文へ追記するまで実装開始は禁止。**

## 1. 裁定方法

一次と敵対的は独立スレッド、二次は両レビューを入力に別スレッド。親は `Harness`、`"5. 確認"` 正アサーション、確認の「変更」ボタン、axe `it.each`、`full-journey` idea `:315–336`、household `noveltySaved`、`planner-wizard.test.ts` の import を再照合した。

Spec の骨格（`firstIncomplete` 非変更、4b、P-01 / P-02 / P-03 / P-05、D-03 擬似コード、D-01 helper 名、pantry「確認に戻る」、キーボード 4 手、44px の測る対象、contracts 非変更）は計画が壊していない。再開しない。残るのは **計画のコードブロックと「期待 PASS」コマンドが live と一文にならない**ことである。

主要な再照合:

- `planner-wizard.test.tsx:51–158` の `Harness` は `useState` の draft を返さない。`renderWizardAtTimeLimit` / `latestDraft` はファイルに無い。`buildPlannerSubmissionFieldErrors` の既存テストは同 tsx `:2344–2371`。model 側 `planner-wizard.test.ts:3–9` はその import が無い。
- 確認の変更は食事 / メイン食材 / ジャンル / `aria-label="対象を変更"` まで（`review-step.tsx:543–553`）。`調理時間を変更` は Task 4 まで無い。
- `"5. 確認"` 正アサーションは 323, 536, 576, 616, 647, 764, 773, 794, 799, 804, 1543。queryByRole 不在（555, 712, 828, 854）は見出し差し替え後も緑。追加条件 4 本（717, 893, 934, 983）は Task 3 ではカード UI が残るので緑。
- axe は `it.each` に `step` が必須。`renderWizard` は `onStepChange={vi.fn()}` で歩かない（`accessibility.test.tsx:231–260`, `:479–510`）。
- idea ジャーニー `:315` の次は `:317`「家族の年齢・アレルギーは確認されません」。`"5. 確認"` は privacy 復帰 `:336`。
- household `:77–88` は radiogroup `.check()` の**前に** `waitForResponse`（`"p_novelty_preference":"twist"`）。
- user-event 14.6 の MouseLeft は `isPrimary: true`（rereview3 で照合済み）。ArrowDown が jsdom で `change` を出さない証拠は無い。

## 2. 確定・統合した指摘

| 統合ID | 元ID | 最終severity | 裁定 | 計画へ書くこと |
| --- | --- | --- | --- | --- |
| P-T3-API | 一次 I-1 / 敵対 A-12 | Important | 新規テストが live に無い helper と `latestDraft()` を呼ぶ。Step 3 に Harness 拡張が無い | Task 3 の到達を `<Harness initialStep=… initialDraft=… />` に落とす。`latestDraft` を返す改修を Step 3 に本文で書く。Task 4 の `renderWizardAtReviewWithDraft` も同じ |
| P-T3-EDIT | 一次 I-2 | Important | 「調理時間を変更」は Task 4 のサマリ行まで存在しない。Task 3 Step 4 はファイル全体 | このテストを Task 4 へ移す。Task 3 の P-01 回帰は「対象を変更 → 確認に戻る」だけ |
| P-T3-HEADING | 一次 I-3 / 敵対 A-10 / A-11 | Important | 更新リストは sequential / `:746–764` / `:801–804` だけ。idea 着地 536, 576, 616, 647 と 1543 が赤。追加条件 4 本は Task 3 では緑なのに「赤でよい」と書いてある | `"5. 確認"` 正アサーションを全件列挙。追加条件 4 本は Task 3 では緑、Task 4 で書き換え。Step 4 の「4 テスト以外 PASS」を消す |
| P-T3-GUARD | 敵対 A-13 | Important | sequential の 4 ページ歩きに `passActivationGuard` が無い。audience 次へ直後の click は 350ms に食われる。戻る×8 の距離自体は正しい | sequential 更新文に `passActivationGuard`（または fake timer）を明示する。戻る×8 は確認から数える |
| P-T4-717 | 一次 I-4 | Important | `:717` のタイトルは「任意条件はデフォルトで開き…」。名前検索から漏れる | 書き換え対象に名前で書く。details 開閉だけ残すなら radio 操作を削除した本文を貼る |
| P-T4-AXE | 一次 I-5 / 敵対 A-17 | Important | スニペットに `step` が無い。歩き指示は `renderWizard` と両立しない | `step: "timeLimit" as const` 等を足して直描画。歩き parenthetical を消す。`primary` はスキップ / 戻る |
| P-T1-IMPORT | 敵対 A-1 | Important | 新規テストが `buildPlannerSubmissionFieldErrors` を呼ぶ。import 指示は `plannerSteps` だけ。model テストにその import は無い | Task 1 Step 1 の import に `buildPlannerSubmissionFieldErrors` を足す |
| P-T5-IDEA | 敵対 A-25 | Important | 「`clickWizardNext` 直後の `5. 確認` を skip に置換」だと idea `:315` に skip が入らない。`:336` を helper にすると privacy 復帰が死ぬ | idea は `:315` の直後（disclaimer `:317` の前）へ `skipOptionalPlannerSteps` を**挿入**する。`:336` は見出し置換のみ |
| P-T6-WAIT | 一次 I-6 / 敵対 A-29 | Important | 確認の `.check()` だけ消して `noveltySaved` を残す／消すと timeout か twist 未保存 | `waitForResponse` を 8 ページ目の「ひねりたい」`.click()` の直前へ移し、`await noveltySaved` のあと `9. 確認` を主張する |

## 3. 偽陽性・重複・受け入れ残差

| 項目 | 裁定 | 理由 |
| --- | --- | --- |
| leftover / 6〜8 閉じ込めを Critical | **Rejected** | `blocked()` が `handleChange` にも掛かる。各 step に `onBack` |
| `firstIncomplete` / 4b / contracts | **Rejected** | 計画が禁止。Task 1 は `stepByField` の 3 行だけ |
| A-5 `isPrimary` / PointerEvent polyfill | **Rejected** | user-event 14.6 MouseLeft は `isPrimary: true`。rereview3 と同じ |
| A-6 ArrowDown が jsdom で change しない | **Rejected** | 未検証。失敗証拠が無い |
| A-28 radio `.click()` を Important | **Downgraded → Minor** | Spec unit は `.wizard-option`（Task 2 は満たす）。E2E は click **か** Space。計画は `.check()` を避けている。バブルが死ぬ証拠は無い |
| A-13 の「戻る×8 で meal 超過」 | **Rejected（部分）** | 確認から 8 回は距離が正しい。独立の赤は 350ms 無しの歩き |
| 追加条件 4 テストが Task 3 で赤 | **Rejected** | カード UI が残るので緑。赤になるのは未列挙の見出し |
| Task 3 typecheck が `ReviewFieldErrors` 余剰で赤 | **Rejected** | 余剰キーは代入側を壊さない。`ReviewChoiceField` は Task 4 まで使用中 |
| `ensurePlannerReady` に skip | **Rejected** | live `:40–67` は食事 radio まで |
| キーボード heading 上 Space / 44px `.focus()` / 既定 Enter / pantry「次へ」 | **Rejected** | 計画が rereview4 の閉じ方を本文に持っている |
| 敵対 A-10 / A-11 | **Duplicate** | P-T3-HEADING |
| 敵対 A-12 | **Duplicate** | P-T3-API |
| 敵対 A-17 | **Duplicate** | P-T4-AXE |
| 敵対 A-29 | **Duplicate** | P-T6-WAIT |

## 4. 計画が直すべき具体パッチ（実装はまだしない）

1. Task 1: `buildPlannerSubmissionFieldErrors` を import する。
2. Task 3: 到達を live `Harness` に落とす。`latestDraft` の返し方を Step 3 に書く。「調理時間を変更」は Task 4 へ。`"5. 確認"` 正アサーションを全件列挙。sequential 歩きに `passActivationGuard`。追加条件 4 本は Task 3 では緑と明記。
3. Task 4: `:717` を名前で書く。axe に `step` を足して直描画。歩き指示を消す。
4. Task 5: idea は `:315` の直後に skip を**挿入**。`:336` は置換のみ。
5. Task 6: `noveltySaved` を 8 ページ目 click の直前へ移す。

Minor（計画は止めないが本文へ）: Task 6 の pointer を `.wizard-option` に揃える、grep に `*.tsx`、確認ヘルプの任意 step 書き分け、fake timer の `afterEach`、`git add` を触ったファイルに狭める、incomplete audience も `advanceFromEditOr` 経由。

## 5. 修正後判定

**REVISE。** 骨格と P-01 / P-05 / D-03 / D-01 helper 名 / pantry ボタン名 / キーボード 4 手 / 44px の測る対象は APPROVE 相当。上の 9 系統を計画に埋め込んだら、そのデルタだけを再レビューすればよい。実装開始は再 APPROVE のあと。
