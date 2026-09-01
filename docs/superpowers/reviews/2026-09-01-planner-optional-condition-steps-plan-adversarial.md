# 追加条件ウィザードstep化 Implementation Plan — 敵対的レビュー

- 日付: 2026-09-01
- 対象: plan @ `34f5e2d3`（`docs/superpowers/plans/2026-09-01-planner-optional-condition-steps.md`）
- Spec: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md`
- 姿勢: spec の骨格は再開しない。**計画のコード・コマンド・Interfaces を壊す。**
- 判定: **REVISE**

## §1 Verdict

計画は P-01 / P-02 / D-03 擬似コード / `key={step}` / skip 9 行 / pantry「確認に戻る」 / `firstIncomplete` 非変更の骨格は spec と live に揃っている。しかし **Task 3 の「期待 PASS」コマンドが、計画どおりにコピペすると非ゼロで終わる**。原因は (1) 追加条件 4 テストは Task 3 時点ではまだ緑なのに「赤のままでよい」と書いてあること、(2) 同じファイルの idea 到達・保存失敗など **未列挙の `"5. 確認"` 正アサーションが見出し差し替えで赤になる**こと、(3) 新規テストが live に無い helper / `latestDraft` を呼ぶこと。加えて Task 4 の axe 行に `step` が無く、Task 5 の idea ジャーニー差し込み手順が privacy 復帰行と衝突し、Task 6 の E2E が spec の `.wizard-option` ではなく radio `.click()` を固定する。Critical（閉じ込め・contracts・`firstIncomplete` 破壊）は計画本文からは出ていない。**Task 3 の検証コマンドと未列挙テスト更新を直すまで APPROVE できない。**

## §2 攻撃シナリオ（A-1…）

### A-1. Task 1: 新規テストが `buildPlannerSubmissionFieldErrors` を import していない

- Plan: 49–51「既存 import はそのまま使う。`plannerSteps` が未 import なら import 文へ足す」。53–91 のコードは `buildPlannerSubmissionFieldErrors` を呼ぶ。
- Spec: 51–59（`stepByField` 付け替えと field error の行先）。
- Live: `src/features/planner/model/planner-wizard.test.ts:3–9` は `firstIncompletePlannerStep` 等だけ。`buildPlannerSubmissionFieldErrors` も `plannerSteps` も未 import。同関数の既存テストは `src/features/planner/components/planner-wizard.test.tsx:2344–2371` 側。
- 失敗経路: Step 1 コードをそのまま貼ると TS2304。計画が import 追加を書いたのは `plannerSteps` だけ。
- 判定: **Important**

### A-2. Task 1: `firstIncompletePlannerStep` を触ると既存テストが止める（計画は壊していない）

- Plan: 132「`firstIncompletePlannerStep` は**変更しない**」。新規テストは配列と `firstInvalidStep` だけ。
- Spec: 45–48。
- Live: `planner-wizard.ts:44–52` は必須 4 問のあと無条件 `"review"`。`planner-wizard.test.ts:16–30` の `completeQuestionAnswers` は任意 4 フィールドが `null`。同 81–83 / 85–94 / 99–105 が `"review"` を固定。
- 失敗経路: 実装者が「任意 step も incomplete」と足すと Task 1 Step 4 が既存テストで赤。計画どおり触れなければ緑。新規 RED は `firstIncomplete` 非変更を主張しない。
- 判定: **Closed**（既存テストが契約を守る。計画の穴ではない）

### A-3. Task 1: `plannerSteps` を iterate する既存テストは無い

- Plan: 103–121 で配列を差し替え。
- Spec: 42–44。
- Live: `plannerSteps` の参照は定義（`planner-wizard.ts:7–8`）と `planner-wizard.tsx:8,241,258,267` の引数型だけ。テスト側の列挙・length===5 主張は無い。
- 失敗経路: Task 1 単独で他ファイルの vitest が配列 iterate で落ちる経路は無い。
- 判定: **Closed**

### A-4. Task 1: `stepByField` は 3 フィールドだけ。`noveltyPreference` を足すと型が落ちる

- Plan: 124–130 の 3 行だけ。Global Constraints 30 行「`noveltyPreference` を `PlannerFieldName` に足さない」。
- Spec: 51–57。
- Live: `PlannerFieldName`（`planner-wizard.ts:16–28`）に `noveltyPreference` は無い。`stepByField` は `Record<PlannerFieldName, PlannerStep>`（133–146）。
- 失敗経路: 4 条件すべてを map したくなる実装者は `noveltyPreference: "novelty"` を足して TS エラー。計画は足させない。
- 判定: **Closed**

### A-5. Task 2: `event.isPrimary` ロックと Files 外 polyfill

- Plan: 163–164 / 481–486 が `event.button === 0 && event.isPrimary`。543 行は pointerup が 0 回なら受け口を変えるな、jsdom の `PointerEvent` を確認せよ。Files は `optional-choice-step.tsx` とテストだけ（154–156）。
- Spec: 113–116、163–165。
- Live: `src/test/setup.ts` に PointerEvent polyfillは無い。本リポジトリに `onPointerUp` / `isPrimary` の既存テストも無い。
- 失敗経路: userEvent の pointerup で `isPrimary` が falsy なら活性化テストは全部 0 回。計画は受け口変更を禁止し、setup polyfillは Task 2 Files に無い。実装者は禁止された分岐か範囲外ファイルの発明を強いられる。
- 未検証: この環境では `node_modules` を読めず、jsdom / user-event が `isPrimary: true` を付けるかは確認していない。事実主張ではなく計画の逃げ道の欠落。
- 判定: **Important**

### A-6. Task 2: 矢印キーテストが native `change` に依存する

- Plan: 292–301 `user.keyboard("{ArrowDown}")` で `onSelect` 1 / `onNext` 0。実装 454–458 は `handleChange` のみ（Arrow 専用ハンドラ無し）。
- Spec: 104、184–190。
- Live: radio group の Arrow を jsdom で踏むテストは無い。既存 Arrow は `menu-result.tsx:184` 等の自前 `onKeyDown` だけ。
- 失敗経路: jsdom が radio group の Arrow で `change` を出さなければ `onSelect` 0 で赤。実装に Arrow ハンドラを足すのは spec のイベント表に無い。`fireEvent.change` に逃げると「矢印キー由来」を測っていない。
- 未検証: jsdom 27 の radio Arrow 動作は実行していない。
- 判定: **Important**

### A-7. Task 2: 12 テスト対 spec の unit 列。スキップは 350ms の外

- Plan: 238–347 が 12 `test`。実装 518–526 のスキップは `onClick={onSkipRest}` で `blocked()` を見ない。341–347 は fake timer 無しで即 click。
- Spec: 339–353（指定なし既定、経路表、次へ不在、D-02 2 段、mutex 非セット、`onSkipRest` 未指定なら非表示）。211 行「戻るとスキップはこのガードの対象外」。
- Live: 新ファイル。
- 失敗経路: 列は spec の必須を覆う。正のスキップ click は spec 必須ではないが、350ms 内に押しても実装が `blocked()` を見ないので緑。既選択 Space の単独行は欠けるが、未選択 Space が mutex の本線。
- 判定: **Closed**

### A-8. Task 2: `passActivationGuard` は `Date.now()` と対になる

- Plan: 228–232 `vi.setSystemTime(Date.now() + 400)`。実装 429 / 445 が `mountedAt = Date.now()` と `Date.now() - mountedAt.current < 350`。
- Spec: 139–144、208–210。
- Live: 同ファイルの既存 fake timer 使用（例 `planner-wizard.test.tsx:1548–1590`）は `advanceTimersByTime`。`Date.now()` ガードは新規。
- 失敗経路: `useFakeTimers()` が Date を mock する前提なら `setSystemTime` は正しい。`toFake` から Date を外す実装に変えるとガードが外れない／常時外れる。計画は default `useFakeTimers({ shouldAdvanceTime: true })`。
- 判定: **Closed**（Date を外す指示は無い）

### A-9. Task 2: `name={id}` は擬似コードに無いが radiogroup に必要

- Plan: 489–490 `name={id}`。
- Spec: 166–175 の擬似コードに `name` 無し。68 行は cuisine-step 踏襲。cuisine-step は `name="genre"`（`cuisine-step.tsx:102`）。裁定 Minor 2 が `name` 追加を要求。
- 失敗経路: `name` 無しだと Arrow / Tab が group にならない。計画が足しているのは spec 違反ではなく裁定どおり。
- 判定: **Closed**

### A-10. Task 3: 「追加条件 4 テスト以外は PASS」コマンドが非ゼロになる

- Plan: 707–708「このタスクでは触らない（Task 4 まで赤のままでよい／`describe.skip` にはしない）」。716–718 と 970–975 はファイル全体を `--run src/features/planner/components/planner-wizard.test.tsx`。期待は「追加条件系4テスト以外は PASS」。
- Spec: 369「既存の『追加条件』系4テストは確認サマリの検証へ書き換え」（Task 4 の仕事）。
- Live 追加条件 4 本（Task 3 ではカードが残るので**緑のまま**）:
  - `planner-wizard.test.tsx:717–744` 任意条件を開き `radiogroup[name="献立全体の調理時間"]`
  - `:893–932` 縦積み構造
  - `:934–981` 材料の使い方
  - `:983–1018` 献立の雰囲気
- Live が Task 3 の見出し差し替え（724–728 / 3-a）で**正アサーション赤**になる未列挙:
  - `:536` idea confirm 成功後 `"5. 確認"`
  - `:576` household の audience 次へ `"5. 確認"`
  - `:616` / `:647` 同
  - `:1543` 「保存失敗時は現在stepを維持する」
  - sequential `:323` は 704 行で更新指示あり
- 失敗経路: vitest は 1 本でも失敗すると exit 1。追加条件 4 本は Task 3 では落ちない。落ちるのは未列挙の `"5. 確認"`。`describe.skip` 禁止のままファイル全体を回すと Step 4 の「期待 PASS」は成立しない。`--testNamePattern` も書いていない。
- 判定: **Important**

### A-11. Task 3: 見出し `9. 確認` を Task 3 で入れるのに、更新リストが足りない

- Plan: 559 / 724–728 が `review-step.tsx:444` を `9. 確認` に。702–706 が sequential `:301–333`、編集戻り `:801–804`、戻る `:746–764` だけを列挙。
- Spec: 29 / 61 見出し延長。
- Live: `planner-wizard.test.tsx` の `"5. 確認"` 正アサーションは 323, 536, 576, 616, 647, 764, 773, 794, 799, 804, 1543。`queryByRole` の不在主張（555, 712, 828, 854）は見出しが `9. 確認` でも緑。
- 失敗経路: 列挙どおりだけ直すと idea describe（`:509–713`）と `:1543` が赤。A-10 と同じコマンドを殺す。
- 判定: **Important**（A-10 の内訳。別番号にして更新漏れを固定する）

### A-12. Task 3: 新規テストの helper 名と `latestDraft` が live に無い

- Plan: 591–603 `renderWizardAtAudienceForHousehold` / `ForIdea`。608 `renderWizardAtTimeLimit` が `{ latestDraft }` を返す。669 / 677 `renderWizardAtReviewFor*`。コメントは「既存 helper に合わせる」。
- Spec: 354–362（wizard 単位の到達と draft 断言）。
- Live: helper 名は存在しない。あるのは `Harness`（`planner-wizard.test.tsx:51–158`）。`useState` の `draft` は返さない。`reviewDraft`（160–167）と `initialStep="audience"|"review"` だけ。
- 失敗経路: コードブロックを貼ると TS2304。`latestDraft` 無しでは、Task 3 時点の確認画面はまだカード UI なので draft の `null` vs `""`（630–638）を DOM から確定できない。Harness 拡張は計画 Step 3 に書いていない。
- 判定: **Important**

### A-13. Task 3: sequential の「4ページ歩き + 戻る×8」に 350ms が無い

- Plan: 704「`5. 調理時間` を期待し、そこから4ページを歩いて `9. 確認` へ。戻る×8」。570–575 の `passActivationGuard` は新規テスト用で、sequential 更新文には出てこない。
- Spec: 208–219、363–364。
- Live: `:301–333` は audience 次へ → `"5. 確認"` → 戻る×4。`meal-step` に戻るボタンは無い（a11y 表 `step !== "meal"`）。
- 失敗経路: ガード無しでカードを click すると 350ms で握り潰され 6 ページ目に行けない。確認まで行かず `5. 調理時間` から戻る×8 すると meal を超えてボタンが無い。計画の「歩け」と「ガードを使え」が同じテストに同時に書いていない。
- 判定: **Important**

### A-14. Task 3: P-01 の incomplete audience は `advanceFromEditOr` を通さない

- Plan: 770–777 は incomplete なら `goToStep(firstIncompletePlannerStep(...))`、complete だけ `advanceFromEditOr("timeLimit")`。`setReturnToReviewAfterEdit(false)` を先に置く現行（`planner-wizard.tsx:542–548`）は消える。
- Spec: 302–309。裁定 Minor 6「incomplete 時は `advanceFromEditOr` 経由で `firstIncomplete` に留まり、フラグは `returnToReviewIfQuestionsComplete` が落とす」。
- Live: 現行は必ず `setReturnToReviewAfterEdit(false)` してから incomplete 分岐。P2 テスト（`:807–829`）は「やめる」経路で、`確認に戻る` + incomplete は無い。
- 失敗経路: 本線の complete audience → `timeLimit` は `advanceFromEditOr` で正しい。incomplete を `goToStep` 直呼びにすると編集戻りフラグが残り、ラベルが「確認に戻る」のまま audience に留まる。裁定 Minor 6 の一文にはならないが、既存テストは「やめる」なので本線は緑。
- 判定: **Minor**

### A-15. Task 3: `nextLabel` 非伝播 / `key={step}` / exhaustive `never`

- Plan: 740–742 `optionalStepBackLabel` は `backLabel` のみ。788 / 831 / 869 / 917 `key={step}`。950–956 `if (step === "review")` + `never`。
- Spec: 193–195、314–318。
- Live: 現行最終分岐はコメント `// review` + 無条件 `return`（`planner-wizard.tsx:566–617`）。`editReturnActionLabels` は `nextLabel`+`backLabel`（275–278）。
- 失敗経路: 計画どおりなら `nextLabel` は任意 step に流れない。`key` 無しは mutex 持ち越しで 6–8 ページ閉じ込め（spec が既に警告）。3-f を忘れると `never` が `review` で落ちる。指示は揃っている。
- 判定: **Closed**

