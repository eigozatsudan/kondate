# 追加条件ウィザードstep化 設計 — 第3デルタ再レビュー（敵対的）

- 日付: 2026-09-01
- 対象: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md` @ `386d8159`
- デルタ: `git diff 06352949..386d8159 -- docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md`
- 入力: 直前裁定 `docs/superpowers/reviews/2026-09-01-planner-optional-condition-steps-rereview2-adjudication.md`、改訂 Spec、live（実装は未着手）
- 姿勢: 閉じた骨格と P-01 / P-05 本体は再開しない。**今回本文に入った新しい規則そのものを壊す。**
- 判定: **REVISE。Critical 0。D-03 擬似コード本体は閉じた。残 Important は D-02 キーボード契約（heading 上 Space）と D-01 の 44px / 戻る回数の食い違い。**

## §1 Verdict

D-03 が要求した順序付き擬似コード・`blocked()` 先行・`key={step}`・350ms 中の `onChange` 無視は本文に入った。前回 C-1（pointerup 同期 `onNext` × 無ガード `onChange`）の仕様穴は、本文が選んだ「`onNext` 遅延は採らず 350ms で `onChange` も落とす」で閉じている。React 19.2.7 の discrete `pointerup` はハンドラ末 `flushSync` ではなく `scheduleMicrotask` → `processRootScheduleInMicrotask` である（推測ではない。§2 A-1 にソース）。同一ジェスチャ leftover が次ページへ落ちても、到着が 350ms 内なら `handleChange` も `activate` も no-op で、mutex は立たない。

壊れるのは **新しいテスト契約** のほうである。

- D-02 キーボードは `heading` の `toBeFocused()` のあと 350ms 待って Space と書いた。live の `h2` は `tabIndex={-1}` で、Space の活性化対象ではない。裁定 Minor の「radio へ Tab してから Space」は本文に落ちていない。
- D-01 表は 44px を `4ページ歩き` にした。live の 44px 走査は各 step で `expectMajorActionAtLeast44(..., "次へ")` し、`次へ` へ focus して Enter で進む。新4ページに「次へ」は無い。待ち 350ms も 44px 行には無い。
- D-01 walker 節は pantry `:263–278` を「対象を変更」に固定し「戻る×5 は採らない」と書いた。同じファイルの「戻る回数の更新」はまだ「戻る×5、または対象を変更」のまま（デルタ外の旧文）。

実装開始は、この 3 点を本文が一文で閉じるまで早い。骨格 / P-01 / P-05 / D-03 擬似コード本体を再開する理由は無い。

## §2 攻撃シナリオ（A-1…）

### A-1 leftover click が次ページ label に落ちる（本文が閉じたつもり）

1. **前提（本文）**: 順序は `pointerup` → `click` → `change`（128–133 行）。`activate` は同期で `onSelect` + `onNext`（146–151 行）。leftover は「同一ジェスチャの `click` / `change` が自動遷移後の新ページへ落ちる」で、`onChange` も 350ms ガードに入れ、`onNext` 遅延は採らない（198–200 行）。経路表は mount 後 350ms 以内を 0/0 とする（191 行）。
2. **live / UA**: `package.json:41` は `react` `^19.2.7`。React 19.2.7 `ReactDOMEventListener.js` の `getEventPriority` は `pointerup` を `DiscreteEventPriority` に含む。`dispatchDiscreteEvent` は優先度を立てて `dispatchEvent` するだけで、ハンドラ末 `flushSync` は呼ばない。sync 作業は `ReactFiberRootScheduler.js` の `ensureRootIsScheduled` → `scheduleImmediateRootScheduleTask` → `scheduleMicrotask` → `processRootScheduleInMicrotask`。コメントどおり「Synchronous work is always flushed at the end of the microtask」。wizard は step ごとに別 `return (<main>…)`（`planner-wizard.tsx:403–566`）。カードは同座標の `.wizard-option`（`styles.css:208–219`、P-03 203–206 行）。
3. **本文どおり組んだときの経路**: pointerup で `activate` → setState は microtask。microtask checkpoint が click より先なら、旧 label は切断され、互換 click が次ページ同座標の label へ落ち得る（touch の `elementFromPoint`、または切断ノードの retarget。Blink 祖先 retarget は crbug 608003 で **未確認のまま**）。次ページの `onPointerUp` は **click では発火しない**（受け口は pointerup だけ、163–165 行）。label 既定は labeled control へ click を転送し、未選択なら `change` が走る。`handleChange` は `blocked()` で return（154–157、191 行）。値は書かない。`activating` も立てない（142–144 行）。
4. **なぜ unit/E2E が緑のまま出荷できるか**: この経路自体は本文どおりなら値も遷移も起きない。前回 C-1 を Critical にしていた前提（`onChange` 無ガード）は消えた。残る破れは **click が次ページで新しい pointer 系列を合成する UA** だけである。証拠は無い。350ms 内の合成 pointerup も `blocked()` で落ち、mutex は立たない。viewport は `width=device-width`（`index.html:11`）なので旧 iOS の ~300ms ghost click 遅延も対象外。→ **閉じた。Critical にしない。**

### A-2 Space の既定動作は keyup が先、ではない（UI Events 対 Blink/WebKit）

1. **前提（本文）**: 「Space は `keyup` ハンドラ → 既定動作の `click`/`change`」（132–133 行）。未選択 Space は「`keyup` の `activate` が先。既定動作の `change` は mutex で落ちる」（188 行）。
2. **live / UA**: UI Events 3.4.1 は、Space の **keydown** 既定動作が state-changing 要素への `click` だと書く。Blink `RadioInputType::HandleKeyupEvent` と WebKit `RadioInputType::handleKeyupEvent` は Space（`" "` / `U+0020`）を **keyup** で扱い、**既チェックなら simulated click を出さない**。未チェックだけ `DispatchSimulatedClickIfActive`。keydown 側は矢印である。HTML のイベントループでは、keyup のリスナ（React `onKeyUp`）→ そのイベントの既定動作 → dispatch 終了 → microtask。したがって Blink/WebKit では本文の「keyup が先、既定 change は mutex」が成立する。既選択「指定なし」の Space は click 自体が無いので `onKeyUp` の `activate` だけが前進を担う（189 行どおり）。
3. **本文どおり組んだときの失敗経路**: UI Events どおり **keydown で click/change する UA** では、`handleChange` が先に `onSelect`（mutex を立てない）→ keyup の `activate` が `onSelect` 2 回目 + `onNext`。値は同じなので誤値にはならない。二重 `onDraftChange` は起き得る。本製品の主 UA（Blink/WebKit、mobile-first）では再現しない。
4. **なぜテストが緑か**: unit の Space は jsdom + user-event。jsdom の radio Space は Blink と同じ keyup 側に寄る。Firefox 専用の keydown click は E2E の chromium project では測らない。→ **Important にはしない。主 UA では本文は正しい。** 二重 autosave は Firefox 残差（§5）。

### A-3 `userEvent.click(.wizard-option)` が `onPointerUp` + `isPrimary` を通らない

1. **前提（本文）**: 操作は必ず `.wizard-option`（`<label>`）を `userEvent.click` で叩く（342–346 行）。`onPointerUp` は `event.button === 0 && event.isPrimary`（163–165 行）。
2. **live**: `@testing-library/user-event` `^14.6.0`。`Pointer.getEventInit` は `isPrimary: this.isPrimary` と `button: getMouseEventButton(button)` を付ける。MouseLeft の primary pointer は `isPrimary=true`、`button=0`。click の便宜 API は `pointer([{target}, {keys:'[MouseLeft]', target}])`。jsdom に layout は無いので、渡した label が pointerup の target になる。pointerup は bubble するので、内側の input に落ちても label の `onPointerUp` は走る。
3. **失敗経路**: `fireEvent.click` / `fireEvent.pointerUp`（init 無し）だと jsdom の `PointerEvent.isPrimary` は falsy になり、ゲートに全落ちする。本文は userEvent を要求しているので、その経路はテスト契約外。input 直 `userEvent.click` でも bubble で label ハンドラは緑になる。**label 余白を測れという要求の本丸は「ハンドラを input に置く実装を緑にしない」こと**で、bubble がある以上 input 直 click でも label 上のハンドラは通る。実機の label 余白タップは input に pointerup を出さない（転送されるのは click）。input に `onPointerUp` を置いた実装は、userEvent で radio を叩くと緑、実機のカード余白は死ぬ。本文は `.wizard-option` を要求しているので、その実装は isolated unit では落ちる。
4. **なぜ緑のまま出荷できるか**: wizard 側の既存テストは今も `user.click(screen.getByRole("radio", …))`（`planner-wizard.test.tsx:264, 306, 742`）。D-02 ウィザード単位の「6ページ目の初回 click」（360–361 行）が radio 直 click のままだと、input 上ハンドラでも緑。isolated は label、wizard は radio、で分裂する。→ **I-3。**

### A-4 キーボード導線が heading 上で Space する

1. **前提（本文）**: キーボード導線は新4ページを Space で通過し、各ページで `heading` の `toBeFocused()` のあと `page.waitForTimeout(350)` を挟んでから Space（437–441 行、220–222 行）。表の手段列は `Space`（401 行）。
2. **live**: `cuisine-step.tsx:89` の `h2` は `tabIndex={-1}`。mount focus は `useEffect` で heading（`:45–47`）。Space の活性化対象は radio であり heading ではない。現行キーボードテストは heading `toBeFocused()` の**あと** `tabUntil` で radio へ行き、そこで Space（`generation-recovery-results.spec.ts:1306–1314`、1343–1351）。`tabUntil` は Tab 連打（`:1193–1206`）、programmatic `.focus()` フォールバックは禁止（`:1286`）。
3. **本文どおり組んだときの失敗経路**: 実装者は cuisine-step を踏襲して heading に focus する。E2E は本文どおり heading focused → 350ms → Space。`onKeyUp` は **各 radio** に付いている（172–174 行）。heading 上の Space はどの radio の `onKeyUp` にも届かない。ページは進まない。偽赤。逃げ道は (a) 最初の radio を mount focus する（heading `toBeFocused()` が死に、既存 meal/cuisine 契約と不揃い）、(b) heading に Space ハンドラを付けて「指定なし」で `activate` する（Tab 前の Space がスキップになる）、(c) テスト側で Tab する（本文に無い）。裁定 rereview2 の Minor は「350ms のあと radio へ Tab してから Space」だった。デルタは待ちだけを入れて Tab を落とした。
4. **なぜ緑のまま出荷できるか**: 実装者が (c) を黙って足せば緑。本文のキーボード契約は満たしていない。実利用者は Tab → radio → Space なので本線は動く。ただし (b) を採ると、確認の見出しにいるつもりで Space した利用者が 5〜8 を飛ばす。→ **I-1。**

### A-5 44px 走査が「次へ」を測り、次へで進む

1. **前提（本文）**: 表は `generation-recovery-results.spec.ts` 44px 走査 `:1259–1272` を **4ページ歩き**（400 行）。DOM に「次へ」は置かない（86 行、347 行）。mobile の `assertStepFits` だけが `{ 戻る: 1 }` / スキップを明示（442–445 行）。44px 行には測るボタンも 350ms 待ちも無い。
2. **live**: 44px ヘルパは `getByRole("button", { name })` の高さ（`generation-recovery-results.spec.ts:1103–1113`）。コメントは「44px は primary/戻る等の操作 button。native radio は対象外」（`:1097`）。ジャンルは radio を Space したあと `expectMajorActionAtLeast44(page, "次へ")` し、`次へ` に focus して Enter で進む（`:1251–1256`）。audience も同じ（`:1267–1269`）。その直後が「5. 確認」（`:1271–1272`）。
3. **本文どおり組んだときの失敗経路**: 4ページ歩きに現行パターンを延長すると、5ページ目で `expectMajorActionAtLeast44(page, "次へ")` が 0 件で落ちる。進む手段も `次へ` Enter なので、カード Space / click に切り替えないと確認へ着けない。Space で進める場合、mount 直後（heading focus 直後）の Space は 350ms ガードに食われる。44px 行はキーボード導線と違って待ちを要求していない。逃げ道は (a) 次へボタンを足す（isolated「次へが無い」と衝突）、(b) 測る対象を 戻る / スキップに変え、進む前に 350ms 待つ（本文 44px 行に無い）、(c) 表を無視して skip する（household/キーボード以外の歩きを消す）。
4. **なぜ緑のまま出荷できるか**: (c) を採ると新4ページの 44px は未測定のまま緑。mobile 節は測ると書いてあるが、44px テストは別ファイルである。→ **I-2。**

### A-6 同一ページ 2 枚目と、blocked のあとの正規 1 発目

1. **前提（本文）**: mutex は instance 寿命の `useRef<boolean>`（140、148 行）。リセットは `key={step}` による remount（136–137、193–195 行）。`blocked()` で弾いたときは mutex を立てない（142–144、196–197 行）。自動遷移するので通常は 1 回で抜ける。
2. **live**: 現行 wizard が step 変更で remount するのは Meal / Cuisine / Audience が **別 type** だから。新4ページは同一 type + 同型 `<main>`。`key={step}` が本文の唯一のリセット。
3. **失敗経路**:
   - 350ms 内のタップ: `blocked()` 先行、mutex は false のまま。350ms 後の正規 1 発目は生きる。本文 352 行の unit がこれを要求。**閉じた。**
   - 正規 `activate` 成功: `onNext()` で step が変わり `key` が変わる。React 19 の commit は microtask なので、同一ジェスチャの後続 click/change はまだ旧 instance に届き得る。旧 instance の mutex が吸収する。新 instance は別 ref。**閉じた。**
   - 同一ページで 2 枚目を選び直す: 自動遷移が動けば起きない。`onNext` が no-op の実装（親が step を変えない）だと mutex が立ちっぱなしで 6〜8 に閉じ込める。本文は `onNext` を `advanceFromEditOr(次のstep)` と固定している（310–311 行）。親が本文どおりなら起きない。
4. **なぜ緑か**: isolated は `onNext` を mock して unmount しない。mutex が立ったあとの 2 枚目 click は no-op。テストは「各 1 回」までしか見ず、同一 mount での選び直しを要求しない。wizard テストは遷移する。→ 本文どおりの親なら閉じ込めにならない。残差は `onNext` 未接続の中間実装だけ。Critical にしない。

### A-7 jsdom で `change` が `pointerup` より先

1. **前提（本文）**: 未選択 tap は pointerup の `activate` が先、後続 `change` は mutex（185 行）。unit は未選択で `onSelect` / `onNext` 各 1 回（345–346 行）。
2. **live**: user-event の pointer 順は `pointerdown` → `pointerup` → `click`。radio の `change` は click の既定。label をクリックしても pointerup が click より先。
3. **失敗経路**: この順が逆転する環境では `handleChange` が先に `onSelect`（mutex なし）→ `activate` が 2 回目。unit「各 1 回」が赤。実装者は `onChange` を外すか、矢印まで `activate` に通す。後者は P-02 の矢印非遷移を壊す。
4. **なぜ緑か**: user-event 14.6 の順序では逆転しない。実装者が `fireEvent.change` で未選択行を書くと別経路になるが、本文は userEvent.click を要求。→ **偽陽性（§5）。**

### A-8 D-01 `:277` 固定と「戻る回数」旧文

1. **前提（本文・新）**: `menu-domain-pantry.spec.ts:263–278` は「対象を変更 → audience で選び直し → 次へ」。`advanceFromEditOr` が `9. 確認` へ直帰。skip も 4ページ歩きも不要。「戻る×5」案は採らない（408–411 行）。
2. **前提（本文・旧、デルタ外）**: 「戻る回数の更新」は `:263–264` を「戻る×5、または対象を変更」（429–430 行）。
3. **live**: `:263` は確認からの順送り「戻る」1 回で `4. 作る相手`。`:277` は `clickWizardNext`（`history.ts:41–42`、name `"次へ"` 専用）→ `"5. 確認"`。編集フラグは立っていない。
4. **失敗経路**: 戻る回数節を正にすると、戻る×5 で audience に着き、`clickWizardNext` は `timeLimit` へ出る（P-01 で audience の次は `advanceFromEditOr("timeLimit")`）。確認へは着かない。skip を足すと walker 節の「戻る×5 は採らない」に反する。対象を変更にすれば walker 節どおり、ボタンは「確認に戻る」（`planner-wizard.tsx:275–278`）。
5. **なぜ緑か**: 片方だけ直して E2E を緑にできる。表は直ったように見え、旧節が生き残る。→ **I-4。**

### A-9 4ページ歩きの 2 枚目以降が 350ms に食われる

1. **前提（本文）**: household / mobile / 44px は 4ページ歩き（394、398、400 行）。350ms 待ちを明示するのはキーボード導線だけ（437–441 行）。P-03 は「E2E のフルウォークは遅いので拾えない」（206 行）。指定なし通過は `.click()`（412–414 行）。
2. **live**: Playwright `locator.check()` は既チェックなら直ちに return（click しない）。`locator.click()` は毎回 pointer 系列を打つ。`expect(heading).toBeVisible()` は見えた瞬間に返す。既定の action 間ディレイは 350ms ではない。
3. **失敗経路**: 5ページ目は audience の「次へ」から 350ms 以上経っているので最初の click は通る。6ページ目 mount 直後の click（フルウォークの次の行）が 350ms 内なら `blocked()` で落ちる。6〜8 に「次へ」もスキップも無い。household 本線が偽赤。逃げ道は (a) 各ページで 350ms 待つ（キーボード以外の歩きには書いていない）、(b) ガードを短くする / Space だけ外す（P-03 が死ぬ）、(c) household を skip に戻す（自動遷移の主張が消える）。Playwright が本当に遅ければ (a) 無しでも緑。本文は「遅いので leftover を拾えない」と書いており、**速すぎて正規 click を落とす**側は見ていない。
4. **なぜ緑のまま出荷できるか**: (c) またはガード緩和。後者は本線ダブルタップの誤値を通す。→ **I-5。** 閉じ込めは「戻る」で出られるので Critical ではない。

## §3 D-01〜D-03 閉じ確認

| ID | 裁定（rereview2）が要求した閉じ方 | 本文 @ `386d8159` | 結論 |
| --- | --- | --- | --- |
| D-01 | `generateShoppingMenu`。`ensurePlannerReady` 削除。`answerAudienceAndReview` を名前で。既定 skip、個別が歩きを指定した行は skip しない。household / キーボード / mobile・44px に手段列。`:277` は二択を一文に。指定なしは `.click()` | 表は helper 名 + 手段列。shopping は `generateShoppingMenu` `:88–89` skip。`ensurePlannerReady` は walker ではないと明記（403–404 行）。`answerAudienceAndReview` は 4ページ歩き（398 行）。`:408–411` は対象を変更に固定。`.click()` は 412–414 行 | **Partial。** walker 表と `.click()` と `:277` 固定は閉じた。44px が「次へ」を測る live との衝突は手段列に書いていない（A-5）。戻る回数節がまだ「または」（A-8）。4ページ歩きに 350ms 待ちが無い（A-9） |
| D-02 | テスト節の「2発目」を消す。isolated は最初の活性化 0 回。無視対象を `activate`（pointerup / Space keyup）に合わせる | P-03 本文 207–210 行は `activate` と `handleChange` の両方。テスト節 348–351 / 360–361 行は「最初の活性化 0 回」と wizard 初回。キーボード 220–222 / 437–441 行は heading 後 350ms | **Partial。** 「2発目」は消えた。isolated / wizard 初回は P-03 本文と一致。キーボードは待ちを入れたが Tab 先を落とした（A-4）。前回 Minor が未反映のまま D-02 の本文規則になっている |
| D-03 | 順序付き擬似コード。350ms と `disabled` を mutex より前。`onChange` を `activate` に通さない。`key={step}`。unit は `.wizard-option`。leftover は `onNext` 遅延 **または** 350ms 中の `onChange` 無視 | 擬似コード 135–180 行。`blocked()` 先行。`handleChange` は mutex 中 return。`key={step}`。unit は label を userEvent。leftover は 350ms `onChange` 無視を採択（198–200 行） | **Closed**（擬似コード本体）。残るのは wizard 単位 click が radio 直のまま分裂し得ること（A-3）と、同一ジェスチャ leftover の UA 合成 pointerup（未確認、A-1） |

P-01 / P-05 本体と D-02 の P-03 **本文**（最初の活性化 0 回、wizard 初回）は再開しない。

## §4 Critical / Important / Minor

### Critical

なし。本文どおり組んでも、本線ユーザーを 戻る無しで閉じ込める経路、誤値の永続（autosave に意図しない 15/economy 等が残る経路）、避けられない二重 autosave、セキュリティは示せない。

- leftover click → 次ページ `change` は 350ms `handleChange` 無視で値を書かない（A-1）。
- leftover が pointerup として再合成されても 350ms 内は `blocked()` で mutex を立てない。
- 6〜8 の「戻る」はガード対象外（211 行）。A-9 の張り付きは戻るで出られる。
- Space の keyup 先行は Blink/WebKit で成立（A-2）。
- mutex の instance 寿命は `key={step}` と `blocked()` 先行で、本文どおりの親なら 2 枚目選び直しの閉じ込めにならない（A-6）。

### Important

#### I-1 キーボード契約が heading 上 Space になっている（A-4）

- **ID**: I-1
- **Severity**: Important
- **Spec**: 220–222 行、401 行、437–441 行
- **live**: `cuisine-step.tsx:89`（`h2 tabIndex={-1}`）、`:45–47`（mount focus）、`generation-recovery-results.spec.ts:1306–1314`（heading のあと `tabUntil` で radio、そこで Space）
- **failure path**: 本文どおりの E2E は radio の `onKeyUp` に届かない。偽赤を (a) radio mount focus、(b) heading の Space で指定なし activate、(c) 黙って Tab、のどれかで逃げる。(b) は本線キーボードの誤スキップ。D-02 が新しく書いた規則そのものが、踏襲先の heading 契約と同時成立しない。

#### I-2 44px の 4ページ歩きが live の「次へ」測定・「次へ」前進と衝突する（A-5）

- **ID**: I-2
- **Severity**: Important
- **Spec**: 86 行、400 行、442–445 行（mobile だけ測るボタンを書いた）
- **live**: `generation-recovery-results.spec.ts:1097`、`:1103–1113`、`:1251–1269`、`:1271–1272`
- **failure path**: 現行パターン延長は「次へ」0 件で赤。次へボタン追加は isolated と矛盾。skip すると新4ページの 44px 未測定。Space 前進なら I-5 と同じ 350ms 食われ。44px 行は待ちも測る対象も書いていない。

#### I-3 wizard 単位の click が `.wizard-option` を要求していない（A-3）

- **ID**: I-3
- **Severity**: Important
- **Spec**: isolated は 342–346 行で label。wizard D-02 は 360–361 行「カードを click」「初回 click」のみ
- **live**: `planner-wizard.test.tsx:264, 306, 742` は `getByRole("radio")` 直 click。`styles.css:208–219` のヒット領域は label 余白
- **failure path**: `onPointerUp` を input に置いた実装は、bubble のおかげで radio 直 userEvent が緑。実機のカード余白（WebKit が転送するのは click だけ）は死ぬ。isolated が label を要求しても、ウィザード単位が radio 直のままだと本線の自動遷移テストが間違った受け口を測る。

#### I-4 pantry `:263–278` が walker 節と戻る回数節で一文にならない（A-8）

- **ID**: I-4
- **Severity**: Important
- **Spec**: 408–411 行（対象を変更、戻る×5 は採らない）対 429–430 行（戻る×5、または対象を変更）
- **live**: `e2e/specs/menu-domain-pantry.spec.ts:263–278`、`e2e/fixtures/history.ts:41–42`
- **failure path**: 戻る×5 + `clickWizardNext` は P-01 後に `timeLimit` へ出る。D-01 表から `:277` を外した意味が、デルタ外の旧節で打ち消される。

#### I-5 4ページ歩きに 350ms 待ちが無く、6ページ目以降の正規 click をガードが落とす（A-9）

- **ID**: I-5
- **Severity**: Important
- **Spec**: 394 / 398 / 400 行（歩き）、412–414 行（`.click()`）、206 行（E2E は遅い）、350ms 待ちは 437–441 行のキーボードだけ
- **live**: Playwright click は既チェックでも pointer を打つ。`locator.check()` は no-op（本文 412–414 行どおり）。heading 可視待ちは 350ms を保証しない
- **failure path**: 5→6 の直後 click が `blocked()`。household の自動遷移主張が偽赤。ガード短縮か skip へ逃げる。短縮すると P-03 の ~300ms 2 発目が次ページの値を書く。値の永続は「戻る」で直せるので Critical ではないが、D-01 の歩きと D-02 のガードが同時に成立しない。

### Minor

#### M-1 擬似コードに `name` / radiogroup が無い

cuisine-step 踏襲（65–68 行）なら `name="genre"` 相当が付く。擬似コードの map だけを写すとラジオがグループにならず、P-02 の矢印行が native では死ぬ。unit の「矢印キー由来の `change`」は `fireEvent.change` で緑にできる。計画は止めない。踏襲を正とするなら本文の擬似コードはイベントだけ、と既に読める。

#### M-2 household 個別が 5〜7 ページの選択値を書いていない

434–436 行は 8 ページ目で「ひねりたい」。5〜7 は `.click()` 規則だけ。未選択の「ひねりたい」は `.check()` でも click する。詰まるのは指定なし通過だけであり、412–414 行が閉じている。繰り返し不足。

#### M-3 7/8 の options 貼付、radiogroup `aria-labelledby`、確認ヘルプ

前回 Minor のまま。デルタ対象外。P-05 本体は再開しない。

## §5 偽陽性として自ら却下したもの

| 攻撃 | 却下理由 |
| --- | --- |
| leftover click が次ページ `onChange` を書いて予算が汚れる（前回 C-1） | 本文が 350ms 中の `onChange` 無視を採った。click は `onPointerUp` を発火しない。値も遷移も起きない（A-1） |
| leftover click が次ページで pointerup を合成し、350ms 後に `activate` する | 合成自体が未確認。到着が 350ms 内なら `blocked()`。viewport は device-width で旧 iOS 300ms ghost click も対象外（`index.html:11`） |
| React 19.2.7 は discrete `pointerup` のハンドラ末で `flushSync` する | `dispatchDiscreteEvent` は優先度だけ。flush は `scheduleMicrotask` → `processRootScheduleInMicrotask`。v19.2.7 ソースで確認した |
| Space の既定が keydown なので mutex が間に合わない | UI Events は keydown。Blink/WebKit の radio は keyup。既チェックは simulated click 自体を出さない。主 UA では本文どおり（A-2） |
| `userEvent.click(.wizard-option)` が `isPrimary` を付けない | user-event 14.6 の primary MouseLeft は `isPrimary: true`、`button: 0`。jsdom 無 layout でも渡した label が target |
| jsdom が `change` を `pointerup` より先に出す | user-event の順は pointerup → click。radio `change` は click 既定（A-7） |
| mutex が instance 寿命のため同一ページ 2 枚目が選べない | 自動遷移が本文どおりなら 1 回で unmount。`blocked()` は mutex を立てない。正規 1 発目は生きる（A-6） |
| disabled でも label の `onPointerUp` が発火する（前回 I-7） | 擬似コードの `blocked()` が `disabled` を mutex より前に見る（144 行） |
| `ensurePlannerReady` に skip を足さないと買い物が死ぬ | 本文 403–404 行が walker ではないと書いた。対象は `generateShoppingMenu` |
| `:277` が skip 必須のまま | walker 節は対象を変更に固定。残るのは戻る回数節の旧文（I-4） |
| 骨格 / `firstIncomplete` / 4b / 必須 4 問の「次へ」 / P-01 / P-05 / contracts | 裁定どおり再開しない |
| Blink で label 転送 click の `detail===0` のため前進不能 | 本文は `detail` を見ない |
| 6〜8 に「戻る」があるから Important も全部落とす | Critical の自動降格材料にはなる（A-9）。テスト契約の自己矛盾（I-1〜I-5）は戻るでは消えない |
)
