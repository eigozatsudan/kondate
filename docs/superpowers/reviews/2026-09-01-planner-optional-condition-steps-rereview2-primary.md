# 追加条件ウィザードstep化 — 第2デルタ再レビュー（一次）

- 日付: 2026-09-01
- 対象: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md`（コミット `06352949`）
- 実施者: 読み取り専用 Reviewer
- 判定: **REVISE — Critical 0 件、Important 2 件、Minor 4 件**

## 1. Verdict

D-02（350ms のテスト単位）は本文に落ちた。isolated は mount 後 350ms 以内の**最初の**活性化が 0 回、wizard 単位は次 step の**初回** click、キーボード導線は heading focused のあと 350ms 待ってから Space。前回 D-02 の失敗モード（「2発目」だけ書いて leftover 初回を緑にできる）は P-03 節では閉じている。骨格と P-01 / P-05 本体は再開しない。

残る穴は D-01 と D-03 である。

D-01 は helper 名表と privacy 分離までは入ったが、(1) `shopping.ts` の walker を `ensurePlannerReady` と誤記し、実体の `generateShoppingMenu` を落としている、(2) 表の「全行に `skipOptionalPlannerSteps` を挟む」が、個別節の household 4 ページ歩き・キーボード Space 通過と矛盾する、(3) pantry `:277` が skip と「対象を変更」で一文固定されていない。機械的に表どおり実装すると買い物 E2E と full-journey のひねり・キーボード専用テストが赤になる。

D-03 は受け口を label の `onPointerUp` にし `detail` を捨てた点は WebKit 転送 click の前提と矛盾しない。しかし裁決が求めた「同一活性化で `onSelect` を一度だけにする擬似コード」が無く、`activate()` が常に `onSelect`+`onNext`、`onChange` が独立に `onSelect` という書きがイベント表の「各 1 回」と同時成立しない。未選択カード（15 分・節約・多め・ひねりたい）は本線である。

この 2 系統を本文が直すまで Plan / 実装開始は早い。

## 2. D-01〜D-03 閉じ確認

| ID | 状態 | 判定 |
| --- | --- | --- |
| D-01 | **Partial** | helper 名表、privacy 復帰を見出し置換側へ分離（`history.ts:468` / mobile `:96` / full-journey `:336` / generation-recovery `:103` `:440`）、`completeIdeaPlannerToReview` `:87–90`、`completeMinimumPlanner` `:141–142`、`savePlannerMeal` `:119–120`、unit `:746–764` をカード click で `9. 確認`、は入った。`shopping.ts:88–89` の実体は `generateShoppingMenu` であり `ensurePlannerReady`（`:40–67`、meal まで）ではない。表の「全行に skip」が個別の歩きと衝突する（§4 I-1）。 |
| D-02 | **Closed** | P-03 節が isolated「最初の活性化 0 回」+ `vi.useFakeTimers()` 350ms 後に 1 回、wizard 単位「6 ページ目の初回 click で `6. 予算` に留まる」、キーボードは heading `toBeFocused()` のあと `waitForTimeout(350)` を本文に書いた。live の leftover 動機（`.wizard-transition` 180ms は `styles.css:840–842`、現行 `<section>` は `cuisine-step.tsx:85` に未適用）と矛盾しない。テスト節に旧「2発目」が残るのは Minor（§5 M-1）。 |
| D-03 | **Partial** | 活性化の受け口を `.wizard-option` の `onPointerUp`（`button === 0` かつ `isPrimary`、`detail` を見ない）、Space は input `onKeyUp`、値だけは `onChange`、mutex は次 step mount でリセット、までは具体。擬似コードが無く、`activate()` 常時 `onSelect`+`onNext` が `onChange` の `onSelect` と重なる。裁決の「未選択は `onChange`=値、label の pointer が遷移」と本文が矛盾する（§4 I-2）。unit が `.wizard-option` をクリックすると書いていない。 |

## 3. Critical

なし。`firstIncompletePlannerStep` 非変更は live `planner-wizard.ts:48–52` のまま。`?resume=review` 4b、避ける食材は確認、必須 4 問の「次へ」、contracts / Function 非変更、編集中スキップ非表示も改訂で崩れていない。Chrome の label 転送 click が `detail === 0` で 6〜8 前進不能、は前回どおり偽陽性（Blink は underlying PointerEvent の `detail` をコピーする）。pointerup は `detail` を見ないのでその経路とも矛盾しない。

## 4. Important（残る / 新規）

### I-1: D-01 の helper 名表が `generateShoppingMenu` を落とし、skip 一括適用が個別の歩きと矛盾する

根拠:

- 裁決 D-01 は「行番号ではなく helper 名で再列挙」し、敵対二次は `generateShoppingMenu` と `answerAudienceAndReview` を名前で要求した。改訂表は「audience の `次へ` のあと `5. 確認` を期待している箇所がすべて対象で、**そこへ `skipOptionalPlannerSteps` を挟む**」と書く。
- live `e2e/fixtures/shopping.ts:88–89` は `generateShoppingMenu`（`:70–99`）の audience `clickWizardNext` → `"5. 確認"`。`ensurePlannerReady`（`:40–67`）は `/planner` を meal の「朝食」radio まで開くだけで、audience→review を歩かない。本文表は `| shopping.ts | ensurePlannerReady | :88–89 |` と、行番号は walker、名前は非 walker。
- 表に household ジャーニー `:71–73` とキーボード導線 `:1358–1385` が入っている。個別節は household を「スキップを使わず 4 ページを歩き」、キーボードを「新 4 ページを Space で通過」と書く。live household は `full-journey.spec.ts:71–73` の直後 `:84–87` で確認画面の radiogroup「献立の雰囲気」に `.check()` し、`p_novelty_preference":"twist"` の保存を待つ。確認から `ReviewChoiceField` 4 つを消す設計（本文 確認画面）なので、skip するとひねりの操作対象が無い。キーボード導線は `generation-recovery-results.spec.ts:1283–1383` が Tab / Space / Enter のみ、`tabUntil`（`:1193–1206`）に programmatic focus 禁止。skip helper はスキップ**ボタン**の pointer click であり、キーボード専用契約を壊す。
- pantry インライン `:277–278` は表では skip 対象。戻る回数節は `:263–264` を戻る×5 **または**「対象を変更」とする。live は `menu-domain-pantry.spec.ts:260` で `advanceToReviewWithHousehold` したあと `:263` で順送りの「戻る」、`:277` `clickWizardNext`（`history.ts:41–42` は name `"次へ"` 専用）。「対象を変更」を選ぶとボタンは「確認に戻る」（`planner-wizard.tsx:275–278`）で skip は出ない（編集中は `onSkipRest` を渡さない）。

