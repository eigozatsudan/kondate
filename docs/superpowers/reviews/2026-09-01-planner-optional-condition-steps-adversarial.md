# 追加条件ウィザードstep化 設計 — 敵対的レビュー

- 日付: 2026-09-01
- 対象: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md`
- 実施者: 読み取り専用 Reviewer（敵対的入力・競合・運用ミス担当）
- 判定: **REVISE — Critical 0 件、Important 5 件、Minor 4 件**

## 1. Verdict

選択式4条件のページ化そのもの、`firstIncompletePlannerStep` を触らない判断、`?resume=review` 契約、避ける食材・メモ・冷蔵庫を確認に残す線引き、送信ペイロード非変更は現行コードと衝突しない。安全・quota・RLS・アレルギー欄が消える Critical は成立しない。

一方、設計どおりに実装すると **household の「確認に戻る」が調理時間へ送られる**、**既定の「指定なし」では 6〜8 ページから確認へ出られない（矢印キーでは逆にページが飛ぶ）**、**ダブルタップで次ページの同位置が誤選択される**、**E2E の audience→review 短絡が fixture 4 ファイル以外に残る**、**`value: ""` を draft に入れると Zod / autosave が死ぬ**、が起きる。Task 化前にイベント意味・household の `advanceFromEditOr`・空文字変換・E2E 全経路を仕様へ固定すべきである。

## 2. 主要な攻撃シナリオ

1. 選択のダブルタップ / 連打で onSelect+onNext が二重発火し draft が壊れる、または次ページの同位置を誤選択する
2. 「以降は指定なしでスキップ」が編集戻り中に出る、または出なくても値が消える経路
3. スキップが avoid / memo / pantry / 必須質問まで null にする
4. 戻る→選び直し、確認の「変更」で1条件だけ直すとき他3条件が消える / 残る不整合
5. `returnToReviewAfterEdit` と idea 確定経路と household 経路の分岐漏れ
6. `firstIncompletePlannerStep` を変えない設計が resume 先を崩す / 未保存の任意値が消える
7. `?resume=review` 深リンク（不変契約 4b）が step 配列挿入で壊れる
8. `stepByField` 付け替え漏れで submission field error が確認に出ない
9. `noveltyPreference` は PlannerFieldName に無いという主張が誤り
10. 自動遷移が必須4問にも漏れて入る、または cuisine-step 流用で「次へ」が残る
11. キーボードのみ（Enter / Space / Tab / 矢印）で選択+自動遷移ができず、またはフォーカスが次ページの h2 に乗らない。320px / 44px
12. `disabled` / `isSaving` 中に選択やスキップが通り、中途半端な draft が保存される
13. スキップ後に確認の「変更」で戻ると、null にした値が復活する / autosave 競合
14. 見出し番号「5. 確認」→「9. 確認」の置換漏れ（42箇所主張の真偽、他の「5.」誤置換）
15. E2E fixture `skipOptionalPlannerSteps` を入れ忘れる経路
16. 選択値 `value: ""` と `null` の往復で Zod / draft RPC が 422、または空文字が送信される
17. ブラウザが `@shared/safety` を import する所有境界越え
18. 送信ペイロード・Function・contracts を step 追加に合わせて変える / UI step 名が persistence に漏れる
19. スクリーンリーダー: 選択と同時にページが消えるアナウンス不足、スキップと「指定なし」の二重
20. 既存利用者が途中 draft を持つ状態でデプロイ後に resume したときの互換
21. `editReturnActionLabels` の nextLabel を渡さない結果、確認へ戻れない / 「やめる」が無い
22. 同一選択肢の再選択（既に選ばれている「指定なし」を再タップ）で次へ進むか、進めないか

## 3. Critical

なし。スキップ対象は選択式4フィールドに閉じ、avoid / アレルギー評価 / quota / RLS / 認証を設計が触る攻撃は現行ハードゲートと一致しない。

## 4. Important

### I-01: household の audience「次へ」を timeLimit 固定にすると、確認の「確認に戻る」が調理時間へ送られる

根拠:

- 設計「ウィザードの遷移」は household について「`isAudienceComplete` ガードはそのまま。通過後 `timeLimit` へ」とだけ書く。idea だけ「編集戻りだったときは従来どおり `review`、順送りのときだけ `timeLimit`」と分岐する。
- 現行 household `onNext` はフラグを捨てたあと **常に** `review` へ行く。編集戻りでも順送りでも同じ行である。

```542:548:src/features/planner/components/planner-wizard.tsx
            setReturnToReviewAfterEdit(false);
            // household 等: 未完成 audience / 非 eligible のまま review へ進めない（P2/P7）
            if (!isAudienceComplete(draft, eligibleMemberIdSet)) {
              goToStep(firstIncompletePlannerStep(draft, eligibleMemberIdSet));
              return;
            }
            goToStep("review");
