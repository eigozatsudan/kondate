# 追加条件ウィザードstep化 Implementation Plan — 二次レビュー

- 日付: 2026-09-01
- 対象: plan @ `34f5e2d3`
- 入力: primary, adversarial
- 判定: REVISE — Critical 0、Important 9、Minor 8

## §1 Verdict

骨格（`plannerSteps` 挿入、`firstIncompletePlannerStep` 非変更、`noveltyPreference` 非追加、contracts 非変更、P-01 の `advanceFromEditOr("timeLimit")`、D-03 の `onPointerUp` + Space `onKeyUp` + mutex、P-03 の 350ms を `handleChange` にもかける、5ページ目だけスキップ、D-01 helper 名、pantry「対象を変更 → 確認に戻る」、キーボード 4 手、44px の測る対象）は APPROVE 済み Spec と live に沿っている。Critical（閉じ込め・4b・contracts）は計画本文から出ていない。

実装開始を止めるのは、**本文どおりコピペすると Task 1/3/4/5/6 の expect-PASS コマンドが緑にならない**ことである。一次の I-1…I-6 はすべて live で成立する。敵対が足した A-1 / A-13 / A-25 も成立する。敵対 A-5 / A-6 は UA/jsdom の未検証推測なので Important にしない。A-28 はバブルで本線が死ぬ証拠が無く、一次 M-5 へ落とす。

## §2 Spec coverage / 閉じ確認

| Spec 節 | Task | 穴 |
| --- | --- | --- |
| step モデル / `firstIncomplete` 非変更 / `noveltyPreference` 非追加 | Task 1 | import 指示が `plannerSteps` だけ（A-1） |
| OptionalChoiceStep / P-02 / D-03 / P-03 単体 | Task 2 | なし（`isPrimary` / Arrow の jsdom 推測は Important にしない） |
| P-01 / P-05 / スキップ / wizard 単位 D-02 | Task 3 | `latestDraft` と到達 helper が live `Harness` に無い（I-1）。「調理時間を変更」は Task 4 依存（I-2）。`"5. 確認"` 更新リストが不完全（I-3）。sequential 歩きに 350ms が無い（A-13） |
| 確認サマリ / `ReviewFieldErrors` / `forceAdditionalOpen` | Task 4 | `:717` が名前検索から漏れる（I-4）。axe 行に `step` が無く歩き指示と衝突（I-5） |
| skip helper 9 行 / pantry「確認に戻る」 / 戻る×8 | Task 5 | idea `:315` の差し込み手順が privacy `:336` と混線（A-25） |
| 4 ページ歩き / キーボード 4 手 / 44px | Task 6 | household の `noveltySaved` 付け替えが無い（I-6）。radio `.click()` は Minor |

閉じたまま再開しないもの: P-01 / P-05 本体 / D-03 擬似コード / D-02 初回 0 回 / D-01 helper 名（`generateShoppingMenu`、`ensurePlannerReady` 除外、`answerAudienceAndReview`）/ pantry 確認に戻る / キーボード 4 手 / 44px の測る対象 / `firstIncomplete` / 4b / contracts。

## §3 二次判定表（一次・敵対の各 ID）

