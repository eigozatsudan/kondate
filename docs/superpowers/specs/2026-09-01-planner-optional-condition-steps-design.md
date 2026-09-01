# 追加条件を1問1ページのウィザードstepへ移す

- 日付: 2026-09-01
- 対象: 献立ウィザードの確認画面にある「追加条件」のうち選択式4つ
- 前提コミット: `9cc64886`（追加条件を select からカード選択へ変えた変更）
- レビュー: `docs/superpowers/reviews/2026-09-01-planner-optional-condition-steps-{primary,adversarial,secondary,adjudication}.md`
  裁定 REVISE の確定 Important 5 系統（P-01〜P-05）と Minor を本文へ反映済み。
  デルタ再レビューの残 Important 3 系統（D-01: walker 再列挙 / D-02: 350ms ガードの
  テスト単位 / D-03: 活性化 mutex とポインタ受け口）も本文へ反映済み。

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
| 未選択カードをポインタ tap/click | ○ | ○ |
| 既に選択済みのカード（「指定なし」含む）をポインタ再 tap | ○（同値） | ○ |
| フォーカス済み radio で Space | ○ | ○ |
| 矢印キーで選択移動 | ○ | ✕（値だけ変える） |
| その他の `change`（プログラム的変更など） | ○ | ✕ |

#### D-03: 活性化 mutex とポインタの受け口

「`change` と `click` のどちらか一方だけを数えてちょうど1回」にはできない。native の
radio ラベル操作では `change` と `click` の両方が同じ活性化から出るうえ、`click` の
`detail > 0` で実ポインタを判別する案は **WebKit で `<label>` が転送する click の
`detail` が 0 固定**なので、カードタップそのものを落とす。よって次の形にする。

- **活性化の受け口はカードの `<label>`（`.wizard-option`）の `onPointerUp`**。キーボード
  操作は pointer event を出さないので、矢印キーはここに来ない。`event.button === 0` かつ
  `event.isPrimary` のみ受ける。`detail` は一切見ない。
- **キーボードの活性化は input の `onKeyUp`（`event.key === " "`）**。
- **値だけの更新は input の `onChange`**（`onSelect` のみ、遷移しない）。矢印キーと
  プログラム的変更はここに落ちる。
- `activate(value)` は `onSelect(value)` と `onNext()` を呼ぶ単一の関数にし、**活性化単位の
  mutex**（`useRef<boolean>`）で保護する。同一活性化から `pointerup` と（転送された）
  `click` / `change` が続けて来ても2回目以降は no-op。mutex は次 step の mount でリセット
  する（step が変わらない編集戻りのケースは `advanceFromEditOr` が確認へ抜けるので
  同じく1回で終わる）。
- したがって「`change` を数える／`click` を数える」ではなく「**活性化を数える**」が
  テストの単位になる。

#### D-03: 擬似コードと順序

`activate` が常に `onSelect` + `onNext` を呼び、`onChange` が独立に `onSelect` を呼ぶと、
未選択カードの本線で `onSelect` が2回走る。順序（`pointerup` → `click` → `change`、
Space は `keyup` ハンドラ → 既定動作の `click`/`change`）を使って、**活性化中は
`onChange` を落とす**。

```tsx
// 呼び出し側: <OptionalChoiceStep key={step} … />  ← 4ページは同じ component type なので
// key が無いと instance が再利用され、mutex と mountedAt が持ち越される
function OptionalChoiceStep({ options, value, disabled, onSelect, onNext, … }) {
  const mountedAt = useRef(Date.now());
  const activating = useRef(false); // 活性化 mutex（instance ごと）

  // 350ms ガードと disabled は mutex より前に見る。ここで弾いたときは mutex を立てない
  // （立てると 6〜8ページ目で以後の操作が全部死に、スキップの無いページに閉じ込める）
  const blocked = () => disabled || Date.now() - mountedAt.current < 350;

  const activate = (optionValue: string) => {
    if (blocked() || activating.current) return;
    activating.current = true; // 同一ジェスチャの後続 click / change をここで吸収
    onSelect(optionValue);
    onNext();
  };

  // 値だけの更新（矢印キー・プログラム的変更）。mutex は立てない
  const handleChange = (optionValue: string) => {
    if (blocked() || activating.current) return;
    onSelect(optionValue);
  };

  return options.map((option) => (
    <label
      key={option.value}
      className="wizard-option"
      onPointerUp={(event) => {
        if (event.button === 0 && event.isPrimary) activate(option.value);
      }}
    >
      <input
        type="radio"
        checked={value === option.value}
        disabled={disabled}
        onChange={() => handleChange(option.value)}
        onKeyUp={(event) => {
          if (event.key === " ") activate(option.value);
        }}
      />
      <span>{option.label}</span>
    </label>
  ));
}
```

