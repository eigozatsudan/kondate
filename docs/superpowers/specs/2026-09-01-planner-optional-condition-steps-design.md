# 追加条件を1問1ページのウィザードstepへ移す

- 日付: 2026-09-01
- 対象: 献立ウィザードの確認画面にある「追加条件」のうち選択式4つ
- 前提コミット: `9cc64886`（追加条件を select からカード選択へ変えた変更）
- レビュー: `docs/superpowers/reviews/2026-09-01-planner-optional-condition-steps-{primary,adversarial,secondary,adjudication}.md`
  裁定 REVISE の確定 Important 5 系統（P-01〜P-05）と Minor を本文へ反映済み。

## 背景と目的

追加条件は確認画面の `<details>` に押し込まれており、`9cc64886` でカード選択に
変えて「選ぶまで中身が見えない」問題は解いた。しかし依然として1画面に4条件が
縦に積まれ、必須質問（食事・メイン食材・ジャンル・対象）と操作の質が違う。

本設計では選択式4条件を**1問1ページ**へ分割し、必須質問と同じ「順に答えていく」
体験へ揃える。あわせて**選んだ瞬間に次のページへ進む**ようにし、タップ数の増加を
「以降は指定なしでスキップ」で相殺する。

## 決定事項（前提質問への回答）

1. 選択で即次のページへ自動遷移する。各ページに「次へ」は置かず「戻る」のみ。
   「指定なし」を押すこと自体がスキップ操作を兼ねる。
2. 自動遷移は**新しい追加条件のページだけ**に入れる。食事・メイン食材・ジャンル・
   対象は現状の「次へ」のまま変えない。
3. ページ化するのは選択式4つのみ。避ける食材・自由メモ・冷蔵庫の食材は確認画面の
   「追加条件」に残す。
4. 見出しは通し番号を延長する。確認は `5. 確認` → `9. 確認` になる。
5. 5ページ目（調理時間）に「以降は指定なしでスキップ」を置き、残り3条件を指定なしで
   確定して確認へ直行できるようにする。

## step モデル

`src/features/planner/model/planner-wizard.ts`

```
meal → ingredients → cuisine → audience
     → timeLimit → budget → ingredientPreference → novelty → review
```

- `plannerSteps` に `timeLimit` / `budget` / `ingredientPreference` / `novelty` を
  audience と review の間へ挿入する。この配列が「UI・resume判定・focus順の唯一の正」で
  ある位置づけは変えない。
- `firstIncompletePlannerStep` は**変更しない**。追加条件は任意なので「未完了」に
  ならず、必須4問が揃えば従来どおり `review` を返す。`?resume=review` の深リンク契約
  （不変契約 4b）は `resume === "review" && firstIncomplete === "review"` の合致で
  成立しているため、そのまま保たれる。
- 受理済みの残差: 任意 step の途中でリロードすると確認へ着地する。step 名は persist
  しない設計（`toDraftInputFields` に step は無い）で、入力値はフィールドとして残る。
- `stepByField` を付け替える。
  - `timeLimitMinutes` → `timeLimit`
  - `budgetPreference` → `budget`
  - `ingredientPreference` → `ingredientPreference`
  - `avoidIngredients` / `memo` / `pantrySelections` は `review` のまま
  - `noveltyPreference` は `PlannerFieldName` に存在せず submission error の対象外
    （現状どおり追加しない）
- 送信時 field error は route の既存経路（`planner-route.tsx:1797` / `:1889` の
  `firstInvalidStep` → `setStep`）でそのまま該当ページへ戻る。
- 見出しの通し番号: `5. 調理時間` `6. 予算` `7. 材料の使い方` `8. 献立の雰囲気`
  `9. 確認`。

## 新 step コンポーネント

`src/features/planner/components/optional-choice-step.tsx` を1本作り、4ページはその
設定違いとして使う。外枠は `cuisine-step.tsx` を踏襲する（`Surface` / `Inset` /
`Stack`、`h2` に `tabIndex={-1}` + mount focus、`wizard-option-list` /
`wizard-option`）。**ただし遷移の起こし方は cuisine-step とは別物**にする（P-02）。

props:

| prop | 役割 |
| --- | --- |
| `title` | `5. 調理時間` などの見出し。radiogroup の名前はこの heading 側に持たせ、確認画面の radiogroup 名（「献立全体の調理時間」等）は再利用しない |
| `options` | `{ value: string; label: string }[]`。先頭は必ず「指定なし」（`value: ""`） |
| `value` | 現在値（`null` は `""`） |
| `onSelect` | 選択値を親へ返す |
| `onNext` | 順送り |
| `onBack` | 戻る |
| `disabled` | 親の `isSaving` 等 |
| `errorMessage` | 送信時 field error（既存 step と同じ inline 表示） |
| `description` | 任意の補足文（材料の使い方の調味料ヒントなど） |
| `onSkipRest` | 省略可。渡されたときだけ「以降は指定なしでスキップ」を出す |

