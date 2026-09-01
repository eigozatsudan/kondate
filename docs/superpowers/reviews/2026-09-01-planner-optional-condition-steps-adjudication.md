# 追加条件ウィザードstep化 設計 — 指摘裁定

- 日付: 2026-09-01
- 裁定者: 親エージェント
- 対象: 一次、敵対的、二次、親の live 再照合
- 最終判定: **REVISE。Critical 0。確定 Important 5 系統を Spec へ反映するまで Plan / 実装開始は禁止。**

## 1. 裁定方法

各指摘を live の wizard step モデル、audience `onNext`、確認カード、契約スキーマ、autosave、E2E helper へ当てた。一次・敵対的は独立スレッド、二次は両レビューを入力に別スレッド。同一原因は統合し、Spec が明示した製品判断と、成立条件が現行コードですでに閉じている攻撃は偽陽性とした。

二次の「一次 I-1 の setState 機序は不正確」は採用する。欠陥（household を `goToStep("timeLimit")` にすると編集戻りが壊れる）は残る。一次 I-2 の「click にすれば足りる」は採用せず、敵対的 I-02 のイベント表を正とする。

主要な再照合:

- `planner-wizard.tsx:542–548` household はフラグを捨てて `goToStep("review")`。`536–538` idea も await 後にフラグを捨てて review 固定。`258–264` `advanceFromEditOr` は meal / ingredients / cuisine だけ。
- 同一クロージャの `returnToReviewAfterEdit` は `setState(false)` しても変わらない。失敗条件はフラグ分岐を書かずに行先だけ `timeLimit` へ置換すること。
- `planner-wizard.test.tsx:801–804` が household「対象を変更→確認に戻る→確認」。`301–333` が audience の次＝確認、戻る×4 で食事。
- cuisine-step / `ReviewChoiceField` は native radio `onChange`（`cuisine-step.tsx:106–108`、`review-step.tsx:137–139`）。checked 済みの再クリックは `change` を発火しない。
- `planner-labels.ts` に調理時間・予算の定数は無い。正本は `review-step.tsx:597–614` / `631–645`。
- `planner.ts:96` `timeLimitMinutes` は `15 | 30 | 45 | null`。`use-draft-autosave.ts:84–86, 506–518, 642–646` は schema 失敗を Incomplete として黙って idle。
- `"5. 確認"`（ASCII 引用符）は ts/tsx で 42 件。`acceptance.ts` は wizard を歩かない（history から re-export）。
- `menu-domain-pantry.spec.ts:77–80` 戻る 4 回で `1. 食事`。`:263–264` 戻る 1 回で `4. 作る相手`。
- `.wizard-option` は `min-height: 44px`。`.wizard-transition` は 180ms だが現行 step の `<section>` には載っていない。

## 2. 確定・統合した指摘

