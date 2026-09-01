# 追加条件ウィザードstep化 設計 — 第3デルタ再レビュー裁定

- 日付: 2026-09-01
- 裁定者: 親エージェント
- 対象: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md`（`386d8159`）
- 入力: rereview3 一次、敵対的、二次、親の live / React 19.2.7 / Blink Space / Playwright 再照合
- 最終判定: **REVISE。Critical 0。確定 Important 4 系統を Spec へ追記するまで Plan / 実装開始は禁止。**

## 1. 裁定方法

一次と敵対的は独立スレッド、二次は両レビューを入力に別スレッド。親は pantry 編集戻りボタン、`clickWizardNext`、キーボード `tabUntil`、44px helper、`blocked()` の起点、React 19.2.7 の discrete flush を再照合した。

閉じた骨格・P-01・P-05 本体・D-03 擬似コード本体は再開しない。前回 Closed の D-02 テスト節（「2発目」削除、最初の活性化 0 回、wizard 初回）も再開しない。残るのは、第2デルタ指摘を本文へ落としたときに **新しいテスト契約が live ヘルパと一文にならない**穴である。

主要な再照合:

- 編集戻り中の audience は `editReturnActionLabels` で `nextLabel: "確認に戻る"`（`planner-wizard.tsx:275–278`）。`clickWizardNext` は name `"次へ"` 専用（`history.ts:41–42`）。unit は編集中の「次へ」不在を主張する（`planner-wizard.test.tsx:770–772`、対象変更 `:801–804`）。確認の操作は `review-step.tsx:547` `aria-label="対象を変更"` → `:585–588` がフラグを立てる。
- `h2` は `tabIndex={-1}`（`cuisine-step.tsx:89`）。現行キーボードは heading `toBeFocused()` のあと `tabUntil` で radio、そこで Space（`generation-recovery-results.spec.ts:1306–1314`）。`tabUntil` は Tab 連打、programmatic `.focus()` 禁止（`:1193–1206`, `:1286`）。
- 44px helper は `getByRole("button", { name })`（`:1103–1113`）。ジャンル / audience は `"次へ"` を測り、`次へ` に focus して Enter で進む（`:1251–1269`）。その直後が `"5. 確認"`（`:1271–1272`）。
- `blocked()` の起点は `mountedAt = Date.now()`（Spec 139、144）。audience の「次へ」からの経過ではない。heading 可視待ちは mount 直後に返り得る。
- React 19.2.7 の `pointerup` は discrete。flush は `scheduleMicrotask` → `processRootScheduleInMicrotask`。ハンドラ末 `flushSync` ではない。
- Blink / WebKit の radio Space は keyup 既定。E2E は chromium のみ（`playwright.config.ts:46–53`）。

## 2. 確定・統合した指摘

| 統合ID | 元ID | 最終severity | 裁定 | Spec へ書くこと |
| --- | --- | --- | --- | --- |
| D-01 残り（`:277` ボタン名） | 一次 I-1 / 敵対 I-4 / 二次 | Important | walker 節は「対象を変更」を採ったが第三操作が「次へ」。live 編集戻りは「確認に戻る」。戻る回数節はまだ「戻る×5、または」 | 408–411 を「確認の『対象を変更』→ audience で選び直し → **『確認に戻る』**」に固定。この区間で `clickWizardNext` / `getByRole(..., "次へ")` を使わない。429–430 の「戻る×5、または」を消し、「採らない」と一文にする |
| D-02 残り（キーボード Tab） | 敵対 I-1 / 一次 M-4（格上げ）/ 二次 | Important | 待ちは入った。活性化は各 radio の `onKeyUp`。本文は heading 上 Space と読める。live は `tabUntil` で radio | `toBeFocused()` → `waitForTimeout(350)` → `tabUntil` で radio → Space。heading 上 Space と読める書き方を消す。programmatic `.focus()` は禁止のまま |
| D-01 残り（44px） | 敵対 I-2 / 一次 M-6（格上げ）/ 二次 | Important | 表は 44px を 4ページ歩きにした。live は `"次へ"` を測り `"次へ"` Enter で進む。新4ページに「次へ」は無い。mobile だけ測るボタンを書いた | `"次へ"` を測るな・押すな。`expectMajorActionAtLeast44` は button 専用なので、5ページ目はスキップと戻る、6〜8 は戻る。前進はカードの `.click()` / Space（350ms 後）。カードを測るならヘルパを button 以外へ拡張すると書く |
| D-01/D-02 交差（歩きの 350ms） | 敵対 I-5 / 二次 | Important | キーボードだけ待ちを書いた。P-03 は「E2E は遅い」側だけ。`blocked()` は **そのページの mount** から始まる。heading 可視直後の `.click()` は 5ページ目も含めて食われ得る | household / mobile / 44px の 4ページ歩きにも各ページ `waitForTimeout(350)`（または同等）を手段列へ書く。ガード短縮と household skip 戻しは採らない |

D-03 擬似コード本体（`blocked()` 先行、`key={step}`、350ms 中の `onChange` 無視、unit は `.wizard-option`）は **Closed**。前回 leftover C-1 の仕様穴は本文が選んだ「`onNext` 遅延は採らず 350ms で `onChange` も落とす」で閉じた。

P-01 / P-05 本体と D-02 の P-03 **本文**（最初の活性化 0 回、wizard 初回）と D-01 表の helper 名（`generateShoppingMenu`、`ensurePlannerReady` 除外、`answerAudienceAndReview`、手段列、指定なし `.click()`）は Closed。

## 3. 偽陽性・重複・受け入れ残差

| 項目 | 裁定 | 理由 |
| --- | --- | --- |
| 敵対 leftover を Critical に戻す | **Rejected** | 350ms 中の `handleChange` 無視。click は `onPointerUp` を発火しない。6〜8 は「戻る」で出られる |
| 「React 19 は pointerup 末で flushSync する」 | **False positive（機序）** | discrete なのは真。flush は microtask |
| Space の既定が keydown なので mutex が間に合わない | **False positive（主 UA）** | Blink / WebKit の radio は keyup。既チェックは simulated click 自体を出さない。Playwright は chromium のみ |
| 一次のキーボード / 44px Minor | **False positive（重大度）** | heading 上 Space は radio の `onKeyUp` に届かない。44px の `"次へ"` 延長は 0 件で赤。failure path の反証が無い |
| 敵対 I-3（wizard 単位が `.wizard-option` を要求しない）を Important にする | **Downgraded** | isolated が label を要求済み。wizard leftover はタイミング。input 上ハンドラは isolated で赤。Minor |
| 一次 I-1 と敵対 I-4 | **Duplicate** | D-01 `:277` ボタン名へ統合 |
| 敵対 A-9 の「5ページ目は audience の次へから 350ms 超なので通る」 | **False positive（機序）** | `blocked()` は page 5 の mount から始まる。指摘自体（歩きに待ちが無い）は成立 |
| D-03 が裁定文言どおり「未選択は `onChange`=値、pointer は `onNext` のみ」になっていない | **False positive** | 未選択を `activate` 内の `onSelect`+`onNext` とし後続 `change` を mutex で落とす。経路表は 1/1。pointerup 同期 `onNext` では値を先に書かないと unmount 後の `change` が落ちる |
| D-02 テスト節の「2発目」再発 | **False positive** | 問題説明に「2発目」は残るが、テスト契約は「最初の活性化 0 回」 |
| `userEvent.click(.wizard-option)` が `isPrimary` を付けない | **False positive** | user-event 14.6 の primary MouseLeft は `isPrimary: true`、`button: 0` |
| jsdom が `change` を `pointerup` より先に出す | **False positive** | user-event は pointerup → click。radio `change` は click 既定 |
| mutex が instance 寿命のため同一ページ 2 枚目が選べない | **False positive** | 自動遷移が本文どおりなら 1 回で unmount。`blocked()` は mutex を立てない |
| disabled でも label の `onPointerUp` が発火する | **False positive** | `blocked()` が `disabled` を mutex より前に見る |
| `ensurePlannerReady` に skip を足せば足りる | **False positive** | 本文が walker ではないと書いた。対象は `generateShoppingMenu` |
| 骨格 / P-01 / P-05 / 4b / contracts | **False positive** | 再開しない |
| Blink で label 転送 click の `detail===0` のため前進不能 | **False positive** | 本文は `detail` を見ない |
| 6〜8 に「戻る」があるから Important も全部落とす | **False positive** | Critical の自動降格材料にはなる。テスト契約の自己矛盾は戻るでは消えない |

## 4. Spec が直すべき具体パッチ（実装はまだしない）

1. **pantry `:263–278`** — 「確認の『対象を変更』→ audience で選び直し → **『確認に戻る』**」。`clickWizardNext` 禁止。戻る回数節の「戻る×5、または」を消す。
2. **キーボード** — heading `toBeFocused()` → 350ms → `tabUntil` で radio → Space。heading 上 Space を消す。
3. **44px** — `"次へ"` を測るな・押すな。5ページ目はスキップと戻る、6〜8 は戻る。前進はカードの `.click()` / Space。
4. **4ページ歩き** — household / mobile / 44px にも各ページ 350ms 待ち。起点は **その OptionalChoiceStep の mount**。

Minor（計画は止めないが本文へ）: 確認ヘルプの任意 step 文言、7/8 の options / `onSelect` 貼付、radiogroup の `aria-labelledby` を heading `id` に張る、incomplete 時のフラグ、wizard 単位 leftover も `.wizard-option` を叩く。

## 5. 修正後判定

**REVISE。** 骨格と P-01 / P-05 と D-03 擬似コード本体と D-02 の P-03 本文（最初の活性化 0 回）と D-01 表の helper 名は APPROVE 相当。上の 4 系統を本文に埋め込んだら、そのデルタだけを再レビューすればよい。実装開始は再 APPROVE のあと。