### A-16. Task 3 typecheck: `ReviewFieldErrors` 余剰フィールドと未削除 `ReviewChoiceField`

- Plan: 972 typecheck PASS。`ReviewFieldErrors` 縮小は Task 4（1068–1074）。
- Spec: 332–334。
- Live: `review-step.tsx:149–158` は 6 フィールド。`ReviewChoiceField` は `:588–718` で使用中。wizard の任意 step は `fieldErrors.timeLimitMinutes` 等を `PlannerFieldName` マップから渡す（計画 814）。
- 失敗経路: 余剰キーは代入側を壊さない。`ReviewChoiceField` は Task 3 ではまだ使う。typecheck はここでは落ちない。
- 判定: **Closed**（「Task 3 の typecheck が余剰フィールドで赤」は偽）

### A-17. Task 4: axe 行に `step` が無い。parenthetical の「歩いて到達」は `renderWizard` と両立しない

- Plan: 1204–1211 のオブジェクトは `heading` / `primary` だけ。1211「新4ページへは audience の『次へ』のあと、各ページで 350ms ガードを跨いでカードを click して到達する」。1202「既存行のプロパティ名…はファイル内の実際の形に合わせる」。
- Spec: 370–372。
- Live: `src/app/accessibility.test.tsx:479–510` の `it.each` は `step` / `heading` / `primary` / 任意 `draft`。`renderWizard`（231–260）は `onStepChange={vi.fn()}` で step が動かない。
- 失敗経路: コードブロックをそのまま足すと `step` が undefined。`renderWizard(undefined, …)` は実行時死。parenthetical どおり歩くと step が変わらず 6 ページ目に着けない。正しいのは `step: "timeLimit" as const` 等を足して直 render。計画は「合わせる」と歩き指示を同時に書く。
- 判定: **Important**