経路ごとの呼ばれ方:

| 操作 | `onSelect` | `onNext` | 機序 |
| --- | --- | --- | --- |
| 未選択カードを tap | 1 | 1 | `pointerup` の `activate`。後続の `change` は mutex で落ちる |
| 既選択（「指定なし」含む）を再 tap | 1（同値） | 1 | `change` は元々出ない。`pointerup` が単独で担う |
| 未選択 radio で Space | 1 | 1 | `keyup` の `activate` が先。既定動作の `change` は mutex で落ちる |
| 既選択 radio で Space | 1（同値） | 1 | `change` は出ない |
| 矢印キーで選択移動 | 1 | 0 | `handleChange` のみ。mutex を立てないので次の tap は生きる |
| mount 後 350ms 以内 | 0 | 0 | `blocked()`。`onChange` も落とすので、同一ジェスチャの leftover が次ページの値を書かない |

- `mountedAt` / `activating` は instance ローカルなので、**呼び出し側で `key={step}` を渡す**
  ことが前提になる。4ページは同一 component type で `<main>` の形も同じため、`key` が無いと
  React が instance を再利用して mutex が立ったまま次ページへ持ち越される。
- `blocked()` を mutex より先に評価するのが必須。逆順にすると 350ms のガードで弾いた操作が
  mutex を立て、「戻る」しか無い 6〜8ページ目から出られなくなる。
- leftover（同一ジェスチャの `click` / `change` が自動遷移後の新ページへ落ちる）は、
  `onChange` も 350ms ガードの内側に置くことで閉じる。`onNext` を遅延させる案は採らない
  （体感が鈍る）。

### P-03: 自動遷移直後のダブルタップ

4ページとも `.wizard-option` が同じ座標に並ぶ。`.wizard-transition`（180ms）は現行 step の
`<section>` には載っていないため、~300ms 後の2発目は次ページの同位置カードに落ちて
誤選択になる。E2E のフルウォークは遅いので拾えない。

- step が mount してから **350ms** の間は、`activate`（label の `pointerup` / radio の
  Space `keyup`）も `handleChange`（native `change`）も無視する。`useRef` に mount 時刻を
  持ち、両ハンドラの先頭で判定する（D-03 の `blocked()`）。
- 「戻る」とスキップボタンはこのガードの対象外にする（同位置の連打リスクが無い）。
- unit 必須（D-02）。「2発目」という書き方では、次 step の**初回** click を通してしまう
  実装でも緑になる。次の2段で書く。
  - `optional-choice-step.test.tsx`（単体）: mount 後 350ms 以内の**最初の**活性化で
    `onSelect` / `onNext` が **0 回**。`vi.useFakeTimers()` で 350ms 進めたあとの活性化で
    初めて1回ずつ。
  - `planner-wizard.test.tsx`（ウィザード単位）: 5ページ目のカードを click して
    6ページ目へ自動遷移した直後、6ページ目の**初回** click（350ms 以内）で draft が
    変わらず `6. 予算` に留まる。
- E2E のキーボード導線も 350ms を明示的に待つ。`heading` が focus されたことを
  `toBeFocused()` で確認したうえで `page.waitForTimeout(350)` を挟んでから Space を押す
  （待ちが無いと実機速度では初回 Space が握り潰されて偽赤になる）。

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
  - P-02 / D-03 の経路表を1行ずつ。操作は必ず **`.wizard-option`（`<label>`）を
    `userEvent.click` で叩く**（input を直接 `click` すると pointerup の受け口を
    通らず、実機と違う経路を測ってしまう）。未選択カードで `onSelect` / `onNext` が
    各1回 / 既選択「指定なし」の再クリックでも各1回 / 既選択の非デフォルト再クリックでも
    各1回 / Space で各1回 / 矢印キー由来の `change` では `onSelect` 1回・`onNext` 0回
  - DOM に「次へ」が無い
  - D-02: mount 後 350ms 以内の**最初の**活性化で `onSelect` / `onNext` が **0 回**
    （`vi.useFakeTimers()` で 350ms 進めたあとの活性化で初めて各1回）。同区間の
    `change` でも `onSelect` が 0 回
  - 350ms 以内に弾かれたあと、350ms 経過後の操作が生きている（mutex が立っていない）
  - `onSkipRest` 未指定ならスキップボタンを出さない
