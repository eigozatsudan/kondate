# 追加条件ウィザードstep化 — デルタ再レビュー（二次）

- 日付: 2026-09-01
- 対象: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md`（`b9bdb099`）
- 入力: 初回裁定、一次デルタ、敵対的デルタ。live は wizard / review / cuisine / labels / autosave / contracts / accessibility / planner-wizard.test / 指定 E2E
- 実施者: 読み取り専用 Reviewer（一次・敵対的とは別コンテキスト）
- 判定: **REVISE — Critical 0 件、Important 3 件（P-02 残差 / P-03 / P-04）**

骨格（`firstIncomplete` 非変更、4b resume、避ける食材は確認、必須4問の「次へ」、contracts 非変更）は再攻撃しない。

## §1 Verdict

敵対 C-1 の「Chrome の label 転送 click は `detail === 0` なのでカードタップで前進不能」は **偽陽性**。Blink 現行は `HTMLLabelElement::DispatchSimulatedClick(&evt)` が default `kFromUserAgent` で、`SimulatedEventUtil` は underlying が `PointerEvent` なら `pointerId` / `pointerType` / `isPrimary` / **`detail` をコピー**する。ポインタ由来の label クリックは元 click の `detail === 1` を input へ渡す。`event.detail > 0` は Chrome ではカードタップを落とさない。`pointerId === -1` は accessibility 専用ではなく、コピー前の予約値／旧経路の話であり、`detail` ゲートの失敗条件ではない。

残る計画ブロッカーは三つ。

1. **P-04**（一次 I-1 / 敵対 I-3）: `completeIdeaPlannerToReview` / `completeMinimumPlanner` / pantry `:277` が列挙に無く、privacy resume 行が歩く箇所に混入。unit `746–764` は novelty に「次へ」が無い。
2. **P-03**（敵対 I-2）: 必須 unit が「同 step の 2 発目」になって leftover（次 step の **初回**）を緑にできる。キーボード E2E は heading focus 待ち込みでも Space が 350ms 未満になり得る。
3. **P-02 残差**（敵対 I-1 + C-1 から分離したテスト穴 + WebKit）: 本文の「ちょうど 1 回」は native の change+click / change+keyup と排他。Chrome では `detail > 0` は通るが、WebKit の SimulatedClick は `detail` を 0 固定。input 直 click の unit は 44px カードタップを代用できない。

P-01 と P-05 の本体（時間・予算の `""`→`null` / `Number` 禁止）は Closed。7/8 ページの options 未貼付は Minor。

## §2 P-01〜P-05 閉じ確認

| ID | 状態 | 二次の結論 |
| --- | --- | --- |
| P-01 | **Closed** | 本文は household を `isAudienceComplete` のあと `advanceFromEditOr("timeLimit")`、idea は await 成功後に同じ helper、`goToStep("timeLimit")` 禁止。live `planner-wizard.tsx:257–264`（helper）、`519–548`（idea はフラグを捨てて `goToStep("review")`、household も complete 後に review 固定）。置換すれば「対象を変更→確認に戻る」は壊れない。incomplete 分岐の一文不足は Minor（敵対 M-1） |
| P-02 | **Partial** | イベント表と `detail > 0` + Space は書いてある。Chrome の label 転送で前進不能、は閉じた（C-1 偽陽性）。残るのは (a) 「ちょうど 1 回」と native 順序の mutex が本文に無い (b) WebKit は転送 click の `detail` が 0 (c) unit が input 直 click を許す。6〜8 に「次へ」もスキップも無い前提は live / 本文どおり |
| P-03 | **Partial** | 350ms 無視と戻る/スキップ除外は本文にある。unit 本文 124 行（次 step の onSelect が走らない）と 249 行（mount 直後の **2 発目**）が食い違う。キーボード E2E に 350ms 待ちが無い |
| P-04 | **Partial** | skip helper・`clickWizardNext` 禁止・戻る回数・full-journey household 歩き・idea skip 意図・44px / キーボード・`acceptance.ts` 対象外は入った。本番 walker 3 本と pantry 277、privacy 混入、unit 746–764 が未記載 |
| P-05 | **Closed**（7/8 は Minor 残差） | 時間・予算の options / ternary / `Number` 禁止は本文 133–161 行。live 正本 `review-step.tsx:597–614` / `631–645`。契約 `shared/contracts/planner.ts:96`。`use-draft-autosave.ts:84–86, 642–646` は Incomplete を toast せず idle。初回 P-05 の穴（labels に時間・予算が無い）は閉じた。7/8 は `planner-labels.ts:23–37, 49–56` が正本で、options 配列の本文貼付だけが無い |

## §3 各指摘の二次判定表

| 元ID | 判定 | 最終severity | 根拠 |
| --- | --- | --- | --- |
| 敵対 C-1（Chrome `detail===0` で 6〜8 前進不能） | **False positive** | — | Blink: `Node::DispatchSimulatedClick` の default は `kFromUserAgent`。`HTMLLabelElement` は `element->DispatchSimulatedClick(&evt)`。`SimulatedEventUtil::CreateMouseOrPointerEvent` は `kFromUserAgent` かつ underlying が `PointerEvent` なら `setDetail(pointer_underlying_event->detail())` と pointerId をコピーする。ポインタの label クリックは元 `detail===1` が input へ渡る。`pointerId===-1` はコピー前の `kReservedNonPointerId`／accessibility 以外でも出得るが、**`detail` ゲートの失敗条件ではない**（w3c/pointerevents#554 は pointerId/pointerType の話で `detail` を 0 と書いていない）。live カードは `cuisine-step.tsx:98–112` / `review-step.tsx:130–141` の `<label class="wizard-option">`、ヒット領域は `src/styles.css:208–211`。Chrome では input の `detail > 0` でカードタップが進む |
| C-1 から分離: input 直 click の unit がカードタップを代用できない | **Confirmed**（本体とは別） | **Important**（P-02 残差へ束ねる） | Spec テスト節 245–247 行は「ポインタ click」とだけ書き、`.wizard-option` を指定しない。RTL `getByRole("radio")` / Playwright `getByRole("radio").click()` は input の layout box。44px 正本は label（`styles.css:208–211`、`cuisine-step.tsx:99`）。Chrome では両経路とも `detail>0` なのでテスト緑＝製品緑。WebKit では乖離する（下段） |
| C-1 の WebKit / Firefox | WebKit **Confirmed**（detail=0）。Firefox **未確認**（ソース上は clickCount コピー） | **Important**（P-02 残差） | WebKit `SimulatedClick.cpp` の SimulatedMouseEvent は `/* detail */ 0` 固定（現行パッチでも同じ）。input の `onClick` + `detail > 0` だと Safari のカードタップは `onNext` しない。6〜8 は「次へ」無し（本文 84, 170 行）。Firefox は `HTMLLabelElement` が `DispatchClickEvent` に source mouse を渡し、clickCount をコピーする実装なので `detail===1` の可能性が高いが、実行確認はしていない |
| 一次 I-1 / 敵対 I-3（P-04 列挙） | **Confirmed**（両者 Duplicate） | **Important** | `completeIdeaPlannerToReview` は `generation-recovery-results.spec.ts:28–90`、audience の `clickWizardNext` 直後に `"5. 確認"`（`:87–90`、呼出 `:722`）。`completeMinimumPlanner` は同 `:107–142`（`:141–142`、呼出 `:221 / 294 / 353 / 410 / 501`）。本文 277 行は「44px（`:1268–1272`）とキーボード」としか書いていない。`menu-domain-pantry.spec.ts:260–278` は review 到達後に戻って audience を直し、`:277` `clickWizardNext` → `:278` `"5. 確認"`。本文は `:263–264` だけ。`clickWizardNext` は `history.ts:41–42` で name `"次へ"` 専用。編集戻りならボタンは「確認に戻る」（`planner-wizard.tsx:275–278`） |
| 一次 I-1 の privacy 混入 | **Confirmed** | **Important**（上に含む） | `history.ts:455–470` は idea 確認到達のあと privacy CTA。`:468` は既に確認見出し。`mobile-accessibility.spec.ts:82–98` の `:96` も privacy 復帰後の確認。`full-journey.spec.ts:315` が idea の audience `次へ`、`:336` は privacy 復帰後。本文 271–276 / 296 行は `:468` `:96` `:336` を歩く箇所として数え、idea には skip を置けと書く。確認画面にスキップボタンは無い（本文 170–192 行、timeLimit のみ） |
| 一次 I-1 の unit `746–764` | **Confirmed** | **Important**（上に含む） | `planner-wizard.test.tsx:746–764` は確認の「戻る」で `4. 作る相手`、その場の「次へ」で確認へ戻る。review の `onBack` を `novelty` にすると着地は `8. 献立の雰囲気`（本文 215 行）。そのページに「次へ」は無い（決定事項 1、本文 84 行）。「戻る回数だけ 8」にして「次へ」で戻すとハングする |
| 敵対 I-3 の `savePlannerMeal` forward / `:119` | **Confirmed**（I-3 に含む） | **Important** | `menu-domain-pantry.spec.ts:70–120`。本文は `:77`（入場時の確認見出し）と `:118–120` を列挙。`:77` は walker ではない。戻るを ×8 にしても **forward の最後 `:119` `clickWizardNext`** が残れば着地は `5. 調理時間`。`:1026` は cuisine→audience のあと emergency へ抜け、review 非経由（`generation-recovery-results.spec.ts:1019–1036`）。敵対の「`:1026` は対象外」は正しい |
| 一次 M-1 / 敵対 I-1（P-02 ちょうど 1 回） | **Confirmed**。一次の Minor 化は **不採用** | **Important** | 本文 97–113 / 245–247 行。live の radio は `onChange` のみ（`cuisine-step.tsx:106–108`、`review-step.tsx:137–139`）。WHATWG / Blink は click ハンドラのあと default action で change。未選択ポインタ: onClick が onSelect を担うと **onSelect 2 回**。担わないと既選択再 click の onSelect が死ぬ。未選択 Space は keyup（onSelect+onNext）+ change（onSelect）で同様。**未選択は稀ではない**。既定「指定なし」再タップはスキップ本線だが、15 分 / 節約 / 多め / ひねりたいを選ぶ本線は未選択カード。unit `toHaveBeenCalledTimes(1)` は mutex 無しでは未選択行で落ちる。活性化単位のフラグが本文に無い |
| 敵対 I-2（P-03 unit 2 発目 vs leftover 初回） | **Confirmed** | **Important** | 本文 121–124 行は「次 step の onSelect が走らない」。本文 249 行は「mount 直後 350ms 以内の **2 発目**」。optional-choice-step を 1 台 mount して 1 発目を通し 2 発目だけ無視すれば 249 は緑。leftover は **次インスタンスの 1 発目**（本文 117–119 行の動機）。4 ページとも先頭は「指定なし」 |
| 敵対 I-2（キーボード E2E 350ms） | **Confirmed** | **Important**（上に含む） | `tabUntil` は Tab 連打（`generation-recovery-results.spec.ts:1193–1206`）。現行キーボード導線 `:1283–1383` は各 step で `expect(heading).toBeFocused()` のあと `tabUntil` → Space。heading focus は mount の `useEffect`（`cuisine-step.tsx:45–47, 89`）。Playwright の web-first expect は条件成立まで poll（既定 interval 100ms）するが、heading は mount 直後に focus 済みなので待ちは 0〜1 poll。その後 Tab 1 回で先頭 radio に着き Space。合計は 350ms 未満になり得る。本文 297–299 行は「Space で通過」とだけ言い、350ms 待機を書かない。戻る/スキップはガード対象外（本文 123 行）だが、キーボード本線は選択肢の Space |
| 敵対 I-4（P-05 7/8 未貼付） | **Confirmed**。初回 P-05 の穴は閉じた | **Minor** | 時間・予算は本文 133–157 行にリテラルがある。7/8 は本文 162–165 行が「labels + 現行 ReviewChoiceField と同じ literal 比較」とだけ言う。live 正本は `review-step.tsx:664–716`。`planner-labels.ts:23–37, 49–56` があるので labels 虚偽は再発しない。残る抜け道は `as` / `includes` コピー。`Number("")` 爆弾は 7/8 に無い |
| 一次 M-2 確認ヘルプ | **Confirmed** | **Minor** | 本文 237 行は「見直す」だけ。live `review-step.tsx:558–561` は「直したあとは『確認に戻る』でこの画面に戻ります。」必須 4 問は `nextLabel` を渡す（`planner-wizard.tsx:275–278`）。追加 4 行は `nextLabel` を渡さず選択で `advanceFromEditOr`（本文 212–218 行）。旧文を残すと追加 4 行について半分嘘 |
| 一次 M-3 full-journey `.check()` | **Confirmed** | **Minor** | `full-journey.spec.ts:84–87` は novelty radiogroup に `.check()`。Playwright は already checked なら **直ちに return**（click しない）。P-02 の既定「指定なし」再タップは `.click()` が要る。household の「ひねりたい」自体は未選択なので `.check()` は click する。詰まるのは 5〜7 ページを `.check()` で「指定なし」通過しようとしたとき。本文 294–295 行は 4 ページ歩きを要求するが `.click()` を書いていない |
| 敵対 M-1 incomplete フラグ | **Confirmed** | **Minor** | live household は先に `setReturnToReviewAfterEdit(false)` してから incomplete なら `goToStep(firstIncomplete)`（`planner-wizard.tsx:542–546`）。本文は complete ガードのあと helper とだけ書き、incomplete を黙っている。P-01 本線は helper で閉じる |
| 敵対 M-4 radiogroup `aria-labelledby` | **Confirmed** | **Minor** | 本文 72 行は「radiogroup の名前はこの heading 側」。live 必須 step は `section aria-labelledby` だけで radiogroup は無名（`cuisine-step.tsx:85–97`）。`ReviewChoiceField` だけが `aria-labelledby={`${id}-label`}`（`review-step.tsx:123–127`）。cuisine 踏襲だと `getByRole("radiogroup", { name: "5. 調理時間" })` は失敗する。現行 axe は無名 radiogroup の cuisine を通している（新規違反にはならない） |
| 敵対 M-2 C-C2 / ReviewFieldErrors | **Confirmed**（残差のみ） | **Minor** | 本文 230–236 行どおり 3 フィールドを外す。live `forceAdditionalOpen` は `review-step.tsx:379–389`、`buildReviewFieldErrors` は `planner-wizard.tsx:24–39`。novelty は `PlannerFieldName` 外（`planner-wizard.ts:16–28, 109–122`）、確認カード `invalid={false}`（`review-step.tsx:700`） |
| 敵対 M-3 axe primary | **False positive**（矛盾しない） | — | `accessibility.test.tsx:479–508` は named button の可視だけ。variant は見ない。5 ページ目 primary=スキップ、6〜8=「戻る」でハーネスは通る |
| 敵対 M-5 確認「変更」→指定なし再タップ | **Duplicate** | — | P-02 の既選択再 click。C-1 Chrome 偽陽性のあと、WebKit 残差と mutex に従属 |
| 敵対 攻撃 4 / 5 / 8 / 9、骨格蒸し返し | **False positive** | — | 一次 §6 および敵対 §7 どおり。live `firstIncompletePlannerStep` は `planner-wizard.ts:48–52`。`toDraftInputFields`（`use-draft-autosave.ts:66–81`）に step 名は無い |

## §4 残す計画ブロッカー

Critical は無い。次の 3 系統を本文に埋め込んでから Plan / 実装開始。

### 1. P-04 呼び出し先を helper 名で再列挙する

- 列挙から privacy resume を外し、見出し置換側へ移す: `history.ts:468`、`mobile-accessibility.spec.ts:96`、`full-journey.spec.ts:336`。
- 名前で足す: `completeIdeaPlannerToReview`（`:87–90`）、`completeMinimumPlanner`（`:141–142`）、`savePlannerMeal` の **forward 最後**（`:119`）、`advanceToReviewWithHousehold`（`:145`）、`answerAudienceAndReview`（`mobile-accessibility.spec.ts:147`）、`seedGeneratedMenu` / `seedGeneratedIdeaMenu` / `generateShoppingMenu` / shots `flows.ts:36`、full-journey household `:71` と idea **`:315`**。
- `menu-domain-pantry.spec.ts:277–278` を一文で固定する。「対象を変更」なら `:277` は `clickWizardNext` ではなく「確認に戻る」。戻る×5 で audience に出すなら、その `次へ` のあとにも `skipOptionalPlannerSteps`。
- 戻る×8 の **帰り** の `clickWizardNext` を skip helper に置換すると明記する。
- unit `planner-wizard.test.tsx:746–764` を更新対象に戻す。確認から 1 つ戻った任意 step には「次へ」が無いので、指定なし（または任意カード）click で `9. 確認` へ戻ると書く。

### 2. P-03 unit を leftover 初回にし、キーボード E2E に 350ms を書く

- `optional-choice-step.test.tsx`: 「mount 後 350ms 以内の **最初の** 活性化では `onSelect` / `onNext` が 0 回」。
- wizard 単位: 「step N の選択直後の同座標 click で step N+1 の `onSelect` が 0 回」（本文 124 行を 249 行より優先する）。
- キーボード導線（本文 297–299 行）: 各任意 step で heading focused の **あと 350ms 待ってから** Space。`tabUntil`（`:1193–1206`）は待ちを足さない。

### 3. P-02: ちょうど 1 回の活性化フラグ + label 経路 + unit は `.wizard-option`

擬似コードを本文に貼る。

- 同一活性化（ポインタ 1 回 / Space 1 回）で `onSelect` を一度だけにする。未選択は `onChange` が値、`onClick`/`pointerup` が遷移。既選択再 tap は change が無いのでポインタ側が値+遷移。矢印の `change` は値のみ。
- ポインタ判定は **label（`.wizard-option`）上の pointerup / 本物 click**（`pointerType` が `mouse|touch|pen`）を正とする。input の `detail > 0` 単体にしない。Chrome では転送 click の `detail` は 1 だが、WebKit の SimulatedClick は `detail` を 0 固定するため、input だけ見ると Safari のカードタップが 6〜8 で詰まる。label に `onClick` を置くなら、input から bubble する転送 click で `onNext` を二度走らせない。
- unit 必須: **`.wizard-option`（label）をクリック**して `onSelect`+`onNext` が各 1 回。`getByRole("radio")` 直 click だけを緑にしてはいけない。既選択「指定なし」のカード再タップで 6〜8 から出られることを label 経路で主張する。

## §5 偽陽性

- **敵対 C-1 の Chrome「`detail===0` で前進不能」。** 転送 click は合成だが、Blink は underlying PointerEvent の `detail` をコピーする。UI Events の「合成 click の detail は 0」を label 転送に当てた読みが誤り。`pointerId===-1`（#554）と `detail` を同一視した。
- **敵対 M-3（axe primary 必須との矛盾）。** ハーネスは名前付きボタンの可視だけ。
- **骨格の蒸し返し**（`firstIncomplete`、4b、避ける食材、必須4問の「次へ」、contracts / Function、編集中スキップ非表示）。一次 §6 / 敵対 §7 / live `planner-wizard.ts:48–52`。
- **P-01 stale クロージャ / スキップ `goToStep("review")` と P-01 の衝突。** 禁止は audience の `goToStep("timeLimit")`。スキップは timeLimit 専用で編集中は出さない（本文 176–192 行）。
- **P-03 Strict Mode が leftover を通す。** leftover は ~300ms 後の 2 物理タップ。`useRef(Date.now())` を render で持てば remount はガードを張り直す。
- **`generation-recovery-results.spec.ts:1026` を audience→review walker に数えること。** 敵対どおり cuisine→audience のあと emergency へ抜ける（`:1019–1036`）。列挙漏れではない。
- **7/8 の labels 虚偽（初回 P-05）。** `planner-labels.ts` に `ingredientPreferenceLabels` / `noveltyPreferenceLabels` がある。時間・予算だけが無かった穴は本文リテラルで閉じた。

---

判定: **REVISE — Critical 0 件、Important 3 件。** P-01 / P-05 本体と骨格は APPROVE 相当。P-04 の helper 名再列挙、P-03 の leftover 初回 unit とキーボード 350ms、P-02 の活性化 mutex と label 経路（WebKit `detail=0`、unit は `.wizard-option`）を本文が直すまで Plan / 実装開始は禁止。