- 必須ではないので incomplete バリデーションと toast は持たない。
- DOM に「次へ」ボタンを置かない（テストで不在を主張する）。

### P-02: 自動遷移のイベント表（cuisine-step の `onChange` は使わない）

`cuisine-step.tsx:106–108` / `review-step.tsx` の `ReviewChoiceField` は native radio の
`onChange` で値を受けている。`onChange` をそのまま遷移トリガにすると2つ壊れる。

- 既定で checked の「指定なし」を再タップしても `change` が出ず、スキップボタンの無い
  6〜8ページ目から出られなくなる。
- 矢印キーで選択を移すたびに `change` が出て、ページが飛ぶ。

そこで**値の更新と遷移を別のイベントで受ける**。

| 操作 | `onSelect`（値） | `onNext`（遷移） |
| --- | --- | --- |
| 未選択カードをポインタ click | ○ | ○ |
| 既に選択済みのカード（「指定なし」含む）をポインタ再 click | ○（同値） | ○ |
| フォーカス済み radio で Space | ○ | ○ |
| 矢印キーで選択移動 | ○ | ✕（値だけ変える） |
| その他の `change`（プログラム的変更など） | ○ | ✕ |

実装規則:

- 値は従来どおり `onChange` で受ける（`onSelect` のみ。遷移しない）。
- 遷移は `onClick` で受け、**`event.detail > 0`（実ポインタ由来）のときだけ** `onNext`。
  Chromium は矢印キーで click を合成し得るが、合成 click の `detail` は 0 なのでここで
  落ちる。
- Space は `onKeyUp` で `event.key === " "` を見て `onSelect` + `onNext`。
- 「指定なし」が既に選択されている状態の再 click でも `onSelect` と `onNext` が
  ちょうど1回ずつ走ること（`change` が出ないため `onClick` 側が単独で担う）。

### P-03: 自動遷移直後のダブルタップ

4ページとも `.wizard-option` が同じ座標に並ぶ。`.wizard-transition`（180ms）は現行 step の
`<section>` には載っていないため、~300ms 後の2発目は次ページの同位置カードに落ちて
誤選択になる。E2E のフルウォークは遅いので拾えない。

- step が mount してから **350ms** の間は選択肢の活性化（click / Space）を無視する。
  `useRef` に mount 時刻を持ち、活性化ハンドラの先頭で判定する。
- 「戻る」とスキップボタンはこのガードの対象外にする（同位置の連打リスクが無い）。
- unit 必須: 「選択直後に同じ座標を2回目 click しても次 step の `onSelect` が走らない」。

## P-05: 値とラベルの正本

`planner-labels.ts` には**調理時間・予算の定数は無い**。正本は現行
`review-step.tsx` の `ReviewChoiceField` 呼び出し4つで、その options と `""` の扱いを
そのまま写す。`""` を draft に入れると `plannerDraftSchema`（`timeLimitMinutes` は
`15 | 30 | 45 | null`）が落ち、autosave は Incomplete として **toast も出さず idle に
なる**（`use-draft-autosave.ts`）ため、`""` は必ず親側で `null` へ畳む。

```ts
// 調理時間（5ページ目）
options: [
  { value: "", label: "指定なし" },
  { value: "15", label: "15分以内" },
  { value: "30", label: "30分以内" },
  { value: "45", label: "45分以内" },
]
onSelect: (selected) => onDraftChange({
  ...draft,
  timeLimitMinutes:
    selected === "15" ? 15 : selected === "30" ? 30 : selected === "45" ? 45 : null,
})

// 予算（6ページ目）
options: [
  { value: "", label: "指定なし" },
  { value: "economy", label: "節約優先" },
  { value: "standard", label: "標準" },
]
onSelect: (selected) => onDraftChange({
  ...draft,
  budgetPreference:
    selected === "economy" ? "economy" : selected === "standard" ? "standard" : null,
})
```

- `Number(selected)` は禁止（`Number("") === 0` が schema を落とす）。必ず literal 比較。
- 材料の使い方（7ページ目）と献立の雰囲気（8ページ目）のラベルだけ
  `planner-labels.ts` の `ingredientPreferenceLabels` / `noveltyPreferenceLabels` と
  `ingredientPreferenceLabel(null)` / `noveltyPreferenceLabel(null)` を使う。値の写しは
  現行 `ReviewChoiceField` と同じ literal 比較。
- unit 必須: 「指定なしを選んだ後の draft が `null` であって `""` ではない」。

