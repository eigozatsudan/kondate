# 追加条件ウィザードstep化 設計 — 二次検証

- 日付: 2026-09-01
- 対象Spec: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md`
- 入力: 同日付の一次レビュー、敵対的レビュー
- 実施者: 両レビューと別スレッドの読み取り専用 Reviewer
- 判定: **REVISE — Critical 0、統合後の計画ブロッカーは Important 5 系統（audience の edit-return、自動遷移イベント、ダブルタップ誤選択、audience→review テスト網、ReviewChoiceField の値・ラベル正本）。骨格（firstIncomplete 非変更、`?resume=review`、避ける食材は確認に残す、ペイロード非変更）は現行実装と矛盾しない。**

## 1. 総合 Verdict

選択式4条件を `plannerSteps` の audience〜review 間へ挿し、`firstIncompletePlannerStep` と送信契約は触らない、という製品判断は live と整合する。安全評価・quota・RLS・アレルギー欄が消える Critical は再現しない。

設計どおり進めると次が起きる。Plan 前に Spec へ固定する。

1. household の audience「次へ」を `goToStep("timeLimit")` に差し替えると、確認の「対象を変更→確認に戻る」が調理時間へ落ちる。idea もフラグを読まず review 固定のまま置換すると同じ。
2. cuisine-step / `ReviewChoiceField` の radio `onChange` をコピーすると、既定「指定なし」では 6〜8 ページから前進できず、矢印キーではページが飛ぶ。
3. 自動遷移直後のダブルタップが次ページの同位置カードを誤選択する。E2E は遅いので偽 GREEN。
4. fixture 4 ファイル＋`"5. 確認"` 機械置換では、独自 helper / 戻る回数 / `clickWizardNext` 前提の E2E・unit が大量失敗する。
5. `value: ""` を draft に入れると Zod が落ち autosave が止まる。調理時間・予算のラベル正本は `planner-labels.ts` には無い。

一次の「setState(false) のあと state を読むと false」は React のクロージャでは不正確だが、欠陥そのもの（フラグを見ない `goToStep("timeLimit")`）は成立する。一次 I-2 の「click にすれば足りる」は Chromium の radio 矢印が click を合成し得るため不十分で、敵対的 I-02 のイベント表を正とする。

## 2. 再確認した事実

- `plannerSteps` は `["meal", "ingredients", "cuisine", "audience", "review"]`（`planner-wizard.ts` 7 行）。コメント 3–5 行が UI・resume・focus の唯一の正。`firstIncompletePlannerStep` は必須4問だけで、揃えば `"review"`（48–52 行、`planner-wizard.test.ts` 81–83 行）。任意4フィールドは見ない。
- `PlannerFieldName` に `noveltyPreference` は無い（16–28、109–122 行）。`stepByField` は `timeLimitMinutes` / `budgetPreference` / `ingredientPreference` / avoid / memo / pantry がすべて `"review"`（133–146 行）。
- `advanceFromEditOr` はフラグが立っていれば `returnToReviewIfQuestionsComplete`、否则 `goToStep(sequentialNext)`（258–264 行）。meal / ingredients / cuisine の `onNext` だけがこれを使う（421–422、448–449、477–478 行）。
- audience `onNext` は使わない。idea は await 成功後に `setReturnToReviewAfterEdit(false); goToStep("review")`（536–538 行）。household は先にフラグを落とし、`isAudienceComplete` ガードのあと `goToStep("review")`（542–548 行）。`editReturnActionLabels` は `nextLabel: "確認に戻る"` / `backLabel: "やめる"`（275–277 行）で audience へ spread（559 行）。
- 確認の「対象を変更」は `setReturnToReviewAfterEdit(true)` + `goToStep(target)`（585–587 行）。unit は household で「対象を変更→確認に戻る→`5. 確認`」を固定（`planner-wizard.test.tsx` 801–804 行）。idea の同経路 unit は無い。idea 確定の sequential は review 着地（509–536、616、647 行）。
- ウィザード末尾は `if (step === "audience")` のあと無条件で ReviewStep（566 行コメント `// review`）。未知 step でも確認が出る。
- review の `onBack` は `goToStep("audience")`（577–580 行）。
- cuisine-step の選択は native radio `onChange` のみ（106–108 行）。「次へ」は別ボタン（125–127 行）。`ReviewChoiceField` も同じ `onChange`（137–139 行）。先頭「指定なし」`value: ""`（97、597–598 行）。checked 済み radio の再クリックは `change` を発火しない。
- 調理時間の options と number 写しは `review-step.tsx` 597–614 行（`""` → `null`、`"15"` → `15`）。予算は 631–645 行。材料の使い方・雰囲気だけ `planner-labels.ts`（23–57 行）。調理時間・予算の定数は labels ファイルに無い。
- `timeLimitMinutes` は `15 | 30 | 45 | null`（`shared/contracts/planner.ts` 96、134 行）。`""` も `0` も拒否。`budgetPreference` / `ingredientPreference` / `noveltyPreference` も enum + nullable。
- autosave は `plannerDraftInputSchema.safeParse(toDraftInputFields)` が失敗すると persistable ではない（`use-draft-autosave.ts` 84–86 行）。audience 中立でも直せない不正フィールドは `IncompleteDraftSaveError`（506–518 行）。debounce の enqueue 失敗は `.catch(() => undefined)`（695 行）。Incomplete は toast にせず idle（40–49、642–646 行）。
- `?resume=review` は `resume === "review" && firstIncomplete === "review"` のときだけ確認へ固定（`planner-route.tsx` 651–656、695–696 行）。
- 生成前 `plannerSubmissionSchema.safeParse` 失敗は `firstInvalidStep` へ戻す（1784–1798 行）。`buildReviewFieldErrors` は time/budget/ingredientPreference を ReviewStep に渡す（`planner-wizard.tsx` 24–39 行）。C-C2 の `forceAdditionalOpen` もこの3つを含む（`review-step.tsx` 379–385 行）。
- `isSaving` は submit / 競合 / leave-flush 等。debounce autosave 中は載せない（1652–1664 行）。cuisine-step は radio も Button も `disabled`（103、121 行）。
- `onSaved` は query cache のみ。local `value` をサーバ行で置換しない（802–810 行）。
- `.wizard-option` は `min-height: 44px`（`styles.css` 208–211 行）。`.ui-btn` も 44px（2852–2855 行）。`.wizard-actions` は `flex-wrap`（699–704 行）。
- 確認ヘルプは「直したあとは『確認に戻る』でこの画面に戻ります。」（558–561 行）。見出し JSX は `5. 確認`（444 行、引用符なし）。
- `"5. 確認"`（ASCII 引用符）は ts/tsx で **42 件**。設計の「42箇所」と一致。JSX 見出しは集合外の 1 件。`clickWizardNext` は `name: "次へ"` 専用（`e2e/fixtures/history.ts` 41–42 行）。
- audience の次を確認だと思っている live 経路:
  - `history.ts` `seedGeneratedMenu` 237–238 行、`seedGeneratedIdeaMenu` 453–455・468 行
  - `shopping.ts` `generateShoppingMenu` 88–89 行
  - `shots/flows.ts` `advanceToReviewWithHousehold` 36–37 行
  - `acceptance.ts` は wizard を歩かず history から re-export するだけ（16 行）
  - `menu-domain-pantry.spec.ts` `savePlannerMeal` 77–80 行（戻る **4** 回で `1. 食事`）、119–120 行、`advanceToReviewWithHousehold` 145–146 行、263–264 行（戻る 1 回で `4. 作る相手`）
  - `generation-recovery-results.spec.ts` `completeIdeaPlannerToReview` 87–90 行、`completeMinimumPlanner` 141–142 行、キーボードテスト 1382–1383 行、**44px レイアウト** `fits 320px without horizontal scroll...` 1268–1272 行（両レビューの helper 列挙に無い）
  - `full-journey.spec.ts` household 71–73 行（確認で radiogroup「献立の雰囲気」を操作、84–87 行）、idea 315–336 行
  - `mobile-accessibility.spec.ts` `answerAudienceAndReview` 147–155 行（`次へ` のあと確認＋`献立を作る`）
