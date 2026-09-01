# 追加条件ウィザードstep化 — 第3デルタ再レビュー（一次）

- 日付: 2026-09-01
- 対象: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md` @ `386d8159`
- 実施者: 読み取り専用 Reviewer
- 判定: **REVISE — Critical 0、Important 1、Minor 6**

## 1. Verdict

直前裁定が「Spec へ書け」とした D-02 残りと D-03 残りは本文に落ち、経路表・擬似コード・テスト契約は live の label カード / Blink Space / React 19.2.7 discrete flush と矛盾しない。D-01 表（`generateShoppingMenu`、`ensurePlannerReady` 除外、`answerAudienceAndReview` 名、手段列、指定なし `.click()`）も表としては閉じた。骨格と P-01 / P-05 本体、D-02 の P-03 本文は再開しない。

残る穴は D-01 が固定した pantry `:263–278` の操作列だけである。裁定の片方「対象を変更→確認に戻る」を採りながら、本文は audience のボタンを「次へ」と書いた。live の編集戻りは `nextLabel: "確認に戻る"` であり、`clickWizardNext` は name `"次へ"` 専用。戻る回数節はまだ「戻る×5 または」を残し、D-01 の「採らない」と並立する。Plan が D-01 を機械的に抄ると pantry E2E は赤、戻る×5 を採ると順送りの `次へ` が `timeLimit` に着地する。

この 1 系統を「確認に戻る」へ一文固定するまで Plan / 実装開始は早い。それ以外の本線（未選択 tap / Space / 指定なし通過 / leftover）は擬似コードで閉じている。

## 2. D-01〜D-03 閉じ確認

| ID | 状態 | 1行根拠 |
| --- | --- | --- |
| D-01 | **Partial** | 表は `generateShoppingMenu`（Spec 391、live `shopping.ts:70–99` `:88–89`）、`ensurePlannerReady` を walker から外す（Spec 403–404、live `:40–67`）、`answerAudienceAndReview` 名（Spec 398、live `mobile-accessibility.spec.ts:130–149`）、前置き「既定 skip / 手段列だけ歩く」（Spec 384–385）、household `4ページ歩き` / キーボード `Space` / mobile・44px `4ページ歩き`、指定なし `.click()`（Spec 412–414）。`:277` は「対象を変更」を採ったが操作列が「次へ」（Spec 408–411）。戻る回数はまだ「戻る×5 または」（Spec 429–430）。live 編集戻りは `planner-wizard.tsx:275–278` の「確認に戻る」、`clickWizardNext` は `history.ts:41–42` で name `"次へ"` 専用（§4 I-1） |
| D-02 | **Closed** | テスト節の「2発目 click」は消えた。isolated は mount 後 350ms 以内の**最初の**活性化 0 回（Spec 349–351）、wizard は 6ページ目の**初回** click で `6. 予算` に留まる（Spec 360–361 / 217–219）。P-03 の無視対象は `activate`（label `pointerup` / Space `keyup`）と `handleChange`（Spec 208–210）。live leftover 動機は `.wizard-transition` 180ms（`styles.css:840–842`）が現行 `<section>`（`cuisine-step.tsx:85`）に未適用のまま |
| D-03 | **Closed** | 擬似コード（Spec 138–179）は未選択 `activate`=値+遷移・後続 `change` は mutex、既選択再 tap / 既選択 Space は pointer / keyup が値+遷移、矢印は `handleChange` のみで mutex を立てない。`blocked()`（350ms と `disabled`）を mutex より前（Spec 142–144, 196–197）。`onChange` を `activate` に通さない（Spec 153–157, 171）。`key={step}`（Spec 136–137, 193–195）。unit は `.wizard-option` を `userEvent.click`（Spec 343–345）。leftover は mount 後 350ms の `onChange` 無視を採り、`onNext` 遅延は採らない（Spec 198–200）。live カードは `<label class="wizard-option">`（`cuisine-step.tsx:98–112`）、ヒット領域 `styles.css:208–211`。wizard は `if (step === …) return (<main>`（`planner-wizard.tsx:403–566`）で同 type 再利用が起きる前提と一致。Blink Space は keyup 既定で simulated click（後述 §6） |

## 3. Critical

なし。`firstIncompletePlannerStep` 非変更は Spec 45–48 と live `planner-wizard.ts:48–52` のまま。`?resume=review` 4b、必須4問の「次へ」（Spec 25–26）、避ける食材は確認（Spec 27–28）、`shared/contracts` / Functions 非変更（Spec 460）、P-01 の audience `goToStep("timeLimit")` 禁止（Spec 302–303）、P-05 の時間・予算リテラルと `""`→`null`（Spec 232–256、live `review-step.tsx:597–614` / `:631–645`、Incomplete idle `use-draft-autosave.ts:84–86, 642–646`）はデルタで崩れていない。同一ジェスチャ leftover は 350ms の `onChange` 無視で仕様として閉じ、6〜8 は「戻る」で出られる。

## 4. Important

### I-1: D-01 が pantry `:263–278` を「対象を変更 → 次へ」と書き、live の編集戻りボタン「確認に戻る」と矛盾する

- **Severity:** Important
- **Spec:** 408–411（操作列と「戻る×5 案は採らない」）、429–430（戻る回数の「戻る×5、または『対象を変更』」）、314–316（P-01: 編集戻りの `nextLabel` は「確認に戻る」）、376–378（`clickWizardNext` は「次へ」専用）
- **live:** `review-step.tsx:547`（`aria-label="対象を変更"`）、`planner-wizard.tsx:585–588`（`onEditStep` が `returnToReviewAfterEdit` を立てる）、`:275–278`（`nextLabel: "確認に戻る"`）、`:257–264`（`advanceFromEditOr` はフラグ中なら `review` / incomplete へ）、`history.ts:41–42`（`getByRole("button", { name: "次へ" })`）、`planner-wizard.test.tsx:801–804`（対象を変更 → `確認に戻る`）、`menu-domain-pantry.spec.ts:263–278`（現行は順送りの「戻る」1回 + `clickWizardNext` + `"5. 確認"`）

**failure path:**

1. Plan が D-01 408–411 を抄って `getByRole("button", { name: "次へ" })` または `clickWizardNext` を書く。編集戻り中の audience に「次へ」は無く（live unit `:770–772` も `queryByRole(..., "次へ")` 不在を主張する）、15s タイムアウトで pantry 本線が赤。
2. 戻る回数 429–430 の「または戻る×5」を採る。順送りなのでフラグは立たず、audience のボタンは本当に「次へ」。P-01 どおり `advanceFromEditOr("timeLimit")` し `5. 調理時間` に着地する。テストが `"9. 確認"` を待つと赤。skip を足すと D-01 の「採らない」と二重適用になる。
3. 「次へ」を探せず skip helper に逃げる。編集中は `onSkipRest` を渡さない（Spec 289–290）のでスキップボタンも無い。

裁定の閉じ条件は「対象を変更→確認に戻る」**または**「戻る×5→次へ後 skip」の片方だった。本文は前者を採りながら第三操作を「次へ」と誤名し、後者を戻る回数節に残した。

**必要な修正:** 408–411 を「確認の『対象を変更』→ audience で選び直し → **『確認に戻る』**」に固定する。`clickWizardNext` をこの区間で使わない。429–430 の「戻る×5、または」を消し、D-01 の「採らない」と一文にする。

## 5. Minor

### M-1: 確認ヘルプの新文言がまだ「見直す」だけ

- **Spec:** 335（「9ページ構成に合わせて見直す」）
- **live:** `review-step.tsx:559–561`（「直したあとは『確認に戻る』でこの画面に戻ります。」）
- **failure path:** 追加条件 step には `nextLabel` を渡さない（Spec 314–316）ので、調理時間などを「変更」した利用者への案内が必須4問のボタン名のまま残る。選択で `advanceFromEditOr` するため閉じ込めにはならない。
- **必要な修正:** 任意 step は「選ぶと確認に戻る」と書き分ける。計画は止めない。

### M-2: 7/8 ページの options / `onSelect` が時間・予算と同じ粒度で貼られていない

- **Spec:** 260–263（`planner-labels` と「現行 `ReviewChoiceField` と同じ literal 比較」）
- **live:** `review-step.tsx:664–684`（材料）、`:696–716`（雰囲気）
- **failure path:** 実装者が labels のキーを落とすと契約の enum とズレる。P-05 本体の時間・予算リテラルは Closed。
- **必要な修正:** 時間・予算と同じく options 配列と `onSelect` の literal を本文へ貼る。

### M-3: radiogroup の `aria-labelledby` を heading `id` に張ると書いていない

- **Spec:** 74（「radiogroup の名前はこの heading 側に持たせ」）
- **live:** `ReviewChoiceField` は `aria-labelledby={`${id}-label`}`（`review-step.tsx:119–126`）。cuisine の radiogroup は名前無し（`cuisine-step.tsx:92–96`）、名前は `<section aria-labelledby>`（`:85`）
- **failure path:** 新4ページの radiogroup が無名のまま axe を通す / 通さないが Plan で割れる。閉じ込めにはならない。
- **必要な修正:** heading `id` を radiogroup の `aria-labelledby` に張ると一文足す。

### M-4: キーボード導線が heading focused の直後に Space と読める

- **Spec:** 437–441（`heading` の `toBeFocused()` のあと 350ms 待ってから Space）
- **live:** heading focus のあと `tabUntil` で radio に着いてから Space（`generation-recovery-results.spec.ts:1306–1314`、cuisine `:1343–1351`）。`h2` は `tabIndex={-1}`（`cuisine-step.tsx:89`）。キーボード専用は programmatic `.focus()` 禁止（`:1286–1287`, `tabUntil` `:1193–1206`）
- **failure path:** 実装者が heading 上で Space し、radio が活性化せず偽赤。350ms 待ち自体は D-02 で閉じている。
- **必要な修正:** 「350ms のあと radio へ Tab してから Space」をキーボード節へ足す。

### M-5: incomplete 時の `returnToReviewAfterEdit` を本文が黙っている

- **Spec:** 302–309（complete ガードのあと `advanceFromEditOr`。フラグを先に false して直指定は禁止）
- **live:** household 現行は先に `setReturnToReviewAfterEdit(false)` してから incomplete なら `firstIncomplete`（`planner-wizard.tsx:542–546`）。`advanceFromEditOr` → `returnToReviewIfQuestionsComplete`（`:251–264`）は incomplete なら review に戻さない
- **failure path:** 編集戻り中に audience を incomplete にすると、フラグの残し方で「確認に戻る」が review に帰るか `timeLimit` へ出るかが実装者判断になる。P-01 の complete 本線は helper で閉じる。
- **必要な修正:** incomplete ではフラグを残す / 落とすを一文で固定する。

### M-6: 44px 走査が新ページで何を測るか書いていない

- **Spec:** 400（表は `4ページ歩き`）、442–445（mobile の `assertStepFits` だけ具体）
- **live:** 44px helper は `getByRole("button")`（`generation-recovery-results.spec.ts:1103–1112`）。現行は各必須 step で `"次へ"` を測る（`:1253–1267`）。新4ページに「次へ」は無い（Spec 86）
- **failure path:** 既存パターンの `"次へ"` を 5〜8 に残すと要素無しで赤。測らず歩くだけにするとスキップ / 戻る / `.wizard-option` の 44px が未検証。カードは既に `min-height: 44px`（`styles.css:208–211`）
- **必要な修正:** 5ページ目はスキップと戻る、6〜8 は戻ると `.wizard-option` を測ると書く。計画は止めない。

## 6. 偽陽性として却下したもの

- **骨格 / P-01 / P-05 本体 / D-02 の P-03 本文の再開。** デルタは `plannerSteps` 挿入と `firstIncomplete` 非変更（Spec 42–48、live `:48–52`）、audience の `advanceFromEditOr("timeLimit")` 禁止事項、時間・予算リテラルを壊していない。
- **D-02 テスト節の「2発目」再発。** 問題説明（Spec 204–206, 212）に「2発目」は残るが、テスト契約は「最初の活性化 0 回」「6ページ目の初回 click」。Plan がテスト節を抄っても leftover 初回を緑にできる書き方は消えた。
- **D-03 が裁定文言どおり「未選択は `onChange`=値、pointer / Space は `onNext` のみ」になっていない。** 擬似コードは未選択を `activate` 内の `onSelect`+`onNext` とし、後続 `change` を mutex で落とす。pointerup 同期 `onNext` では値を先に書かないと unmount 後の `change` が落ちる。経路表は未選択 1/1、既選択 1/1、矢印 1/0。Blink の Space は `RadioInputType::HandleKeyupEvent` が keyup 既定で simulated click するため、React `onKeyUp`（dispatch 中）→ 既定 click/change の順で mutex が間に合う。E2E は chromium のみ（`playwright.config.ts:46–53`）。文字どおりの分割より本線は閉じている。
- **敵対 C-1 を Critical に戻す。** leftover の `change` は 350ms の `handleChange` が落とす（Spec 191, 198–200）。React 19.2.7（`package.json:41`）の `pointerup` は discrete だが flush は microtask でありハンドラ末 `flushSync` ではない。6〜8 は「戻る」で出られる。
- **「未選択 Space は change が keyup より先」**（第2デルタ一次 I-2）。Blink は keyup 既定。UI Events の keydown 既定 click は本リポジトリの Playwright 対象外。本文の順序主張（Spec 131–133, 188）は Chromium と一致する。
- **Blink で label 転送 click の `detail === 0` のため前進不能。** 本文は `detail` を見ない（Spec 116）。
- **`ensurePlannerReady` に skip を足せば足りる。** meal まで（`shopping.ts:40–67`）。表は `generateShoppingMenu` に直った。
- **`:1026` / `:866–871` / `acceptance.ts` を walker に数える。** 本文対象外どおり。
- **スキップ `goToStep("review")` と P-01 の衝突。** 禁止は audience の `goToStep("timeLimit")`。
- **320px / 44px カード不足 / Strict Mode が leftover を通す。** カードは既に 44px。Strict Mode remount は同期。同 type 再利用は `key={step}` で閉じた。
- **axe primary=「戻る」がハーネスと矛盾。** named button の可視だけ。
- **指定なし通過の `.check()` が未記載。** Spec 412–414 に入り、Playwright の既チェック no-op を本文が書いている。
- **7/8 未貼付・確認ヘルプ・aria-labelledby・incomplete フラグ・heading 上 Space を Important にする。** 前回どおり Minor。本線の二重 `onSelect` / 閉じ込め / walker 誤名（shopping）ではない。
- **経路表 unit が 350ms 経過前に「各1回」と書いてあること。** fake timers を進めないと偽赤になるが、失敗モードを緑にはしない。D-02 節が 350ms 後の活性化を既に要求する。
