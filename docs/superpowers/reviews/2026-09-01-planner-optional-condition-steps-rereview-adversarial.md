# 追加条件ウィザードstep化 設計 — デルタ再レビュー（敵対的）

- 日付: 2026-09-01
- 対象: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md`（コミット `b9bdb099`。P-01〜P-05 と Minor を本文へ反映済み。実装は未着手）
- 初回裁定: `docs/superpowers/reviews/2026-09-01-planner-optional-condition-steps-adjudication.md`
- 判定: **REVISE。Critical 1（P-02 の `detail > 0` が 44px カードタップと両立しない）。P-01 は Closed。P-02 は Open。P-03〜P-05 は Partial。**

骨格（`firstIncomplete` 非変更、4b resume、避ける食材は確認、必須4問は「次へ」、contracts 非変更、編集中はスキップ非表示）は再攻撃しない。攻撃対象はデルタの新しい規則そのもの。

## §1 Verdict

`b9bdb099` は初回裁定のパッチ項目を本文へ埋め込んだが、P-02 の実装規則は **native radio のイベント順序・label 転送 click・「ちょうど1回」** を同時に満たせない。モバイルの正本操作は `.wizard-option` ラベル（`src/styles.css:208–211`、min-height 44px）であり、radio 円ではない。Chrome の label 転送 click は associated control 上で `pointerId: -1` / `pointerType: ""`（非ポインタ扱い）になり、UI Events は合成 click の `detail` を 0 と定める。`event.detail > 0` を input の `onClick` に置くと、カードタップでは `onNext` が落ち、6〜8ページ目は「次へ」もスキップも無いので前進不能になる。

P-04 の「全列挙」は helper 名を洗い切っておらず、P-03 の必須 unit は「2発目」と「次 step の初回 leftover」が食い違う。実装開始は、P-02 のイベント表を label/AT 込みで閉じ、P-03/P-04/P-05 の穴を本文で塞いでから。

## §2 攻撃シナリオ（デルタ向け）

| # | 攻撃 | 結果 |
| --- | --- | --- |
| 1 | P-02 表と実装規則を、未選択 click / 既選択「指定なし」再 click / 未選択 Space / 既選択 Space で native の change/click/keyup 順序に当てる | **成立（Important）**。`onChange`=値のみ、`onClick`=`detail>0` で遷移、Space は keyup で `onSelect+onNext`、再 click は `onClick` が単独で `onSelect` を担う、は同時に成立しない |
| 2 | `event.detail > 0` が支援技術・Playwright・touch・**label 転送 click** を落とすか | **成立（Critical）**。正本操作は label カード。Chrome 転送 click は非ポインタ相当。6〜8ページは逃げ道が無い |
| 3 | P-03 の 350ms 無視が native 見た目と draft をずらすか、Strict Mode、戻る/スキップ除外、unit が「同step 2発目」か「次step 初回」か | **成立（Important）**。unit 文言が実装規則と食い違う。キーボード E2E の Space 連打がガードに食われる。Strict Mode 自体は偽陽性 |
| 4 | P-01 の idea await 後 `advanceFromEditOr`。世代トークン、`confirmingIdeaAudience`、stale クロージャ、household ガードと helper の順序 | **成立しない（骨格は Closed）**。await 後に helper を呼べばクロージャのフラグはクリック時点の値で正しい。incomplete 時のフラグ処理は本文が黙っている（Minor） |
| 5 | スキップの `goToStep("review")` が P-01 の goToStep 禁止と衝突し、編集戻りや途中値を消すか | **成立しない**。禁止は audience の `goToStep("timeLimit")`。編集中は `onSkipRest` を渡さない |
| 6 | P-04 呼び出し先「全列挙」が本当に全か。helper 名、戻る×8 後の `clickWizardNext`、audience 編集後 277 付近 | **成立（Important）**。`completeIdeaPlannerToReview` / `completeMinimumPlanner` / `menu-domain-pantry.spec.ts:277` が列挙に無い |
| 7 | P-05 の options 写し漏れ、`""`→null、`Number` 禁止の抜け道 | **成立（Important）**。調理時間・予算は本文にリテラルがある。材料の使い方・雰囲気の options/`onSelect` は本文に無い |
| 8 | C-C2 / `ReviewFieldErrors` から3フィールド削除後の novelty・送信エラー着地、`stepByField` 付け替え後の `firstInvalidStep` | **成立しない（Minor 残差のみ）**。novelty はもともと `PlannerFieldName` 外。3フィールドは `stepByField` 付け替えで各 step へ戻る |
| 9 | axe 表: 5ページ目 primary=スキップ、6〜8は戻るのみ、が「primary 必須」ハーネスと矛盾するか | **成立しない**。ハーネスはボタン名の可視だけを見る。variant=primary は要求しない |
| 10 | キーボード E2E が Space で自動遷移した直後、次ページの 350ms ガードで Space が落ちるか | **成立（Important、P-03 に含む）**。heading focus → Tab 1回 → Space は 350ms 未満になり得る |
| 11 | 320px / 44px / radiogroup 名（heading 側）の `aria-labelledby` 未配線 | **一部成立（Minor）**。44px は既存 CSS。radiogroup への配線手順が本文に無い |
| 12 | 確認サマリ「変更」→選ぶ→確認。既定「指定なし」再タップで戻れるか | **P-02 に従属**。再タップが進まないと、編集戻り中（スキップ非表示）は「やめる」以外に確認へ帰れない |

## §3 P-01〜P-05 閉じ確認

| ID | 状態 | 根拠 |
| --- | --- | --- |
| P-01 | **Closed** | 本文は household を `isAudienceComplete` のあと `advanceFromEditOr("timeLimit")`、idea は await 成功後に同じ helper、フラグ解除は helper 内、`goToStep("timeLimit")` 禁止、と書いてある。live `planner-wizard.tsx:519–548` の直 `goToStep("review")` をこの helper に置換すれば「対象を変更→確認に戻る」は壊れない。await 後の `returnToReviewAfterEdit` は **クリック時クロージャの値** を読むのが正しく、stale ではなく必要値 |
| P-02 | **Open** | イベント表（本文 97–103 行）と実装規則（106–113 行）が native 順序と label 転送で同時成立しない。`detail > 0` は 44px カード（label）を落とす |
| P-03 | **Partial** | 350ms 無視と「戻る/スキップ除外」は書いてある。必須 unit が「同 step の 2発目」（本文 249 行）と「次 step の onSelect が走らない」（本文 124 行）で食い違う。キーボード E2E との競合が未記載 |
| P-04 | **Partial** | 列挙は fixture 4 本と一部 spec 行には届く。`completeIdeaPlannerToReview`（`generation-recovery-results.spec.ts:87`）、`completeMinimumPlanner`（同 `:141`）、`menu-domain-pantry.spec.ts:277` の audience 編集後 `clickWizardNext` が無い。戻る×8 だけ直して forward の `clickWizardNext` を残すと `5. 調理時間` に着地する |
| P-05 | **Partial** | 調理時間・予算の options と `""`→`null` リテラル、`Number` 禁止は本文にある（133–157 行）。材料の使い方・雰囲気は「現行 `ReviewChoiceField` と同じ literal 比較」とだけ言い、options/`onSelect` を貼っていない |

## §4 Critical

### C-1. P-02 の `event.detail > 0` は 44px カードタップ（label 転送 click）で `onNext` を落とす

**対象規則:** 本文「P-02: 自動遷移のイベント表」実装規則 2 行目（click は `event.detail > 0` のときだけ `onNext`）。外枠は `cuisine-step.tsx` 踏襲（本文 65–66 行）。

**live:**

- カードは `<label class="wizard-option"><input type="radio">…`（`cuisine-step.tsx:98–112`、`review-step.tsx:130–141`、`meal-step.tsx:104–116`）。
- `.wizard-option` が 44px ヒット領域（`src/styles.css:208–211`）。radio 円は `.wizard-option input { flex: 0 0 auto }`（同 231–233）。
- 必須4問は `onChange` のみで、遷移は「次へ」ボタンが担う。追加条件ページは DOM に「次へ」を置かない（本文 84 行）。6〜8ページはスキップも置かない（本文 170 行）。

**攻撃:** 利用者がカード（label / span）をタップする。ブラウザは label の活性化で associated radio へ **合成 click を転送**する（Chromium `HTMLLabelElement::DispatchSimulatedClick`）。Chrome の転送 click は control 上で `pointerId: -1`・`pointerType: ""`（非ポインタ扱い。w3c/pointerevents#554）。UI Events はキー由来および合成 click の `detail` を 0 と定める。実装規則どおり **input の `onClick` で `detail > 0` を見る**と:

1. カードタップ → 転送 click `detail === 0` → `onNext` しない。
2. 未選択カードなら `change` は出る → `onSelect` だけ走り、値は変わるがページは進まない。
3. 既定「指定なし」再タップなら `change` も出ない → `onSelect` も `onNext` も走らない。
4. 6〜8ページには「次へ」もスキップも無い。前進不能。5ページ目だけスキップで逃げられる。

直接 radio 円をクリックしたときだけ `detail > 0` になる。unit / Playwright が `getByRole("radio").click()` で input の layout box を叩くと **テストは緑、実カードタップは死ぬ**。

逆に転送 click の `detail` が元ポインタから 1 でコピーされる UA では、label に `onClick` を置くと「label の本物 click（detail>0）」と「input から bubble する転送 click」で `onNext` が **2回** 走り、1タップで 2ページ飛ぶ。本文はどちらにも対処しない。

支援技術の仮想クリック、`HTMLElement.click()`、Testing Library の `fireEvent.click`（MouseEvent 既定 `detail: 0`）も同じ門で落ちる。Space は keyup 別経路があるが、VoiceOver iOS のダブルタップは Space を送らず合成 click 側に乗る。

**要求する本文修正:**

- ポインタ判定は input の `detail > 0` 単体にしない。**label（カード）上の元ポインタイベント**（`pointerup` / 本物の click、`pointerType` が `mouse|touch|pen`）で `onNext` する。
- 転送 click（`pointerId === -1` または `detail === 0` の input click）では `onNext` しない、かつ二重発火しない。
- unit は **label / `.wizard-option` をクリック**して `onSelect`+`onNext` が各1回であること。input 直 click だけを緑にしてはいけない。
- 既選択「指定なし」のカード再タップで 6〜8ページから出られることを、label 経路で必須とする。

これが閉じるまで P-02 は Open。自動遷移が製品の中核なので Critical。

## §5 Important

### I-1. P-02 のイベント表と実装規則は、native の change/click/keyup 順序で「ちょうど1回」を同時に満たせない

**対象規則:** 本文 97–113 行。unit「ポインタ click で各1回 / 既選択「指定なし」の再 click でも1回 / Space で1回」（本文 245–247 行）。

**live の順序（WHATWG / Blink・Gecko: click → input → change。WebKit も click が先に揃えた）:**

| 操作 | native | 規則どおりのハンドラ | 実カウント |
| --- | --- | --- | --- |
| 未選択カードをポインタ | click（detail>0 なら `onNext`）→ change（`onSelect`） | 値は change、遷移は click。再 click 用に click 側が `onSelect` を担うなら **click でも `onSelect`** | `onSelect` **2回** + `onNext` 1回 |
| 既選択「指定なし」再ポインタ | click のみ（change なし） | click が `onSelect`+`onNext` を単独で担う（本文 111–113 行） | 各1回（click が両方やる場合だけ） |
| 未選択に Space | keyup（`onSelect`+`onNext`）→ 合成 click（detail=0 で遷移せず）→ change（`onSelect`） | | `onSelect` **2回** + `onNext` 1回 |
| 既選択に Space | keyup（`onSelect`+`onNext`）、change なし | | 各1回 |

「値は `onChange` のみ」「再 click は `onClick` が `onSelect` を単独で担う」「ちょうど1回」は **排他**。未選択ポインタで click 側が `onSelect` を省略すると、既選択再 click の `onSelect` が死ぬ。両方で呼ぶと未選択が 2回。keyup と change にも同じ mutex が要る。本文に「同一活性化で `onSelect` を一度だけにする」フラグ／手順が無い。

親の `onSelect` が同一値でも `onDraftChange({ ...draft })` を2回走らせると autosave が二重 enqueue する（`use-draft-autosave.ts` の Incomplete 黙殺とは別件）。unit の `toHaveBeenCalledTimes(1)` は、規則をそのまま書くと未選択ポインタと未選択 Space で落ちる。

**要求:** 活性化単位の擬似コードを本文に書く。例: click 開始でフラグ、`onChange` と `onClick`/`onKeyUp` が同じ値の `onSelect` を共有し、遷移はポインタ活性化と Space keyup だけ、矢印の `change` は値のみ。

### I-2. P-03 の必須 unit は「同 step の 2発目」になっており、leftover タップ（次 step の **初回** click）を緑にできる。キーボード E2E の Space は 350ms ガードに食われる

**対象規則:** 本文 121–124 行（mount から 350ms は活性化を無視、unit「次 step の `onSelect` が走らない」）対 本文 249 行（`optional-choice-step.test.tsx`: 「mount 直後 350ms 以内の **2発目** click では `onSelect` が走らない」）。キーボード導線は本文 297–299 行。

**攻撃 A（unit の読み違い）:** leftover はページ遷移後の **新しいインスタンスへの最初の click** である。`optional-choice-step` を1台 mount して 1発目を通し 2発目だけ無視する実装は、本文 249 行の文言を満たす。しかし 4ページとも先頭は「指定なし」、3番目は 調理時間=30分 / 予算=標準 で座標が重なる（本文 117–119 行の動機そのもの）。wizard を跨ぐ leftover は **次 step の 1発目** であり、249 行の unit では落ちない。124 行の wizard 単位 unit を「次 step を mount した直後の **最初の** click」と書かないと、実装者が 249 行だけを満たして P-03 を閉じたことにできる。

**攻撃 B（キーボード E2E）:** 現行 `advances four questions to review and privacy using keyboard only`（`generation-recovery-results.spec.ts:1283–1383`）は heading 自動 focus（各 step の `useEffect` + `tabIndex={-1}`、`cuisine-step.tsx:45–47, 89`）のあと `tabUntil` で Tab → Space。`tabUntil`（同ファイル 1193–1200 行）は Tab 1回 + `evaluate`。Playwright の expect ポーリングは 100ms 刻み。Space で自動遷移した直後、次ページ heading が focus 済みなら Tab 1回で先頭 radio に着き、合計が 350ms 未満になり得る。ガードが Space も無視するので、テストは次見出し待ちで落ちる。本文 297–299 行は「Space で通過」とだけ言い、350ms 待機を書かない。戻る/スキップはガード対象外（本文 123 行）だが、キーボード通過は選択肢の Space が本線。

**攻撃 C（native と draft のズレ）:** ガードがハンドラ先頭 return だけで `preventDefault` しない場合、controlled `checked={value === option.value}`（`cuisine-step.tsx:104` と同型）は native のチェックを次描画で戻す。3番目カード leftover では「標準」が一瞬点灯して「指定なし」に戻る。機能は守れるが、unit が `onSelect` 非発火だけだとこの点滅を固定できない。本文は preventDefault / pointer-events の有無を書いていない。

**Strict Mode:** `src/main.tsx` は `StrictMode`。`useRef(Date.now())` を render で持てば remount は新しいインスタンスで 350ms が張り直される。leftover は 2発目の物理タップ（~300ms 後）であり、effect 前の 0 初期化だけが危険。本文が「mount 時刻を render 時に取る」と書けば Strict Mode 攻撃は閉じる。これは偽陽性寄り。

**要求:** (1) unit は「mount 後 350ms 以内の **最初の** 活性化では `onSelect`/`onNext` が 0 回」。wizard 単位で「step N の選択直後の同座標 click で step N+1 の `onSelect` が 0 回」。(2) キーボード E2E は各任意 step の heading focus 後 350ms 待ってから Space、と本文に書く。(3) ガード中は radio の default action を止め、見た目と draft をずらさない。

### I-3. P-04 の「全列挙」から、audience→review を歩く本番 helper が抜けている

**対象規則:** 本文 271–280 行「呼び出し先（audience→review を歩く箇所を全列挙）」。`clickWizardNext` は任意 step に使わない（本文 268–269 行）。戻る×4→×8（本文 286–287 行）。

**live で列挙に無い walker:**

| 場所 | 何が起きるか |
| --- | --- |
| `completeIdeaPlannerToReview` `e2e/specs/generation-recovery-results.spec.ts:87–90` | audience の `clickWizardNext` の直後に `"5. 確認"`。本文は同ファイルを「44px（`:1268–1272`）とキーボード導線」としか書いていない |
| `completeMinimumPlanner` 同 `:141–142` | 同上。dual-tab テスト（`:410`）など多数がこれを通る |
| `savePlannerMeal` の forward `menu-domain-pantry.spec.ts:119–120` | 本文は `:77`（入場時の確認見出し）と `:118–120` を列挙している。`:118` はジャンル→audience の `clickWizardNext` で、audience→review は `:119`。戻るを ×8 にしても **forward の最後が `clickWizardNext` のまま**なら `5. 調理時間` に着地する |
| audience 編集後 `menu-domain-pantry.spec.ts:263–278` | 本文は `:263–264` を戻る×5 または「対象を変更」へ、と書く。置き換え後の **`:277` `clickWizardNext` → `:278` `"5. 確認"` が列挙に無い**。戻る×5 を選ぶと audience の「次へ」は `timeLimit` に着く（P-01）。「対象を変更」を選ぶなら `:277` は「確認に戻る」に変える必要があるが、本文はそこを指示しない |

列挙済みで足りているもの: `history.ts:237` / `:453`、`shopping.ts:88`、`shots/flows.ts:36`、`full-journey.spec.ts:71`、`mobile-accessibility.spec.ts:147`、`advanceToReviewWithHousehold`（menu-domain-pantry `:145` と shots）。`history.ts:468` は privacy 復帰後の見出しで walker ではない。`generation-recovery-results.spec.ts:1026` は cuisine→audience で、その後 `/emergency-menus` へ抜ける（review 非経由）。

`full-journey` idea は本文が `:336`（privacy 復帰後の `"5. 確認"`）に skip を置けと書く。実際の audience→review は `:315` の `clickWizardNext`。意図は読めるが、機械的に `:336` だけ触ると `:315` が `timeLimit` に落ち、`:317` の idea 注意文が見えない。

**要求:** helper 名で再列挙する（`completeIdeaPlannerToReview` / `completeMinimumPlanner` / `savePlannerMeal` / `advanceToReviewWithHousehold` ×2 / `answerAudienceAndReview` / `seedGeneratedMenu` / `seedGeneratedIdeaMenu` / `generateShoppingMenu` / `full-journey` household `:71` と idea `:315`）。`menu-domain-pantry.spec.ts:277` は「対象を変更 + 確認に戻る」か `skipOptionalPlannerSteps` かを一文で固定する。戻る×8 の **帰り** の `clickWizardNext` を skip helper に置換すると明記する。

### I-4. P-05 は材料の使い方・雰囲気の options / `onSelect` リテラルを本文に貼っていない

**対象規則:** 本文 127–166 行。裁定パッチ 4「ReviewChoiceField の options と `""`→`null` / `"15"`→`15` 写しを親のリテラルとして本文に貼る」。

調理時間・予算は本文 133–157 行に options と ternary がある。`Number(selected)` 禁止も 161 行。材料の使い方・雰囲気は「ラベルだけ `planner-labels.ts`、値の写しは現行 `ReviewChoiceField` と同じ literal 比較」（162–165 行）で、配列と `onSelect` が無い。

**live 正本（本文が「正本は ReviewChoiceField」と指す場所）:**

```664:716:src/features/planner/components/review-step.tsx
                    { value: "", label: ingredientPreferenceLabel(null) },
                    { value: "more", label: ingredientPreferenceLabels.more },
                    { value: "less", label: ingredientPreferenceLabels.less },
                    { value: "selected_only", label: ingredientPreferenceLabels.selected_only },
                    { value: "auto", label: ingredientPreferenceLabels.auto },
                  ...
                      ingredientPreference:
                        selected === "more" ? "more"
                          : selected === "less" ? "less"
                            : selected === "selected_only" ? "selected_only"
                              : selected === "auto" ? "auto"
                                : null,
