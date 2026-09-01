# 追加条件を1問1ページのウィザードstepへ移す

- 日付: 2026-09-01
- 対象: 献立ウィザードの確認画面にある「追加条件」のうち選択式4つ
- 前提コミット: `9cc64886`（追加条件を select からカード選択へ変えた変更）

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
  ならず、resume 先は従来どおり `review` に着地する。`?resume=review` の深リンク契約
  （不変契約 4b）も不変。
- `stepByField` を付け替える。
  - `timeLimitMinutes` → `timeLimit`
  - `budgetPreference` → `budget`
  - `ingredientPreference` → `ingredientPreference`
  - `avoidIngredients` / `memo` / `pantrySelections` は `review` のまま
  - `noveltyPreference` は `PlannerFieldName` に無く submission error の対象外なので
    追加しない（現状どおり）
- 見出しの通し番号: `5. 調理時間` `6. 予算` `7. 材料の使い方` `8. 献立の雰囲気`
  `9. 確認`。

## 新 step コンポーネント

`src/features/planner/components/optional-choice-step.tsx` を1本作り、4ページはその
設定違いとして使う。構造は `cuisine-step.tsx` を踏襲する（`Surface` / `Inset` /
`Stack`、`h2` に `tabIndex={-1}` + mount focus、`wizard-option-list` /
`wizard-option`）。

props:

| prop | 役割 |
| --- | --- |
| `title` | `5. 調理時間` などの見出し |
| `options` | `{ value: string; label: string }[]`。先頭は必ず「指定なし」（`value: ""`） |
| `value` | 現在値（`null` は `""`） |
| `onSelect` | 選択値を親へ返す |
| `onNext` | 順送り。`onSelect` と同じハンドラ内で続けて呼ぶ |
| `onBack` | 戻る |
| `disabled` | 親の `isSaving` 等 |
| `errorMessage` | 送信時 field error（既存 step と同じ表示） |
| `description` | 任意の補足文（材料の使い方の調味料ヒントなど） |
| `onSkipRest` | 省略可。渡されたときだけ「以降は指定なしでスキップ」を出す |

- 必須ではないので incomplete バリデーションと toast は持たない。
- 選択肢のラベルは `model/planner-labels.ts` の既存定数をそのまま使う。

## 「以降は指定なしでスキップ」

- 置くのは `timeLimit`（5ページ目）だけ。`wizard-actions` 内に `戻る` と並べて
  `variant="secondary"` のボタンを1つ置く。文言は「以降は指定なしでスキップ」。
- 押下時: `timeLimitMinutes` / `budgetPreference` / `ingredientPreference` /
  `noveltyPreference` の4つをまとめて `null` にし、`review` へ直行する。
  すでに値が入っていた場合も指定なしへ戻す（文言どおりの挙動にする）。
- 確認画面の「変更」から入った編集戻り中（`returnToReviewAfterEdit`）は**表示しない**。
  「調理時間だけ直しに来た」利用者の他条件を消さないため。
- 補足文（`type-small`）で「あとから確認画面で変えられます」と添える。確認画面に
  サマリと「変更」があるので、この案内は事実として正しい。

## ウィザードの遷移（`planner-wizard.tsx`）

- `audience` の `onNext` の順送り先を `review` から `timeLimit` へ変える。
  - household 経路: `isAudienceComplete` ガードはそのまま。通過後 `timeLimit` へ。
  - idea 確定経路: 現状は編集戻りでも順送りでも `review` へ行く。編集戻りだったときは
    従来どおり `review`、順送りのときだけ `timeLimit` へ進める（既存利用者から見た
    編集戻りの挙動を変えない）。
- 各追加条件 step の `onNext` は `advanceFromEditOr(次のstep)` を通す。確認からの
  編集中なら選択と同時に確認へ戻る（1タップで直せる）。
- 各追加条件 step の `onBack` は `backFromEditOr(前のstep)`。`review` の `onBack` は
  `audience` から `novelty` へ変える。
- `editReturnActionLabels` の `nextLabel`（「確認に戻る」）は「次へ」を持たない追加条件
  step には渡さない。`backLabel`（「やめる」）は渡す。

## 確認画面（`review-step.tsx`）

- 選択式4条件のカード UI（`ReviewChoiceField` の4呼び出し）を削除する。
  `ReviewChoiceField` 自体も未使用になるので消す。
- 既存のサマリ `dl` に4行を追加する。`dt` は「調理時間」「予算」「材料の使い方」
  「献立の雰囲気」、`dd` は選択値または「指定なし」、各行に既存と同じ `変更` ボタン
  （`onEditStep(該当step)`、`aria-label` は「調理時間を変更」など）。
- `ReviewStepProps["onEditStep"]` の受け入れ step が4つ増える。型は `PlannerStep` の
  ままなので追加変更は不要。
- `<details>追加条件` には「今回だけ避ける食材」「自由メモ」「冷蔵庫の食材」だけが残る。
  デフォルト展開とブロック中の強制展開（C-C2）はそのまま。
- 削除する4条件の field error（`timeLimitMinutes` / `budgetPreference` /
  `ingredientPreference`）は各 step 側へ移す。`ReviewFieldErrors` の型自体は
  avoid/memo/pantry で引き続き使う。

## テスト

### unit（vitest）

- `optional-choice-step.test.tsx`: 「指定なし」が既定で選択済み／選択で `onSelect` と
  `onNext` が1回ずつ走る／`onSkipRest` 未指定ならスキップボタンを出さない／戻る。
- `planner-wizard.test.tsx`:
  - audience の「次へ」で `5. 調理時間` に着くこと
  - 4ページを順に選ぶと `9. 確認` に着き、値が draft に入ること
  - 5ページ目のスキップで4条件が `null` のまま `9. 確認` に着くこと
  - 確認の「変更」で該当ページへ飛び、選ぶと確認へ戻ること
  - 既存の「追加条件」系4テストは確認画面のサマリ検証へ書き換え
- `planner-route-conflict.test.tsx` / `app/accessibility.test.tsx`: `5. 確認` の
  見出し名を更新。

### E2E（playwright）

- `e2e/fixtures/history.ts` に `skipOptionalPlannerSteps(page)` を追加する。5ページ目の
  「以降は指定なしでスキップ」を押して確認まで飛ばす1関数にし、audience→review を歩く
  fixture すべて（`history.ts` / `acceptance.ts` / `shopping.ts` / `shots/flows.ts`）から
  呼ぶ。
- `"5. 確認"` → `"9. 確認"` の機械置換（現状42箇所）。
- `full-journey.spec.ts`: 「ひねりたい」は8ページ目で選ぶ形へ。ここだけスキップを
  使わず4ページを歩き、自動遷移が効いていることも同時に主張する。
- `mobile-accessibility.spec.ts`: 320/375/430px の走査へ新4ページを追加。
- キーボード導線（`generation-recovery-results.spec.ts` の
  「advances four questions to review and privacy using keyboard only」）に新4ページを
  追加し、テスト名も実態へ合わせる。

## トレードオフ

確認到達までのページが 5 → 9 に増える。既定のまま進む利用者は5ページ目のスキップ
1タップで確認へ行けるので、実質の増分は1タップに収まる。1問ずつ答えたい利用者は
4タップで通過する（各ページの選択がそのまま次への遷移になるため）。

## 非目標

- 食事・メイン食材・ジャンル・対象の操作方法は変えない。
- 避ける食材・自由メモ・冷蔵庫の食材のページ化はしない。
- 送信ペイロード、`shared/contracts`、生成 Function 側は一切変えない。