| ID | 元 severity | 二次 | 根拠 |
| --- | --- | --- | --- |
| 一次 I-1 | Important | **Confirmed** | Plan 605–666 が `renderWizardAtTimeLimit` / `latestDraft()`。live `planner-wizard.test.tsx:51–158` の `Harness` は `useState` の `draft` を返さない。ファイル内に当該 helper は無い。Task 3 Step 3 は Harness 拡張を書いていない。P-05 の `null` vs `""` は Task 3 時点の DOM では確定できない。Task 4 の `renderWizardAtReviewWithDraft`（1005–1047）も同型 |
| 一次 I-2 | Important | **Confirmed** | Plan 685–698 が `調理時間を変更`。live `review-step.tsx:543–553` の変更は食事 / メイン食材 / ジャンル / 対象まで。ボタンは Task 4 の 4-d（1091–1111）で初めて出る。Task 3 Step 4 はファイル全体。`describe.skip` 禁止 |
| 一次 I-3 | Important | **Confirmed** | live 正アサーションは 323, 536, 576, 616, 647, 764, 773, 794, 799, 804, 1543。Plan 702–707 は sequential `:301–333`、`:746–764`、`:801–804` だけ。3-d の `advanceFromEditOr("timeLimit")` で 536 / 576 / 616 / 647 は `5. 調理時間` に着地して赤。1543 は見出し差し替えで赤。queryByRole 不在（555, 712, 828, 854）は緑のまま。追加条件 4 本（717, 893, 934, 983）は Task 3 ではカード UI が残るので**緑**。Plan 707–708 / 975 の「4 テストまで赤でよい」は逆 |
| 一次 I-4 | Important | **Confirmed** | `:717` のタイトルは「任意条件はデフォルトで開き…」。`:741–743` が `radiogroup`「献立全体の調理時間」を click。Task 4 が「追加条件」名前検索だけだと残る |
| 一次 I-5 | Important | **Confirmed** | live `accessibility.test.tsx:479–510` は各行に `step: PlannerStep`。`renderWizard`（231–260）は `onStepChange={vi.fn()}` で歩かない。Plan 1204–1209 は `heading` / `primary` だけ。1211 の歩きは `it.each` 本体と両立しない |
| 一次 I-6 | Important | **Confirmed** | live `full-journey.spec.ts:77–88` は `.check()` の**前に** `waitForResponse`（`"p_novelty_preference":"twist"`）。autosave debounce は `use-draft-autosave.ts:696` の 600ms。Plan 1354–1374 は click を 8 ページ目へ移すが wait の付け替えが無い |
| 一次 M-1 | Minor | **Confirmed** | `renderWizardAtAudienceFor*` 等はコメントで「既存 helper に合わせる」。live は `<Harness initialStep="audience" initialDraft={reviewDraft} />`。I-1 ほどは止まないが、名前のまま貼ると参照エラー |
| 一次 M-2 | Minor | **Confirmed**（A-26 と Duplicate） | Plan 1315 `grep --include=*.ts`。src の残りは `.tsx` |
| 一次 M-3 | Minor | **Confirmed**（A-19 と Duplicate） | 4-e（1179–1181）は「選び直すか『確認に戻る』」。任意 step に「確認に戻る」は無い（Plan 179 `nextLabel` 不在）。rereview4 Minor 3。本線非ブロック |
| 一次 M-4 | Minor | **Confirmed** | rereview4 Minor 9。click / `tabUntil` は radio。測定名はフル |
| 一次 M-5 | Minor | **Confirmed**（A-28 をここへ Downgrade） | 下記 A-28 |
| 一次 M-6 | Minor | **Confirmed** | Task 3 の fake timer テストは末尾 `useRealTimers()` のみ。ファイルの `afterEach`（18–20）は `registerPlannerLeaveFlush` だけ。途中 throw で `:1547` 以降が汚染され得る |
| 敵対 A-1 | Important | **Confirmed** | Plan 49–51 は `plannerSteps` だけ import 追加。53–91 は `buildPlannerSubmissionFieldErrors` を呼ぶ。live `planner-wizard.test.ts:3–9` にその import は無い。同関数の既存テストは `planner-wizard.test.tsx:2344–2371`。`test()` 自体は `vitest.config.ts:13` `globals: true` と `tsconfig.app.json:25` `vitest/globals` で通る。関数名の未 import は Step 4 の PASS を止める |
| 敵対 A-2 / A-3 / A-4 | Closed | **Confirmed** | `firstIncomplete` 非変更、配列 iterate テスト無し、`noveltyPreference` を `PlannerFieldName` に足すと `Record` が落ちる |
| 敵対 A-5 | Important | **Rejected** | user-event v14.6.1 `PointerHost` は `pointers.new('mouse','mouse')`。`pointerType !== 'touch'` なので `isPrimary === true`。`Pointer.getEventInit` は `isPrimary: this.isPrimary` と `button: getMouseEventButton(button)`。Task 2 は `userEvent.click(.wizard-option)`。rereview3 裁定も False positive。polyfill 欠落は planned 経路を赤にしない。`src/test/setup.ts` に PointerEvent polyfill が無いのは事実だが、それだけでは Important にならない |
| 敵対 A-6 | Important | **Rejected** | jsdom 27 が radio Arrow で `change` を出さない証拠は無い。未検証 UA 推測は Important にしない |
| 敵対 A-7 / A-8 / A-9 | Closed | **Confirmed** | 12 テストは spec 必須を覆う。`setSystemTime` は `Date.now()` ガードと対。`name={id}` は裁定 Minor 2 |
| 敵対 A-10 | Important | **Duplicate**（I-3） | 追加条件 4 本は Task 3 では緑、未列挙 `"5. 確認"` が exit 1、の内訳 |
| 敵対 A-11 | Important | **Duplicate**（I-3） | 正アサーション 11 件のうち列挙漏れを固定した番号。中身は I-3 |
| 敵対 A-12 | Important | **Duplicate**（I-1） | helper 名と `latestDraft` が live に無い |
| 敵対 A-13 | Important | **Confirmed**（350ms のみ。×8 で meal 超過は Rejected） | Plan 704 は 4 ページ歩き + 戻る×8。`passActivationGuard`（573–577）は新規テスト用で sequential 更新文に無い。既存 `:301–333` は real timer、`userEvent.setup()` 既定 delay 0。audience の次へで `timeLimit` が mount した直後の click は 350ms ガードに食われる。確認から戻る×8 は review→novelty→…→ingredients→meal で距離は正しい。meal は順送りでは `onBack` を渡さない（`planner-wizard.tsx:414–420`）。歩きが成功すれば 8 回目で `1. 食事` に着き、9 回目は無い。「meal を超える」は歩き失敗の二次被害であり独立の赤ではない |
| 敵対 A-14 | Minor | **Confirmed** | Plan 770–777 は incomplete なら `goToStep(firstIncomplete)` 直呼び。裁定 Minor 6 の「`advanceFromEditOr` 経由」にはならない。live P2（`:807–829`）は「やめる」。本線 complete audience は `advanceFromEditOr("timeLimit")`。既存テストは緑 |
| 敵対 A-15 / A-16 | Closed | **Confirmed** | `key={step}` / `nextLabel` 非伝播 / `never`。Task 3 の typecheck は余剰 `ReviewFieldErrors` では落ちない。`ReviewChoiceField` は Task 4 まで使用中 |
| 敵対 A-17 | Important | **Duplicate**（I-5） | axe 行の `step` 欠落と `renderWizard` 非歩行 |
| 敵対 A-18 / A-20 | Closed | **Confirmed** | 4-a/4-c/4-g は同時。サマリ 4 行の `onEditStep` は Task 1 後の union に入る |
| 敵対 A-19 | Minor | **Duplicate**（M-3） | |
| 敵対 A-21…A-24 | Closed | **Confirmed** | skip 9 行は Spec 386–401 と一致。`ensurePlannerReady`（`shopping.ts:40–67`）は食事 radio まで。pantry `:263–278` は「対象を変更」+「確認に戻る」。戻る×8 は 9 ページ距離 |
| 敵対 A-25 | Important | **Confirmed** | Plan 1267–1269 は「`clickWizardNext` の直後にある `5. 確認` を skip に置換」。表 1276 は idea `:315` の次。live `:315` の次は `:317`「家族の年齢・アレルギーは確認されません」。`"5. 確認"` は privacy 復帰 `:336`（Spec 419–426）。機械置換だけだと skip が入らず idea 注意が `5. 調理時間` で赤。`:336` を helper にすると `resume=review` 後に調理時間見出しを待って死ぬ |
| 敵対 A-26 | Minor | **Duplicate**（M-2） | |
| 敵対 A-27 | Minor | **Confirmed** | `git add e2e src` は無関係 dirty を巻き込む。E2E 延期自体は Closed |
| 敵対 A-28 | Important | **Downgraded → Minor**（M-5 と Duplicate） | Spec 342–345 の `.wizard-option` は **unit**（Task 2 は `optionLabel` で満たす）。E2E Spec 448 / Plan 1348 は「カード click **か** radio の Space」。コード 1357–1399 は radio `.click()`（`.check()` ではない）。input は `label.wizard-option` 内（実装 478–505、live `review-step.tsx:130`）。Playwright / userEvent の pointerup はバブルする。指定なしの罠は `.check()` の no-op であり、計画は `.click()` を使っている。Chromium でバブルが死んで本線が赤になる証拠は無い。未検証 UA 推測は Important にしない |
| 敵対 A-29 | Important | **Duplicate**（I-6） | |
| 敵対 A-30 / A-31 / A-32 | Closed | **Confirmed** | キーボード 4 手は `toBeFocused` → 350ms → `tabUntil` radio 指定なし → Space。44px は `activateFocusedWithKeyboard(page, "Space")`（live `:1127–1131` 既定 Enter）。`./scripts/run-e2e.sh` は人間端末。Interfaces 名は Task 2→3 で一致 |

