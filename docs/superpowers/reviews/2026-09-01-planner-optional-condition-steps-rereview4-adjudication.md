# 追加条件ウィザードstep化 設計 — 第4デルタ再レビュー裁定

- 日付: 2026-09-01
- 裁定者: 親エージェント
- 対象: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md`（`f7f7c1ad`）
- 入力: rereview4 一次（APPROVE）、敵対的（REVISE / Important 2）、二次（APPROVE）、親の live / Chromium radio group / Blink Space / Playwright 再照合
- 最終判定: **APPROVE。Critical 0。Important 0。** 第3裁定が埋め込ませた 4 系統は本文と live が一文になった。Plan / 実装開始を止めるブロッカーは無い。

## 1. 裁定方法

一次と敵対的は独立スレッド、二次は両レビューを入力に別スレッド。親は pantry ボタン名、P-03 220–222 と個別 4 手の併存、`tabUntil` と radio group の Tab 順、44px helper、`blocked()` の起点を再照合した。

閉じた骨格・P-01・P-05 本体・D-03 擬似コード本体・D-02 テスト節（最初の活性化 0 回）・D-01 helper 名は再開しない。今回見るのは、第3デルタの残 4 系統が **新しいテスト契約として live ヘルパと一文になるか**、およびデルタ外に残った旧文が本線 E2E を赤にするか、である。

主要な再照合:

- 編集戻り中の audience は `editReturnActionLabels` で `nextLabel: "確認に戻る"`（`planner-wizard.tsx:275–278`）。`advanceFromEditOr`（`:257–264`）。`clickWizardNext` は name `"次へ"` 専用（`history.ts:41–42`）。unit は編集中の「次へ」不在と「確認に戻る」（`planner-wizard.test.tsx:770–772`、対象変更 `:801–804`）。確認は `review-step.tsx:547` `aria-label="対象を変更"` → `:585–588` がフラグを立てる。
- `h2` は `tabIndex={-1}`（`cuisine-step.tsx:89`）。mount focus は `:45–47`。現行キーボードは heading `toBeFocused()` のあと `tabUntil` で radio、そこで Space（`generation-recovery-results.spec.ts:1306–1314`、cuisine `:1343–1351`）。`tabUntil` は Tab 連打、programmatic `.focus()` 禁止（`:1193–1206`, `:1286`）。
- 44px helper は `getByRole("button", { name })`（`:1103–1113`）。コメントはレイアウト走査と Tab 順証明を分割（`:1096–1100`）。ジャンルは radio `.focus()` + Space のあと `"次へ"` を測り Enter（`:1251–1256`）。`activateFocusedWithKeyboard` の既定は Enter（`:1127–1132`）。
- live の radio は同名 group（`cuisine-step.tsx:102` `name="genre"`、`meal-step.tsx:107` `name="meal"`、`audience-step.tsx:279,292` `name="audience-mode"`、`review-step.tsx:131–133` `name={id}`）。Chromium の Sequential Focus Navigation はチェック済み（無ければ先頭）だけを Tab 対象にする。他は Arrow。E2E は chromium のみ（`playwright.config.ts:46–53`）。
- `blocked()` の起点は `mountedAt = Date.now()`（Spec 139、144）。audience の「次へ」からの経過ではない。
- Blink / WebKit の radio Space は keyup 既定。既チェックは simulated click を出さない。活性化は `onKeyUp`（Spec 172–174、189）。
- React 19.2.7 の `pointerup` は discrete。flush は microtask。ハンドラ末 `flushSync` ではない。

## 2. 4系統の閉じ確認

| 系統 | 状態 | 裁定 |
| --- | --- | --- |
| pantry `:263–278` ボタン名 | **Closed** | Spec 408–414 は「対象を変更 → 選び直し → **確認に戻る**」。`clickWizardNext` 禁止。`getByRole("button", { name: "確認に戻る" }).click()`。戻る回数 432–433 から「戻る×5、または」が消えた。live の `nextLabel` と一致 |
| キーボード 4 手 | **Closed**（P-03 旧文は Minor） | 個別 458–467 は `toBeFocused()` → 350ms → `tabUntil` radio → Space。heading 上 Space では届かないと明記。`tabUntil("次へ")` 禁止。`.focus()` 禁止。live キーボードと同じ形 |
| 44px の測る対象と前進 | **Closed** | 472–478。「次へ」を測るな・押すな。5 はスキップと戻る、6〜8 は戻る。前進は radio `.focus()` + `activateFocusedWithKeyboard(..., "Space")`。helper は button 専用なので、測る対象が button なら拡張は不要 |
| 4ページ歩きの 350ms | **Closed** | 共通 442–445。`blocked()` は **そのページの mount**。household 455 / mobile 471 / 44px 475 / キーボード 462–464。指定なし通過の pointer は `.click()`（415–417、449–450） |

D-03 擬似コード本体、D-02 の P-03 本文（最初の活性化 0 回、wizard 初回）、D-01 表の helper 名（`generateShoppingMenu`、`ensurePlannerReady` 除外、`answerAudienceAndReview`、手段列）は再開しない。P-01 / P-05 / `firstIncomplete` 非変更（Spec 45–48、live `planner-wizard.ts:44–52`）/ 4b / contracts も再開しない。

## 3. 食い違いの裁定

| 元 | 最終severity | 裁定 | 理由 |
| --- | --- | --- | --- |
| 敵対 I-1（P-03 220–222 が heading 上 Space）/ 一次 M-1 | **Minor** | **Downgraded** | named recipe は個別 458–467。heading 上 Space は 459–460 が否定する。P-03 の Space を heading に打ってから 4 手を直列しても、h2 に `onKeyUp` は無く no-op。続けて `tabUntil` + Space は緑。P-03 だけを手順の全部と読む赤は、stale 文の経路。第3裁定パッチ 2 の「消す」が個別にだけ落ちた残差。本線レシピは閉じている |
| 敵対 I-2（`tabUntil(選ぶ選択肢)` が未チェックへ着けない）/ 一次は未指摘 | **Minor** | **Downgraded**（新規 Minor） | 同名 radio で Tab がチェック済み以外へ着けないのは Chromium の事実。P-02 矢印と cuisine 踏襲は `name` を要求する。ただし live キーボードの `tabUntil("和食")` 等は **未チェック集団の先頭** で、新ページの先頭は既チェックの「指定なし」。189 の Space で進む。キーボード named test は review まで進むことであり、household の「ひねりたい」は pointer の別行。指定なしで実装すると緑。反対実装の強制ではない |
| 敵対 A-3（44px 個別に heading 待ちが無い） | **Minor** | 一次は未指摘、敵対どおり Minor | 共通 444 が 44px を含む。個別 475–476 だけを完全手順と読むと 350ms が mount より前に始まり得る。共通と合成すれば緑 |
| 一次 M-2…M-6 / 敵対 M-2 | **Minor** | Confirmed | 確認ヘルプ、7/8 options、`aria-labelledby`、incomplete フラグ、wizard leftover のセレクタ、skip の「指定なし」部分一致 |

第3裁定のときキーボード / 44px を Minor から上げた理由は「failure path の反証が無い」だった。今回は反証がある。I-1 は named recipe が既に 4 手で、直列しても赤にならない。I-2 は live 先頭アナログ（指定なし）が緑。

「6〜8 に戻る」では落としていない。戻るは Critical の自動降格材料。I-1 / I-2 の Minor 化は、失敗経路が本線 E2E を必ず赤にしないから。

## 4. 偽陽性・再開しないもの

| 項目 | 裁定 | 理由 |
| --- | --- | --- |
| leftover を Critical に戻す | **Rejected** | 350ms 中の `handleChange` 無視。click は `onPointerUp` を発火しない。6〜8 は「戻る」 |
| React 19 は pointerup 末で flushSync | **Rejected**（機序） | discrete は真。flush は microtask |
| Space の既定が keydown なので mutex が間に合わない | **Rejected** | 主 UA は keyup。既チェックは simulated click 自体を出さない。E2E は chromium |
| 共通「指定なしは `.click()`」と Space が反対 | **Rejected** | 448 が click **か** Space。449–450 は `.check()` no-op の pointer 経路。指定なし Space は 189 |
| 既チェック Space は click が無いので前進しない | **Rejected** | `onKeyUp` の `activate`。本文 189 が織り込み済み |
| 44px の `.focus()` がキーボード only を破る | **Rejected** | 別 test。live `:1096–1100` と本文 466 / 475–476 が分割 |
| `activateFocusedWithKeyboard` 既定 Enter | **Rejected** | 本文 476 が `"Space"` |
| skip 部分一致で本線が死ぬ | **Rejected**（本線） | `tabUntil` は radio、click は `.wizard-option`、測定名はフル。残差は Minor |
| pantry がまだ「次へ」/ 戻る×5 | **Rejected** | 408–414 / 432–433 が消した |
| 44px helper が button 専用なのでカード 44px が未測定 | **Rejected** | live `:1097` が native radio を対象外。本文はカードを測れと言っていない |
| 骨格 / P-01 / P-05 / D-03 擬似コード / D-02 初回 0 回 / D-01 helper 名 / 4b / contracts | **Rejected** | 再開しない |

## 5. Minor（計画は止めない。本文へ足すと誤読が安い）

1. **P-03 220–222** を個別と同じ 4 手に揃え、heading 上 Space と読める文を消す。
2. **キーボード `選ぶ選択肢`** を既チェックの「指定なし」（1 Tab）、または非デフォルトは Arrow のあと Space、に固定する。擬似コードへ `name`（踏襲が正）を足す。
3. 確認ヘルプの任意 step は「選ぶと確認に戻る」と書き分ける。
4. 7/8 の options / `onSelect` を時間・予算と同じ粒度で貼る。
5. radiogroup の `aria-labelledby` を heading `id` に張る。
6. incomplete 時は `advanceFromEditOr` 経由で `firstIncomplete` に留まり、フラグは `returnToReviewIfQuestionsComplete` が落とす、と一文。
7. wizard 単位 leftover も `.wizard-option` を叩く。
8. 44px 個別の矢印列先頭へ `expect(heading).toBeVisible()`。
9. 5 ページ目で `getByRole("button", { name: "指定なし" })` がスキップに部分一致する、と一行。

## 6. 修正後判定

**APPROVE。** 実装開始は再 APPROVE 待ちではなく、この HEAD の Spec を正本にして Plan に進んでよい。Minor は Plan 着手前に本文へ足しても、Plan 本文で固定しても、どちらでも本線は壊れない。
