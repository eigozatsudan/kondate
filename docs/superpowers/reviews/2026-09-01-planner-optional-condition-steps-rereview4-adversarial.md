# 追加条件ウィザードstep化 設計 — 第4デルタ再レビュー（敵対的）

- 日付: 2026-09-01
- 対象: spec @ `f7f7c1ad`
- デルタ: git diff 386d8159..f7f7c1ad -- docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md
- 姿勢: 閉じた骨格と P-01 / P-05 / D-03 擬似コード本体は再開しない。**今回本文に入った新しい規則そのものを壊す。**
- 判定: REVISE

## §1 Verdict

第3裁定の 4 系統は、個別節と共通ルールには落ちた。pantry `:263–278` は「確認に戻る」＋`clickWizardNext` 禁止＋「戻る×5、または」削除まで一文になった。44px は「次へ」を測るな・押すな、5 はスキップと戻る、6〜8 は戻る、前進は radio `.focus()` + Space。キーボード個別は `toBeFocused` → 350ms → `tabUntil` radio → Space で、heading 上 Space はその節からは消えた。4ページ歩きは各ページ 350ms、起点は **そのページの mount**。

壊れるのは、**デルタが直した節の外側に残した旧文**と、**新しい 4 手順が踏襲先の radio group と同時成立しない**点である。

- P-03 220–222 はまだ「heading が `toBeFocused()` → 350ms → Space」。個別 462–464 の `tabUntil` が無い。裁定が消せと言った heading 上 Space が、待ちを書いた最初の場所に残っている。
- 個別の `tabUntil(name.includes("<選ぶ選択肢>"))` は cuisine の `tabUntil("和食")` を写している。cuisine は未チェックで先頭が和食。新4ページは先頭が既チェックの「指定なし」で、踏襲すれば `name` でグループになる。Tab ではチェック済み以外へ着けない。

実装開始は、P-03 の Space 文を個別と同じ 4 手に書き換え、キーボードの `選ぶ選択肢` を「既チェックの指定なし、または Arrow のあと Space」まで一文にするまで早い。骨格 / P-01 / P-05 / D-03 擬似コード / D-02 初回 0 回 / D-01 helper 名 / pantry ボタン名は再開しない。

## §2 攻撃シナリオ（A-1…）

### A-1 P-03 がまだ heading 上 Space と読める（個別 4 手と両立しない）

1. **前提（本文）**: P-03 220–222「`heading` が focus されたことを `toBeFocused()` で確認したうえで `page.waitForTimeout(350)` を挟んでから Space を押す」。個別 462–464 は同じ待ちの**あと** `tabUntil` で radio、そこで Space。h2 は Tab 順に入らず、heading 上 Space は radio の `onKeyUp` に届かない（個別 459–461）。共通 444–445 はキーボードを `toBeFocused()` のあと 350ms、操作は「カード click か radio の Space」（448）で、Tab を挟むとは書いていない。
2. **live**: `cuisine-step.tsx:89` の h2 は `tabIndex={-1}`。mount focus は `:45–47`。活性化は radio（擬似コード 172–174、`event.key === " "`）。現行キーボードは heading `toBeFocused()` のあと `tabUntil` で radio、そこで Space（`generation-recovery-results.spec.ts:1306–1314`、`:1343–1351`）。`tabUntil` は Tab 連打、`.focus()` フォールバック禁止（`:1193–1206`、`:1286`）。
3. **本文どおり組んだときの失敗経路**: Plan が P-03（キーボードの 350ms を最初に書いた場所）を抄ると、focus は heading のまま Space する。`onKeyUp` は各 radio にしか無い。ページは進まない。偽赤。個別を正にすると緑。両方を機械的に直列すると、待ちの直後に Space（P-03）してから `tabUntil`（個別）になり、最初の Space が heading で死ぬ。裁定 rereview3 のパッチ 2 は「heading 上 Space と読める書き方を消す」だった。デルタは個別へ 4 手を足し、P-03 220–222 は無変更。
4. **なぜテストが緑か**: 個別だけを実装する。P-03 は「待ちの根拠」と読み、Space の対象は個別に任せる。本文は一文にならない。→ **I-1。**

