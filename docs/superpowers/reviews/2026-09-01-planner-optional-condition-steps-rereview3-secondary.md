# 追加条件ウィザードstep化 — 第3デルタ再レビュー（二次）

- 日付: 2026-09-01
- 対象: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md` @ `386d8159`（HEAD 一致）
- デルタ: `git diff 06352949..386d8159 -- docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md`
- 入力: 直前裁定 `rereview2-adjudication`、一次 `rereview3-primary`、敵対的 `rereview3-adversarial`。live は現行正本（実装未着手）
- 実施者: 読み取り専用 Reviewer（一次・敵対的とは別コンテキスト）
- 判定: **REVISE — Critical 0。残 Important 4 系統。D-03 擬似コード本体は Closed。D-01 / D-02 は Partial。**

骨格（`firstIncomplete`、4b、必須4問の「次へ」、避ける食材は確認、`shared/contracts` / Functions、P-01 / P-05 本体）はデルタで壊れていない。再開しない。

## §1 Verdict

裁定が「Spec へ書け」とした D-03 残り（順序付き擬似コード、`blocked()` 先行、`onChange` を `activate` に通さない、`key={step}`、350ms 中の `onChange` 無視）と、D-02 残りのテスト節（「2発目」削除、最初の活性化 0 回、無視対象を `activate` / `handleChange` に合わせる）は本文に落ちた。leftover click が次ページの値を書く経路は、本文が選んだ「`onNext` 遅延は採らず 350ms で `onChange` も落とす」で閉じている。React 19.2.7 の discrete `pointerup` はハンドラ末 `flushSync` ではない（§5）。Blink / WebKit の radio Space は keyup 既定（§5）。

残るのは **新しいテスト契約が live ヘルパと一文にならない**ことである。一次の「I-1 だけ直せば APPROVE」は採らない。敵対のキーボード / 44px / 4ページ歩き 350ms は、Plan が本文を抄ったときの本線 E2E 偽赤として成立する。一次が Minor に落とした 2 件（heading 上 Space、44px が「次へ」を測る）は、failure path の反証が無いので Important に戻す。

実装開始は、§4 の 4 点を本文が一文で閉じるまで早い。

## §2 D-01〜D-03 閉じ確認

| ID | 裁定（rereview2）が要求した閉じ方 | 本文 @ `386d8159` | 二次の結論 |
| --- | --- | --- | --- |
| D-01 | `generateShoppingMenu`。`ensurePlannerReady` 削除。`answerAudienceAndReview` を名前で。既定 skip、個別が歩きを指定した行は skip しない。household / キーボード / mobile・44px に手段列。`:277` は二択を一文に。指定なしは `.click()` | 表は helper 名 + 手段列（Spec 387–401）。shopping は `generateShoppingMenu` `:88–89` skip（live `shopping.ts:70–99`）。`ensurePlannerReady` は walker ではない（Spec 403–404、live `:40–67`）。`answerAudienceAndReview` は 4ページ歩き（Spec 398、live `mobile-accessibility.spec.ts:130–149`）。指定なし `.click()`（Spec 412–414）。`:408–411` は「対象を変更」を採ったが第三操作が「次へ」。戻る回数 429–430 はまだ「戻る×5、または」。44px 行は測る対象も 350ms も無い | **Partial。** 表・`.click()`・shopping 名は閉じた。`:277` のボタン名と戻る回数の「または」、44px / 4ページ歩きの 350ms が残る |
| D-02 | テスト節の「2発目」を消す。isolated は最初の活性化 0 回。無視対象を `activate`（pointerup / Space keyup）に合わせる | P-03 本文 208–210 は `activate` と `handleChange`。テスト節 349–351 / 360–361 は「最初の活性化 0 回」と wizard 初回。キーボード 220–222 / 437–441 は heading 後 350ms → Space（Tab 先が無い） | **Partial。** 裁定が求めたテスト節の文言は閉じた。D-02 が本文に書いたキーボード契約そのものが、踏襲先の heading `tabIndex={-1}` と同時成立しない |
| D-03 | 順序付き擬似コード。350ms と `disabled` を mutex より前。`onChange` を `activate` に通さない。`key={step}`。unit は `.wizard-option`。leftover は `onNext` 遅延 **または** 350ms 中の `onChange` 無視 | 擬似コード 135–180。`blocked()` 先行（142–144、196–197）。`handleChange` は mutex 中 return（153–157）。`key={step}`（136–137、193–195）。unit は label を userEvent（342–345）。leftover は 350ms `onChange` 無視を採択（198–200） | **Closed**（擬似コード本体）。wizard 単位 click が radio 直のまま分裂し得ることは isolated が label を要求した時点で Plan 入力の本線偽緑にはならない（I-3 を Minor へ） |

P-01 / P-05 本体と D-02 の P-03 **本文**（最初の活性化 0 回、wizard 初回）は再開しない。

## §3 二次判定表（一次・敵対の各 ID）

| 元ID | 判定 | 最終severity | 根拠 |
| --- | --- | --- | --- |
| 一次 I-1（pantry `:263–278` が「対象を変更 → 次へ」、戻る回数は「または」） | **Confirmed** | **Important** | Spec 408–411 は「確認の『対象を変更』→ audience で選び直し → **『次へ』**」。Spec 314–316 は編集戻りの `nextLabel` を「確認に戻る」とし、追加条件 step にだけ渡さない。audience は必須 step なので live は `editReturnActionLabels` を渡す（`planner-wizard.tsx:275–278`）。live 確認の操作は `review-step.tsx:547` `aria-label="対象を変更"` → `planner-wizard.tsx:585–588` が `returnToReviewAfterEdit` を立てる → audience のボタンは「確認に戻る」。unit も編集中の「次へ」不在を主張する（`planner-wizard.test.tsx:770–772`、対象変更 `:801–804`）。`clickWizardNext` は `history.ts:41–42` で name `"次へ"` 専用。Plan が 408–411 を抄って `clickWizardNext` / `getByRole(..., "次へ")` を書くと 15s タイムアウトで pantry 本線が赤。戻る回数 429–430 は同じ `:263–264` を「戻る×5、または『対象を変更』」のまま。戻る×5 は順送りなのでフラグは立たず、ボタンは本当に「次へ」。P-01 どおり `advanceFromEditOr("timeLimit")` し `5. 調理時間` に着地する。skip を足すと walker の「採らない」と二重適用。裁定の閉じ条件は「対象を変更→**確認に戻る**」**または**「戻る×5→次へ後 skip」の片方。本文は前者を採りながら第三操作を誤名し、後者を旧節に残した |
| 敵対 I-4（`:277` 固定と戻る回数旧文） | **Confirmed。一次 I-1 と Duplicate** | **Important** | 同じ矛盾の戻る回数側。live `:263` は確認からの順送り「戻る」1 回で `4. 作る相手`、`:277` は `clickWizardNext` → `"5. 確認"`。編集フラグは立っていない。一次 I-1 にボタン名まで含むので、残ブロッカーは一次 I-1 を正とする |
| 敵対 I-1（キーボードが heading 上 Space） / 一次 M-4 | **Confirmed。一次の Minor は不採用（Upgraded）** | **Important** | Spec 220–222 / 401 / 437–441: `heading` の `toBeFocused()` のあと 350ms 待って Space。活性化の受け口は **各 radio の `onKeyUp`**（Spec 172–174）。live `cuisine-step.tsx:89` の `h2` は `tabIndex={-1}`。mount focus は `useEffect` で heading（`:45–47`）。Space の活性化対象は radio。現行キーボードは heading `toBeFocused()` の**あと** `tabUntil` で radio へ行き、そこで Space（`generation-recovery-results.spec.ts:1306–1314`、cuisine `:1343–1351`）。`tabUntil` は Tab 連打（`:1193–1206`）、programmatic `.focus()` フォールバックは禁止（`:1286`）。本文どおりの E2E は heading に Space を送り、どの radio の `onKeyUp` にも届かない。ページは進まない。偽赤。逃げ道 (a) 最初の radio を mount focus → heading `toBeFocused()` が死に既存 meal/cuisine 契約と不揃い、(b) heading に Space ハンドラを付けて「指定なし」で `activate` → 確認の見出しにいるつもりで Space した利用者が 5〜8 を飛ばす、(c) テスト側で黙って Tab → 本文のキーボード契約を満たしていない。裁定 rereview2 の Minor は「350ms のあと radio へ Tab してから Space」だった。デルタは待ちだけを入れて Tab を落とした。実利用者は Tab → radio → Space なので本線 UI は動く。ただし Plan が 437–441 を抄ると本線キーボード E2E が偽赤、または (b) で誤スキップ。Important の定義（本文抄録で本線テストが偽赤、または壊れる分岐を選ぶ）を満たす。 Minor に落とす反証（heading 上 Space で radio が活性化する、live が heading に Space している、など）は無い |
| 敵対 I-2（44px が「次へ」を測り「次へ」で進む） / 一次 M-6 | **Confirmed。一次の Minor は不採用（Upgraded）** | **Important** | Spec 86 / 347: DOM に「次へ」は置かない。表は 44px 走査 `:1259–1272` を **4ページ歩き**（Spec 400）。mobile の `assertStepFits` だけが測るボタンを書いた（442–445）。44px 行には測る対象も 350ms も前進手段も無い。live ヘルパ `expectMajorActionAtLeast44` は `getByRole("button", { name })` の高さ（`generation-recovery-results.spec.ts:1103–1113`）。コメントは「44px は primary/戻る等の操作 button。native radio は対象外」（`:1097`）。ジャンルは radio を Space したあと `expectMajorActionAtLeast44(page, "次へ")` し、`次へ` に focus して Enter で進む（`:1251–1256`）。audience も同じ（`:1267–1269`）。その直後が「5. 確認」（`:1271–1272`）。Plan が現行パターンを延長すると、5ページ目で `"次へ"` が 0 件で赤。進む手段も `次へ` Enter なので、カード Space / click に切り替えないと確認へ着けない。カードは `<label class="wizard-option">` であり button ではない（`cuisine-step.tsx:98–112`、`styles.css:208–219`）。ヘルパを変えずに `.wizard-option` を測ることはできない。逃げ道 (a) 次へボタンを足す → isolated「次へが無い」と衝突、(b) 測る対象を 戻る / スキップに変え、進む前に 350ms 待つ → 44px 行に無い、(c) 表を無視して skip する → 新4ページの 44px 未測定。カード CSS は既に `min-height: 44px`（`styles.css:208–211`）だが、それは走査が緑になる理由にならない。計画を止めない Minor の反証は、本文が「測るな」と書いていない以上成立しない |
| 敵対 I-5（4ページ歩きに 350ms 待ちが無い） | **Confirmed** | **Important** | Spec 394 / 398 / 400 は household / mobile / 44px を 4ページ歩き。350ms 待ちを明示するのはキーボード導線だけ（437–441）。P-03 は「E2E のフルウォークは遅いので拾えない」（206 行）と **遅すぎて leftover を拾えない**側だけを見ている。指定なし通過は `.click()`（412–414）。live: Playwright `locator.check()` は既チェックなら直ちに return（公式: "If the element is already checked, this method returns immediately."）。`locator.click()` は毎回 pointer 系列を打つ。`expect(heading).toBeVisible()` は見えた瞬間に返す。既定の action 間ディレイは 350ms ではない。`blocked()` の起点は **そのページの `mountedAt = Date.now()`**（Spec 139、144）。敵対 A-9 の「5ページ目は audience の『次へ』から 350ms 以上経っているので最初の click は通る」は **誤り**。audience の `onNext` のあと page 5 が mount し、その瞬間から 350ms が始まる。heading 可視待ちは mount 後にすぐ返すので、5ページ目の正規 1 発目も 350ms 内に落ち得る。6ページ目以降は自動遷移直後の次行 click がさらに短い。6〜8 に「次へ」もスキップも無い。household 本線（`full-journey.spec.ts:71–73` を 4ページ歩きに延長、`:84–87` の雰囲気は確認から消える）が偽赤。逃げ道 (a) 各ページで 350ms 待つ → キーボード以外の歩きには書いていない、(b) ガードを短くする / Space だけ外す → P-03 の ~300ms 2 発目が次ページの値を書く、(c) household を skip に戻す → 自動遷移の主張が消える。閉じ込めは「戻る」で出られるので Critical ではない。D-01 の歩きと D-02 のガードが同時に成立しない |
| 敵対 I-3（wizard 単位 click が `.wizard-option` を要求していない） | **Confirmed（残差）。Important は Downgraded** | **Minor** | isolated は Spec 342–345 で `.wizard-option` を `userEvent.click`。wizard D-02 は 360–361 で「カードを click」「初回 click」のみ。live `planner-wizard.test.tsx:264, 306, 742` は `getByRole("radio")` 直 click。label の `onPointerUp` は input からの bubble でも発火する。実機のカード余白（`styles.css:208–219`）で WebKit が転送するのは click だけなので、**input に `onPointerUp` を置いた実装**は radio 直 userEvent が緑、余白タップは死ぬ。ただし D-03 残りは isolated に label を要求しており、Plan が isolated を抄れば input 上ハンドラはそこで赤になる。wizard 単位 leftover はタイミングのテストであり、label 上ハンドラなら radio 直 click でも bubble で通る。余白死は isolated 契約違反が前提。本線偽緑の Plan 入力にはならない。防御の重複不足として Minor |
| 一次 M-1（確認ヘルプが「見直す」だけ） / 敵対 M-3 | **Confirmed。Duplicate** | **Minor** | Spec 335。live `review-step.tsx:559–561` は必須4問の「確認に戻る」。追加条件 step には `nextLabel` を渡さない（Spec 314–316）。選択が `advanceFromEditOr` するので閉じ込めにならない。前回どおり |
| 一次 M-2（7/8 options 未貼付） / 敵対 M-1 | **Confirmed。Duplicate** | **Minor** | Spec 260–263。live 正本 `review-step.tsx:664–684` / `:696–716`。P-05 本体（時間・予算リテラルと `""`→`null`）は Closed（Spec 232–256、live `:597–614` / `:631–645`） |
| 一次 M-3（radiogroup `aria-labelledby`） / 敵対 M-2 | **Confirmed。Duplicate** | **Minor** | Spec 74 は「名前はこの heading 側」。live `ReviewChoiceField` は `aria-labelledby={`${id}-label`}`（`review-step.tsx:119–126`）。cuisine の radiogroup は名前無し（`cuisine-step.tsx:92–96`）、名前は `<section aria-labelledby>`（`:85`）。axe 追加は primary のスキップ / 戻るだけ |
| 一次 M-5（incomplete 時の `returnToReviewAfterEdit`） | **Confirmed** | **Minor** | Spec 302–309 は complete 本線を `advanceFromEditOr` に固定。live household 現行は先に `setReturnToReviewAfterEdit(false)` してから incomplete なら `firstIncomplete`（`planner-wizard.tsx:542–546`）。`advanceFromEditOr` → `returnToReviewIfQuestionsComplete`（`:251–264`）は incomplete なら review に戻さない。P-01 の complete 本線は helper で閉じる。フラグの残し/落としは一文足りないだけ |
| 敵対 M-2（household 5〜7 の選択値未記載） | **Confirmed** | **Minor** | Spec 434–436 は 8 ページ目で「ひねりたい」。5〜7 は `.click()` 規則だけ。未選択の「ひねりたい」は `.check()` でも click する。詰まるのは指定なし通過であり、412–414 が閉じている |
| 敵対 A-1（leftover click → 次ページ change）を Critical に戻す | **Rejected** | — | 本文 191 / 198–200 が 350ms 中の `onChange` 無視を採った。click は `onPointerUp` を発火しない。値も遷移も起きない。6〜8 は「戻る」がガード対象外（211 行） |
| 敵対 A-2 / 一次「未選択 Space は change が keyup より先」 | **Rejected**（主 UA） | — | Blink `RadioInputType::HandleKeyupEvent` は Space `" "` を keyup で扱い、既チェックなら simulated click を出さない。WebKit `RadioInputType::handleKeyupEvent` は `keyIdentifier() == "U+0020"` で同じく、既チェックなら `dispatchSimulatedClickIfActive` をスキップ。keydown 側は矢印。E2E は chromium のみ（`playwright.config.ts:46–53`）。UI Events の keydown 既定 click は本リポジトリの Playwright 対象外 |
| 敵対 A-6（同一ページ 2 枚目閉じ込め） | **Rejected**（Critical） | — | `blocked()` は mutex を立てない（142–144、352）。`onNext` は `advanceFromEditOr(次のstep)`（310–311）。本文どおりの親なら 1 回で unmount。`key={step}` で新 instance は別 ref |
| 敵対 A-7（jsdom が change を pointerup より先） | **Rejected** | — | user-event 14.6 の click は `pointer([{target}, {keys:'[MouseLeft]', target}])`。順は pointerdown → pointerup → click。radio `change` は click 既定 |

## §4 残ブロッカー（Plan 開始前に本文へ書くこと）

Critical は無い。次を本文に埋め込んでから Plan / 実装開始。

1. **pantry `:263–278` を「確認に戻る」へ一文固定（一次 I-1 / 敵対 I-4）**  
   408–411 を「確認の『対象を変更』→ audience で選び直し → **『確認に戻る』**」にする。この区間で `clickWizardNext` / `getByRole(..., "次へ")` を使わない。429–430 の「戻る×5、または」を消し、D-01 の「採らない」と一文にする。

2. **キーボードは heading 後 350ms のあと radio へ Tab してから Space（敵対 I-1）**  
   220–222 / 437–441 に「`toBeFocused()` → `waitForTimeout(350)` → `tabUntil` で radio → Space」と書く。heading 上 Space と読める書き方を消す。programmatic `.focus()` は現行どおり禁止。

3. **44px 走査が測るボタンと前進手段を書く（敵対 I-2）**  
   `:1259–1272` の延長で `"次へ"` を測るな。`expectMajorActionAtLeast44` は `getByRole("button")` 専用なので、5ページ目はスキップと戻る、6〜8 は戻る（カードを測るならヘルパを button 以外へ拡張すると書く）。前進は「次へ」Enter ではなくカードの click / Space。

4. **4ページ歩き（household / mobile / 44px）にも各ページ 350ms 待ち（敵対 I-5）**  
   ガードの起点は **その OptionalChoiceStep の mount** であり、audience の「次へ」からの経過ではない。heading 可視の直後 click は 5ページ目も含めて `blocked()` に食われ得る。キーボード以外の歩きにも `waitForTimeout(350)`（または同等）を手段列へ書く。ガード短縮と household skip 戻しは採らない。

Minor（計画は止めないが本文へ）: 確認ヘルプの任意 step 文言、7/8 の options 貼付、radiogroup `aria-labelledby`、incomplete 時のフラグ、wizard 単位 leftover も `.wizard-option` を叩く。

## §5 偽陽性

| 攻撃 | 理由 |
| --- | --- |
| 骨格 / `firstIncomplete` / 4b / 必須4問の「次へ」 / 避ける食材は確認 / contracts / Functions | デルタは `plannerSteps` 挿入と `firstIncomplete` 非変更（Spec 42–48、live `planner-wizard.ts:48–52`）を壊していない。再開しない |
| P-01 / P-05 本体 | audience の `goToStep("timeLimit")` 禁止（Spec 302–303）。時間・予算リテラルと `""`→`null`（Spec 232–256、live `review-step.tsx:597–614` / `:631–645`、Incomplete idle `use-draft-autosave.ts:84–86, 642–646`）は崩れていない |
| leftover click が次ページ `onChange` を書いて予算が汚れる（前回 C-1 を Critical に戻す） | 本文が 350ms 中の `onChange` 無視を採った。click は `onPointerUp` を発火しない。6〜8 は「戻る」で出られる |
| leftover click が次ページで pointerup を合成し、350ms 後に `activate` する | 合成自体が未確認。到着が 350ms 内なら `blocked()`。viewport は `width=device-width`（`index.html:11`）で旧 iOS ~300ms ghost click も対象外 |
| 「React 19.2.7 は discrete `pointerup` のハンドラ末で `flushSync` する」 | `package.json:41` は `react` `^19.2.7`。v19.2.7 `ReactDOMEventListener.js` の `getEventPriority` は `pointerup` を `DiscreteEventPriority` に含む。`dispatchDiscreteEvent` は優先度を立てて `dispatchEvent` するだけで、ハンドラ末 `flushSync` は呼ばない。sync 作業は `ReactFiberRootScheduler.js` の `ensureRootIsScheduled` → `scheduleImmediateRootScheduleTask` → `scheduleMicrotask` → `processRootScheduleInMicrotask`。`includesSyncLane` のとき「Synchronous work is always flushed at the end of the microtask」 |
| Space の既定が keydown なので mutex が間に合わない | UI Events は keydown。Blink / WebKit の radio は keyup。既チェックは simulated click 自体を出さない。主 UA と Playwright chromium では本文どおり |
| `userEvent.click(.wizard-option)` が `isPrimary` を付けない | user-event 14.6 `Pointer.getEventInit` は `isPrimary: this.isPrimary` と `button: getMouseEventButton(button)`。既定 mouse ポインタは `isPrimary=true`。click の便宜 API は `pointer([{target}, {keys:'[MouseLeft]', target}])` |
| jsdom が `change` を `pointerup` より先に出す | user-event の順は pointerup → click。radio `change` は click 既定 |
| mutex が instance 寿命のため同一ページ 2 枚目が選べない | 自動遷移が本文どおりなら 1 回で unmount。`blocked()` は mutex を立てない |
| disabled でも label の `onPointerUp` が発火する（前回 I-7） | 擬似コードの `blocked()` が `disabled` を mutex より前に見る（144 行） |
| `ensurePlannerReady` に skip を足さないと買い物が死ぬ | 本文 403–404 が walker ではないと書いた。対象は `generateShoppingMenu` |
| `:277` が skip 必須のまま | walker 節は対象を変更に固定。残るのはボタン名と戻る回数節（I-1） |
| 指定なし通過の `.check()` が未記載 | Spec 412–414 に入り、Playwright の既チェック no-op を本文が書いている |
| D-03 が裁定文言どおり「未選択は `onChange`=値、pointer / Space は `onNext` のみ」になっていない | 擬似コードは未選択を `activate` 内の `onSelect`+`onNext` とし、後続 `change` を mutex で落とす。pointerup 同期 `onNext` では値を先に書かないと unmount 後の `change` が落ちる。経路表は未選択 1/1。文字どおりの分割より本線は閉じている |
| D-02 テスト節の「2発目」再発 | 問題説明（Spec 204–206, 212）に「2発目」は残るが、テスト契約は「最初の活性化 0 回」「6ページ目の初回 click」。Plan がテスト節を抄っても leftover 初回を緑にできる書き方は消えた |
| Blink で label 転送 click の `detail===0` のため前進不能 | 本文は `detail` を見ない（Spec 116） |
| 320px / 44px カード不足 / Strict Mode が leftover を通す | カードは既に 44px。Strict Mode remount は同期。同 type 再利用は `key={step}` で閉じた |
| axe primary=「戻る」がハーネスと矛盾 | named button の可視だけ |
| 6〜8 に「戻る」があるから Important も全部落とす | Critical の自動降格材料にはなる。テスト契約の自己矛盾（I-1 / I-2 / I-5 / キーボード）は戻るでは消えない |
| 一次の D-02 Closed / D-03 Closed をそのまま採用する | D-03 擬似コード本体は Closed で一致。D-02 はテスト節文言は閉じたがキーボード契約が未閉じ。一次 Closed は不採用 |
| heading 上 Space / 44px「次へ」を前回どおり Minor に戻す | failure path（本線 E2E 偽赤、または (b) 誤スキップ / 次へ追加）の反証が無い。APPROVE のためのダウングレードはしない |

---

判定: **REVISE — Critical 0 件。Important 4 系統**（pantry「確認に戻る」一文、キーボード Tab→Space、44px の測る対象と前進、4ページ歩きの 350ms）。D-03 擬似コード本体と骨格 / P-01 / P-05 と D-02 の P-03 本文（最初の活性化 0 回）は APPROVE 相当。§4 を本文に埋め込んだら、そのデルタだけを再レビューすればよい。実装開始は再 APPROVE のあと。