| 統合ID | 元ID | 最終severity | 裁定 | Spec へ書くこと |
| --- | --- | --- | --- | --- |
| P-01 | 一次 I-1 / 敵対 I-01 | Important | 現行 audience は順送りも編集戻りも review なのでフラグを見ない。行先だけ `timeLimit` にすると「対象を変更→確認に戻る」が `5. 調理時間` に着地する。idea も await 後の review 固定を置換すると同じ | household は `isAudienceComplete` のあと **`advanceFromEditOr("timeLimit")`**。`goToStep("timeLimit")` 禁止。idea は await 成功後に同じ helper。unit「対象を変更→確認に戻る→`9. 確認`」を household と idea の両方で必須回帰 |
| P-02 | 一次 I-2 / 敵対 I-02 | Important | cuisine-step 踏襲の `onChange` では既定「指定なし」を再タップしても進まない。スキップは 5 ページ目だけなので 6〜8 ページから出られない。矢印キーの `change` でページが飛ぶ。click だけでは不十分 | 自動遷移はポインタ（mouse/touch/pen）の click と Space のみ。native `change` / 矢印では `onNext` しない。既選択の「指定なし」でも `onSelect`+`onNext` が 1 回。DOM に「次へ」が無いこと。既選択の非デフォルト再タップも同じ表で進む／留まるを書く |
| P-03 | 敵対 I-03 | Important | 4 ページとも同じ `.wizard-option` 座標。180ms の `.wizard-transition` は現行 step に未適用で、~300ms の 2 発目は次ページの同位置に落ちる。E2E フルウォークは遅く偽緑 | ページ遷移後 300–400ms は選択肢の pointer を無視する、または `onNext` を pointerup 後に遅らせる。unit「選択直後の 2 回目 click では次 step の onSelect が走らない」を必須 |
| P-04 | 一次 I-3 / 敵対 I-04 / 二次 §4 | Important | fixture 4 本＋見出し機械置換では足りない。`acceptance.ts` は歩かない。独自 helper・戻る回数・`clickWizardNext`（`次へ` 専用）・unit sequential が残る | audience→review の全 helper から `skipOptionalPlannerSteps` を呼ぶ。戻る 1 回＝`8. 献立の雰囲気`、meal までは 8 回（または確認の「食事を変更」）。`clickWizardNext` は任意 step に使わない。unit の sequential / idea 確定着地 / 「戻るで1つ前」も更新対象。idea `full-journey` もスキップか 4 ページ歩きかを明示。44px レイアウトテスト（`generation-recovery-results.spec.ts:1268–1272`）を列挙に含める |
| P-05 | 一次 I-4 / 敵対 I-05 | Important | 「ラベルは `planner-labels.ts`」は調理時間・予算について虚偽。`value: ""` を draft に入れると schema が落ち、Incomplete は toast せず idle | 値とラベルの正本は現行 `ReviewChoiceField`。親が `""` → 各フィールド `null`、`"15"\|"30"\|"45"` → number literal。`Number("")` 禁止。`onSkipRest` は 4 フィールドだけ `null` にする spread をリテラルで書く。材料の使い方・雰囲気だけ `planner-labels.ts`。unit「指定なし後の draft は `null` であり `""` ではない」 |

## 3. 偽陽性・重複・受け入れ残差