- unit の sequential / 戻る×4 は `planner-wizard.test.tsx` 301–333、746–760 行。idea/household の audience 次へ先が `5. 確認`（509–536、574–576 行）。
- `accessibility.test.tsx` の axe 表は 5 step 固定、primary は `次へ` または `献立を作る`（479–509 行）。
- planner UI の safety import は `@shared/safety-pure/medical-scope` のみ（`review-step.tsx` 13 行、`planner-route.tsx` 13 行）。`@shared/safety` は無い。

## 3. 元指摘の二次判定

| 元ID | 判定 | 最終severity | 統合判断 |
| --- | --- | --- | --- |
| P-I-1 | Confirmed | Important | household を `goToStep("timeLimit")` にすると「対象を変更→確認に戻る」が調理時間へ落ちる。idea もフラグ未読のまま置換すると sequential も edit-return も壊れる。正本は complete ガードのあと `advanceFromEditOr("timeLimit")`。setState 後に同じクロージャの const を読むと false になる、という一次の機序説明だけ不正確。 |
| P-I-2 | Confirmed（機序は A-I-02 を正とする） | Important | 既定「指定なし」＋「次へなし」＋ `onChange` では 6〜8 ページから出られない。click だけでは Chromium の radio 矢印が click を合成し得る。 |
| P-I-3 | Confirmed | Important | fixture 4 本＋見出し置換では足りない。unit の sequential / 戻る回数も含む。`acceptance.ts` を歩く fixture に数えない判断は正しい。 |
| P-I-4 | Confirmed | Important | 調理時間・予算のラベルは `review-step.tsx` の inline options。`planner-labels.ts` には無い。`""` → `null` 写しは A-I-05 と同一根。 |
| P-M-1 | Confirmed | Minor | `buildReviewFieldErrors`・C-C2・各 step の `errorMessage` を列挙すれば足りる。UI が valid literal しか置けないので発火は稀。 |
| P-M-2 | Confirmed | Minor | axe 表に新4ページが無く、5ページ目の primary は「以降は指定なしでスキップ」。見出し置換だけでは新 step を測れない。 |
| P-M-3 | Duplicate | — | A-M-02 と同じ確認ヘルプ。 |
| A-I-01 | Duplicate | — | P-I-1 と同じ根。`advanceFromEditOr("timeLimit")` と idea の await 後呼び出しが実装手順として残る。 |
| A-I-02 | Confirmed | Important | 自動遷移はポインタ（mouse/touch/pen）と Space のみ。native `change` と矢印では `onNext` しない。既選択「指定なし」タップでも 1 回進む。P-I-2 より精密なのでイベント表の正本にする。 |
| A-I-03 | Confirmed | Important | 4ページとも同じ `.wizard-option` 座標。React commit 後の 2 発目（~300ms）が次ページの同位置に落ちる。E2E フルウォークは遅く偽緑。cooldown / pointer 抑制が Spec に無い。 |
| A-I-04 | Duplicate | — | P-I-3 と同じ根。E2E helper 列挙はこちらが詳しいのでリストは A-I-04 を採用し、unit と 44px レイアウトテストを足す。 |
| A-I-05 | Confirmed | Important | 親が `timeLimitMinutes: v` や `Number(v)` を書くと `""` / `0` で schema 失敗。Incomplete は黙って idle。現行 ReviewChoiceField の写しをリテラルで固定する。 |
| A-M-01 | Confirmed | Minor | スキップ Button にも `disabled={disabled}`。既存 step と同型。 |
| A-M-02 | Confirmed | Minor | 追加条件の「変更」は選択即復帰なので、案内を「選ぶと確認に戻ります」へ足すかは製品判断。 |
| A-M-03 | Confirmed | Minor | `plannerSteps` に足した直後、分岐前は `timeLimit` でも確認が出る。exhaustive か未知 step throw を推奨。 |
| A-M-04 | Confirmed | Minor | 既選択の非デフォルト（15分）再タップは A-I-02 のイベント表に 1 行足せば足りる。 |