```

- 確認の「対象を変更」は `returnToReviewAfterEdit` を立て、audience の主ボタンは `nextLabel: "確認に戻る"` になる（`editReturnActionLabels` 275–277 行、audience へ spread 559 行）。主ボタンは `onNext` である。
- 追加条件 step は `advanceFromEditOr` を通すと書いてあるが、audience は独自経路のまま。meal / cuisine は既に `advanceFromEditOr` を使っている（421–422, 477–478 行）。
- ウィザード末尾は `if (step === "audience")` のあと無条件で ReviewStep を描く（566 行コメント `// review`）。新 step の分岐を足すまで `timeLimit` でも確認画面が出る足場でもある。

成立条件:

1. 仕様どおり household の `goToStep("review")` を `goToStep("timeLimit")` に差し替える。
2. 利用者が確認で「対象を変更」→中身は触らず「確認に戻る」を押す。
3. 着地は `9. 確認` ではなく `5. 調理時間`。以降のスキップボタンが出る（編集戻り中ではないので `onSkipRest` が渡る）。誤ってスキップすると他3条件まで null になる。

必要な修正:

- household は complete ガードのあと **`advanceFromEditOr("timeLimit")`** とリテラルで書く。`goToStep("timeLimit")` と書かない。
- idea は設計どおり編集戻り→`review`、順送り→`timeLimit`。`await onIdeaAudienceConfirmed()` のあと、クロージャの `returnToReviewAfterEdit` を読んでからフラグを落とす（現行 536–538 行は先に false にして review 固定）。
- ユニットに「確認→対象を変更→確認に戻る→`9. 確認`（`5. 調理時間` ではない）」を household / idea 両方で固定する。

### I-02: 自動遷移を radio `onChange` に載せると、既定の「指定なし」では 6〜8 ページから出られず、矢印キーではページが飛ぶ

根拠:

- 決定事項 1: 「各ページに『次へ』は置かず」「『指定なし』を押すこと自体がスキップ操作を兼ねる」。スキップボタンは `timeLimit` だけ。
- 新 step は cuisine-step を踏襲し、`onSelect` と `onNext` を同じハンドラで呼ぶ。現行の選択 UI はすべて native radio の `onChange` である。

```106:108:src/features/planner/components/cuisine-step.tsx
                    onChange={() => {
                      onChange(key);
                    }}
```

```137:139:src/features/planner/components/review-step.tsx
              onChange={() => {
                onSelect(option.value);
              }}
```

- 先頭は必ず「指定なし」（`value: ""`）、確認画面でも既定でそれが checked（wizard テスト 925–928 行）。checked 済み radio の再クリックは **`change` を発火しない**。
- 予算 / 材料の使い方 / 献立の雰囲気にはスキップも「次へ」も無い。調理時間で 15 分を選んで自動遷移した利用者は、予算で既定の「指定なし」をタップしても進めない。
- 逆に radiogroup の矢印キーは選択を動かして `change` を飛ばす。`onChange` 内で `onNext` すると、最初の矢印で次ページへ消える。キーボード E2E は Space で radio を選び Enter で「次へ」と分けている（`generation-recovery-results.spec.ts` 1345–1357 行）。自動遷移ページではその分離が無くなる。
- ユニット一覧は「選択で onSelect と onNext が1回ずつ」だけで、「既選択の指定なしでも進む」「次へが無い」「矢印では進まない」が無い。