### A-18. Task 4: `ReviewChoiceField` 削除と `ReviewFieldErrors` 3 フィールド、C-C2

- Plan: 1061–1087 が関数・型・4 呼び出し・3 つの field error 段落・hint・`forceAdditionalOpen` から 3 条件を削除。1186–1199 が `buildReviewFieldErrors` を 3 キーに。4-f が未使用 import。
- Spec: 322–334。
- Live: `review-step.tsx:88–147` 定義、`:149–158` 型、`:377–389` `forceAdditionalOpen`（C-C2 コメント 377）、`:588–718` 4 呼び出し。wizard `buildReviewFieldErrors` 24–39。hint 文言は 687–689。
- 失敗経路: 4-a/4-c/4-g を同時にやれば型は閉じる。呼び出しだけ消して型を残す、または逆、だと `exactOptionalPropertyTypes` で赤。計画は同時にやれと書いている。
- 判定: **Closed**（手順を分割実行したときだけ赤。本文は同時）

### A-19. Task 4: 確認ヘルプが任意 step を書き分けない

- Plan: 1176–1182 単文「直したあとは、選び直すか『確認に戻る』でこの画面に戻ります。」
- Spec: 335。裁定 Minor 3「任意 step は『選ぶと確認に戻る』と書き分ける」。
- Live: `review-step.tsx:558–561` は現行 5 ページ用の「確認に戻る」単文。
- 失敗経路: 任意 step に「確認に戻る」ボタンは無い（計画 179 `nextLabel` 不在）。ヘルプが嘘になる。本線テストは落ちない。
- 判定: **Minor**