## 4. 二次が新たに足す指摘（あれば）

計画を止める Important 以上の新規 ID は無い。両レビューが挙げた根の外側で、実装が黙って壊れる経路は確認できなかった。

I-04 の列挙漏れ（同一系統、別 ID にしない）:

- `generation-recovery-results.spec.ts` の `fits 320px without horizontal scroll and keeps multi-step 44px action targets`（1268–1272 行）も audience の次を確認だと思っている。キーボードテストとは別。
- idea sequential unit（`planner-wizard.test.tsx` 509–536、616、647 行）は確定後 `5. 確認`。設計どおり順送りを `timeLimit` にするとこのままだと赤。
- 新 step の radiogroup 名: 現行確認は `献立全体の調理時間`（`review-step.tsx` 590 行、wizard テスト 741・916 行）。cuisine-step 踏襲なら名は heading `5. 調理時間` 側。Spec に「確認の radiogroup 名を再利用しない」と一文あるとテストが割れない。

## 5. 偽陽性・重複

- **A-I-01 = P-I-1**: audience の edit-return。残すのは P-I-1。実装手順は A-I-01 の `advanceFromEditOr`。
- **A-I-04 = P-I-3**: テスト網。残すのは P-I-3。helper リストは A-I-04 ＋ §4 の 44px テスト。
- **P-I-4 の変換部分 = A-I-05**: `""` → `null`。ラベル正本は同じ ReviewChoiceField を正とするため §6 で一括。
- **P-M-3 = A-M-02**: 確認ヘルプ。
- **スキップが編集戻り中に出る / avoid を消す / 1条件変更で他3条件が消える**: 設計の明示（`onSkipRest` は timeLimit のみ、編集中は渡さない、対象4フィールド列挙）。household が誤って timeLimit へ来たときだけ P-I-1 経由で露出する。
- **`firstIncomplete` 非変更で resume が review 以外**: 必須4問が揃えば今も `"review"`。任意値はフィールドとして残る（step 名は persist しない、`toDraftInputFields` 66–81 行）。
- **`?resume=review` 破壊**: firstIncomplete を触らなければ 4b は保つ。
- **`noveltyPreference` が PlannerFieldName にある**: 無い。主張は正しい。
- **自動遷移が必須4問に漏れる**: 設計が「新しい追加条件のページだけ」と非目標で食事〜対象を変えないと書いてある。cuisine-step 本体を改変しなければ漏れない。
- **320px / 44px 不足**: 既存 `.wizard-option` / `.ui-btn` が 44px。長いスキップは wrap。
- **スキップ後の値復活**: `onSaved` は cache のみ。追記ループは latest に収束。
- **「5.」の誤置換**: 一致は `"5. 確認"` 42 件。`15分` は含まない。JSX 見出しは実装本体。
- **`@shared/safety` 境界越え / contracts・Function 変更 / step 名の persistence 漏れ**: 設計非目標どおり。現行 planner UI は safety-pure のみ。
- **nextLabel 非渡しで確認に戻れない**: 編集戻りは選択で `advanceFromEditOr`、戻るは `やめる`。どちらも `returnToReviewIfQuestionsComplete`。
- **一次の「setState(false) のあと読むと false」**: 同一クロージャの state const は setState しても変わらない。失敗条件はフラグ分岐を書かずに `goToStep("timeLimit")` へ置換すること。指摘自体は Confirmed。