成立条件:

1. `optional-choice-step` を cuisine-step と同じ `onChange` + 自動 `onNext` で書く。
2. 順送りで 15 分を選ぶ → 予算は「指定なし」が checked → タップも Space も無反応。戻る以外の出口が無い。
3. キーボード利用者が予算で矢印を押す → `economy` が選ばれ同時に材料の使い方へ飛ぶ。選択肢を読み比べできない。

必要な修正:

- 自動遷移の発火を **ポインタの click / Space のみ** に固定する。native `change`（矢印キー）では `onNext` しない。
- 既選択の「指定なし」タップでも `onSelect("")` + `onNext` が1回走る、とテストする（`onClick` または button カード。checked radio の `onChange` では失敗する）。
- 「次へ」が DOM に無いこと、`onSkipRest` 無しページではスキップも無いことをユニットで固定する。
- キーボード E2E は新4ページで「Tab → 指定なしで Space → 次見出しへ focus」を主張する。矢印でページが変わらないことも1件入れる。

### I-03: 自動遷移直後のダブルタップが、次ページの同位置カードを誤選択する

根拠:

- 設計は選んだ瞬間に次ページへ進める。cooldown / `pointer-events` 抑制は書いていない。
- 4ページとも同じ `.wizard-option-list` / `.wizard-option`（`styles.css` 202–220 行、`min-height: 44px`）。先頭はどれも「指定なし」。調理時間の 2 番目は「15分以内」、予算の 2 番目は「節約優先」。
- React は同一クリックの処理後に次 step を commit するので単発タップは次ページへ貫通しない。ダブルタップの 2 発目（~300ms）は **新しい radiogroup の同じ座標** に落ちる。
- I-02 を click 発火に直すと、この誤選択はより起きやすい（既選択でも 2 発目が通る）。

成立条件:

1. 利用者が「15分以内」を素早く二度タップする（モバイルの慣れた操作）。
2. 1 発目で `timeLimitMinutes=15` になり予算へ進む。
3. 2 発目が「節約優先」を選び、続けて材料の使い方へ進む。確認サマリには予算が残る。本人は調理時間だけ選んだつもり。

必要な修正:

- ページ遷移後 300–400ms は選択肢の pointer を無視する、または `onNext` を `pointerup` 後に rAF / timeout で遅らせる、と書く。
- ユニットに「選択直後の 2 回目 click では次 step の onSelect が走らない」を入れる。E2E のフルウォークはゆっくりで偽緑になるのでユニット必須。

### I-04: `skipOptionalPlannerSteps` の呼び出し先が足りず、機械置換だけでは大量 E2E が赤になる

根拠:

- 設計は fixture を `history.ts` に置き、呼ぶのは `history.ts` / `acceptance.ts` / `shopping.ts` / `shots/flows.ts` だけとする。`full-journey` のひねり・`mobile-accessibility` の 4 ページ追加・キーボードテストは個別に触る。
- `"5. 確認"` の機械置換対象は **42 箇所で正しい**（引用符付き一致。`review-step.tsx` の JSX 見出しは引用符無しなのでこの集合に入らない）。置換だけでは audience の次が `5. 調理時間` のまま待ち続ける。
- 設計が列挙していない短絡:

```63:80:e2e/specs/menu-domain-pantry.spec.ts
 * 「戻る」を4回押してmeal stepまで戻り、食事だけを変更してから再びreviewへ進む。
...
  await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible();
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole("button", { name: "戻る" }).click();
  }
  await expect(page.getByRole("heading", { name: "1. 食事" })).toBeVisible();
```

  設計どおり `review.onBack` を `novelty` に変えると、戻る 4 回の着地は食事ではなく `5. 調理時間`。同ファイルの `advanceToReviewWithHousehold`（127–146 行）も audience の次を確認だと思っている。