一次・敵対とも Critical 0。二次も Critical を新設しない。

## §4 残ブロッカー（Plan 改訂前に本文へ書くこと）

1. **Task 3 の到達 API を live `Harness` に落とす（I-1 / A-12）。** `latestDraft` を返す改修を Step 3 に本文で書く。`renderWizardAt*` を消す。Task 4 の `renderWizardAtReviewWithDraft` も `<Harness initialStep="review" initialDraft={…} />` にする。
2. **「調理時間を変更」テストを Task 4 へ移す（I-2）。** Task 3 の P-01 回帰は live の「対象を変更 → 確認に戻る」（668–683、live `:801–804`）だけ。
3. **`planner-wizard.test.tsx` の `"5. 確認"` 正アサーションを全件更新対象に列挙する（I-3 / A-10 / A-11）。** 536 / 576 / 616 / 647 / 1543 を含める。追加条件 4 本（717 / 893 / 934 / 983）は Task 3 では緑、Task 4 で書き換える、と書き直す。Step 4 の「4 テスト以外 PASS」を消す。
4. **sequential `:301–333` の 4 ページ歩きに `passActivationGuard`（または fake timer）を明示する（A-13）。** 戻る×8 は確認から数える（meal 超過の書き方はしない）。
5. **Task 4 の書き換え対象に `:717` を名前で書く（I-4）。** details 開閉だけ残すなら、調理時間 radio 操作を削除した本文を貼る。
6. **axe 表に `step: "timeLimit" as const` 等を足し、歩き parenthetical を消す（I-5 / A-17）。** 直描画。`primary` はスキップ / 戻る。
7. **Task 1 の import に `buildPlannerSubmissionFieldErrors` を足す（A-1）。**
8. **Task 5 idea は `clickWizardNext` の直後（disclaimer `:317` の前）へ `skipOptionalPlannerSteps` を挿入すると書く（A-25）。** `:336` は見出し置換のみと再掲する。
9. **`noveltySaved` の `waitForResponse` を 8 ページ目の「ひねりたい」`.click()` の直前へ移し、`await noveltySaved` のあと `9. 確認` を主張する（I-6 / A-29）。**