成立条件:

1. helper 名どおり `ensurePlannerReady` に skip を足す → meal 画面にスキップボタンは無くタイムアウト。`generateShoppingMenu` は audience の次を `"5. 確認"` のまま待ち、買い物 fixture（`:26–27` が両方を呼ぶ）がまとめて赤。
2. 表どおり household `:71–73` に skip を挟む → 4 条件は `null`、確認に雰囲気カードが無い。`:84–87` の「ひねりたい」が要素を見つけられない。個別の 4 ページ歩きをあとから足すと skip と二重適用になる。
3. 表どおりキーボード導線に skip を挟む → キーボード専用テストが pointer で任意 step を飛ばす。D-02 の 350ms Space 待ちも死ぬ。
4. 戻る回数で「対象を変更」にし、表どおり `:277` に skip を足す → 編集戻り中の audience にスキップは無く、`clickWizardNext` は「確認に戻る」を見つけられない。

必要な修正:

- `shopping.ts` の単位名を `generateShoppingMenu` にする。`ensurePlannerReady` は walker ではないので列挙から外す。
- 表の前置きを「既定は skip。個別節が歩きを指定した行は skip しない」に変える。household とキーボード導線を skip 列から外すか、列に「skip / 4 ページ / Space」を持たせる。
- pantry `:277–278` を一文で固定する。「対象を変更 → 確認に戻る」か、「戻る×5 → audience の `次へ` のあと skip」の片方。
- `answerAudienceAndReview` を名前で書く（今は「走査本体」。行 `:147–149` は正しい）。