- `planner-wizard.test.tsx`
  - audience の「次へ」で `5. 調理時間` に着く（household / idea 両方）
  - 4ページを順に選ぶと `9. 確認` に着き、値が draft に入る
  - P-05: 「指定なし」通過後の draft が `null`（`""` でない）
  - 5ページ目のスキップで4条件が `null` のまま `9. 確認` に着く
  - P-01 回帰: 確認の「対象を変更 → 確認に戻る」が `9. 確認` に戻る（household / idea）
  - D-02（ウィザード単位）: 5ページ目のカードを click して6ページ目へ自動遷移した直後、
    6ページ目の**初回** click（350ms 以内）で draft が変わらず `6. 予算` に留まる
  - 確認の「変更」で該当ページへ飛び、選ぶと確認へ戻る
  - 既存の sequential テスト（`:301–333` 相当。audience の次＝確認、戻る×4 で食事）と
    編集戻りテスト（`:801–804` 相当）を新しい step 数へ更新
  - 「戻るで1つ前の質問へ、変更後の次へで確認へ直行できる」（`:746–764` 相当）は
    2箇所直す（D-01）。確認からの戻る1回は `8. 献立の雰囲気`。そこから確認へ帰るのに
    **`次へ` は無い**ので、雰囲気のカードを click して `9. 確認` へ着く形にする
    （`getByRole("button", { name: "次へ" })` をこの区間で使わない）
  - 既存の「追加条件」系4テストは確認サマリの検証へ書き換え
- `planner-route-conflict.test.tsx` / `app/accessibility.test.tsx`: `5. 確認` の
  見出し名を更新。axe 表に新4ページを足す（5ページ目の primary はスキップボタン、
  6〜8ページ目は「戻る」のみ）。

### E2E（playwright）

`e2e/fixtures/history.ts` に `skipOptionalPlannerSteps(page)` を追加する（`5. 調理時間`
の「以降は指定なしでスキップ」を押して `9. 確認` まで飛ばす1関数）。`clickWizardNext` は
「次へ」専用なので任意 step には**使わない**。

#### D-01: audience → review を歩く箇所（helper 名で列挙）

行番号ではなく helper 名で押さえる。「audience の `次へ` を押したあと `5. 確認` を
期待している」箇所がすべて対象。**既定はスキップ**（`skipOptionalPlannerSteps` を挟む）で、
下表の「手段」列が `4ページ歩き` / `Space` になっている行だけは skip を使わず、その節の
指定どおりに操作する。

| ファイル | 単位 | 現在地 | 手段 |
| --- | --- | --- | --- |
| `e2e/fixtures/history.ts` | `seedGeneratedMenu`（household） | `:237–238` | skip |
| `e2e/fixtures/history.ts` | `seedGeneratedIdeaMenu`（idea） | `:453–455` | skip |
| `e2e/fixtures/shopping.ts` | **`generateShoppingMenu`** | `:88–89` | skip |
| `e2e/shots/flows.ts` | `advanceToReviewWithHousehold` | `:36–37` | skip |
| `e2e/specs/full-journey.spec.ts` | household ジャーニー | `:71–73` | **4ページ歩き** |
| `e2e/specs/full-journey.spec.ts` | idea ジャーニー | `:315` の次 | skip |
| `e2e/specs/menu-domain-pantry.spec.ts` | `savePlannerMeal` | `:119–120` | skip |
| `e2e/specs/menu-domain-pantry.spec.ts` | `advanceToReviewWithHousehold` | `:145–146` | skip |
| `e2e/specs/mobile-accessibility.spec.ts` | **`answerAudienceAndReview`** | `:147–149` | **4ページ歩き** |
| `e2e/specs/generation-recovery-results.spec.ts` | `completeIdeaPlannerToReview` | `:87–90` | skip |
| `e2e/specs/generation-recovery-results.spec.ts` | `completeMinimumPlanner` | `:141–142` | skip |
| `e2e/specs/generation-recovery-results.spec.ts` | 44px レイアウト走査 | `:1259–1272` | **4ページ歩き** |
| `e2e/specs/generation-recovery-results.spec.ts` | キーボード導線 | `:1358–1385` | **Space** |

- `e2e/fixtures/shopping.ts` の `ensurePlannerReady`（`:40–67`）は **walker ではない**
  （`1. 食事` の radio を出すところで止まる）。ここに skip を足しても意味が無い。
- `e2e/fixtures/acceptance.ts` は wizard を歩かない（`history.ts` からの re-export）ので
  対象外。`generation-recovery-results.spec.ts:866–871` は「人数未選択で遷移しない」ことの
  主張で audience に留まるため対象外。
- `menu-domain-pantry.spec.ts:263–278`（対象を選び直して確認へ戻るインライン）は
  **確認の「対象を変更」→ audience で選び直し → 「確認に戻る」** へ書き換える。
  編集戻り中の primary は `editReturnActionLabels` の `nextLabel`＝**「確認に戻る」**で
  あって「次へ」ではないので、`clickWizardNext`（`次へ` 専用）は使わず
  `getByRole("button", { name: "確認に戻る" }).click()` を書く。`advanceFromEditOr` が
  `9. 確認` へ直帰するため skip も4ページ歩きも要らない（P-01 の E2E 側の裏取りを兼ねる）。
  「戻る×5」案は採らない。