| 項目 | 裁定 | 理由 |
| --- | --- | --- |
| 一次 I-1 と敵対 I-01 | **Duplicate** | P-01 へ統合。実装手順は `advanceFromEditOr` |
| 一次 I-2 と敵対 I-02 | **Duplicate** | P-02 へ統合。イベント表は敵対を正とする |
| 一次 I-3 と敵対 I-04 | **Duplicate** | P-04 へ統合。helper リストは敵対＋二次の 44px テスト |
| 一次 I-4 と敵対 I-05 | **Duplicate** | P-05 へ統合。ラベル正本と `""`→`null` は同じ ReviewChoiceField |
| 一次 M-3 と敵対 M-02 | **Duplicate** | 確認ヘルプ。Minor |
| 一次の「setState(false) のあと読むと false」 | **False positive（機序）** | 同一クロージャの state const は変わらない。欠陥はフラグ分岐の欠落（P-01） |
| 一次 I-2 の「click にすれば足りる」 | **False positive（修正案）** | Chromium の radio 矢印は click を合成し得る。P-02 は change / 矢印を除外する |
| スキップが編集戻り中に出る / avoid を消す / 1 条件変更で他 3 条件が消える | **False positive** | 設計が `onSkipRest` は timeLimit のみ・編集中は渡さない・対象 4 フィールドを明示。household が誤って timeLimit へ来たときだけ P-01 経由で露出 |
| `firstIncomplete` 非変更で resume が review 以外 | **False positive** | 必須 4 問が揃えば今も `"review"`（`planner-wizard.ts:48–52`）。任意値はフィールドとして残る。step 名は persist しない |
| `?resume=review` 破壊 | **False positive** | route は `resume==="review" && firstIncomplete==="review"` のときだけ確認へ固定。firstIncomplete を触らなければ 4b は保つ |
| `noveltyPreference` が PlannerFieldName にある | **False positive** | 無い（16–28、109–122 行）。確認カードも `invalid={false}` |
| 自動遷移が必須 4 問に漏れる | **False positive** | 設計が「新しい追加条件のページだけ」と非目標で食事〜対象を変えないと書いてある |
| 320px / 44px 不足 | **False positive** | `.wizard-option` / `.ui-btn` が既に 44px。長いスキップは `wizard-actions` の wrap |
| スキップ後の値復活 / autosave 競合 | **False positive** | `onSaved` は query cache のみ。追記ループは latest に収束 |
| 「5.」の誤置換 / 42 箇所が嘘 | **False positive** | 引用符付き `"5. 確認"` は ts/tsx で 42 件。`15分` は含まない。JSX 見出しは実装本体 |
| `@shared/safety` 境界越え / contracts・Function 変更 / step 名の persistence 漏れ | **False positive** | 非目標どおり。現行 planner UI は `@shared/safety-pure/medical-scope` のみ。`toDraftInputFields` に step 名は無い |
| nextLabel 非渡しで確認に戻れない | **False positive** | 編集戻りは選択で `advanceFromEditOr`、戻るは「やめる」。どちらも `returnToReviewIfQuestionsComplete` |
| `timeLimitMinutes: v` が TS で止まるので I-05 は偽 | **False positive（却下）** | 型は守っても `Number(v)` や別コピーを新設できる。P-05 は正本の欠落 |
| 敵対の「42 箇所は正しい」 | **Confirmed** | 引用符付き一致。機械置換だけでは戻る回数と `次へ` 前提は直らない（P-04） |
| 一次 M-1 `buildReviewFieldErrors` / C-C2 | **Minor** | field error を各 step の `errorMessage` へ移し、ReviewFieldErrors と C-C2 から 3 フィールドを外す。UI が valid literal しか置けないので発火は稀 |
| 一次 M-2 axe 表 | **Minor** | 新 4 ページを足す。5 ページ目 primary はスキップボタン、他は「戻る」のみ |
| 敵対 M-01 スキップ `disabled` | **Minor** | 既存 step と同型で一文 |
| 敵対 M-03 最終枝が常に ReviewStep | **Minor** | exhaustive か未知 step throw。P-04 の unit（audience の次が `5. 調理時間`）が最終防衛 |
| 敵対 M-04 既選択 15 分の再タップ | **Minor** | P-02 のイベント表に 1 行 |
| 二次の radiogroup 名「献立全体の調理時間」 | **Minor** | 新 step は heading 側。確認の radiogroup 名を再利用しないと一文 |
| 任意 step 途中リロードが確認へ着地 | **Accepted residual** | `firstIncomplete` 非変更の設計判断。値はフィールドに残る |
| 確認到達 5→9 ページ | **Accepted residual** | トレードオフとして受理済み。P-02 を閉じれば指定なし導線はスキップ 1 タップまたは各ページの指定なしタップ |
| ひねりの field error UI を増やさない | **Accepted residual** | 現状どおり。`PlannerFieldName` に足さない |

## 4. Spec が直すべき具体パッチ（実装はまだしない）

1. **audience `onNext`** — household は complete ガードのあと `advanceFromEditOr("timeLimit")`。idea は await 成功後に同じ helper。フラグを落とすのは helper 内。`goToStep("timeLimit")` と「先に false にしてから直指定」を禁止する。
2. **自動遷移イベント表** — ポインタ click と Space のみ `onNext`。`change` / 矢印は値だけ変えるか無視。既選択「指定なし」でも 1 回進む。「次へ」無し。
3. **ダブルタップ** — 遷移後 300–400ms の pointer 無視、または `onNext` 遅延。unit 必須。
4. **値とラベル** — ReviewChoiceField の options と `""`→`null` / `"15"`→`15` 写しを親のリテラルとして本文に貼る。`planner-labels.ts` は材料の使い方・雰囲気だけ。
5. **テスト網** — skip helper の呼び出し先を全列挙。戻る回数。`clickWizardNext` 禁止。unit sequential / idea 確定。idea full-journey。44px レイアウトテスト。`"5. 確認"` 42 件は見出しアサーションであり別作業。
6. **Minor** — スキップ `disabled`。`buildReviewFieldErrors` と C-C2 から 3 フィールド削除。axe 表。確認ヘルプ。exhaustive switch。radiogroup 名。

## 5. 修正後判定

**REVISE。** 骨格（`firstIncomplete` 非変更、`?resume=review`、避ける食材は確認に残す、必須 4 問の「次へ」、送信ペイロード非変更、編集戻り中はスキップ非表示）は APPROVE 相当。P-01〜P-05 を本文に埋め込んだら、そのデルタだけを再レビューすればよい。実装開始は再 APPROVE のあと。