## §5 Minor

- M-1: Task 3 の到達 helper 名はコメントどおり live `Harness` に合わせる（I-1 を直す過程で消える）。
- M-2 / A-26: Task 5 grep は `--include=*.ts --include=*.tsx`。
- M-3 / A-19: 確認ヘルプは任意 step を「選ぶと確認に戻る」と書き分ける（rereview4 Minor 3）。本線非ブロック。
- M-4: 5 ページ目 `button`「指定なし」の部分一致。残差のみ。
- M-5 / A-28: Task 6 の pointer 前進を `.wizard-option` locator に揃えると spec 448 と一文になる。radio `.click()` のままでもバブルで緑になり得る。本線は止めない。
- M-6: Task 3 の fake timer に `afterEach(() => { vi.useRealTimers(); })`。
- A-14: incomplete audience も `advanceFromEditOr` 経由にする（裁定 Minor 6）。既存 P2 は「やめる」なので本線非ブロック。
- A-27: `git add e2e src` を触ったファイルに狭める。

## §6 偽陽性・却下

| 項目 | 裁定 | 理由 |
| --- | --- | --- |
| leftover / 6〜8 閉じ込めを Critical にする | Rejected | `blocked()` が `handleChange` にも掛かる。mutex はその後。各 step に `onBack`。6〜8 に戻るがあることは Critical の自動降格材料であり、テスト契約の赤は落とさない |
| `firstIncomplete` / 4b / contracts 変更 | Rejected | 計画が禁止。Task 1 は `stepByField` の 3 行だけ |
| `ensurePlannerReady` に skip | Rejected | Spec 403–404、live `:40–67` は食事 radio まで |
| キーボード heading 上 Space | Rejected | Task 6 Step 4 は 4 手。rereview4 で閉じた |
| 44px の `.focus()` が keyboard-only を破る | Rejected | live `:1096–1100` が分割。計画も分割 |
| `activateFocusedWithKeyboard` 既定 Enter | Rejected | 計画が `"Space"` を渡す |
| pantry がまだ「次へ」/ 戻る×5 | Rejected | Task 5 Step 3 が「対象を変更」+「確認に戻る」 |
| Task 3 typecheck が `ReviewFieldErrors` 余剰で赤 | Rejected | A-16。余剰キーは代入側を壊さない |
| 追加条件 4 テストが Task 3 で赤 | Rejected | カード UI が残るので緑。赤になるのは未列挙の見出し側 |
| A-5 `isPrimary` / PointerEvent polyfill | Rejected | user-event 14.6 MouseLeft は `isPrimary: true`。再照合済み |
| A-6 ArrowDown が jsdom で change しない | Rejected | 未検証。失敗証拠が無い |
| A-28 radio `.click()` を Important のまま | Downgraded | バブル未検証を Important にしない。unit は既に label。E2E は `.check()` を避けている |
| A-13 の「戻る×8 で meal 超過」 | Rejected（部分） | 確認から 8 回は距離が正しい。Independent な赤は 350ms 無しの歩き |
| Spec 骨格 / P-01 / P-05 / D-03 擬似コードの再開 | Rejected | rereview4 どおり再開しない |