- **「指定なし」を通過する操作は `.check()` ではなく `.click()`。** 既定で checked の
  radio に対する Playwright の `.check()` は「既に checked」で no-op になり、
  `pointerup` が出ないので前進しない。

**privacy 復帰行は歩かない。** 次の箇所は `/privacy` から `?resume=review` で戻った先の
見出し名を主張しているだけで、ウィザードを進む処理ではない。見出し名の
`5. 確認` → `9. 確認` 置換side（後述の42件）に属する。

- `e2e/fixtures/history.ts:468`
- `e2e/specs/mobile-accessibility.spec.ts:96`
- `e2e/specs/full-journey.spec.ts:336`
- `e2e/specs/generation-recovery-results.spec.ts:103`、`:440`

#### 戻る回数の更新

- `menu-domain-pantry.spec.ts` `savePlannerMeal`（`:77–80`）の「確認から戻る×4 で
  `1. 食事`」は戻る×8、または確認の「食事を変更」へ置き換える。
- `menu-domain-pantry.spec.ts:263–264` の「戻る×1 で `4. 作る相手`」は確認の
  「対象を変更」へ置き換える（上記のとおり戻り道は「確認に戻る」）。
- 確認からの戻る1回は `8. 献立の雰囲気`。

#### 4ページを歩く行の共通ルール

手段列が `4ページ歩き` / `Space` の行（household full-journey、
`mobile-accessibility` の `answerAudienceAndReview`、44px 走査、キーボード導線）は
すべて次に従う。

- **各ページで 350ms 待つ。** `blocked()` は**そのページの mount** から数えるので、
  `heading` が可視／focus になった直後の `.click()` や Space は食われる。
  ページごとに `await expect(heading).toBeVisible()`（キーボード導線は `toBeFocused()`）
  のあと `await page.waitForTimeout(350)` を置いてから操作する。
- **新4ページに「次へ」は無い。** `clickWizardNext` を使わない、`次へ` を
  `expectMajorActionAtLeast44` で測らない、`tabUntil(focus.name === "次へ")` を書かない
  （どれも 0 件で赤になる）。前進はカード（`.wizard-option`）の click か radio の Space。
- 「指定なし」のまま通過する場合も `.check()` ではなく `.click()`（既 checked の
  `.check()` は no-op）。

#### 個別

- `full-journey.spec.ts` household: 「ひねりたい」は `8. 献立の雰囲気` で選ぶ。ここだけ
  スキップを使わず4ページを歩き、自動遷移が効いていることも同時に主張する。
  各ページで 350ms 待ってからカードを click する。
- `full-journey.spec.ts` idea: `skipOptionalPlannerSteps` を使う。
- キーボード導線テスト（`generation-recovery-results.spec.ts` の
  「advances four questions to review and privacy using keyboard only」）。`onKeyUp` は
  **radio** に載るので、heading にフォーカスしたまま Space を押しても届かない。
  h2 は `tabIndex={-1}` で Tab 順にも入らない。各ページの手順は
  `await expect(heading).toBeFocused()` → `await page.waitForTimeout(350)` →
  `tabUntil(page, (focus) => (focus.role === "radio" || focus.type === "radio") &&
  focus.name.includes("<選ぶ選択肢>"), …)` → `page.keyboard.press("Space")` の4手。
  この4ページでは `tabUntil(focus.name === "次へ")` を書かない（存在しない）。
  programmatic `.focus()` フォールバック禁止の既存ルールはそのまま。テスト名も実態へ
  合わせる。
- `mobile-accessibility.spec.ts` `answerAudienceAndReview`: 320/375/430px の走査へ新4ページを
  追加し、4ページを歩いて `9. 確認` まで進める。各ページの `assertStepFits` は
  `5. 調理時間` が `{ 以降は指定なしでスキップ: 1, 戻る: 1 }`、`6.`〜`8.` が
  `{ 戻る: 1 }`（「次へ」は存在しない）。各ページで 350ms 待ってから card を click する。
- 44px レイアウト走査（`generation-recovery-results.spec.ts:1259–1272` 付近）は現行、
  各 step で `expectMajorActionAtLeast44(page, "次へ")` を測り、`次へ` を focus して
  Enter で進める。新4ページではこの形が使えない。各ページで
  `expectNoHorizontalScroll` → 350ms 待ち → radio を `.focus()` して
  `activateFocusedWithKeyboard(page, "Space")` で進める形にし、測る対象は
  `5. 調理時間` が「以降は指定なしでスキップ」と「戻る」、`6.`〜`8.` が「戻る」だけに
  する（`次へ` は測らない）。
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