### A-20. Task 4: サマリ 4 行の options / 変更ボタン

- Plan: 1091–1173。`onEditStep("timeLimit"|"budget"|"ingredientPreference"|"novelty")`。
- Spec: 324–326。Live `onEditStep?: (step: Exclude<PlannerStep, "review">)`（`review-step.tsx:223`）。Task 1 後の union に 4 step が含まれる。
- 失敗経路: Task 1 済みなら型は通る。`getAllByText("指定なし")` length 4（1021–1029）は review 上に他の「指定なし」が無ければ緑。
- 判定: **Closed**

### A-21. Task 5: skip helper 9 行は spec 表の skip 行と一致する

- Plan: 1271–1281 の 9 単位。
- Spec: 386–401。skip は seedGeneratedMenu / seedGeneratedIdeaMenu / generateShoppingMenu / shots `advanceToReviewWithHousehold` / full-journey idea / pantry `savePlannerMeal` / pantry `advanceToReviewWithHousehold` / `completeIdeaPlannerToReview` / `completeMinimumPlanner`。歩き/Space 4 行は Task 6。
- Live 行番号は表と一致（`history.ts:238,455`、`shopping.ts:89`、`shots/flows.ts:37`、`full-journey.spec.ts:315`、`menu-domain-pantry.spec.ts:120,146`、`generation-recovery-results.spec.ts:90,142`）。
- 判定: **Closed**

