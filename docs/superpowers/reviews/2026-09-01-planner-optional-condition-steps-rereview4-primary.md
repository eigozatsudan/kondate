# 追加条件ウィザードstep化 — 第4デルタ再レビュー（一次）

- 日付: 2026-09-01
- 対象: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md` @ `f7f7c1ad`
- 実施者: 読み取り専用 Reviewer
- 判定: APPROVE — Critical 0、Important 0、Minor 6

## 1. Verdict

第3デルタ裁定が本文へ求めた 4 系統は、いずれも Plan が抄れる粒度で落ちている。pantry `:263–278` は「対象を変更 → 確認に戻る」に固定し `clickWizardNext` を禁じ、戻る回数の「戻る×5、または」は消えた。キーボードは `toBeFocused()` → 350ms → `tabUntil` radio → Space の 4 手で、heading 上 Space では `onKeyUp` に届かないと明記した。44px は「次へ」を測らず押さず、5 ページ目はスキップと戻る、6〜8 は戻る、前進は 350ms 後の radio Space。household / mobile / 44px / キーボードはいずれも **その OptionalChoiceStep の mount** から 350ms を数える。

残るのは計画を止めない Minor（P-03 に残る短い「heading 後 Space」文、確認ヘルプの「見直す」、7/8 の options 未貼付、radiogroup 名、incomplete フラグ、wizard 単位の click 対象）だけである。骨格・P-01 / P-05・D-03 擬似コード・firstIncomplete 非変更はデルタで崩れていない。Plan / 実装開始を止める穴は無い。

## 2. 4系統の閉じ確認

| 系統 | 状態 | 1行根拠 |
| --- | --- | --- |
| pantry `:263–278` | **Closed** | Spec 408–414 は「対象を変更 → audience で選び直し → **『確認に戻る』**」。`editReturnActionLabels.nextLabel`＝「確認に戻る」（live `planner-wizard.tsx:275–278`）。`clickWizardNext`（`history.ts:41–42` は name `"次へ"` 専用）禁止、`getByRole("button", { name: "確認に戻る" }).click()` を書く。`onEditStep` がフラグを立て（`:585–588`）、`advanceFromEditOr`（`:257–264`）が `9. 確認` へ直帰。戻る回数 432–433 は「対象を変更」のみ。「戻る×5、または」は削除。live pantry `:263–278` はまだ順送りの戻る + `clickWizardNext` + `"5. 確認"` で、本文どおり書き換え対象 |
| Keyboard | **Closed** | Spec 458–467 は `toBeFocused()` → `waitForTimeout(350)` → `tabUntil` radio → `press("Space")`。heading 上 Space は radio の `onKeyUp` に届かない（Spec 459–460、擬似コード 172–174）。h2 は `tabIndex={-1}`（`cuisine-step.tsx:89`、mount focus `:45–47`）。`tabUntil` は Tab 連打で `.focus()` フォールバック禁止（`:1193–1206`, `:1286`）。現行キーボードも heading のあと `tabUntil` で radio → Space（`:1306–1314`, `:1343–1351`）。`tabUntil(focus.name === "次へ")` 禁止（Spec 447, 465）。P-03 220–222 の短い待ち文は Minor |
| 44px | **Closed** | Spec 446–448 / 472–478。`expectMajorActionAtLeast44` は `getByRole("button")` 専用（`:1103–1113`）。新4ページは「次へ」を測らない・押さない。5 ページ目は「以降は指定なしでスキップ」と「戻る」（`.ui-btn` は `styles.css:2852–2854` で 44px）、6〜8 は「戻る」。前進は 350ms 後に radio `.focus()` + `activateFocusedWithKeyboard(page, "Space")`。`.focus()` は 44px レイアウト走査では許可（コメント `:1096–1100`）。カードは `.wizard-option` の `min-height: 44px`（`styles.css:208–211`）だが button ヘルパの対象外で、本文はヘルパ拡張を要求していない |
| 4ページ歩き 350ms | **Closed** | 共通ルール 442–445: `blocked()` は **そのページの mount**（擬似コード 139, 144）。heading `toBeVisible()`（キーボードは `toBeFocused()`）の直後 click/Space は食われるので、各ページ `waitForTimeout(350)` してから操作。household 455–456、mobile 471、44px 475、キーボード 462–464 が同じ起点。audience の「次へ」からの経過ではない。手段はカード `.click()` か radio Space。指定なしは `.check()` 禁止（415–417, 449–450） |

## 3. Critical

なし。`firstIncompletePlannerStep` 非変更は Spec 45–48 と live `planner-wizard.ts:44–52` のまま。`?resume=review` 4b、必須4問の「次へ」（Spec 25–26）、避ける食材・メモ・冷蔵庫は確認（Spec 27–28, 327）、`shared/contracts` / Functions 非変更（Spec 493）、P-01 の audience `goToStep("timeLimit")` 禁止（Spec 302–303）、P-05 の時間・予算リテラルと `""`→`null`（Spec 232–256、live `review-step.tsx:597–614` / `:631–645`）はデルタで崩れていない。6〜8 は「戻る」で出られる。

## 4. Important

なし。4 系統は互いに一文で矛盾せず、Plan が live ヘルパ名とボタン名を機械的に抄っても本線 E2E が赤になる分岐は残っていない。

## 5. Minor

### M-1: P-03 の短い待ち文が、まだ heading 直後 Space と読める

- **Severity:** Minor
- **Spec:** 220–222（`toBeFocused()` のあと 350ms を挟んでから Space）。E2E 本線は 458–467 の 4 手
- **live:** `cuisine-step.tsx:89`（`h2 tabIndex={-1}`）、`generation-recovery-results.spec.ts:1306–1314`（heading のあと `tabUntil` で radio、そこで Space）。活性化は radio の `onKeyUp`（Spec 172–174）
- **failure path:** P-03 だけを抄ると heading 上 Space になり、ページが進まず偽赤。E2E 節は heading 上 Space では届かないと書いて 4 手を固定しているので、本線レシピは閉じている
- **必要な修正:** 220–222 を「`toBeFocused()` のあと 350ms、続けて `tabUntil` で radio に着いてから Space（E2E 節と同じ）」へ揃える。計画は止めない

### M-2: 確認ヘルプの新文言がまだ「見直す」だけ

- **Severity:** Minor
- **Spec:** 335
- **live:** `review-step.tsx:559–561`（「直したあとは『確認に戻る』でこの画面に戻ります。」）
- **failure path:** 追加条件 step には `nextLabel` を渡さない（Spec 314–316）ので、調理時間などを「変更」した利用者への案内が必須4問のボタン名のまま残る。選択で `advanceFromEditOr` するため閉じ込めにはならない
- **必要な修正:** 任意 step は「選ぶと確認に戻る」と書き分ける

### M-3: 7/8 ページの options / `onSelect` が時間・予算と同じ粒度で貼られていない

- **Severity:** Minor
- **Spec:** 260–263
- **live:** `review-step.tsx:664–684`（材料）、`:696–716`（雰囲気）、`planner-labels.ts:23–37`
- **failure path:** 実装者が labels のキーを落とすと契約の enum とズレる。P-05 本体の時間・予算リテラルは Closed
- **必要な修正:** 時間・予算と同じく options 配列と `onSelect` の literal を本文へ貼る

### M-4: radiogroup の `aria-labelledby` を heading `id` に張ると書いていない

- **Severity:** Minor
- **Spec:** 74（「radiogroup の名前はこの heading 側に持たせ」）
- **live:** `ReviewChoiceField` は `aria-labelledby={`${id}-label`}`（`review-step.tsx:119–126`）。cuisine の radiogroup は名前無し（`cuisine-step.tsx:92–96`）、名前は `<section aria-labelledby>`（`:85`）
- **failure path:** 新4ページの radiogroup が無名のまま axe を通す / 通さないが Plan で割れる。閉じ込めにはならない
- **必要な修正:** heading `id` を radiogroup の `aria-labelledby` に張ると一文足す

### M-5: incomplete 時の `returnToReviewAfterEdit` を本文が黙っている

- **Severity:** Minor
- **Spec:** 302–309（complete ガードのあと `advanceFromEditOr`。フラグを先に false して直指定は禁止）
- **live:** household 現行は先に `setReturnToReviewAfterEdit(false)` してから incomplete なら `firstIncomplete`（`planner-wizard.tsx:542–546`）。`advanceFromEditOr` → `returnToReviewIfQuestionsComplete`（`:251–264`）は incomplete なら review に戻さない
- **failure path:** 編集戻り中に audience を incomplete にすると、フラグの残し方で「確認に戻る」が review に帰るか `timeLimit` へ出るかが実装者判断になる。P-01 の complete 本線は helper で閉じる
- **必要な修正:** incomplete なら `advanceFromEditOr` 経由で `firstIncomplete` に留まり、フラグは `returnToReviewIfQuestionsComplete` が落とす、と一文足す

### M-6: wizard 単位 leftover テストが `.wizard-option` を要求しない

- **Severity:** Minor
- **Spec:** isolated は `.wizard-option` を `userEvent.click`（343–345）。wizard 単位 D-02 は「6ページ目の**初回** click」（217–219, 360–361）で対象セレクタを固定していない
- **live:** 既存 wizard テストは `user.click(screen.getByRole("radio", …))`（`planner-wizard.test.tsx:306, 742`）。受け口は label の `onPointerUp`（Spec 163–165）。input 直 click でも bubble で label ハンドラは通るが、input 上ハンドラ実装を緑にし得る
- **failure path:** wizard leftover だけ radio 直 click だと、受け口を input に置いた実装でも緑。isolated が label を要求済みなので本線の活性化契約は閉じている
- **必要な修正:** wizard 単位 leftover も `.wizard-option` を叩くと一文足す

## 6. 偽陽性として却下したもの

| 項目 | 裁定 | 理由 |
| --- | --- | --- |
| P-03 220–222 を Keyboard 系統の Important に戻す | **Rejected（重大度）** | E2E 節 458–467 が 4 手を固定し、heading 上 Space では届かないと書いた。残りは短い待ち文の誤読（M-1）。本線レシピは閉じている |
| 44px の「測る」が Space 前進の後に読める | **Rejected** | 「進める形にし、測る対象は…にする」は前進手段の置換と測定対象の置換の並列。live 44px は測ってから進む（`:1251–1256`）。本文は「次へ」を測るなと対象を置き換えており、順序の自己矛盾ではない |
| 44px の programmatic `.focus()` がキーボード禁止と衝突 | **Rejected** | live コメント `:1096–1100` がレイアウト走査と Tab 順証明を分けている。本文 466–467 / 475–476 も同じ。chromium のみ（`playwright.config.ts:46–53`） |
| pantry を順送りの戻る×8 に戻す | **Rejected** | 本文は「戻る×5」を採らず「対象を変更 → 確認に戻る」に固定。`savePlannerMeal` の戻る×8（430–431）は別ヘルパ |
| household が page 8 で「ひねりたい」を `.check()` する現行を延長 | **Rejected** | 本文 415–417 / 449–450 / 454–456 はカード `.click()`。`.check()` は既 checked で no-op、input 直だと `pointerup` を外す |
| leftover click を Critical に戻す | **Rejected** | 350ms 中の `handleChange` 無視。click は `onPointerUp` を発火しない。6〜8 は「戻る」で出られる |
| 骨格 / P-01 / P-05 / 4b / contracts / firstIncomplete | **Rejected** | 再開しない。audience は `advanceFromEditOr("timeLimit")`（Spec 302–303）。現行 live `:536–548` の `goToStep("review")` は書き換え対象であって本文の穴ではない |
| `activateFocusedWithKeyboard` 既定 Enter | **Rejected** | 本文 44px は第 2 引数 `"Space"` を明示（476）。radio の活性化は Space（P-02） |
