# 追加条件ウィザードstep化 Implementation Plan — 一次レビュー

- 日付: 2026-09-01
- 対象: `docs/superpowers/plans/2026-09-01-planner-optional-condition-steps.md` @ `34f5e2d3`
- Spec: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md` @ `f7f7c1ad`
- 実施者: 読み取り専用 Reviewer
- 判定: REVISE — Critical 0、Important 6、Minor 6

## 1. Verdict

骨格は APPROVE 済み Spec と live に沿っている。`plannerSteps` 挿入、`firstIncompletePlannerStep` 非変更、`noveltyPreference` を `PlannerFieldName` に足さない、`shared/contracts` 非変更、`Number(selected)` 禁止、P-01 の `advanceFromEditOr("timeLimit")`、D-03 の `onPointerUp` + Space `onKeyUp` + 活性化 mutex、P-03 の 350ms を `handleChange` にもかける、5ページ目だけスキップ、編集戻り中は `onSkipRest` 非表示、D-01 helper 名（`generateShoppingMenu` / `ensurePlannerReady` 除外 / `answerAudienceAndReview`）、pantry `:263–278` を「対象を変更 → 確認に戻る」、キーボード 4 手、44px の測る対象、は本文に落ちている。

実装開始を止めるのは Critical ではなく、**Task 3/4 の unit 検証コマンドが計画どおりでは緑にならない**ことと、**Task 6 household の twist 同期点が消える**ことである。Implementer が Step 4 を通すために誤ったテスト削除・`describe.skip`・Task 4 の先取り・novelty wait 削除をすると、本線が壊れる。

## 2. Spec coverage 表 (Spec節 → Task → 穴)

| Spec 節 | Task | 穴 |
| --- | --- | --- |
| step モデル（`plannerSteps` / `stepByField` / `firstIncomplete` 非変更 / `noveltyPreference` 非追加） | Task 1 | なし |
| 新 step コンポーネント props / 「次へ」不在 | Task 2 | なし（`id` / `backLabel` は props 表外だが 4 ページ分離と「やめる」に必要） |
| P-02 イベント表 / D-03 mutex・`onPointerUp` / `key={step}` | Task 2（実装）/ Task 3（key） | なし |
| P-03 350ms と 2 段 unit | Task 2 / Task 3 | Task 3 の wizard 初回 click は `.wizard-option` で正しい |
| P-05 値とラベル正本、`""`→`null` | Task 3 | draft 観測手段が live Harness に無い（I-1） |
| 「以降は指定なしでスキップ」（編集戻り中は非表示） | Task 3 | なし |
| P-01 audience `advanceFromEditOr`、各 step `onNext`/`onBack`、`nextLabel` 非伝播、exhaustive | Task 3 | なし。idea 既存着地テストの更新リストが抜けている（I-3） |
| 確認画面（カード削除・サマリ 4 行・`forceAdditionalOpen`・`buildReviewFieldErrors`・説明文） | Task 4 | 説明文は 9 ページ向けに書き換え済み。任意 step の「選ぶと確認に戻る」書き分けは rereview4 Minor 3（本線非ブロック） |
| unit テスト網 | Task 2 / 3 / 4 | Task 3 の「調理時間を変更」は Task 4 依存（I-2）。確認ラジオ操作テストの列挙漏れ（I-4） |
| axe 表・`planner-route-conflict` 見出し | Task 3（見出し）/ Task 4（axe） | axe 追加行が live `it.each` と矛盾（I-5） |
| E2E skip helper と skip 行 9 件 | Task 5 | なし（helper 名は Spec D-01 と一致） |
| 戻る回数、pantry `:263–278` | Task 5 | なし（「確認に戻る」、`clickWizardNext` 禁止） |
| `"5. 確認"` 置換、privacy 復帰は置換のみ | Task 5 | grep が `*.ts` のみ（Minor） |
| 4 ページ歩き 4 箇所と共通ルール | Task 6 | household の `noveltySaved` 付け替えが無い（I-6） |

## 3. Critical

なし。閉じ込め（6〜8 ページに戻るあり、ガード失敗時は mutex を立てない）、leftover（`handleChange` も 350ms 内 no-op）、`firstIncomplete` / 4b、`shared/contracts` を計画が変更する経路は無い。

## 4. Important

### I-1: Task 3 の draft 断言が live Harness に存在しない API を呼ぶ

- Plan: Task 3 Step 1（605–666 行付近）。`const { latestDraft } = renderWizardAtTimeLimit()` と `latestDraft().timeLimitMinutes` / `toMatchObject({ timeLimitMinutes, budgetPreference, … })`。
- Spec: 354–358 行（4 ページ歩行後の draft、P-05 の `null`、スキップ後 4 フィールド `null`、D-02 で draft が変わらない）。
- live: `src/features/planner/components/planner-wizard.test.tsx:51–158` の `Harness` は `useState` の draft を返さない。ファイル内に `renderWizardAtTimeLimit` / `latestDraft` は無い。既存の追加条件テストは確認画面の radio を見る（`:934–1017`）。

失敗経路: Step 1 を本文どおり貼ると `latestDraft is not a function` で RED。Step 3 の実装リストは wizard / review 見出しだけで Harness 拡張が無い。Implementer は (a) 断言を捨てて P-05 を測らない、(b) 未指定の Harness 改修を発明する。確認サマリは Task 4 まで無いので、Task 3 時点で UI から 4 フィールドを読む手段も無い。

必要な修正: Task 3 に `Harness` が `latestDraft`（または同等の draft 参照）を返す改修を本文で書く。到達 helper は live どおり `<Harness initialStep="audience" initialDraft={reviewDraft} />` 等に落とす。

### I-2: Task 3 の「調理時間を変更」テストは Task 4 までボタンが存在しない

- Plan: Task 3 Step 1（685–698 行）。`getByRole("button", { name: "調理時間を変更" })`。Step 4 は `planner-wizard.test.tsx` 全体を実行。
- Spec: 362 行「確認の「変更」で該当ページへ飛び、選ぶと確認へ戻る」。サマリ `aria-label` は確認画面節 324–326 行。
- live: `review-step.tsx:543–553` の 変更は食事 / メイン食材 / ジャンル / **対象を変更** まで。`調理時間を変更` は Task 4 の 4-d（計画 1091–1111 行）で初めて出る。Task 3 の 3-a は見出し `9. 確認` だけ。

失敗経路: Task 3 Step 4 は新規テストが `Unable to find role=button 調理時間を変更` で必ず非ゼロ。計画は「追加条件系 4 テスト以外は PASS」「`describe.skip` 禁止」。Implementer は Task 4 を先取りするか、このテストを消す。前者は Task 境界破壊、後者は Spec 362 行の契約が Task 4 の「変更で開くだけ」（1038–1043 行）に縮む。

必要な修正: このテストを Task 4 へ移す。Task 3 の P-01 回帰は live にある「対象を変更 → 確認に戻る」（計画 668–683 行、live `:801–804`）だけにする。

### I-3: Task 3 の既存テスト更新リストが不完全で、Step 4 コマンドが緑にならない

- Plan: 702–707 行は sequential `:301–333`、編集戻り `:801–804`、`:746–764` だけを列挙。「追加条件系 4 テストは触らない / Task 4 まで赤でよい」。Step 4（971–975 行）はファイル全体。
- live の `"5. 確認"`（audience 次へ着地）:
  - idea 確定 `:509–536`、`:616`、`:647`（`goToStep("review")` 成功後）
  - household audience next `:574–576`
  - 編集戻り `:773` `:794` `:799`（`:801–804` 以外）
  - review 直描画 `:1543`
- 計画 3-d は idea/household の次を `advanceFromEditOr("timeLimit")` にする。上記は更新しなければ `5. 調理時間` で落ちる。
- 「追加条件系 4 テスト」は Task 3 ではまだ緑。カード UI は Task 4 まで残る（live `:588–718`）。

失敗経路: 列挙どおりだけ直すと Step 4 が idea/household 着地で非ゼロ。本文の「4 テストが赤」を見て、まだ緑の確認カードテストを壊すか skip する。calibration どおり「Step 4 が後続 Task の残赤で緑にならない」形。

必要な修正: `planner-wizard.test.tsx` の `"5. 確認"` 全件（上の idea/household 着地を含む）を Task 3 の更新対象に列挙する。追加条件カードテストは Task 3 では緑のまま残し、Task 4 で書き換えると明記する。Step 4 の期待から「4 テスト以外 PASS」を消す。

### I-4: Task 4 が確認ラジオを叩く live テストを列挙しきれていない

- Plan: Task 4 Step 1（1001 行）「既存「追加条件」系 4 テストを書き換える」。新規 5 本を示す。
- live:
  - `it("追加条件は field 縦積み…")` `:893`
  - `it("追加条件の材料の使い方…")` `:934`
  - `it("追加条件の献立の雰囲気…")` `:983`
  - `it("任意条件はデフォルトで開き、閉じたあと再度開いて編集できる")` `:717` — 名前に「追加条件」が無く、`radiogroup`「献立全体の調理時間」で `30分以内` を click（`:741–743`）

失敗経路: 名前検索で 3〜4 本だけ置換すると `:717` が Task 4 Step 4 で赤のまま。Implementer は details のデフォルト展開テストを残そうとしてカード UI を戻す。

必要な修正: `:717` を書き換え対象に名前で書く。details の開閉だけ残すなら、調理時間 radio 操作を削除した本文を貼る。

### I-5: Task 4-h の axe 表追加が live の `it.each` + `renderWizard(step)` と矛盾する

- Plan: 1202–1211 行。スニペットは `{ heading, primary }` のみ。続けて「新 4 ページへは audience の次へのあと 350ms 跨ぎでカード click」。
- Spec: 370–372 行（axe 表に新 4 ページ。5 の primary はスキップ、6〜8 は戻るのみ）。
- live: `src/app/accessibility.test.tsx:479–509`。各行に `step: PlannerStep`。本体は `renderWizard(step, draft ?? emptyDraft)` で直描画。歩かない。`primary` は `getByRole("button", { name: primary })`。

失敗経路: スニペットを足すと `step` 欠落で typecheck が落ちる。歩き手順に従うと `it.each` 本体を書き換え、既存 5 行まで 350ms click になり、review 直描画契約が壊れる。

必要な修正: live と同じ形で `step: "timeLimit" | "budget" | "ingredientPreference" | "novelty"` を足し、直描画する。歩きと 350ms は書かない。`primary` は計画どおりスキップ / 戻る。

### I-6: Task 6 household 歩きが `noveltySaved` 同期点を付け替えない

- Plan: Task 6 Step 1（1354–1374 行）。4 ページ歩きで 8 ページ目に「ひねりたい」を click。「確認画面で選んでいた箇所があれば削除」。
- Spec: 454–456 行（household だけ 4 ページ歩き。「ひねりたい」は 8 ページ目）。
- live: `e2e/specs/full-journey.spec.ts:73–88`。確認の radiogroup「献立の雰囲気」で `.check()` する**前に** `waitForResponse` で `p_novelty_preference":"twist"` を待つ。生成 CTA はその後。