### A-22. Task 5: `ensurePlannerReady` は walker ではない

- Plan: 1283–1284。
- Spec: 403–404。
- Live: `e2e/fixtures/shopping.ts:40–67` は設定のあと `openWizardFromHome` + 朝食 radio 可視で止まる。audience 次へも `5. 確認` も無い。
- 失敗経路: ここに skip を足しても呼ばれない。計画は触るなと書いてある。
- 判定: **Closed**

### A-23. Task 5: pantry インラインは live の「戻る + clickWizardNext」を「対象を変更 → 確認に戻る」へ書き換える

- Plan: 1298–1306。
- Spec: 408–414。裁定 Closed。
- Live: `menu-domain-pantry.spec.ts:263–278` は review から `戻る` → `4. 作る相手` → `clickWizardNext` → `5. 確認`。Task 3 の review `onBack` を `novelty` に変えたあと、戻る 1 回は `8. 献立の雰囲気`（計画 958–965）。この書き換えを怠ると `4. 作る相手` が見つからない。計画は書き換え本文を持っている。
- 判定: **Closed**（計画が live の旧経路を正しく捨てている）

### A-24. Task 5: 戻る×8 は 9 ページ構成の距離と一致する

- Plan: 1290–1297。
- Spec: 429–431。
- Live: `menu-domain-pantry.spec.ts:77–80` は×4。review→novelty→ingredientPreference→budget→timeLimit→audience→cuisine→ingredients→meal で 8 回。
- 判定: **Closed**