### I-2: D-03 の mutex が `onSelect` ちょうど 1 回を閉じず、擬似コードが無い

根拠:

- 裁決 D-03 は「同一活性化で `onSelect` を一度だけにする**擬似コード**。未選択は `onChange`=値、label の pointer が遷移。既選択再 tap は change が無いので pointer 側が値+遷移。unit は `.wizard-option` をクリックして各 1 回。input 直 click だけを緑にしてはいけない」。
- 改訂 D-03 は `activate(value)` を「`onSelect(value)` と `onNext()` を呼ぶ単一の関数」+ `useRef<boolean>` mutex とし、同時に「値だけの更新は input の `onChange`（`onSelect` のみ）」「同一活性化から pointerup と click / change が来ても 2 回目以降は no-op」と書く。
- live の radio は controlled `onChange` のみ（`cuisine-step.tsx:106–108`、`review-step.tsx:137–139`）。カードは `<label class="wizard-option">`（同 98–112 / 130–141、ヒット領域 `styles.css:208–211`）。WHATWG / Blink のポインタ活性化は pointerup → click → default action で change。未選択 Space は change が keyup より先に出る。
- 親の `onSelect` は `onDraftChange({ ...draft, ... })` リテラル（本文 P-05）。同一値でも 2 回呼べば autosave が二重 enqueue する。unit は「ポインタ click で `onSelect` + `onNext` が各 1 回」（テスト節）。

成立条件:

1. 本文どおり `onChange` = `onSelect`、`activate` = `onSelect`+`onNext`、mutex は `activate` だけ → 未選択カードの pointerup のあと change が `onSelect` をもう 1 回呼ぶ。mutex は change を見ない。unit `toHaveBeenCalledTimes(1)` は 15 分 / 節約 / 多め / ひねりたい（未選択本線）で落ちる。既定「指定なし」再 tap だけが 1 回で緑。
2. 「change も mutex で no-op」を文字どおり `onChange` から `activate` する → 矢印キーの `change` が `onNext` し、イベント表の「矢印は値だけ」が死ぬ。1 回目の矢印でページが飛ぶ。
3. mutex を step 寿命の `onSelect` 抑制にする → 矢印 2 回目以降の値更新が止まる。
4. `cuisine-step` 踏襲で `disabled` を input にだけ付け、label の `onPointerUp` が `disabled` を見ない → `isSaving` 中も活性化する。native は disabled radio の label 活性化を起こさない（`cuisine-step.tsx:103`）。pointerup は label に付くので input の `disabled` では止まらない。
5. unit が `getByRole("radio")` / `fireEvent.click` だけ → 44px 正本の label 経路を代用できない。裁決が禁じた「input 直 click だけ緑」。

必要な修正:

- 活性化 1 回分の擬似コードを貼る。未選択: `onChange` が `onSelect`、pointerup / Space keyup は `onNext` のみ。既選択再 tap / 既選択 Space: change が無いので pointer / keyup が `onSelect`+`onNext`。矢印の `change` は `onSelect` のみで mutex を立てない。
- mutex は pointerup と Space keyup（と、listen するなら label の click）だけを跨ぎ、`onChange` を `activate` に通さない。
- `activate` の先頭で `disabled` と 350ms ガードを見る順序を書く（ガードで return する経路では mutex を立てない）。
- unit は `.wizard-option` をクリックして未選択 / 既選択「指定なし」再 tap / 既選択非デフォルト再 tap の各 1 回。input 直 click だけを緑にしない。

## 5. Minor

### M-1: テスト節の P-03 行が旧「2発目」のまま

P-03 / D-02 節は「2発目という書き方では次 step の初回を緑にできる」と書いたうえで、最初の活性化 0 回と wizard 初回 click を要求する。同じ本文の unit リストは「mount 直後 350ms 以内の**2発目** click では `onSelect` が走らない」を残している。Plan がテスト節だけを入力にすると leftover 初回 unit が消える。P-03 節を正とすれば D-02 は閉じる。テスト節の 1 行を「最初の活性化 0 回」に合わせれば足りる。

### M-2: `answerAudienceAndReview` が「走査本体」になっている

