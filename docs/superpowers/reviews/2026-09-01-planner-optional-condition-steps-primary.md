# 追加条件ウィザードstep化 設計 — 一次レビュー

- 日付: 2026-09-01
- 対象: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md`
- 実施者: 読み取り専用 Reviewer
- 判定: **REVISE — Critical 0 件、Important 4 件、Minor 3 件**

## 1. Verdict

選択式4条件を `plannerSteps` の audience〜review 間へ差し、`firstIncompletePlannerStep` と送信契約は触らない、という骨格は現行の step モデル・`?resume=review`（不変契約 4b）・autosave 写しと矛盾しない。削除対象も `9cc64886` 以降の確認画面カード UI（`ReviewChoiceField`）と一致する。

ただし設計どおり進めると、(1) household の「対象を変更→確認に戻る」が調理時間へ落ち、(2) 既定「指定なし」では 6〜8 ページから前進できず、(3) 列挙外の E2E/unit が `次へ` / `戻る×4` 前提のまま大量失敗し、(4) 調理時間・予算のラベル正本を impl が取り違える。この 4 点を仕様に固定するまで Plan に進めるべきではない。

## 2. Critical

なし。`shared/contracts`・生成 Function・RLS・quota は非目標どおり触らない前提で、現行 `timeLimitMinutes` / `budgetPreference` / `ingredientPreference` / `noveltyPreference` はすでに draft/submission にある。`shared/safety` をブラウザへ入れる記述も無い。`noveltyPreference` を `PlannerFieldName` に足さない判断も live と一致する。

## 3. Important

### I-1: household の audience `onNext` が edit-return を壊す書き方になっている

根拠:

- Spec「ウィザードの遷移」は household を「`isAudienceComplete` ガードはそのまま。通過後 `timeLimit` へ」とだけ書く。edit-return 分岐は idea 確定経路にだけある。
- live の audience `onNext` は `advanceFromEditOr` を使わない。household はフラグを先に落としてから review 直指定。
  `src/features/planner/components/planner-wizard.tsx` 542–548 行:
  `setReturnToReviewAfterEdit(false)` のあと `isAudienceComplete`、通過なら `goToStep("review")`。
- idea 確定も同様にフラグを消してから review（同ファイル 536–538 行）。await 成功後も `advanceFromEditOr` ではない。
- 必須3問（meal/ingredients/cuisine）だけが `advanceFromEditOr`（258–264、421–422、448–449、477–478 行）。audience は例外。
- 既存 unit は「対象を変更」→「確認に戻る」→確認へ復帰を固定している。
  `src/features/planner/components/planner-wizard.test.tsx` 801–804 行。

成立条件:

1. household の `goToStep("review")` を無条件で `goToStep("timeLimit")` に置換する → 確認の「対象を変更」から「確認に戻る」を押すと `5. 調理時間` に着地する。既存利用者の編集戻りが壊れる。
2. 現行どおり `setReturnToReviewAfterEdit(false)` を分岐より前に残す → idea 側に書いた「編集戻りなら review」も、読む時点では既に false で常に `timeLimit` へ進む。

必要な修正:

- household も idea と同じく「編集戻りなら review、順送りなら `timeLimit`」と明記する。
- 実装手順は「フラグを読む → 完了ガード → `advanceFromEditOr("timeLimit")`（または同等の分岐）→ その後にフラグを落とす」。現行の「先に false にしてから直指定」をなぞることを禁止する。
- unit「対象を変更→確認に戻るで確認へ戻る」を必須回帰として残す。

### I-2: 既定「指定なし」＋「次へなし」では radio `onChange` で前進できない

根拠:

- Spec 決定事項 1: 各ページに「次へ」は置かず、「指定なし」を押すこと自体がスキップ。unit は「指定なしが既定で選択済み／選択で `onSelect` と `onNext` が1回ずつ」。
- Spec 新 step は `cuisine-step.tsx` を踏襲（`wizard-option-list` / `wizard-option`）。cuisine の選択は radio の `onChange` のみ（`src/features/planner/components/cuisine-step.tsx` 99–108 行）。「次へ」は別ボタン（119–127 行）。
- 現行カードも同じ `onChange`（`review-step.tsx` 137–139 行の `ReviewChoiceField`）。先頭「指定なし」が既定（97 行、597–598・632 行）。
- HTML の radio は、すでに checked の項目をもう一度選んでも `change` が発火しない。
- 「以降は指定なしでスキップ」は `timeLimit`（5ページ目）だけ。6〜8ページ（予算・材料の使い方・雰囲気）には逃げ道も「次へ」も無い。
- キーボード導線は Space のあと `次へ` へ Tab する前提（`e2e/specs/generation-recovery-results.spec.ts` 1308–1383 行）。新ページに `次へ` は無い。

成立条件:

1. cuisine / `ReviewChoiceField` の `onChange` をコピーする → 既定「指定なし」をクリックしても `onNext` が走らない。5ページ目はスキップボタンで抜けられるが、6〜8ページは非 null を選ばないと確認へ行けない。調理時間だけ指定して残りは未指定、という本設計の主経路が死ぬ。
2. unit が「15分以内」など未選択値だけを click して GREEN にする → 既定「指定なし」で進む経路がテストされない偽 GREEN。

必要な修正:

- 選択は `change` ではなく、既選択でも発火する `click`（または同等）で `onSelect` + `onNext` すると固定する。
- unit に「value が既に `""` の『指定なし』をクリックしても `onNext` が1回走る」を必須にする。
- キーボードは Space で即次ページ（`次へ` は探さない）、5ページ目のスキップはボタン名「以降は指定なしでスキップ」へ Tab、と書く。

### I-3: テスト計画の対象が fixture 4 ファイル＋機械置換に偏り、既存の audience→review / 戻る回数を取りこぼす

根拠:

- Spec は `skipOptionalPlannerSteps` を `history.ts` / `acceptance.ts` / `shopping.ts` / `shots/flows.ts` から呼び、「`5. 確認` → `9. 確認` の機械置換（現状42箇所）」とする。
- live の audience 直後 `clickWizardNext`（`次へ` 専用、`e2e/fixtures/history.ts` 41–42 行）→ 確認、は次にもある。
  - `e2e/specs/menu-domain-pantry.spec.ts` 独自 `advanceToReviewWithHousehold`（127–146 行）と `savePlannerMeal`（76–120 行）。fixture 4 ファイルに含まれない。
  - 同ファイル 58–80 行: 確認から「戻る」を **4回** で `1. 食事`。設計どおり review の `onBack` を `novelty` にすると 4回では `5. 調理時間` に止まる。
  - 同ファイル 263–264 行: 確認の「戻る」1回で `4. 作る相手`。変更後は `8. 献立の雰囲気`。
  - `e2e/specs/generation-recovery-results.spec.ts` の `completeIdeaPlannerToReview`（87–90 行）と `completeMinimumPlanner`（141–142 行）。Spec が触るのはキーボードテスト名だけ。
  - `e2e/specs/full-journey.spec.ts` 71–73 行（household）と 315–317 行（idea。確認見出しの前に「家族の年齢・アレルギーは確認されません」）。`clickWizardNext` 直書きで fixture helper を経由しない。
  - `e2e/specs/mobile-accessibility.spec.ts` `answerAudienceAndReview`（147–155 行）は audience の `次へ` のあとすぐ確認＋`献立を作る`。
- unit も同じ前提。
  - `planner-wizard.test.tsx` 301–333 行: audience の次へで確認、確認から戻る×4 で食事。Spec の追加ケース一覧に無い。
  - 同 509–536・558–576 行: idea/household の audience 次へ先が `5. 確認`。
  - 同 746–760 行: 確認の「戻る」で `4. 作る相手`。
- `e2e/fixtures/acceptance.ts` は wizard を歩かない（`seedGeneratedMenu` を history から再 export するだけ、16 行）。ここに skip を足しても full-journey は直らない。
- 「42箇所」は ts/tsx の非コメント出現に近いが、機械置換しても `次へ` の着地と `戻る` 回数は直らない。

成立条件:

1. Spec どおり fixture 4 本＋見出し置換だけ実装する → `menu-domain-pantry` / `generation-recovery` helpers / `full-journey` / mobile `answerAudienceAndReview` / wizard sequential unit が、確認を待って `5. 調理時間` でタイムアウトするか、戻る回数不足で落ちる。
2. キーボードテストに 4 ページを足しつつ旧「Tab → 次へ」を残す → 新ページに `次へ` が無くハング（I-2 と複合）。

必要な修正:

- audience→review を歩く **全** helper/spec を列挙する（少なくとも menu-domain-pantry の 2 helper、generation-recovery の 2 helper、full-journey 2 本、mobile `answerAudienceAndReview`、history の `seedGeneratedMenu` / `seedGeneratedIdeaMenu`、shopping、shots）。
- 確認からの「戻る」1回＝直前任意 step、meal までは **8回**（任意4 + 必須4）、という回数変更を必須にする。
- `clickWizardNext` は任意 step に使わない（`次へ` 不在）。skip helper か、指定なし click による自動遷移だけを使う。
- unit の sequential / idea 確定 / 「戻るで1つ前」も更新対象に入れる。`acceptance.ts` を歩く fixture として数えない。

### I-4: 「ラベルは `planner-labels.ts` の既存定数」は調理時間・予算について事実と違う

根拠:

- Spec 新 step: 「選択肢のラベルは `model/planner-labels.ts` の既存定数をそのまま使う」。
- live の `planner-labels.ts` にあるのは `ingredientPreferenceLabels` / `noveltyPreferenceLabels` と null 時「指定なし」（23–57 行）だけ。調理時間・予算の定数は無い。
- 正本は `review-step.tsx` のインライン options。
  - 調理時間: `""` / `"15"` / `"30"` / `"45"` → 「指定なし」「15分以内」「30分以内」「45分以内」（597–601 行）。値は number 15/30/45 へ写す（606–613 行）。
  - 予算: `""` / `"economy"` / `"standard"` → 「指定なし」「節約優先」「標準」（632–635 行）。
- 契約の許容値は `shared/contracts/planner.ts` 96–97・134–135 行（15|30|45 と `economy`|`standard`）。文言は contracts にも無い。

成立条件: 仕様どおり `planner-labels.ts` だけを見ると定数が無く、「15分」「節約」など別コピーを新設する。確認サマリ・E2E の role name と割れ、送信値が contracts の literal とずれる余地がある。

必要な修正:

- 調理時間・予算のラベル正本は `review-step.tsx` の options（と number 写し）と明記する。移すなら `planner-labels.ts` へ移す作業を Task に含める。
- 材料の使い方・雰囲気だけが既存定数、と書き分ける。
- `value: ""` → `null`、`"15"` → `15` の変換は親（`planner-wizard.tsx`）が現行 review と同じ写しを持つと固定する。

## 4. Minor

### M-1: field error の移設先が `buildReviewFieldErrors` / C-C2 まで落ちている

根拠: Spec は field error を各 step の `errorMessage` へ移し、`ReviewFieldErrors` は avoid/memo/pantry で残すと書く。live では `planner-wizard.tsx` 24–39 行の `buildReviewFieldErrors` が `timeLimitMinutes` / `budgetPreference` / `ingredientPreference` を ReviewStep にだけ渡し、`review-step.tsx` 383–385 行の `forceAdditionalOpen`（C-C2）もこの3つで details を強制展開する。`stepByField` を付け替えると `planner-route.tsx` 1786–1797・1878–1889 行が `firstInvalidStep` で新 step へ飛ばす。errorMessage 配線と ReviewFieldErrors からの削除、C-C2 条件の削除を仕様に列挙しないと、ジャンプ先にエラーが出ず details 強制展開だけが残る。UI が valid literal しか置けないので発火は稀。Plan 本文で3点を列挙すれば足りる。

### M-2: `accessibility.test.tsx` は見出し置換だけでは新 step を測れない

根拠: Spec は `planner-route-conflict.test.tsx` / `app/accessibility.test.tsx` の「`5. 確認` の見出し名を更新」だけ。live の axe 表は 5 step 固定で、primary を `次へ` または `献立を作る` と仮定する（`src/app/accessibility.test.tsx` 479–509 行、`step !== "meal"` なら「戻る」）。新4ページは `次へ` が無く、5ページ目だけスキップボタンがある。行を足さずに heading だけ替えると既存は通るが、新 step の axe / 44px 相当が unit で空になる。mobile 走査へ4ページを足す記述と、この it.each の primary 名（`戻る` とスキップ）を揃えて書く。

### M-3: 確認ヘルプの「確認に戻る」は追加条件 step では出ない

根拠: Spec は追加条件 step に `nextLabel`（「確認に戻る」）を渡さず `backLabel`（「やめる」）だけ渡す。確認画面の案内は「直したあとは『確認に戻る』でこの画面に戻ります。」のまま（`review-step.tsx` 558–561 行）。必須4問では今どおり正しい。追加4行の「変更」からは選択即復帰なので、案内を「選ぶと確認に戻ります」まで足すかは製品判断。実装は止めない。

## 5. 確認して問題なしとした点

- `plannerSteps` が UI・resume・focus の唯一の正（`planner-wizard.ts` 3–8 行）。audience と review の間へ4 id を挿す位置づけは現行コメントと合う。
- `firstIncompletePlannerStep` は必須4問だけを見て、揃えば `"review"`（44–53 行、テスト 81–83 行）。任意条件を見ないので、触らない判断は `?resume=review` と一致する。
- 不変契約 4b: `planner-route.tsx` 649–656・688–698 行は `resume==="review"` かつ `firstIncomplete==="review"` のときだけ step を review に固定。firstIncomplete を変えない限り深リンクは保たれる。
- `stepByField` は `timeLimitMinutes` / `budgetPreference` / `ingredientPreference` → `"review"`、avoid/memo/pantry も `"review"`（133–146 行）。付け替え対象と「残す3つ」の切り分けは正しい。
- `noveltyPreference` は `PlannerFieldName` に無い（16–28、109–122 行）。`mapPlannerIssuePathToField` の対象外。確認カードも `invalid={false}`（`review-step.tsx` 700 行）。「submission error 対象外なので stepByField に足さない」は真。
- `onEditStep` は `Exclude<PlannerStep, "review">`（`review-step.tsx` 223 行）。`PlannerStep` を増やすだけで 4 step を受け取れる。型追加は不要、という主張は正しい。
- 確認サマリ `dl` の「変更」＋ `aria-label` パターンは食事〜対象で既存（473–556 行）。4行追加の型はこれで足りる。
- `<details>追加条件` のデフォルト展開と C-C2 強制展開は 306–307・377–394・563–578 行に実在。選択式4つを抜いても avoid/memo/pantry 用に残す判断は現行と合う。
- 削除対象は `9cc64886` のカード選択そのもの。`ReviewChoiceField` 4呼び出し（588–718 行）と、同 commit が変えた radiogroup。select 時代ではない。
- idea 確定が編集戻りでも順送りでも review へ行く現状（`planner-wizard.tsx` 536–538 行、テスト 509–536 行）は Spec の現状認識どおり。順送りだけ `timeLimit` へ、は I-1 のフラグ順序を守れば既存編集戻りを維持できる。
- `returnToReviewAfterEdit` 中にスキップを出さない判断は、確認「変更」がフラグを true にする経路（585–587 行）と一致する。他条件を消さない理由は妥当。
- draft autosave は step ではなく field 写し（`use-draft-autosave.ts` 67–81 行に4任意キー済み）。step 追加だけでは flush/keepalive は壊れない。resume も firstIncomplete 依存なので任意 step の途中リロードは確認へ着地する（設計どおり）。
- 送信ペイロード・`shared/contracts`・Function を変えない非目標は、キーがすでに `plannerDraftInputSchema` / submission にあるので追加作業なしで成立する。
- 所有境界: 新ファイルは `src/features/planner/components/optional-choice-step.tsx`。`shared/safety` をブラウザへ入れる記述は無い。
- 必須4問は「次へ」のまま、避ける食材・自由メモ・冷蔵庫は確認の追加条件に残す、は製品判断として現行操作と矛盾しない（本レビューでは別案にしない）。
- `cuisine-step.tsx` の Surface / Inset / Stack / `h2 tabIndex={-1}` + mount focus（84–91 行）を踏襲する構造指定は、既存 wizard の heading focus 契約（accessibility.test 502–504 行）と合う。incomplete toast を持たない、も任意 step として正しい。
- 材料の使い方ヒント（`review-step.tsx` 687–689 行）を `description` で移す指定は、現行 accessible description（wizard テスト 980 行）を維持できる。