### A-25. Task 5: idea ジャーニー `:315` の次に skip を「5. 確認置換」手順で入れると privacy 行を壊す

- Plan: 1267–1269「audience の `clickWizardNext` の直後にある `5. 確認` を `skipOptionalPlannerSteps` に置き換える」。表 1276 は idea `:315` の次が skip。1311 / spec 419–426 は `full-journey.spec.ts:336` を privacy 復帰・置換のみ。
- Spec: 394 idea は skip。336 は privacy。
- Live: `full-journey.spec.ts:315` は `clickWizardNext`。直後は `5. 確認` ではなく `:317`「家族の年齢・アレルギーは確認されません」（review の idea 注意）。`:336` が privacy 復帰の `"5. 確認"`。
- 失敗経路: Step 2 の機械置換だけだと 315 の次に skip が入らず、idea 注意文が `5. 調理時間` で見つからず赤。逆に 336 を skip helper にすると `resume=review` 後に `5. 調理時間` を待って死ぬ（helper 1258 が調理時間見出し必須）。表と機械手順が矛盾する。
- 判定: **Important**

### A-26. Task 5: `grep --include=*.ts` は src の `.tsx` 見出しを見ない

- Plan: 1313–1318 `grep -rn '"5\. 確認"' --include=*.ts e2e src` 期待空。
- Spec: 479 `"5. 確認"` 42 件。
- Live: e2e は `.ts`。src の残りは `.tsx`（`planner-wizard.test.tsx`、`review-step.tsx`、`accessibility.test.tsx`、`planner-route-conflict.test.tsx`）。
- 失敗経路: Task 3 の未更新 `"5. 確認"` が tsx に残っても grep は空。Task 5 の「機械置換完了」は e2e しか保証しない。
- 判定: **Minor**

### A-27. Task 5: `git add e2e src` と E2E 未実行

- Plan: 1325 `git add e2e src`。1328「E2E の実行は Task 6」。
- 失敗経路: 無関係な src dirty を巻き込む（広すぎる add）。歩き 4 行はまだ赤のままコミットされるが、計画は E2E を回すなと明示。
- 判定: **Minor**（broad add）/ E2E 延期は **Closed**

### A-28. Task 6: household / mobile / 44px が radio `.click()` / `.focus()` で、spec の `.wizard-option` ではない