失敗経路: 確認の `.check()` だけ消して wait を残すと、twist 保存が起きず wait がタイムアウト。wait ごと消すと debounce 600ms の autosave 前に「献立を作る」を押し、ひねり無し生成になり得る。8 ページ目の click は `onSelect` + 自動遷移なので、wait は **その click の前に張る**必要がある。

必要な修正: `noveltySaved` の `waitForResponse` を 8 ページ目の「ひねりたい」`.click()` の直前へ移し、`await noveltySaved` のあと `9. 確認` を主張する、と本文に書く。

## 5. Minor

- **M-1**: Task 3 の `renderWizardAtAudienceForHousehold` 等はコメントで「既存 helper に合わせる」。live は `Harness`。I-1 の `latestDraft` ほどは止まないが、本文の関数名のまま貼ると参照エラー。
- **M-2**: Task 5 Step 4 の `grep --include=*.ts` は `*.tsx` を見ない。unit 側の残 `"5. 確認"` を空と誤認する。`git add e2e src` は無関係 dirty を巻き込む。
- **M-3**: rereview4 Minor 3（確認ヘルプの任意 step は「選ぶと確認に戻る」書き分け）。4-e は「選び直すか『確認に戻る』」で近いが、任意 step に「確認に戻る」が無いことが一文になっていない。非ブロック。
- **M-4**: rereview4 Minor 9（5 ページ目 `button`「指定なし」がスキップに部分一致）。計画の click / `tabUntil` は radio。測定名はフル。残差のみ。
- **M-5**: Task 6 の pointer 前進が `getByRole("radio").click()`。Spec はカード `.wizard-option`。input は label 内なので `pointerup` はバブルする。失敗しても 戻る がある。
- **M-6**: Task 3 の fake timer テストは末尾で `useRealTimers()` するが `afterEach` が無い。途中 throw で後続（autosave fake timer テスト `:1547`）が汚染される。