### A-2 キーボード `tabUntil(選ぶ選択肢)` が、踏襲した radio group では未チェックへ着けない

1. **前提（本文）**: 個別 463–464 `tabUntil(..., (focus.role === "radio" || focus.type === "radio") && focus.name.includes("<選ぶ選択肢>"))` → Space。外枠は cuisine-step 踏襲（65–68）。P-02 は矢印で値だけ変える（104、190）。options 先頭は必ず「指定なし」で既定チェック（75、342）。擬似コードの `<input>` に `name` は無い（167–175）が、踏襲先は `name="genre"`（`cuisine-step.tsx:102`）。写し元の `ReviewChoiceField` も `name={id}`（`review-step.tsx:131–133`）。
2. **live / UA**: HTML の同名 radio は Sequential Focus Navigation で**チェック済み（無ければ先頭）だけ**が Tab 対象。他は Arrow。Blink の既チェック Space は simulated click を出さないが、keyup 自体は出る（本文 189、rereview3 で照合済み）。E2E は chromium のみ（`playwright.config.ts:46–53`）。`readFocusedControl` は native radio の `type` と label の textContent を名前にする（`:1148–1167`）。
3. **本文どおり組んだときの失敗経路**: キーボード live は `tabUntil("和食")`（先頭・未チェック）。新ページのアナログは `tabUntil("15分以内")` / `"節約優先"` / `"ひねりたい（主菜を定番から外す）"`。cuisine 踏襲で `name` を付けると、heading からの最初の Tab は既チェック「指定なし」で止まる。次の Tab はグループを抜け、5ページ目なら「以降は指定なしでスキップ」、その次が「戻る」。32 回で throw。Arrow は 4 手に無い。Arrow で移すと P-02 どおり `handleChange` のみで `onNext` は出ないので、そのあと Space が要る。本文はそれを書いていない。`.focus()` で未チェックへ飛ぶのはキーボード個別が禁止（466）。
4. **なぜテストが緑か**: `選ぶ選択肢` を「指定なし」にする。先頭かつチェック済みなので 1 Tab で着き、Space の `onKeyUp` が `activate` する（189）。44px 側は `.focus()` なので同じ「15分以内」を選べる。キーボードだけ赤、44px は緑、で分裂する。→ **I-2。**

### A-3 44px 個別の 350ms が heading / mount を起点にしない

1. **前提（本文）**: 共通 442–445 `blocked()` は**そのページの mount**。heading 可視（キーボードは focus）の直後 click/Space は食われる。44px 走査もこの共通に含まれる（438–439）。個別 475–476 は `expectNoHorizontalScroll` → 350ms → radio `.focus()` + `activateFocusedWithKeyboard(page, "Space")` で、heading 待ちが無い。
2. **live**: 44px の各 step は先に heading `toBeVisible()`（`:1248`、`:1259`、`:1271`）。`expectNoHorizontalScroll` は見出し待ちをしない（`:1116–1120`）。`blocked()` の起点は `mountedAt = Date.now()`（本文 139、144）。React 19.2.7 の discrete `pointerup` はハンドラ末 `flushSync` ではなく microtask（再照合、§5）。
3. **失敗経路**: 個別の矢印列だけを新4ページの本体にすると、audience の Enter 直後に `expectNoHorizontalScroll`（まだ 4. 作る相手でも通り得る）→ 350ms が **page 5 の mount より前**に始まる。page 5 が T=100ms で mount すると `blocked()` は T=450ms まで。待ち明けの Space は T=350ms で食われる。6〜8 は「戻る」があるので閉じ込めではない。共通を足して heading を先に待てば緑。
4. **なぜ緑か**: live 44px の「heading を見てから測る」形を残し、その後に 350ms を足す。共通と個別を合成する。個別だけを完全な手順と読むと偽赤。→ **M-1（不完全。反対実装ではない）。**

### A-4 共通の「指定なしは `.click()`」と、44px / キーボードの Space