- Plan: 1357–1369 `getByRole("radio", { name: "15分以内" }).click()` 等。1384–1399 指定なし radio `.click()`。1416–1425 radio `.focus()` + `activateFocusedWithKeyboard(page, "Space")`。1348 は `.check()` 禁止。
- Spec: 342–345 unit は **label `.wizard-option`**（input 直 click は pointerup 受け口を通らない）。448 E2E「前進はカード（`.wizard-option`）の click か radio の Space」。415–417 / 449–450 は `.check()` no-op。472–478 の 44px は radio `.focus()` + Space（裁定 Closed）。
- Live: 現行 E2E は必須質問で radio `.check()`（`full-journey.spec.ts:53` 等）。新 step の受け口は label `onPointerUp`（計画 481–486）。
- 失敗経路: `.check()` を使わない点は spec どおり。未選択 radio の `.click()` は input が target。pointerup が label までバブルして React `onPointerUp` が走れば緑。走らなければ `handleChange` だけが値を書き **ページが進まない**（指定なし再 click は `change` 自体が出ないので特に閉じ込め）。unit 計画は同じ理由で input click を禁止している。Playwright のバブルは本レビューでブラウザ検証していない。
- 判定: **Important**（spec 本文とコードブロックの locator 不一致。閉じ込めは未検証の条件付き）

### A-29. Task 6: household の `p_novelty_preference: twist` 待ちを消す指示が無い

- Plan: 1352–1374「確認画面で『ひねりたい』を選んでいた箇所があれば削除」。4 ページ歩きで 8 ページ目に click。
- Spec: 454–456。
- Live: `full-journey.spec.ts:77–88` は review の radiogroup 操作を `waitForResponse`（`"p_novelty_preference":"twist"`）で同期してから生成。
- 失敗経路: 確認の `.check()` だけ消して wait を 8 ページ目に移さないと、autosave debounce（600ms、`generation-recovery-results.spec.ts:73–75` コメント）前に生成し、twist 未保存のまま進む。フレークまたは generaton 条件退行。
- 判定: **Important**

### A-30. Task 6: キーボード `tabUntil(指定なし)` と 44px `activateFocusedWithKeyboard(..., "Space")`

- Plan: 1437–1448 は heading `toBeFocused` → 350ms → `tabUntil` radio 指定なし → Space。1410–1426 は heading visible → 測る対象は skip/戻る → 350ms → radio `.focus()` + `activateFocusedWithKeyboard(page, "Space")`。
- Spec: 458–467、472–478。裁定 I-2 Minor（先頭は既チェックの指定なし。Tab はチェック済みだけ）。
- Live: `activateFocusedWithKeyboard` 第 2 引数 `"Space" | "Enter" = "Enter"`（`generation-recovery-results.spec.ts:1127–1131`）。`tabUntil` 引数順は page / match / label / maxTabs（1193–1197）。`expectMajorActionAtLeast44` は button 専用（1103–1107）。
- 失敗経路: 指定なし固定は裁定どおり緑。helper 署名は live と一致。`次へ` を測る／Tab するなも書いてある。
- 判定: **Closed**

### A-31. Task 6: `./scripts/run-e2e.sh` を人間端末へ

- Plan: 1453–1458。
- Live: `CLAUDE.md` の e2e 方針と同じ。`app` コンテナから `npm run e2e` は Docker socket 無し。
- 判定: **Closed**

### A-32. 横断: Interfaces 名は Task 2→3 で一致。`nextLabel` は無い

- Plan: 161–179 / 1496。
- 失敗経路: props 名の食い違いは無い。
- 判定: **Closed**

## §3 Important / Critical

Critical: **0**。`firstIncomplete` 非変更、contracts 非変更、`key={step}`、350ms 中の `handleChange` 無視、skip 非ガードは計画本文にある。radio `.click()` 閉じ込めは Playwright 未検証のため Critical に上げない。

Important（本線が赤、または禁止された発明を強いられる）:

1. **A-10 / A-11** Task 3 のファイル全体 vitest が、未列挙 `"5. 確認"`（idea `:536/:576/:616/:647`、保存失敗 `:1543`）で exit 1。追加条件 4 本は Task 3 では緑。`describe.skip` 禁止。
2. **A-12** 新規テストが live に無い helper と `latestDraft` を要求する。
3. **A-13** sequential 更新が 350ms 無しの 4 ページ歩きと戻る×8 を同時に書く。
4. **A-1** Task 1 テストが `buildPlannerSubmissionFieldErrors` の import 指示を欠く。
5. **A-5 / A-6** Task 2 が受け口変更禁止のまま jsdom pointer `isPrimary` / radio Arrow に依存。失敗時の許可された修正が Files に無い。
6. **A-17** Task 4 axe 行が `step` 欠落。歩き指示は `renderWizard` の no-op `onStepChange` と衝突。
7. **A-25** Task 5 idea `:315` の skip 差し込み手順が、直後に無い `"5. 確認"` 置換と privacy `:336` を混線させる。
8. **A-28** Task 6 E2E が spec の `.wizard-option` ではなく radio `.click()`。
9. **A-29** household ジャーニーの novelty autosave 同期点を移す指示が無い。