## 6. 偽陽性として却下したもの

| 項目 | 理由 |
| --- | --- |
| leftover を Critical にする | `blocked()` が `handleChange` にも掛かる。click は `onPointerUp` を新インスタンスで発火しない。6〜8 は戻る |
| `firstIncomplete` / 4b / contracts 変更 | 計画が明示的に禁止。Task 1 は `stepByField` の 3 行だけ |
| 6〜8 ページ閉じ込め | 各 step に `onBack`。mutex は `blocked()` の後 |
| `ensurePlannerReady` に skip | 計画が walker ではないと除外。live `:40–67` は食事 radio まで |
| キーボード heading 上 Space | Task 6 Step 4 は `toBeFocused` → 350ms → `tabUntil` radio → Space。rereview4 で閉じた |
| 44px の `.focus()` が keyboard-only を破る | live `:1096–1100` がレイアウトと Tab 順を分割。計画も分割 |
| `activateFocusedWithKeyboard` 既定 Enter | 計画が `"Space"` を渡す。live `:1127–1132` と一致 |
| pantry がまだ「次へ」/ 戻る×5 | Task 5 Step 3 が「対象を変更」+「確認に戻る」 |
| jsdom が `pointerup` を出さない | Task 2 Step 4 が polyfill 確認を書き、受け口変更を禁止している |
| ArrowDown が jsdom で change しない | 未確認。製造しない |
| Spec 骨格 / P-01 / P-05 / D-03 擬似コードの再開 | rereview4 裁定どおり再開しない |