- `generation-recovery-results.spec.ts` の `completeIdeaPlannerToReview`（87–90 行）と `completeMinimumPlanner`（141–142 行）は audience の次へ `clickWizardNext` して確認を待つ。キーボードテスト以外は設計の更新リストに無い。
- `full-journey.spec.ts` の idea ジャーニー（315–336 行）は audience の次で「家族の年齢・アレルギーは確認されません」と生成ボタンを探す。household 側のひねりだけ 8 ページ目へ移す指定で、idea 側はスキップも 4 ページ歩きも書いていない。
- `mobile-accessibility.spec.ts` の `answerAudienceAndReview`（147–149 行）も audience の次が確認。本文の「320/375/430px の走査へ新4ページを追加」と、この helper の更新が結びついていない。

成立条件:

1. 見出しを `"9. 確認"` に機械置換し、fixture 4 ファイルだけスキップを入れる。
2. `menu-domain-pantry` の戻る 4 回が `5. 調理時間` で「1. 食事」待ち timeout。`generation-recovery` / idea full-journey / mobile helper は確認見出し待ちで落ちる。
3. `clickWizardNext` は「次へ」専用（`history.ts` 41–42 行）。新ページに「次へ」が無いので、スキップ未呼び出しのまま次へを探すテストも死ぬ。

必要な修正:

- audience→review を歩く **全 helper** を列挙して `skipOptionalPlannerSteps` を呼ぶ: 上記に加え `completeIdeaPlannerToReview` / `completeMinimumPlanner` / `advanceToReviewWithHousehold` / `savePlannerMeal` / `answerAudienceAndReview` / `seedGeneratedIdeaMenu` / `seedGeneratedMenu` / `generateShoppingMenu`。
- `savePlannerMeal` の戻る回数を 8 にするか、確認の「食事を変更」に切り替える（後者が編集戻り契約と一致する）。
- idea `full-journey` も household と同様、スキップするか 4 ページ歩くかを明示する。
- 「42 箇所の機械置換」は見出しアサーションの置換であり、戻る回数・`clickWizardNext`・「次へ」前提は別作業だと書く。

### I-05: 選択肢 `value: ""` を draft にそのまま入れると schema が落ち、autosave が止まる

根拠:

- 設計の options は先頭 `value: ""`、`onSelect` は「選択値を親へ返す」。`null` ↔ `""` の変換コードは無い。
- 現行確認画面は空文字を **フィールド型の null** に落としている。

```603:614:src/features/planner/components/review-step.tsx
                  onSelect={(selected) => {
                    onChange({
                      ...value,
                      timeLimitMinutes:
                        selected === "15"
                          ? 15
                          : selected === "30"
                            ? 30
                            : selected === "45"
                              ? 45
                              : null,
                    });
                  }}
```

- draft schema は `timeLimitMinutes` が `15 | 30 | 45 | null` のみ。`""` も `Number("") === 0` も拒否する。

```96:103:shared/contracts/planner.ts
  timeLimitMinutes: z.union([z.literal(15), z.literal(30), z.literal(45)]).nullable(),
  budgetPreference: z.enum(budgetPreferences).nullable(),
  ...
  noveltyPreference: z.enum(noveltyPreferences).nullable().default(null),
```

- autosave は `plannerDraftInputSchema.safeParse` が失敗すると persistable ではないとみなし、debounce では Incomplete を握りつぶす（`use-draft-autosave.ts` 84–86, 42–40, 506–518, 642–646 行）。`timeLimitMinutes: ""` が混ざると **audience 中立化でも persistable に戻らず**、以降の下書き保存が止まる。
- 生成時 `plannerSubmissionSchema.safeParse` も同様に失敗し、`firstInvalidStep` へ戻される（`planner-route.tsx` 1784–1798 行）。`stepByField` を付け替えても、フィールド値が `""` のままだと step 側で直しきれない。

成立条件:

1. 親が `onSelect={(v) => onDraftChange({ ...draft, timeLimitMinutes: v })}` または `Number(v)` と書く。
2. 「指定なし」またはスキップ相当で `""` / `0` が入る。
3. 保存トーストは出ず（Incomplete は error にしない）、確認から生成すると field error か summary。I-02 で「指定なし」タップが初めて draft を更新する実装だと、ここで顕在化する。

必要な修正:

- 親の変換を現行 ReviewChoiceField と同じく固定する。`""` → 各フィールドの `null`、`"15"|"30"|"45"` → number literal。`Number("")` 禁止。
- `onSkipRest` は `{ ...draft, timeLimitMinutes: null, budgetPreference: null, ingredientPreference: null, noveltyPreference: null }` と spread をリテラルで書く（avoid / memo / pantry / 必須質問を残す）。
- ユニットで「指定なし選択後の draft は `null` であり `""` ではない」「その状態で `plannerDraftInputSchema.safeParse` が成功する」を固定する。

## 5. Minor

### M-01: スキップボタンの `disabled={disabled}` が未記載

`isSaving` は submit / 下書き競合 / leave-flush 中に立つ（`planner-route.tsx` 1652–1664 行）。既存 step は radio も Button も `disabled` を渡す（cuisine-step 103, 121 行）。スキップだけ付け忘れると、競合 chrome 表示中に 4 フィールドを null にできる。`disabled` をスキップにも必ず渡すと一文で足りる。

### M-02: 確認の操作説明が「確認に戻る」のまま

```558:561:src/features/planner/components/review-step.tsx
            {onEditStep !== undefined && (
              <p className="type-small">
                「戻る」で1つ前の質問へ、「変更」でその質問へ直接戻れます。直したあとは「確認に戻る」でこの画面に戻ります。
```

追加条件 step には `nextLabel` を渡さない（設計どおり）。編集戻りは選択で自動復帰し、戻るは「やめる」。サマリ 4 行を足すならこの文も「選ぶと確認に戻ります」へ更新する。機能は `やめる` で戻れるので Important にはしない。

### M-03: ウィザードの最終枝が常に ReviewStep

`planner-wizard.tsx` は meal / ingredients / cuisine / audience 以外を全部確認にする（566 行）。`plannerSteps` に 4 つ足した直後、分岐前は `timeLimit` でも「確認」が出る。exhaustive switch か、未知 step で throw するとテスト前に気づける。設計のテスト（audience の次が `5. 調理時間`）が最終防衛。

### M-04: 既に選ばれている非デフォルト（例: 15分）の再タップは未規定

I-02 の「指定なし」再タップとは別に、15 分が checked の状態で同じカードを押したとき進むのか留まって選び直せるのか、設計に無い。click 発火なら進み、`change` なら留まる。製品判断で閉じられる。I-02 のイベント表に 1 行足せば足りる。

## 6. 成立しなかった攻撃（偽陽性候補）

検証したが現行コードまたは設計の明示判断で閉じているもの。