live は `e2e/specs/mobile-accessibility.spec.ts:130–149`。`:147–149` の行番号は正しい。D-01 の「helper 名で押さえる」からは外れている。I-1 の列挙修正に名前を足せば足りる。

### M-3: キーボード導線が heading focused の直後に Space と読める

D-02 は「heading の `toBeFocused()` のあと 350ms 待ってから Space」。live 現行は heading focus のあと `tabUntil` で radio に着いてから Space（`generation-recovery-results.spec.ts:1306–1314`、cuisine `:1343–1351`）。`h2` は `tabIndex={-1}`（`cuisine-step.tsx:89`）で Space の対象ではない。待ちのあとに radio へ Tab すると書かないと、実装者が heading 上で Space して偽赤にする。現行テスト形を残す一文があれば足りる。`waitForTimeout(350)` とガード `Date.now() - mount < 350` の境界は 1 poll 分のフレーク余地があるが、heading focus が mount `useEffect` のあとなので実機では 350ms 超になりやすい。

### M-4: 350ms ガードと mutex の順序が結合されていない

P-03 は「活性化ハンドラの先頭で」350ms 判定。D-03 は mutex を `activate()` に置く。mutex を 350ms より先に立ててからガード return すると、同一 step では 350ms 後の正規 1 発目も no-op でページから出られない。I-2 の擬似コードに「ガード miss では mutex を立てない」と書けば Minor で消える。

## 6. 偽陽性として却下したもの

- 骨格の再開（`firstIncomplete` 非変更、`?resume=review` 4b、避ける食材は確認、必須 4 問の「次へ」、contracts / Function 非変更、編集中スキップ非表示）。live `planner-wizard.ts:48–52`。`toDraftInputFields`（`use-draft-autosave.ts` 付近）に step 名は無い。
- `noveltyPreference` が `PlannerFieldName` にある。無い（`planner-wizard.ts:16–28, 109–122`）。確認カードも `invalid={false}`（`review-step.tsx:700`）。
- P-01 / P-05 本体。household / idea は `advanceFromEditOr("timeLimit")`、`goToStep("timeLimit")` 禁止。時間・予算の `""`→`null` / `Number` 禁止は本文リテラル。live 正本 `review-step.tsx:597–614` / `:631–645`、Incomplete idle は `use-draft-autosave.ts:84–86, 642–646`。7/8 ページ options 未貼付は前回 Minor のまま再開しない。
- Chrome の label 転送 click が `detail === 0` でカードタップ前進不能。前回裁定どおり偽陽性。本文は `detail` を見ない。
- `generation-recovery-results.spec.ts:1026` を walker に数える。cuisine→audience のあと `/emergency-menus` へ抜ける。本文も対象外。
- `:866–871` 人数未選択で audience に留まる経路。本文対象外どおり。
- `acceptance.ts` が wizard を歩く。re-export のみ。
- `"5. 確認"` 42 件が導線修正で足りる / 件数が嘘。本文は見出し置換と導線を別作業のまま。
- `ensurePlannerReady` に skip を足せば足りる。meal までしか開かない（`:40–67`）。足す対象は `generateShoppingMenu`（I-1）。
- スキップの `goToStep("review")` が P-01 と衝突。禁止は audience の `goToStep("timeLimit")`。編集中は skip 非表示。
- 320px / 44px 不足。`.wizard-option` / `.ui-btn` は既に 44px（`styles.css:208–211`）。
- P-03 Strict Mode が leftover を通す。leftover は ~300ms 後。`useRef` に mount 時刻を持てば remount は張り直す。
- axe 表の 6〜8 ページ primary=「戻る」。ハーネスは named button の可視だけ（`accessibility.test.tsx:479–509`）。
- 確認ヘルプが「見直す」だけ。前回 Minor。第2デルタの焦点外。

---

判定: **REVISE — Critical 0 件、Important 2 件、Minor 4 件**。D-02 と骨格 / P-01 / P-05 は APPROVE 相当。D-01 の helper 名と skip/歩きの切り分け、D-03 の活性化擬似コード（`onSelect` ちょうど 1 回）を本文が直すまで Plan / 実装開始は禁止。