1. **前提（本文）**: 共通 449–450 はキーボード導線・44px 走査を含む全行に「指定なしは `.check()` ではなく `.click()`」。個別キーボードは Space（464）。44px は Space（476）。前進は「カード click **か** radio の Space」（448）。大域 415–417 は `.check()` が既チェックで no-op、`pointerup` が出ない、が理由。
2. **live**: Playwright `locator.check()` は既チェックなら click しない（本文 415–417 どおり。本レビューで Playwright のソースファイルは workspace に無く、API 契約と現行 E2E の `.check()` 使用箇所からの再確認）。`locator.click()` は既チェックでも pointer 系列を打つ。label の `onPointerUp` に届く。Space は pointer を出さず `onKeyUp`（172–174）。
3. **失敗経路（厳読）**: 指定なし通過を `.click()` 必須と読むと、キーボード only が pointer を打つ。テスト名は keyboard only（`:1283`、`:1286`）。44px は layout 用に programmatic focus + keyboard（`:1099–1100`）なのに click へ戻る。
4. **なぜ壊れないか**: 448 が Space を前進手段として許している。449–450 の「も `.click()`」は `.check()` の no-op 対策で、pointer 経路の話である。指定なしの Space は 189 どおり `onKeyUp` の `activate` が担う。→ **偽陽性（§5）。反対実装ではない。**

### A-5 44px の `.focus()` とキーボードの `.focus()` 禁止

1. **前提（本文）**: 44px 475–476 は radio を `.focus()` して Space。キーボード 466 は programmatic `.focus()` フォールバック禁止。共通は `.focus()` に触れない。
2. **live**: コメントがテストを分割している（`:1096–1100`）。44px は測定用に `.focus()`（ジャンル `:1251–1252`）。キーボード only は `tabUntil`、未到達で `.focus()` しない（`:1286`）。`activateFocusedWithKeyboard` の既定キーは Enter（`:1127–1132`）。44px 個別は第 2 引数 `"Space"` を明示している。
3. **失敗経路**: 共通「すべて次に従う」をキーボード規則の `.focus()` 禁止まで 44px に適用すると、44px が `tabUntil` になり A-2 と同じ未チェック不能へ落ちる。逆にキーボードへ 44px の `.focus()` を持ち込むと Tab 順の証明が死ぬ。個別はテストごとに手段を分けている。
4. **なぜ緑か**: live の分割どおり実装する。本文も 44px とキーボードで別手段を書いた。→ **閉じた。意図した分割。**

### A-6 既チェック「指定なし」の Space が click を出さず前進しない、という読み

1. **前提（本文）**: 既選択 Space は `onSelect` 1 / `onNext` 1（189）。機序は `keyup` の `activate`。Blink/WebKit は既チェックなら simulated click 自体を出さない。
2. **live**: 主 UA は Blink。E2E は chromium。`onKeyUp` は keyup リスナなので、simulated click が無くても走る。Playwright `keyboard.press("Space")` は keydown+keyup を focused 要素へ送る。
3. **失敗経路**: 「既チェックは click が無い → 前進しない」と読んで、指定なし通過を `.click()` だけにする。キーボード契約が死ぬ。実装が `onKeyUp` を省略し pointer だけにすると、本文 189 が死ぬ。
4. **なぜ緑か**: 本文 189 と擬似コード 172–174 が keyup 側で閉じている。click が無いことは既知で、活性化は keyup。→ **偽陽性（§5）。D-03 経路表は再開しない。**

### A-7 skip ボタン名が「指定なし」を含み、radio と取り違える

1. **前提（本文）**: 5ページ目の skip は「以降は指定なしでスキップ」（267–269、477）。キーボード `tabUntil` は radio かつ `name.includes("<選ぶ選択肢>")`（463–464）。44px の測定は skip のフルネームと「戻る」（477）。`expectMajorActionAtLeast44` は `getByRole("button", { name })`（`:1103–1107`）。Playwright の name は既定で部分一致。
2. **live**: skip は button。指定なしカードは radio / `.wizard-option`。`assertMajorActionHeights` も button（`mobile-accessibility.spec.ts:23–26`）。
3. **失敗経路**: `expectMajorActionAtLeast44(page, "指定なし")` は skip ボタンに部分一致して 44px で緑、カードは未測定。`getByRole("button", { name: "指定なし" }).click()` は skip で確認へ直行し、6. 予算待ちが赤。`tabUntil(name.includes("指定なし"))` から radio 条件を落とすと、Tab 順では先に「指定なし」radio に当たる（グループ先頭）ので skip より前で match する。
4. **なぜ緑か**: 本文の測定名はフル。`tabUntil` は radio を要求。共通の click 対象は `.wizard-option`（448）。skip は `.wizard-option` ではない。→ **偽陽性（locator を本文どおりにすれば衝突しない）。M-2 に残差だけ残す。**

