# 追加条件ウィザードstep化 設計 — 第2デルタ再レビュー裁定

- 日付: 2026-09-01
- 裁定者: 親エージェント
- 対象: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md`（`06352949`）
- 入力: rereview2 一次、敵対的、二次、親の live / React 19.2.7 再照合
- 最終判定: **REVISE。Critical 0。確定 Important 3 系統（D-01 / D-02 / D-03 の残り）を Spec へ追記するまで Plan / 実装開始は禁止。**

## 1. 裁定方法

一次と敵対的は独立スレッド、二次は両レビューを入力に別スレッド。親は live の wizard 分岐、shopping walker、React `^19.2.7` を再照合した。

前回 Closed の骨格・P-01・P-05 本体は再開しない。D-02 の P-03 **本文**（最初の活性化 0 回、wizard 初回、heading 後 350ms）は入った。残るのは本文内矛盾と、D-03 が pointerup に移したことで開いた穴である。

主要な再照合:

- `shopping.ts:40–67` `ensurePlannerReady` は朝食 radio まで。`:70–99` `generateShoppingMenu` が audience `clickWizardNext` → `"5. 確認"`（`:88–89`）。fixture `:26–27` は両方を呼ぶ。
- wizard は `if (step === …) return (<main>…</main>)`（`planner-wizard.tsx:403–566`）。`<main>` は同型。子が同 type なら `key` 無しで instance が残る。既存が remount するのは Meal / Cuisine / Audience が **別 type** だから。
- カードは `<label class="wizard-option">`（`cuisine-step.tsx:98–112`）。ヒット領域 `styles.css:208–211`。
- React 19.2.7 の `pointerup` は discrete。flush はハンドラ末 `flushSync` ではなく microtask。click が次カードへ落ちるかは未確認。
- `planner-wizard.test.tsx:746–764` は確認の戻る1回で `4. 作る相手`、その場の「次へ」で確認へ戻る。改訂はカード click へ直せと書いた（ここは閉じた）。

## 2. 確定・統合した指摘

| 統合ID | 元ID | 最終severity | 裁定 | Spec へ書くこと |
| --- | --- | --- | --- | --- |
| D-01 残り | 一次 I-1 / 敵対 I-5 / 二次 | Important | helper 名表の shopping が誤名。表の「全行 skip」が個別の 4 ページ歩き・キーボード Space・mobile 新4ページと同時に立つ。`:277` が skip 必須と「または対象を変更」で一文にならない。指定なし通過の `.check()` は no-op | 単位名を `generateShoppingMenu` にする。`ensurePlannerReady` は外す。`answerAudienceAndReview` を名前で書く。前置きを「既定は skip。個別節が歩きを指定した行は skip しない」。household / キーボード /（測るなら）mobile・44px に `skip / 4ページ / Space` 列。`:277` は「対象を変更→確認に戻る」**または**「戻る×5→次へ後 skip」の片方。指定なし通過は `.click()` |
| D-02 残り | 敵対 I-3 / 一次 M-1（格上げ） | Important | P-03 本文は「最初の活性化 0 回」に直った。テスト節 272 行はまだ「2発目 click」。134 行はまだ「click / Space を無視」。Plan がテスト節を抄ると leftover 初回 unit が再び消える | テスト節の「2発目」を消す。isolated は最初の活性化 0 回。P-03 の無視対象を pointerup / Space keyup（`activate`）に合わせる |
| D-03 残り | 一次 I-2 / 敵対 C-1（降格）/ I-1 / I-2 / I-4 / I-7 | Important | 擬似コードが無い。`activate` 常時 `onSelect`+`onNext` と独立 `onChange`=`onSelect` は未選択本線で各1回と排他。mutex を 350ms より先に立てると 6〜8 に閉じ込める。`key={step}` が無く同 type 再利用で mutex が残る。unit は `.wizard-option` を要求していない。pointerup 同期 `onNext` のあと `onChange` は 350ms 外 | 順序付き擬似コード（未選択 / 既選択指定なし / Space / 矢印）。350ms miss と `disabled` では mutex を立てない。`onChange` を `activate` に通さない。`key={step}` か step 変更で mutex / `mountedAt` を張り直す。unit は label を userEvent で叩く。同一ジェスチャ leftover は `onNext` 遅延 **または** mount 後 350ms は `onChange` も無視 |

P-01 / P-05 本体と D-02 の P-03 **本文**（137–144 / キーボード 350ms）は Closed。

## 3. 偽陽性・重複・受け入れ残差

| 項目 | 裁定 | 理由 |
| --- | --- | --- |
| 敵対 C-1 を Critical にする | **Downgraded** | 6〜8 は「戻る」で出られる。React 19 の flush は microtask でありハンドラ末 sync ではない。click が次カードへ落ちるかは未確認。仕様の穴（同期 `onNext` + 無ガード `onChange`）は D-03 残りとして Important |
| 「React 19 は pointerup 末で flushSync する」 | **False positive（機序）** | discrete なのは真。flush は `scheduleMicrotask` |
| 一次の D-02 Closed + テスト節「2発目」Minor | **False positive（重大度）** | 前回 D-02 が Important だった理由はテスト契約の文言。テスト節が残ると再発する |
| 一次 I-1 と敵対 I-5 | **Duplicate** | D-01 残りへ統合 |
| 一次 I-2 と敵対 I-2 | **Duplicate** | D-03 残りへ統合 |
| 敵対 I-8 確認ヘルプを Important にする | **Downgraded** | 選択が `advanceFromEditOr` するので閉じ込めにならない。Minor |
| 骨格 / P-01 / P-05 本体 / 4b / contracts | **False positive** | 再開しない |
| Blink で label 転送 click の `detail===0` のため前進不能 | **False positive** | 前回どおり。本文は `detail` を見ない |
| `ensurePlannerReady` に skip を足せば足りる | **False positive** | meal までしか開かない。対象は `generateShoppingMenu` |
| `:1026` / `:866–871` / `acceptance.ts` を walker に数える | **False positive** | 本文対象外どおり |
| スキップ `goToStep("review")` と P-01 の衝突 | **False positive** | 禁止は audience の `goToStep("timeLimit")` |
| 320px / 44px カード不足 / Strict Mode が leftover を通す | **False positive** | カードは既に 44px。Strict Mode remount は同期。ただし **同 type 再利用**は別件（D-03） |
| axe primary=「戻る」がハーネスと矛盾 | **False positive** | named button の可視だけ |

## 4. Spec が直すべき具体パッチ（実装はまだしない）

1. **D-01 表** — `generateShoppingMenu`。`ensurePlannerReady` 削除。`answerAudienceAndReview` を名前で。既定 skip、個別が歩きを指定した行は skip しない。household / キーボード / 測るなら mobile・44px に手段列。`:277` は二択を一文に。指定なしは `.click()`。
2. **D-02 テスト節** — 「2発目」を消す。最初の活性化 0 回。無視対象を `activate`（pointerup / Space）に合わせる。
3. **D-03 擬似コード** — 未選択は `onChange`=値、label pointerup / Space は `onNext` のみ。既選択再 tap / 既選択 Space は pointer / keyup が値+遷移。矢印の `change` は値のみで mutex を立てない。350ms と `disabled` を mutex より前に見る。`key={step}`。unit は `.wizard-option`。同一ジェスチャ leftover は `onNext` 遅延か、350ms 中の `onChange` 無視。

Minor（計画は止めないが本文へ）: 確認ヘルプの新文言、7/8 の options / `onSelect` 貼付、radiogroup の `aria-labelledby` を heading `id` に張る、キーボードは 350ms のあと radio へ Tab してから Space、incomplete 時のフラグ。

## 5. 修正後判定

**REVISE。** 骨格と P-01 / P-05 と D-02 の P-03 本文は APPROVE 相当。上の 3 系統を本文に埋め込んだら、そのデルタだけを再レビューすればよい。実装開始は再 APPROVE のあと。