## 6. Plan 前に Spec へ書くべきこと（統合リスト）

1. **audience `onNext`**: household は `isAudienceComplete` ガードのあと **`advanceFromEditOr("timeLimit")`**。`goToStep("timeLimit")` 禁止。idea は await 成功後に同じ helper（編集戻り→review、順送り→timeLimit）。フラグを落とすのは helper 内の `returnToReviewIfQuestionsComplete` に任せる。unit「対象を変更→確認に戻る→`9. 確認`（`5. 調理時間` ではない）」を household **と idea** の両方で必須回帰にする。
2. **自動遷移イベント**: native radio `onChange` / 矢印キーでは `onNext` しない。発火はポインタ（mouse/touch/pen）の click と Space のみ。既選択の「指定なし」でも `onSelect` + `onNext` が 1 回。DOM に「次へ」が無いこと、`onSkipRest` 無しページにスキップが無いこと。既選択の非デフォルト（15分）再タップも同じ表で進む／留まると書く。
3. **ダブルタップ**: ページ遷移後 300–400ms は選択肢の pointer を無視する、または `onNext` を pointerup 後に遅らせる。unit「選択直後の 2 回目 click では次 step の onSelect が走らない」を必須。E2E フルウォークでは足りない。
4. **値とラベルの正本は現行 `ReviewChoiceField`**: 親が `""` → 各フィールド `null`、`"15"|"30"|"45"` → number literal。`Number("")` 禁止。`onSkipRest` は `{ ...draft, timeLimitMinutes: null, budgetPreference: null, ingredientPreference: null, noveltyPreference: null }` をリテラルで書く（avoid / memo / pantry / 必須質問は残す）。調理時間・予算の文言は review-step 597–601・632–635 行（「指定なし」「15分以内」「節約優先」）。材料の使い方・雰囲気だけ `planner-labels.ts`。unit「指定なし選択後の draft は `null` であり `""` ではない」「その状態で `plannerDraftInputSchema.safeParse` が成功する」。
5. **テスト網**: `skipOptionalPlannerSteps` を audience→review の全 helper から呼ぶ。少なくとも `seedGeneratedMenu` / `seedGeneratedIdeaMenu` / `generateShoppingMenu` / `shots/flows.ts` の `advanceToReviewWithHousehold` / `menu-domain-pantry` の `advanceToReviewWithHousehold` と `savePlannerMeal` / `completeIdeaPlannerToReview` / `completeMinimumPlanner` / `answerAudienceAndReview` / `full-journey` の household と idea / キーボードテスト / **44px レイアウトテスト**。`acceptance.ts` は re-export のみなので数えない。`clickWizardNext` は任意 step に使わない。確認からの戻る 1 回＝ `8. 献立の雰囲気`、meal までは **8 回**（または確認の「食事を変更」）。`"5. 確認"` 42 件の機械置換は見出しアサーションであり、戻る回数・`次へ` 前提は別作業。unit の sequential / idea 確定着地 / 「戻るで1つ前」も更新対象。`full-journey` の「ひねりたい」は 8 ページ目（household）。idea 側もスキップか 4 ページ歩きかを明示する。
6. **Minor（Plan 本文で足りる）**: スキップにも `disabled`。field error を各 step の `errorMessage` へ移し、`buildReviewFieldErrors` と C-C2 から time/budget/ingredientPreference を外す。axe 表に新4ページ（5ページ目 primary はスキップボタン、他は `戻る` のみ）。確認ヘルプを追加条件の選択即復帰に合わせて更新するか判断を書く。wizard の最終枝を exhaustive にする。新 step の radiogroup 名は heading 側（「献立全体の調理時間」を再利用しない）。

変更しないもの: `firstIncompletePlannerStep`、`?resume=review`（不変契約 4b）、避ける食材・自由メモ・冷蔵庫のページ化、必須4問の「次へ」、送信ペイロード / `shared/contracts` / Function、`noveltyPreference` を `PlannerFieldName` に足さない、編集戻り中はスキップ非表示。
