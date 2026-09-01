# 追加条件ウィザードstep化 設計 — デルタ再レビュー裁定

- 日付: 2026-09-01
- 裁定者: 親エージェント
- 対象: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md`（`b9bdb099`）
- 入力: デルタ一次、デルタ敵対的、デルタ二次、親の live / Blink 再照合
- 最終判定: **REVISE。Critical 0。確定 Important 3 系統を Spec へ追記するまで Plan / 実装開始は禁止。**

## 1. 裁定方法

デルタ一次と敵対的は独立スレッド、二次は両レビューを入力に別スレッド。親は live の wizard / review / cuisine / E2E walker と、敵対 C-1 については Blink `HTMLLabelElement` / `SimulatedEventUtil` を当たった。

初回裁定の骨格（`firstIncomplete` 非変更、`?resume=review` 4b、避ける食材は確認、必須4問の「次へ」、contracts / Function 非変更、編集中スキップ非表示）は再開しない。P-01 と P-05 本体は Closed。

主要な再照合:

- `planner-wizard.tsx:257–264` `advanceFromEditOr`。audience `onNext` は idea `:536–538` / household `:542–548` ともフラグを捨てて `goToStep("review")`。review `onBack` は `:577–580` で `audience`。
- `firstIncompletePlannerStep` は if 連鎖で必須4問のあと `"review"`（`planner-wizard.ts:48–52`）。配列走査ではない。
- カードは `<label class="wizard-option">`（`cuisine-step.tsx:98–112`、`review-step.tsx:130–141`）。ヒット領域は `styles.css:208–211`。
- Blink: label は `DispatchSimulatedClick(&evt)`。default scope は `kFromUserAgent`。underlying が `PointerEvent` なら `detail` / `pointerId` をコピーする。Chrome のカードタップは `detail === 1`。
- `completeIdeaPlannerToReview` `:87–90`（呼出 `:722`）、`completeMinimumPlanner` `:141–142`（呼出 `:221 / 294 / 353 / 410 / 501`）。`clickWizardNext` は name `"次へ"` 専用（`history.ts:41–42`）。
- `planner-wizard.test.tsx:746–764` は確認の戻る1回で `4. 作る相手`、その場の「次へ」で確認へ戻る。
- `tabUntil` は Tab 連打（`generation-recovery-results.spec.ts:1193–1206`）。

## 2. 確定・統合した指摘

| 統合ID | 元ID | 最終severity | 裁定 | Spec へ書くこと |
| --- | --- | --- | --- | --- |
| D-01 | 一次 I-1 / 敵対 I-3 | Important | P-04 の「全列挙」が本番 walker を落とし、privacy resume を歩く箇所に混ぜている。unit「戻るで1つ前」は novelty に「次へ」が無い | helper 名で再列挙。privacy 行は見出し置換側。`:277` は「対象を変更＋確認に戻る」か skip。unit `746–764` はカード click で `9. 確認` |
| D-02 | 敵対 I-2 | Important | P-03 のテスト節が「2発目」になって leftover（次 step の **初回**）を緑にできる。キーボード E2E に 350ms 待ちが無く、heading focus 直後の Space がガードに食われる | isolated unit は mount 後 350ms 以内の **最初の** 活性化が 0 回。wizard 単位で次 step の初回 click。キーボード導線は heading focused のあと 350ms 待ってから Space |
| D-03 | 敵対 I-1 / 一次 M-1（格上げ）/ C-1 から分離した WebKit・label 経路 | Important | 「ちょうど1回」は native の change+click / change+keyup と排他。未選択カードは 15分・節約・多め・ひねりたいの本線であり稀ではない。input の `detail > 0` 単体は WebKit の転送 click（`detail` 0 固定）でカードタップを落とす | 活性化単位の mutex 擬似コード。ポインタは **label（`.wizard-option`）** 上の pointerup / 本物 click。unit は label をクリックして各1回。input 直 click だけを緑にしてはいけない |

P-01 と P-05 本体は Closed。7/8 ページの options 未貼付は Minor。

## 3. 偽陽性・重複・受け入れ残差

| 項目 | 裁定 | 理由 |
| --- | --- | --- |
| 敵対 C-1（Chrome で `detail===0` のため 6〜8 前進不能） | **False positive** | Blink は label 転送 click に underlying PointerEvent の `detail` をコピーする。カードタップの `detail` は 1。UI Events の「合成 click の detail は 0」を label 転送に当てた読みが誤り。`pointerId===-1`（w3c/pointerevents#554）は `detail` ゲートの失敗条件ではない |
| 一次 I-1 と敵対 I-3 | **Duplicate** | D-01 へ統合 |
| 一次の P-02「ちょうど1回」Minor 化 | **False positive（重大度）** | 既定「指定なし」再タップは本線の一つだが、非デフォルトを選ぶ未選択 click も本線。mutex 無しでは unit の各1回が未選択行で落ちる。D-03 |
| 敵対 I-4 を Important のまま残す | **Downgraded** | 初回 P-05 の穴（時間・予算が `planner-labels.ts` に無い）は本文リテラルで閉じた。7/8 は labels 正本がある。貼付は Minor |
| 敵対 M-3 axe primary 必須との矛盾 | **False positive** | ハーネスは named button の可視だけ。variant は見ない |
| P-01 stale クロージャ / idea 世代トークン | **False positive** | await 後に `advanceFromEditOr` すればクリック時点のフラグを読む。Closed |
| スキップの `goToStep("review")` が P-01 と衝突 | **False positive** | 禁止は audience の `goToStep("timeLimit")`。スキップは timeLimit 専用で編集中は出さない |
| `firstIncomplete` / 4b / novelty が PlannerFieldName / acceptance.ts / 42件 / safety 境界 | **False positive** | 初回裁定どおり再開しない |
| `generation-recovery-results.spec.ts:1026` を walker に数える | **False positive** | cuisine→audience のあと `/emergency-menus` へ抜ける。review 非経由 |
| P-03 Strict Mode が leftover を通す | **False positive** | leftover は ~300ms 後。`useRef(Date.now())` を render で持てば remount はガードを張り直す |
| 320px / 44px 不足 | **False positive** | `.wizard-option` / `.ui-btn` が既に 44px |

## 4. Spec が直すべき具体パッチ（実装はまだしない）

1. **P-04 呼び出し先** — privacy resume（`history.ts:468`、mobile `:96`、full-journey idea `:336`）を見出し置換側へ移す。名前で足す: `completeIdeaPlannerToReview`、`completeMinimumPlanner`、`savePlannerMeal` の forward 最後（`:119`）、`advanceToReviewWithHousehold`、`answerAudienceAndReview`、`seedGeneratedMenu` / `seedGeneratedIdeaMenu`、shots `flows.ts:36`、full-journey household `:71` と idea **`:315`**。`menu-domain-pantry.spec.ts:277–278` は「対象を変更＋確認に戻る」か、戻る×5 のあとに skip。unit `746–764` は確認から1つ戻った任意 step に「次へ」が無いので、カード click で `9. 確認`。
2. **P-03 leftover** — isolated unit は mount 後 350ms 以内の **最初の** 活性化が 0 回。wizard 単位で「step N の選択直後の同座標 click で step N+1 の `onSelect` が 0 回」。キーボード導線は各任意 step で heading focused の **あと 350ms 待ってから** Space。
3. **P-02 活性化** — 同一活性化で `onSelect` を一度だけにする擬似コード。未選択は `onChange`=値、label の pointer が遷移。既選択再 tap は change が無いので pointer 側が値+遷移。矢印の `change` は値のみ。ポインタ判定は **label（`.wizard-option`）**。input の `detail > 0` 単体にしない（Chrome では転送 click の `detail` は 1 だが、WebKit SimulatedClick は `detail` 0 固定）。unit は `.wizard-option` をクリックして各1回。

Minor（計画は止めないが本文へ）: 確認ヘルプの新文言、full-journey の「指定なし」通過は `.click()`、incomplete 時の `returnToReviewAfterEdit`、radiogroup の `aria-labelledby` を heading `id` に張る、7/8 ページの options / `onSelect` を時間・予算と同じ粒度で貼る。

## 5. 修正後判定

**REVISE。** 骨格と P-01 / P-05 本体は APPROVE 相当。D-01〜D-03 を本文に埋め込んだら、そのデルタだけを再レビューすればよい。実装開始は再 APPROVE のあと。