### A-8 `activateFocusedWithKeyboard` の既定 Enter

1. **前提（本文）**: 44px 476 は `activateFocusedWithKeyboard(page, "Space")`。
2. **live**: ヘルパ既定は Enter（`:1127–1132`）。ジャンルは radio に Space、**次へ** に既定 Enter（`:1251–1256`）。
3. **失敗経路**: 新4ページに live の「radio Space → 次へ Enter」を延長する。`expectMajorActionAtLeast44(page, "次へ")` が 0 件で赤。radio に既定 Enter だけだと `onKeyUp` は `" "` のみなので進まない。本文 476 は Space を明示し、477 は「次へ」を測るな。
4. **なぜ緑か**: 個別を抄る。live 延長は本文が禁じている。→ **閉じた。**

### A-9 pantry `:263–278` と戻る回数（第3裁定の残り）

1. **前提（本文・新）**: 408–414 は「対象を変更 → audience で選び直し → **確認に戻る**」。`clickWizardNext` 禁止。`getByRole("button", { name: "確認に戻る" }).click()`。skip も 4ページ歩きも不要。「戻る×5」は採らない。432–433 は `:263–264` の戻る×1 を「対象を変更」へ置き、戻り道は「確認に戻る」。429–431 の savePlannerMeal は戻る×8 または「食事を変更」で、ここは `:263–278` ではない。
2. **live**: 編集戻り中の audience は `nextLabel: "確認に戻る"`（`planner-wizard.tsx:275–278`）。`advanceFromEditOr`（`:257–264`）。unit は「次へ」不在と「確認に戻る」（`planner-wizard.test.tsx:770–772`、対象変更 `:801–804`）。確認は `aria-label="対象を変更"`（`review-step.tsx:547`）。`clickWizardNext` は `"次へ"` 専用（`history.ts:41–42`）。現行 `:263–278` は順送りの戻る 1 回 + `clickWizardNext`。
3. **失敗経路**: 本文どおりなら `確認に戻る` で `9. 確認` へ直帰する。`clickWizardNext` を残すと「次へ」0 件で赤。戻る×5 は本文が採らない。
4. **なぜ緑か**: デルタが第3裁定のパッチ 1 をこの 2 節に埋め込んだ。→ **閉じた。**

### A-10 leftover が次ページの値を書く

1. **前提（本文）**: leftover は 350ms 内の `onChange` も無視（191、198–200）。`onNext` 遅延は採らない。`blocked()` は mutex より前（142–144）。`key={step}`（136–137）。
2. **live**: React 19.2.7 `pointerup` は Discrete。flush は `scheduleMicrotask` → `processRootScheduleInMicrotask`。ハンドラ末 `flushSync` ではない。
3. **失敗経路**: click が次ページ label に落ちても受け口は `pointerup` だけ。`change` は `blocked()`。値も遷移も起きない。6〜8 は戻るで出られる。
4. → **閉じた。D-03 擬似コード本体は再開しない。Critical にしない。**

### A-11 household / mobile の 350ms と `.click()`

1. **前提（本文）**: household 455、mobile 471 は各ページ 350ms のあとカード click。共通 442–450 と同じ。指定なしは `.click()`（415–417、449–450）。8ページ目の「ひねりたい」は未チェックなので `.check()` でも click するが、本文は click に固定（454–456）。
2. **live**: `full-journey.spec.ts:71–87` は確認画面の radiogroup で `.check()`。移動後は 8. 献立の雰囲気で click する形になる。`answerAudienceAndReview`（`mobile-accessibility.spec.ts:130–149`）は audience の次へで `"5. 確認"`。
3. **失敗経路**: `.check()` のまま指定なしを通過すると no-op で 6〜8 に張り付く。本文が `.click()` と 350ms を書いたので、抄れば緑。heading 待ちを落とすと A-3 と同じ食われ。household/mobile 個別は「350ms 待ってから click」と共通が重なる。
4. → **閉じた（D-01 歩きの 350ms / `.click()`）。**