## 「以降は指定なしでスキップ」

- 置くのは `timeLimit`（5ページ目）だけ。`wizard-actions` 内に `戻る` と並べて
  `variant="secondary"` のボタンを1つ置く。文言は「以降は指定なしでスキップ」。
  長い文言は `wizard-actions` の wrap に収まる（`.ui-btn` は既に44px）。
- 押下時: 4フィールドだけを `null` にする spread をリテラルで書き、`review` へ直行する。

```ts
onSkipRest: () => {
  onDraftChange({
    ...draft,
    timeLimitMinutes: null,
    budgetPreference: null,
    ingredientPreference: null,
    noveltyPreference: null,
  });
  goToStep("review");
}
```

  避ける食材・自由メモ・冷蔵庫の食材には触れない。すでに値が入っていた場合も指定なしへ
  戻す（文言どおりの挙動）。
- `disabled` は既存 step と同型（親の `isSaving` 等をそのまま渡す）。
- 確認画面の「変更」から入った編集戻り中（`returnToReviewAfterEdit`）は `onSkipRest` を
  **渡さない**＝ボタンを出さない。「調理時間だけ直しに来た」利用者の他条件を消さないため。
- 補足文（`type-small`）で「あとから確認画面で変えられます」と添える。確認画面に
  サマリと「変更」があるので、この案内は事実として正しい。

## P-01: ウィザードの遷移（`planner-wizard.tsx`）

現行 audience の `onNext` は household（`:542–548`）も idea（`:536–538`）も
`returnToReviewAfterEdit` を落としてから `goToStep("review")` を直に呼ぶ。順送りと
編集戻りが同じ行先だったため、フラグを見る必要が無かった。ここで**行先だけを
`timeLimit` に置換すると、確認の「対象を変更 → 確認に戻る」が `5. 調理時間` に
着地して壊れる**。

- household: `isAudienceComplete` ガードを通したあと **`advanceFromEditOr("timeLimit")`**
  を呼ぶ。`goToStep("timeLimit")` は禁止。
- idea: `onIdeaAudienceConfirmed()` の await 成功後に同じく
  `advanceFromEditOr("timeLimit")` を呼ぶ。世代トークン（`ideaConfirmGenerationRef`）の
  判定は現行のまま。
- `setReturnToReviewAfterEdit(false)` を**先に呼んでから行先を直指定する形は禁止**。
  同一クロージャ内の `returnToReviewAfterEdit` は `setState` しても変わらないため、
  フラグの解除は `advanceFromEditOr` → `returnToReviewIfQuestionsComplete` に任せる。
- 各追加条件 step の `onNext` は `advanceFromEditOr(次のstep)`。確認からの編集中なら
  選択と同時に確認へ戻る（1タップで直せる）。
- 各追加条件 step の `onBack` は `backFromEditOr(前のstep)`。`review` の `onBack` は
  `audience` から `novelty` へ変える。
- `editReturnActionLabels` の `nextLabel`（「確認に戻る」）は「次へ」を持たない追加条件
  step には渡さない。`backLabel`（「やめる」）は渡す。編集戻りは「選択で
  `advanceFromEditOr`」「戻るで `returnToReviewIfQuestionsComplete`」の両方が確認へ帰る。
- step 分岐の最終 else が常に `ReviewStep` になっている現行構造は、新 step の追加漏れを
  隠す。分岐を exhaustive にするか、未知 step で throw する。

## 確認画面（`review-step.tsx`）

- 選択式4条件のカード UI（`ReviewChoiceField` の4呼び出し）を削除する。
  `ReviewChoiceField` 自体も未使用になるので消す。
- 既存のサマリ `dl` に4行を追加する。`dt` は「調理時間」「予算」「材料の使い方」
  「献立の雰囲気」、`dd` は選択値または「指定なし」、各行に既存と同じ `変更` ボタン
  （`onEditStep(該当step)`、`aria-label` は「調理時間を変更」など）。
- `<details>追加条件` には「今回だけ避ける食材」「自由メモ」「冷蔵庫の食材」だけが残る。
  デフォルト展開はそのまま。C-C2 の `forceAdditionalOpen` からは
  `timeLimitMinutes` / `budgetPreference` / `ingredientPreference` の3条件を外す
  （直しどころが details 内に無くなるため）。`hasUnavailablePantrySelections` /
  `hasUnconfirmedExpiredPantry` / `medicalBlocked` / avoid / memo / pantry は残す。
- `planner-wizard.tsx` の `buildReviewFieldErrors` からも同3フィールドを外し、
  `ReviewFieldErrors` は avoid / memo / pantry だけにする。3フィールドの
  `errorMessage` は各 step へ渡す。