1. **スキップが編集戻り中に出る**: `onSkipRest` は渡したときだけ出す、編集中は渡さない、と明示。実装すれば出ない。household が誤って timeLimit へ来た場合だけ I-01 経由で露出する。
2. **スキップが avoid / memo / pantry を消す**: 対象 4 フィールドを列挙している。I-05 の spread を書けば TypeScript 上も部分オブジェクトは通らない。emptyDraft 差し替えは現行 `onChange({ ...value, field })` パターンから外れる。
3. **1条件の変更で他3条件が消える**: 編集中はスキップ非表示、選択は当該フィールドだけ `onSelect`。`advanceFromEditOr` は draft を触らない。
4. **idea 順送りが review のまま / 編集中なのに timeLimit**: idea 分岐は設計が書いてある。漏れは household（I-01）。
5. **`firstIncompletePlannerStep` 非変更で resume が review 以外になる**: 必須4問が揃えば今も必ず `"review"`（`planner-wizard.ts` 48–52 行）。任意 step を踏んでも判定は変わらない。途中の任意値はフィールドとして draft に残る（step は persist しない）。
6. **`?resume=review` 破壊**: route は `resume === "review" && firstIncomplete === "review"` のときだけ確認へ固定（`planner-route.tsx` 651–656, 695–696 行）。firstIncomplete を触らなければ 4b は保つ。
7. **`stepByField` 付け替え漏れで error が消える**: 設計が `timeLimitMinutes` / `budgetPreference` / `ingredientPreference` の付け替えと ReviewFieldErrors から外すことを書いている。忘れれば TS が `buildReviewFieldErrors`（wizard 24–39 行）で気づく。novelty は対象外。
8. **`noveltyPreference` が PlannerFieldName にある**: 無い（16–28, 109–122 行）。`mapPlannerIssuePathToField` は未知 root を null にする。確認の ReviewChoiceField も `invalid={false}`（695–701 行）。主張は正しい。
9. **自動遷移が必須4問に漏れる**: 「新しい追加条件のページだけ」と非目標で食事〜対象を変えないと書いてある。cuisine-step 本体を改変しなければ漏れない。残るのは「次へ」コピーの足場（I-02）。
10. **320px / 44px 不足**: `.wizard-option` と `.ui-btn` は既に `min-height: 44px`（`styles.css` 211, 2852–2855 行）。`wizard-actions` は `flex-wrap`（699–704 行）。長いスキップ文言は折り返す。材料の使い方の長ラベルは 1 ページ化で現行 4 積みより悪化しない。
11. **スキップ後の値復活 / autosave 競合**: `onSaved` は query cache だけ更新し local `value` をサーバ行で置換しない（`planner-route.tsx` 802–810 行）。in-flight と latest が違えば追記ループで latest に収束する（`use-draft-autosave.ts` 538–570 行）。スキップの null が最終 latest なら残る。
12. **「5.」の誤置換**: 一致は `"5. 確認"` 42 箇所で設計どおり。`15分` や `5. 調理時間` は含まない。見出し以外の戻る回数は I-04。
13. **`@shared/safety` 境界越え**: 現行 planner UI は `@shared/safety-pure/medical-scope` のみ（`review-step.tsx` 13 行）。新 step は labels + UI。設計が safety 評価を動かさない。
14. **contracts / Function を変える誘惑 vs step 名の persistence 漏れ**: 非目標でペイロード非変更。`PlannerStep` は route の React state のみで、autosave / RPC 引数に step 名は無い（`toDraftInputFields` 66–81 行）。
15. **既存途中 draft の互換**: 必須完了済みは firstIncomplete が review のまま着地。任意値は既存列に載っている。audience 未了の人だけ、次へ以降が 4 ページ増える（本機能の意図）。
16. **nextLabel 非渡しで確認に戻れない**: 編集戻りは選択で `advanceFromEditOr`、戻るは `backLabel: "やめる"`。どちらも `returnToReviewIfQuestionsComplete`。nextLabel は不要。
17. **スクリーンリーダーのページ消滅**: 既存 step と同じ `h2 tabIndex={-1}` + mount focus（cuisine-step 45–47, 89 行）。スキップ文言と「指定なし」radio は別名。live region 追加は改善余地で、現行「次へ」遷移と同型。
18. **isSaving 中の選択**: 既存どおり radio `disabled`。スキップだけ M-01。autosave 中は `isSaving` に載せない（route 1653–1655 行）のは現行契約。

## 7. 受け入れ残差になり得るもの

- 確認到達が 5→9 ページになること自体はトレードオフとして受理済み。I-02 を閉じれば「指定なしで進む」導線はスキップ 1 タップまたは各ページの指定なしタップで足りる。
- 任意 step を resume の incomplete に載せないため、リロードすると調理時間の途中でも確認へ戻る。設計判断。値はフィールドに残る。
- ひねり (`noveltyPreference`) の field error UI は今も無く、今回も増やさない。導入前 snapshot の `.default(null)` と同型。