## §3 Important / Critical に残すもの

### Critical

なし。本文どおり組んでも、戻る無しの閉じ込め、次ページへの誤値永続、safety / contracts の破れは示せない。leftover の `change` は 350ms で落ちる（A-10）。A-2 の張り付きは 5 に skip、6〜8 に戻るがある。テスト契約の自己矛盾は戻るでは消えないので Important に残す。

### Important

#### I-1 P-03 220–222 が heading 上 Space のまま残っている（A-1）

- **ID**: I-1
- **Severity**: Important
- **Spec**: 220–222（デルタ外の旧文）、対 458–467（新 4 手）、444–448（共通は Tab を挟まない）
- **live**: `cuisine-step.tsx:89`、`:45–47`、`generation-recovery-results.spec.ts:1306–1314`、`:1286`、擬似コード 172–174
- **failure path**: P-03 をキーボード E2E の手順と読むと、heading focused → 350ms → Space。radio の `onKeyUp` に届かず偽赤。個別を正にすると緑。両方を直列すると待ち直後の Space が heading で死ぬ。第3裁定パッチ 2「heading 上 Space と読める書き方を消す」が個別にだけ落ち、P-03 に残った。
- **必要な修正**: 220–222 を個別と同じ 4 手に書き換える。`toBeFocused()` → 350ms → `tabUntil` radio → Space。heading 上で Space と読める文を消す。

#### I-2 `tabUntil(選ぶ選択肢)` が radio group の未チェックに届かない（A-2）

- **ID**: I-2
- **Severity**: Important
- **Spec**: 463–464（新）、75（先頭「指定なし」既チェック）、65–68（cuisine 踏襲）、104 / 190（矢印は遷移しない）、466（`.focus()` 禁止）
- **live**: `cuisine-step.tsx:102` `name="genre"`、`review-step.tsx:131–133` `name={id}`、キーボード live `:1346–1351` は未チェック先頭「和食」、`tabUntil` `:1193–1206`
- **failure path**: 選ぶ選択肢を live どおり中身のあるラベル（15分以内 / 節約優先 / ひねりたい）にすると、同名 radio では Tab が「指定なし」で止まる。32 Tab で赤。Arrow は 4 手に無く、Arrow だけでは `onNext` しない。`.focus()` はキーボードで禁止。44px は `.focus()` できるので同じラベルで緑、キーボードだけ赤。
- **必要な修正**: キーボード 4 手に次のいずれか（または両方）を一文で固定する。(a) この 4 ページの `選ぶ選択肢` は既チェックの「指定なし」（1 Tab で着く）。(b) 非デフォルトを選ぶなら Tab でグループに入ったあと **Arrow で移してから Space**（Arrow は値のみ、Space が `onNext`）。擬似コードに `name` が無いことは踏襲が正、と既に Minor だが、新しい `tabUntil` 契約は踏襲と同時に書け。

## §4 Closed

第3裁定が埋め込ませた 4 系統のうち、次は本文と live が一文になった。再開しない。