...
                    { value: "", label: noveltyPreferenceLabel(null) },
                    { value: "standard", label: noveltyPreferenceLabels.standard },
                    { value: "twist", label: noveltyPreferenceLabels.twist },
                  ...
                      noveltyPreference:
                        selected === "standard" ? "standard"
                          : selected === "twist" ? "twist"
                            : null,
```

抜け道: `selected === "" ? null : (selected as IngredientPreference)`（プロジェクト禁止の unchecked cast）、`ingredientPreferences.includes(selected) ? selected : null` の別コピー。`Number` は時間フィールド用で、7/8ページでは型ごまかしが相当物。unit「指定なし後の draft が `null`」（本文 166, 254 行）は 7/8 にも必要だが、本文はフィールドを限定していない一方、写し自体が本文に無い。

**要求:** 7/8ページの options 配列と `onSelect` ternary を時間・予算と同じ粒度で本文へ貼る。`as` / `Number` / 別 enum コピーを禁止する一文を 4フィールド共通にする。

## §6 Minor

### M-1. P-01 idea/household の incomplete 経路で `returnToReviewAfterEdit` をどうするかが本文に無い

live household は先に `setReturnToReviewAfterEdit(false)` してから incomplete なら `goToStep(firstIncomplete)`（`planner-wizard.tsx:542–546`）。本文は「先に false にしてから行先直指定」を禁止し、complete ガードのあと `advanceFromEditOr` とだけ書く。incomplete のときにフラグを残すと、直し切った次の「確認に戻る」で review に帰れる（現行より良い）。落とすと、incomplete にした編集戻りが順送りになり `timeLimit` へ出る。P-01 の本線（complete な「対象を変更→確認に戻る」）は helper で閉じる。incomplete 分岐を一文足せば足りる。

### M-2. C-C2 / `ReviewFieldErrors` / `stepByField` / novelty

本文 230–236 行と 49–57 行どおり、3フィールドを details 強制オープンと `ReviewFieldErrors`（live `planner-wizard.tsx:24–39`、`review-step.tsx:149–158, 379–385`）から外し、`stepByField` を `timeLimit` / `budget` / `ingredientPreference` へ付け替える。`planner-route.tsx:1786–1797` / `:1878–1889` の `firstInvalidStep` → `setStep` はそのまま各任意 step へ着地する。`noveltyPreference` は `PlannerFieldName` に無く（`planner-wizard.ts:16–28, 109–122`）、確認カードも `invalid={false}`（`review-step.tsx:700`）。送信エラーの novelty 着地は今も無い。残差: 3フィールドを `ReviewFieldErrors` から外したあと、各 step へ `errorMessage` を渡し忘れると field error が消える。UI が valid literal しか置かないので発火は稀（初回裁定どおり）。

### M-3. axe 表の「primary」は variant=primary ではない

`src/app/accessibility.test.tsx:479–508` は `getByRole("button", { name: primary })` の可視と、meal 以外の「戻る」を見る。variant / `.ui-btn--primary` は見ない。5ページ目 primary を「以降は指定なしでスキップ」（本文は `variant="secondary"`、170–172 行）、6〜8を `primary: "戻る"` にすればハーネスは通る。スキップは `.ui-btn` で 44px（`src/styles.css:2852–2856`）。テスト名の「named primary control」と視覚的 primary のズレは注記で足りる。

### M-4. radiogroup の名前を heading 側に「持たせる」手順が無い

本文 props 表（72 行）は「radiogroup の名前はこの heading 側」。live 必須 step は `section aria-labelledby="…-title"` だけで、radiogroup 自体は無名（`cuisine-step.tsx:85–97`）。`ReviewChoiceField` だけが `aria-labelledby={`${id}-label`}`（`review-step.tsx:123–127`）。cuisine 踏襲だと radiogroup は無名のまま。現行 axe（`src/test/axe.ts` + `accessibility.test.tsx:502`）は無名 radiogroup の cuisine を通しているので新規違反にはならない。`getByRole("radiogroup", { name: "5. 調理時間" })` は失敗する。heading の `id` を radiogroup の `aria-labelledby` に張ると一文で閉じる。320px / 44px 不足は `.wizard-option` / `.ui-btn` が既に 44px なので再攻撃しない。

### M-5. 確認「変更」→既定「指定なし」再タップ

本文 212–218 行: 編集戻りは選択で `advanceFromEditOr`、戻る（「やめる」）で `returnToReviewIfQuestionsComplete`。スキップは出さない。既定「指定なし」再タップは P-02 の既選択再 click そのもの。C-1 / I-1 が閉じれば 12 番の攻撃も閉じる。P-02 が開いたままだと、編集中の利用者は「やめる」以外に確認へ帰れない（「やめる」は値を変えずに帰るので、指定なしのまま帰る用途には足りるが、15分→指定なしにして確認へ、はカードタップが進まないと 6〜8 と同様に詰まる。編集中の timeLimit にはスキップが無い）。

## §7 成立しない攻撃（偽陽性）

- **骨格の蒸し返し**（`firstIncomplete` 非変更、`?resume=review` 4b、避ける食材は確認、必須4問の「次へ」、contracts / Function 非変更、編集中スキップ非表示）: 初回裁定で閉じた。デルタはこれらを変えていない。
- **攻撃 4（P-01 stale クロージャ / 世代トークン）:** idea の await 中は `confirmingIdeaAudienceRef` で入力と戻るを捨てる（`planner-wizard.tsx:503–518`）。unmount は `ideaConfirmGenerationRef` を進め、resolve 後の `goToStep` を捨てる（234–238, 522–533 行、テスト `:651–712`）。await 成功後に `advanceFromEditOr("timeLimit")` を呼べば、クロージャの `returnToReviewAfterEdit` は **次へを押した時点の値**であり、編集戻りなら true のまま review へ帰る。`setConfirmingIdeaAudience(false)` の直後でも、同ティックの helper はまだ古い const を読む。household を complete ガードのあと helper にすれば `goToStep("timeLimit")` 禁止も守れる。
- **攻撃 5（スキップ `goToStep("review")` と P-01 の衝突）:** P-01 が禁じるのは audience の `goToStep("timeLimit")` と「フラグを落としてから直指定」。スキップは timeLimit 専用で、対象 4 フィールドを null にして review へ直行する（本文 176–189 行）。必須4問が揃ったあとの timeLimit では `firstIncomplete` は既に `"review"`（`planner-wizard.ts:44–52`）。編集中は `onSkipRest` を渡さないので、途中値を消して編集戻りを壊す経路は本文上無い。4フィールドを戻ってからスキップで消すのは文言どおり。
- **攻撃 8 の novelty 消失:** novelty は submission field error の対象外のまま（本文 54–55 行、非目標）。3フィールド削除で novelty の着地は変わらない。
- **攻撃 9（axe primary 必須との矛盾）:** ハーネスは名前付きボタンの可視だけ。6〜8の primary を「戻る」にすれば通る。
- **P-03 Strict Mode 二重 mount が leftover を通す:** leftover は ~300ms 後の 2 物理タップ。Strict Mode remount は同期的で、`useRef(Date.now())` を render で持てばガードは張り直される。
- **`clickWizardNext` を任意 step で使う以外の必須4問:** 食事〜対象の「次へ」は残る。`clickWizardNext` 禁止は任意 step 限定（本文 268–269 行）。ingredients 空の「次へ」（`generation-recovery-results.spec.ts:817`）や audience incomplete（同 `:866`）は対象外。
- **autosave が `""` を Incomplete で黙殺:** P-05 が親で `null` に畳めば `plannerDraftSchema`（`shared/contracts/planner.ts:96`）は通る。`use-draft-autosave.ts:84–86, 506–518, 642–646` の黙殺は `Number("")===0` 経路向けで、本文 161 行が禁止済み。7/8 の写し漏れは I-4。
- **320px 横スクロール / スキップ 44px:** `.wizard-actions` は wrap（`src/styles.css:700–704`）。`.ui-btn` は min 44px。長いスキップ文言は折れる。初回裁定の偽陽性を維持。