- 確認の説明文（「戻る」で1つ前、「変更」で直接）は9ページ構成に合わせて見直す。

## テスト

### unit（vitest）

- `optional-choice-step.test.tsx`
  - 「指定なし」が既定で選択済み
  - P-02 のイベント表を1行ずつ: ポインタ click で `onSelect` + `onNext` が各1回 /
    既選択「指定なし」の再 click でも1回 / 既選択の非デフォルト再 click でも1回 /
    Space で1回 / 矢印キー由来の `change` では `onNext` が走らない
  - DOM に「次へ」が無い
  - P-03: mount 直後 350ms 以内の2発目 click では `onSelect` が走らない
  - `onSkipRest` 未指定ならスキップボタンを出さない
- `planner-wizard.test.tsx`
  - audience の「次へ」で `5. 調理時間` に着く（household / idea 両方）
  - 4ページを順に選ぶと `9. 確認` に着き、値が draft に入る
  - P-05: 「指定なし」通過後の draft が `null`（`""` でない）
  - 5ページ目のスキップで4条件が `null` のまま `9. 確認` に着く
  - P-01 回帰: 確認の「対象を変更 → 確認に戻る」が `9. 確認` に戻る（household / idea）
  - 確認の「変更」で該当ページへ飛び、選ぶと確認へ戻る
  - 既存の sequential テスト（`:301–333` 相当。audience の次＝確認、戻る×4 で食事）と
    編集戻りテスト（`:801–804` 相当）を新しい step 数へ更新
  - 既存の「追加条件」系4テストは確認サマリの検証へ書き換え
- `planner-route-conflict.test.tsx` / `app/accessibility.test.tsx`: `5. 確認` の
  見出し名を更新。axe 表に新4ページを足す（5ページ目の primary はスキップボタン、
  6〜8ページ目は「戻る」のみ）。

### E2E（playwright）

`e2e/fixtures/history.ts` に `skipOptionalPlannerSteps(page)` を追加する（5ページ目の
「以降は指定なしでスキップ」を押して確認まで飛ばす1関数）。`clickWizardNext` は
「次へ」専用なので任意 step には**使わない**。

呼び出し先（audience→review を歩く箇所を全列挙）:

- `e2e/fixtures/history.ts:227–238`、`:441–455`、`:468`
- `e2e/fixtures/shopping.ts:85–89`
- `e2e/shots/flows.ts:26–37`
- `e2e/specs/full-journey.spec.ts:65–73`（household）、`:336`（idea）
- `e2e/specs/menu-domain-pantry.spec.ts:77`、`:118–120`、`:141–146`
- `e2e/specs/mobile-accessibility.spec.ts:96`、`:131–149`
- `e2e/specs/generation-recovery-results.spec.ts` の44pxレイアウト（`:1268–1272` 付近）と
  キーボード導線

`acceptance.ts` は wizard を歩かない（`history.ts` からの re-export）ので対象外。

戻る回数の更新:

- `menu-domain-pantry.spec.ts:63–80` の「戻る×4 で `1. 食事`」は戻る×8、または確認の
  「食事を変更」へ置き換える。
- `menu-domain-pantry.spec.ts:263–264` の「戻る×1 で `4. 作る相手`」は戻る×5、または
  「対象を変更」へ置き換える。
- 確認からの戻る1回は `8. 献立の雰囲気`。

個別:

- `full-journey.spec.ts` household: 「ひねりたい」は8ページ目で選ぶ。ここだけスキップを
  使わず4ページを歩き、自動遷移が効いていることも同時に主張する。
- `full-journey.spec.ts` idea（`:336`）: `skipOptionalPlannerSteps` を使う。
- キーボード導線テスト（`generation-recovery-results.spec.ts` の
  「advances four questions to review and privacy using keyboard only」）は新4ページを
  Space で通過する形にし、テスト名も実態へ合わせる。
- `mobile-accessibility.spec.ts`: 320/375/430px の走査へ新4ページを追加。
- `"5. 確認"`（ASCII 引用符）の42件は見出しアサーションの機械置換で、上の導線修正とは
  別作業として扱う。

## トレードオフ

確認到達までのページが 5 → 9 に増える。既定のまま進む利用者は5ページ目のスキップ
1タップで確認へ行けるので、実質の増分は1タップに収まる。1問ずつ答えたい利用者は
4タップで通過する（各ページの選択がそのまま次への遷移になるため）。

## 非目標

- 食事・メイン食材・ジャンル・対象の操作方法は変えない。
- 避ける食材・自由メモ・冷蔵庫の食材のページ化はしない。
- 献立の雰囲気の field error UI は増やさない（`PlannerFieldName` に足さない）。
- 送信ペイロード、`shared/contracts`、生成 Function 側は一切変えない。