| 系統 | 根拠 |
| --- | --- |
| pantry `:263–278` のボタン名 | 408–414 が「対象を変更 → 選び直し → **確認に戻る**」。`clickWizardNext` 禁止。432–433 から「戻る×5、または」が消えた。live `planner-wizard.tsx:275–278`、`:257–264`、unit `:770–772` / `:801–804`、`review-step.tsx:547`、`history.ts:41–42`（A-9） |
| キーボード個別の 4 手そのもの | 462–464 は `toBeFocused` → 350ms → `tabUntil` radio → Space。`tabUntil("次へ")` 禁止。`.focus()` 禁止。残るのは P-03 旧文（I-1）と `選ぶ選択肢`（I-2） |
| 44px の測る対象と前進 | 472–478 は「次へ」を測るな・押すな。5 はスキップと戻る、6〜8 は戻る。前進は radio `.focus()` + `activateFocusedWithKeyboard(..., "Space")`。ヘルパは button 専用（`:1103–1113`）で、測る対象が button なので拡張は不要。既定 Enter も 476 が Space を明示（A-8） |
| 4ページ歩きの 350ms | 共通 442–445 が household / mobile / 44px / キーボードに、**そのページの mount** 起点で heading 待ちのあと 350ms。household 455、mobile 471 も click 前に待つ。P-03 本文の unit「最初の活性化 0 回」と wizard 初回（214–219）はデルタ対象外のまま Closed |
| 指定なし `.click()`（pointer 経路） | 415–417 / 449–450。Playwright `.check()` の no-op。household / mobile のカード click と両立（A-11） |
| 44px `.focus()` 対 キーボード `tabUntil` | live `:1096–1100` の分割を本文が踏襲（A-5）。テスト契約の分裂自体は意図どおり |
| D-01 helper 名 | 表の `generateShoppingMenu`、`ensurePlannerReady` 除外、`answerAudienceAndReview`、手段列。デルタで崩れていない |
| 骨格 / P-01 / P-05 / D-03 擬似コード / D-02 初回 0 回 / 4b | 裁定どおり再開しない（A-10） |

## §5 偽陽性

| 攻撃 | 却下理由 |
| --- | --- |
| 共通「指定なしは `.click()`」と Space 個別が反対実装（A-4） | 448 が click **か** Space。449–450 は `.check()` no-op の pointer 経路。Space の指定なしは 189 の `onKeyUp` |
| 既チェック Space は click が無いので前進しない（A-6） | keyup リスナが `activate` する。Blink が simulated click を出さないことは本文が織り込み済み |
| skip の「指定なし」部分一致で radio と衝突して本線が死ぬ（A-7） | `tabUntil` は radio 条件、click は `.wizard-option`、測定名はフル。部分一致で skip を測るのは本文外 |
| 44px の `.focus()` がキーボード only を破る（A-5） | 別 test。live コメントが分割している |
| `activateFocusedWithKeyboard` 既定 Enter で新ページが死ぬ（A-8） | 本文 476 が `"Space"` を書いている。live の次へ Enter 延長は本文が禁じている |
| leftover を Critical に戻す（A-10） | 350ms 中の `handleChange` 無視。click は `onPointerUp` を発火しない |
| React 19.2.7 は pointerup 末で `flushSync` | discrete は真。flush は microtask |
| Space の既定が keydown なので mutex が間に合わない | 主 UA は keyup。E2E は chromium |
| 6〜8 に「戻る」があるから I-1 / I-2 も落とす | Critical の自動降格材料。テスト契約の自己矛盾は戻るでは消えない |
| pantry がまだ「次へ」/ 戻る×5 | 408–414 / 432–433 が消した（A-9） |
| `expectMajorActionAtLeast44` が button 専用なのでカード 44px が未測定 | live `:1097` が native radio を対象外にしている。本文はカードを測れと言っていない。ヘルパ拡張は「測るなら」の残差で、今回の測定対象は skip / 戻る |
| 44px 個別に heading 待ちが無い（A-3） | 共通 444 が 44px 走査を含む。反対ではなく個別の省略。Minor |

## §6 受け入れ残差

計画は止めないが、本文へ足した方が安いもの。

- **M-1** 44px 個別 475–476 の矢印列に `expect(heading).toBeVisible()` を先頭へ（共通 444 の繰り返し）。無いと個別だけを完全手順と読んだとき 350ms が mount より前に始まる（A-3）。
- **M-2** 5ページ目で `getByRole("button", { name: "指定なし" })` が skip に部分一致することを一行。locator を radio / `.wizard-option` に限れば本線は死なない（A-7）。
- 前回から未着手の Minor: 確認ヘルプの任意 step 文言、7/8 の options / `onSelect` 貼付、radiogroup の `aria-labelledby` を heading `id` に張る、incomplete 時のフラグ、wizard 単位 leftover も `.wizard-option` を叩く。擬似コードの `name` 欠落は、I-2 を直すときにキーボード契約と一緒に踏襲を正と書く。