## §4 Closed

- A-2 / A-3 / A-4 Task 1 の `firstIncomplete`・非 iterate・`noveltyPreference` 非追加。既存テストと `Record<PlannerFieldName, PlannerStep>` が守る。
- A-7 / A-8 / A-9 Task 2 のスキップ非ガード、`setSystemTime`×`Date.now()`、`name={id}`。
- A-15 / A-16 `key={step}`・`nextLabel` 非伝播・exhaustive、`ReviewFieldErrors` 余剰でも Task 3 typecheck は死なない、`ReviewChoiceField` は Task 4 まで使用中。
- A-18 / A-20 / A-21 / A-22 / A-23 / A-24 Task 4 削除手順の同時性、skip 9 行、`ensurePlannerReady`、pantry「確認に戻る」、戻る×8。
- A-30 / A-31 / A-32 キーボード 4 手、44px Space、人間端末 e2e、Interfaces 名。

## §5 偽陽性

- 「Task 3 の typecheck が `ReviewFieldErrors` の extra fields で落ちる」→ A-16。落ちない。
- 「Task 3 まで `ReviewChoiceField` 未使用で lint 死」→ 確認画面の 4 呼び出しが残る。
- 「`ensurePlannerReady` に skip を足さないのは漏れ」→ spec / live とも walker ではない。
- 「44px の radio `.focus()` が keyboard-only を破る」→ 別テスト。裁定 Rejected。計画 1416 は live `:1096–1100` と同じ分割。
- 「追加条件 4 テストが Task 3 で赤」→ カード UI が残るので緑。赤になるのは未列挙の見出し側。
- radio `.click()` が Chromium で label `pointerup` にバブルして緑になる可能性 → A-28 を Critical にしない理由。未検証。

## §6 受け入れ残差

計画を直すなら最小は次:

1. Task 3 Step 4 のコマンドを、更新するテスト名で切るか、`"5. 確認"` 正アサーションを **ファイル内全件**（idea describe・`:1543` 含む）更新リストに足す。追加条件 4 本は Task 3 では緑、と書き直す。
2. 新規 wizard テストを live の `Harness` + draft 露出（または確認サマリではなく step 見出しと既存 DOM）で書き、存在しない `renderWizardAt*` を消す。sequential 歩きに `passActivationGuard` を明示する。
3. Task 1 の import に `buildPlannerSubmissionFieldErrors` を足す。
4. Task 2 に、pointerup 0 回時は `src/test/setup.ts` の PointerEvent/`isPrimary` polyfillを許可する、と Files へ書く。Arrow テストが jsdom で 0 回なら `fireEvent.change` を「矢印相当」と認めない／認めるを一文で決める。
5. Task 4 axe 行に `step: "timeLimit" as const` 等を足し、歩き parenthetical を消す。
6. Task 5 idea は `clickWizardNext` の直後（disclaimer の前）へ `skipOptionalPlannerSteps` を**挿入**すると書き、`:336` は見出し置換のみと再掲する。
7. Task 6 の pointer 前進を `locator(".wizard-option").filter({ hasText: … }).click()` に直し、household の `noveltySaved` wait を 8 ページ目の click に移す。

Minor（止めない）: 確認ヘルプ書き分け（A-19）、grep `*.ts`（A-26）、`git add e2e src`（A-27）、incomplete audience を `advanceFromEditOr` 経由にする裁定 Minor 6（A-14）。
