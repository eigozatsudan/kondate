# 追加条件ウィザードstep化 — デルタ再レビュー（一次）

- 日付: 2026-09-01
- 対象: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md`（コミット `b9bdb099`）
- 実施者: 読み取り専用 Reviewer
- 判定: **REVISE — Critical 0 件、Important 1 件、Minor 3 件**

## 1. Verdict

P-01（`advanceFromEditOr("timeLimit")` 固定と `goToStep("timeLimit")` 禁止）、P-02（ポインタ click / Space と `change` 分離のイベント表）、P-03（mount 350ms 無視と unit）、P-05（`ReviewChoiceField` 正本の options 写しと `""`→`null`）は本文に落ちており、live の audience `onNext`・controlled radio・`plannerDraftInputSchema`・Incomplete idle と矛盾しない。骨格（`firstIncomplete` 非変更、`?resume=review` 4b、避ける食材は確認に残す、必須4問の「次へ」、contracts/Function 非変更）も改訂で崩れていない。

残る穴は P-04 の「全列挙」だけである。裁決が必須とした `generation-recovery-results.spec.ts` の walker 2 本が呼び出し先から落ち、`menu-domain-pantry` の audience 再入場が未記載のまま `clickWizardNext` 前提で残る。逆に privacy resume 行が歩く箇所として混入しており、そこに `skipOptionalPlannerSteps` を足すと確認画面でスキップボタンを探して落ちる。テスト網が Plan の入力になる以上、このデルタだけを直すまで実装開始は早い。

## 2. P-01〜P-05 閉じ確認表

| ID | 状態 | 判定 |
| --- | --- | --- |
| P-01 | **Closed** | household は `isAudienceComplete` のあと `advanceFromEditOr("timeLimit")`、idea は await 成功後に同じ helper、`goToStep("timeLimit")` と「先に `setReturnToReviewAfterEdit(false)` して直指定」を禁止。live は `planner-wizard.tsx` 257–264 行（`advanceFromEditOr`）、536–538 行（idea はフラグを捨てて `goToStep("review")`）、542–548 行（household も同様）。unit「対象を変更→確認に戻る→`9. 確認`」を household / idea 両方で必須にしている（現行 household は `planner-wizard.test.tsx` 801–804 行）。 |
| P-02 | **Closed** | イベント表が未選択 click / 既選択「指定なし」再 click / 既選択非デフォルト再 click / Space / 矢印 `change` を分け、DOM に「次へ」無し。実装規則は `onClick` の `event.detail > 0` と Space の `onKeyUp`。cuisine-step の `onChange` 踏襲禁止は live `cuisine-step.tsx` 106–108 行 / `review-step.tsx` 137–139 行と一致する。onSelect の所属が handler 間で重なる読みは Minor。 |
| P-03 | **Closed** | mount から 350ms は click / Space を無視、戻るとスキップは対象外。unit「次 step の `onSelect` が走らない」を P-03 節に残し、テスト節では isolated の 350ms として具体化。`.wizard-transition` 180ms は `styles.css` 840–842 行にあり、現行 step の `<section>`（`cuisine-step.tsx` 85 行）には載っていない、という裁決前提のまま。onChange ガードを本文が「click / Space」としか書いていない点は Minor。 |
| P-04 | **Partial** | skip helper、`clickWizardNext` 禁止、戻る回数、full-journey household の 4 ページ歩き、idea は skip、44px / キーボード、`acceptance.ts` 対象外、`"5. 確認"` 42 件は別作業、unit sequential `:301–333` と編集戻り `:801–804` は入った。裁決が挙げた generation-recovery の 2 helper が呼び出し先に無く、pantry の audience 再入場と「戻るで1つ前」unit も未記載。privacy resume 行が歩く箇所に混ざっている（§4 I-1）。 |
| P-05 | **Closed** | 調理時間・予算の options と `""`→`null` / `"15"`→`15` を親リテラルとして本文に貼り、`Number(selected)` 禁止。`planner-labels.ts` は材料の使い方・雰囲気だけ。`onSkipRest` は 4 フィールドだけ `null` にする spread をリテラルで書く。live 正本は `review-step.tsx` 597–614 / 631–645 行。契約は `shared/contracts/planner.ts` 96 行（`15 \| 30 \| 45 \| null`）。`""` を入れると `use-draft-autosave.ts` 84–86・642–646 行が Incomplete を toast せず idle にする。unit「指定なし後の draft は `null`」あり。 |

Minor のうちスキップ `disabled`、`buildReviewFieldErrors` / C-C2 から 3 フィールド削除、axe 表の新 4 ページ、exhaustive 分岐、radiogroup 名を heading 側、既選択 15 分の再タップは本文に入った。確認ヘルプだけ「見直す」で止まっている（§5 M-2）。

## 3. Critical

なし。`firstIncompletePlannerStep` を触らない判断は live `planner-wizard.ts` 48–52 行のまま。`noveltyPreference` は `PlannerFieldName` に無い（16–28、109–122 行）。送信ペイロード / `shared/contracts` / Function 非変更も、キーが既に draft/submission にあるので成立する。ブラウザへ `@shared/safety` を入れる記述は無い。

## 4. Important（残る / 新規）

### I-1: P-04 の「全列挙」が walker を落とし、privacy resume を歩く箇所として混ぜている

根拠:

- 裁決 P-04 は「audience→review の全 helper から `skipOptionalPlannerSteps` を呼ぶ」とし、helper リストに generation-recovery の 2 helper と 44px テストを含めた。
- 改訂 Spec テスト節の「呼び出し先（audience→review を歩く箇所を全列挙）」は次を書く。`history.ts:227–238` / `:441–455` / `:468`、`shopping.ts:85–89`、`shots/flows.ts:26–37`、`full-journey.spec.ts:65–73` と `:336`、`menu-domain-pantry.spec.ts:77` / `:118–120` / `:141–146`、`mobile-accessibility.spec.ts:96` / `:131–149`、generation-recovery は「44px（`:1268–1272` 付近）とキーボード導線」。
- live で audience の `clickWizardNext` の直後に `"5. 確認"` を待つ **独自 walker** は次も存在する。
  - `e2e/specs/generation-recovery-results.spec.ts` 28–90 行 `completeIdeaPlannerToReview`（87–90 行）。呼び出しは 722 行。
  - 同ファイル 107–142 行 `completeMinimumPlanner`（141–142 行）。呼び出しは 221 / 294 / 353 / 410 / 501 行。
  - `e2e/specs/menu-domain-pantry.spec.ts` 277–278 行。260 行で `advanceToReviewWithHousehold` したあと、263–264 行で「戻る」1 回→`4. 作る相手`、メンバーを直してから再度 `clickWizardNext` → `"5. 確認"`。
- 逆に、列挙された行の一部は wizard を歩かない。
  - `e2e/fixtures/history.ts` 455–470 行は idea 確認到達のあと privacy CTA → `resume=review` で確認へ戻る経路。`:468` は既に確認見出しを待つ行。
  - `e2e/specs/mobile-accessibility.spec.ts` 82–98 行は生成前の privacy hop。`:96` も確認見出し。
  - `e2e/specs/full-journey.spec.ts` 315 行が idea の audience `次へ`、336 行は privacy 復帰後の確認見出し。個別箇条書きは skip を使えと書くが、呼び出し先表は `:336` を歩いた行として数えている。
- unit も裁決は sequential / idea 確定着地 / 「戻るで1つ前」を更新対象にした。改訂は `:301–333` と `:801–804` と「audience の次＝`5. 調理時間`」まで。`planner-wizard.test.tsx` 746–764 行は確認の「戻る」1 回で `4. 作る相手`、その場の「次へ」で確認へ戻る。review の `onBack` を `novelty` にすると着地は `8. 献立の雰囲気` になり、そのページに「次へ」は無い（決定事項 1 / P-02）。

成立条件:

1. 列挙どおり helper を足して 44px / キーボードだけ直す → `completeMinimumPlanner` / `completeIdeaPlannerToReview` が audience の `次へ` のあと `"5. 確認"` を待ち、`5. 調理時間` でタイムアウトする。generation-recovery の復旧系がまとめて赤。
2. Spec どおり 263–264 行を戻る×5 または「対象を変更」に置き、277 行の `clickWizardNext` を残す → 順送りなら着地は `5. 調理時間`。編集戻りならボタン名は「確認に戻る」なので `clickWizardNext`（`次へ` 専用、`history.ts` 41–42 行）が要素を見つけられない。
3. 呼び出し先表の行番号に `skipOptionalPlannerSteps` を機械的に挿入する → `history.ts:468` や mobile `:96` は確認画面に居る。スキップボタンは `timeLimit` にしか無い（Spec「以降は指定なしでスキップ」）ため、privacy 復帰がタイムアウトする。`seedGeneratedIdeaMenu` に依存する history / shots / mobile が巻き込まれる。
4. unit 746–764 行を「戻る回数だけ 8」に増やして「次へ」で確認へ戻そうとする → novelty に「次へ」が無くハングする。指定なし click（自動遷移）か確認の「変更」で戻ると書かないと、裁決の「戻るで1つ前」が閉じない。

必要な修正:

- 呼び出し先から privacy resume（`history.ts:468`、mobile `:96`、full-journey idea `:336`）を外し、見出し置換側へ移す。
- `completeIdeaPlannerToReview` と `completeMinimumPlanner` を名前で列挙し、audience の次で `skipOptionalPlannerSteps` を呼ぶと書く。
- `menu-domain-pantry.spec.ts:277–278` を列挙する。263–264 を「対象を変更」にするなら 277 は `clickWizardNext` ではなく「確認に戻る」。戻る×5 で audience に出すなら、その `次へ` のあとにも skip helper が要る。
- unit「戻るで1つ前」（746–764 行）を更新対象に戻す。確認から 1 つ戻った任意 step には「次へ」が無いので、指定なし（または任意のカード）click で `9. 確認` へ戻ると書く。

## 5. Minor

### M-1: P-02 の onSelect 担当が handler 間で重なる

Spec 実装規則は「値は `onChange`（onSelect のみ）」「遷移は `onClick` `detail > 0`（onNext）」「既選択の再 click は `change` が無いので `onClick` が onSelect+onNext を担う」「Space は `onKeyUp` で onSelect+onNext」。未選択ポインタは onChange と onClick が両方走るので、onClick にも常時 onSelect を置くと 2 回になる。未選択 Space も native `change` + `keyup` で 2 回。主経路は既定「指定なし」が既選択なので、既選択再 click / 既選択 Space は 1 回で足りる。unit「各 1 回」が防衛するが、本文に「未選択 click は onChange=onSelect・onClick=onNext のみ。既選択 click / Space は onClick または keyup が両方」と書き分ければ実装が往復しない。

### M-2: 確認ヘルプが「見直す」だけで新文言が無い

Spec 確認画面は「『戻る』で1つ前、『変更』で直接」を 9 ページ構成に合わせて見直す、とだけ書く。live は `review-step.tsx` 558–561 行で「直したあとは『確認に戻る』でこの画面に戻ります。」必須 4 問は `nextLabel` を渡すので今どおり正しい。追加 4 行の「変更」は `nextLabel` を渡さず、選択が `advanceFromEditOr` で確認へ帰る（P-01 節）。旧文を残すと追加 4 行について半分嘘になる。「必須質問は確認に戻る、追加条件は選ぶと戻る」を一文にすれば足りる。

### M-3: 4 ページ歩きの E2E が `.check()` のままだと既定「指定なし」で進まない

Spec は full-journey household だけスキップを使わず 4 ページを歩け、と書く。現行 novelty 操作は `full-journey.spec.ts` 84–87 行が `radiogroup` に対する `.check()`。Playwright の `.check()` は既 checked なら no-op で click を合成しない。P-02 どおり既定「指定なし」で進むには `.click()`（または skip 以外の未選択カード）が要る。unit は click を要求しているので E2E 側に 1 行あれば足りる。

P-03 本文の「活性化（click / Space）」も、ghost click の native `change` までガード対象と書いていない。live の radio は controlled（`review-step.tsx` 135 行 `checked={value === option.value}`、新 step も同型の想定）なので、unit が「次 step の onSelect が走らない」を要求すれば下書きは守られる。onChange も mount ガードの対象だと一文あればよい。

## 6. 偽陽性として却下したもの

- `firstIncomplete` を変えないと resume が壊れる / 任意 step 途中リロードが確認へ着地する。改訂は非変更と受理残差を本文に残しており、live `planner-wizard.ts` 48–52 行と一致する。再開しない。
- `?resume=review` 4b 破壊。route 合致条件は firstIncomplete 依存のまま。再開しない。
- `noveltyPreference` が `PlannerFieldName` にある。無い（16–28、109–122 行）。確認カードも `invalid={false}`（`review-step.tsx` 700 行）。再開しない。
- `acceptance.ts` が wizard を歩く。re-export のみ。改訂も対象外。再開しない。
- `"5. 確認"` 42 件が嘘 / 機械置換で足りる。改訂は見出しアサーションと導線修正を別作業にした。I-1 は列挙漏れであり件数の再訴訟ではない。
- `@shared/safety` 境界 / contracts・Function 変更 / step 名 persistence。非目標どおり。`toDraftInputFields`（`use-draft-autosave.ts` 66–81 行）に step 名は無い。
- スキップが編集戻り中に出る / avoid を消す / 1 条件変更で他 3 条件が消える。`onSkipRest` は `timeLimit` のみ、編集中は渡さない、4 フィールドリテラル。再開しない。
- 自動遷移が必須 4 問に漏れる。決定事項 2 と非目標のまま。
- 320px / 44px 不足。`.wizard-option` は `styles.css` 208–211 行で 44px。スキップは `.ui-btn`。再開しない。
- スキップ後の値復活 / autosave 競合。`onSaved` は query cache。追記は latest 収束。P-05 の `null` 写しで Incomplete idle は閉じた。
- 一次 I-1 の「`setState(false)` のあと読むと false」。機序は偽陽性のまま。P-01 は helper 固定で閉じた。
- 「click にすれば足りる」。改訂は `detail > 0` と Space で矢印合成 click を落としている。再開しない。
- `onSkipRest` が `goToStep("review")` で `advanceFromEditOr` ではないこと。スキップは編集戻り中に出さない前提なので行先固定でよい。P-01 の禁止は `goToStep("timeLimit")`。
- P-03 を isolated 350ms にしたこと自体。裁決の失敗モード（次ページ同座標）は新 step の remount で再現する。wizard レベル unit が無いのは弱いが、仕組みは閉じているので Important にしない。
- axe 表の 6〜8 ページ primary を「戻る」にすること。現行 `accessibility.test.tsx` 479–509 行は named primary を 1 つ要求する。primary=`戻る` で足りる。

---

判定: **REVISE — Critical 0 件、Important 1 件、Minor 3 件**。P-01 / P-02 / P-03 / P-05 と骨格は APPROVE 相当。P-04 の呼び出し先表（generation-recovery 2 helper、pantry 277–278、privacy resume の混入、unit 746–764 行の「次へ」不在）を本文が直すまで Plan / 実装開始は禁止。
