# 追加条件ウィザードstep化 設計 — 第2デルタ再レビュー（敵対的）

- 日付: 2026-09-01
- 対象: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md` @ `06352949`
- 入力: 前回裁定 `docs/superpowers/reviews/2026-09-01-planner-optional-condition-steps-rereview-adjudication.md`、改訂 Spec、live（実装は未着手）
- 姿勢: 閉じた骨格と P-01 / P-05 本体は再開しない。D-01 / D-02 / D-03 の新しい規則そのものを壊す。
- 判定: **REVISE。Critical 1（同一ジェスチャの後続 click が次ページ onChange を汚染）。D-01〜D-03 はいずれも未閉じ。**

## §1 Verdict

D-03 は「活性化を数える」と書いたが、受け口を `label` の `onPointerUp` に移したまま `onNext` を同期で呼ぶ。P-03 自身が「4ページとも `.wizard-option` が同じ座標」と前提しているので、同一タップの後続 `click` は次 step の label に落ちる。350ms ガードは「click / Space」と書いてあり、D-03 の受け口（pointerup）とも、実際に次ページへ届くイベント（click → native `change`）とも一致しない。

D-02 の本文は「最初の活性化が 0 回」に直ったが、テスト節はまだ「2発目 click」。D-01 は helper 名へ移したつもりで、shopping の walker 名を取り違え、skip 対象と「4ページを歩け」が同時に立つ。

実装開始は不可。

## §2 攻撃シナリオ

### A-1 15分タップが次ページの「節約優先」を書く（同一ジェスチャ）

1. 利用者は `5. 調理時間` の 2 枚目「15分以内」をタップする。未選択カードは本線（裁定 D-03）。
2. native 順は `pointerup` → `click` → label 転送 click → 未選択なら `change`。
3. D-03 は `pointerup`（`button === 0 && isPrimary`）で `activate()` → 同期 `onSelect` + `onNext`。
4. React 19 の discrete event（`pointerup` は含まれる）はハンドラ末で flush する。現行 wizard は step ごとに別 `return`（`planner-wizard.tsx:403–566`）なので、次 step の `OptionalChoiceStep` が同じ座標に mount する。
5. 切断されたノードの後続 `click` は、タッチ（本製品の主入力）では `elementFromPoint` の下の要素へ飛ぶ。P-03 が「同じ座標に並ぶ」と書いた前提そのもの。
6. 次ページは `click` を活性化として数えない。label の default が新しい radio をチェックし、`onChange` が `onSelect` だけを呼ぶ。350ms ガードは活性化ハンドラの先頭にしか無く、`onChange` は対象外。
7. draft は `timeLimitMinutes: 15` に加え、`budgetPreference: "economy"`（6ページ目の index 1）になる。画面は `6. 予算` のまま。指定なし（index 0）再タップだけは次も指定なしで無害。非デフォルト本線だけが壊れる。

isolated unit は `onNext` を mock して unmount しない。wizard の P-03 テストは「遷移した直後の**初回** click」であり、1 発目の後続 `click` を見ない。緑のまま出荷できる。

### A-2 mutex を 350ms より先に立て、2 発目 leftover で 6〜8 ページに閉じ込める

P-03 は ~300ms 後の 2 発目を本線リスクとしている。D-03 の mutex は `useRef<boolean>` で、リセットは「次 step の mount」。チェック順は書いていない。

```
activate(v) {
  if (mutex.current) return;
  mutex.current = true;          // 先に立てる
  if (now - mountedAt < 350) return;
  onSelect(v); onNext();
}
```

2 発目 pointerup（350ms 内）はガードで捨てられるが mutex は true のまま。6〜8 ページに「次へ」もスキップも無い（DOM に「次へ」を置かない、とテストで主張する）。戻る以外に脱出できない。5 ページ目だけスキップがガード対象外なので助かる。

「先頭で判定」は 350ms 側の文であり、mutex を先に書く実装を禁止していない。

### A-3 未選択タップで `onSelect` が 2 回

mutex は `activate()` を保護すると書いてある。`onChange` は「`onSelect` のみ、遷移しない」別経路。未選択は pointerup のあと必ず `change` が来る。

- pointerup → `activate` → `onSelect` 1 回目 + `onNext`
- `change` → `onChange` → `onSelect` 2 回目（mutex を見ない）

unit「各 1 回」は未選択本線で落ちる。実装者は (a) `onChange` からも `activate` する（矢印が飛ぶ、P-02 破壊）か (b) 未選択行を書かないか (c) mutex を `onChange` にも効かせる、のどれかへ逃げ、擬似コードが無いので (a) を選んでも本文違反に見えない。

既選択「指定なし」再タップは `change` が無いので 1 回になり、テストを既選択だけにすると緑。

### A-4 shopping walker を取り違え、生成 fixture が `5. 確認` で死ぬ

D-01 表は `e2e/fixtures/shopping.ts` / `ensurePlannerReady` / `:88–89`。live では:

- `ensurePlannerReady` は `shopping.ts:40–67`。audience を歩かず、朝食 radio の可視で終わる。
- `:88–89` は `generateShoppingMenu`（`shopping.ts:70–99`）の `clickWizardNext` + `5. 確認`。

helper 名で押さえる、が目的だった列挙が、行番号の関数を別 export に貼っている。`skipOptionalPlannerSteps` を `ensurePlannerReady` に挟んでも買い物生成は audience の次へで旧見出しを待つ。

### A-5 44px / mobile 走査を skip すると新 4 ページを測れない。キーボードは Space 歩けと後で覆す

D-01 表は次を skip 挿入対象にしている。

- `mobile-accessibility.spec.ts` 「走査本体」`:147–149`（実体は file-local `answerAudienceAndReview`。audience の次へ → `5. 確認`）
- `generation-recovery-results.spec.ts` 44px 走査 `:1259–1272`
- 同ファイル キーボード導線 `:1358–1385`

個別節は「mobile 走査へ新 4 ページを追加」「キーボードは Space で通過」。同一 helper に skip を挟むと 5〜8 を踏まない。表と個別が同時に成立しない。

`:277` も同じ。表は skip 必須。戻る回数節は「戻る×5 **または** 対象を変更」。対象を変更にすると `:277` の `clickWizardNext` は消える。両方やれ、は実装者を分岐の片方へ落とす。

## §3 D-01〜D-03 閉じ確認

| ID | 裁定が要求した閉じ方 | 本文 | 結論 |
| --- | --- | --- | --- |
| D-01 | helper 名で再列挙。privacy は見出し置換側。`:277` は対象変更+確認に戻る **か** 戻る×5 のあと skip。unit `746–764` はカード click | 表の shopping が誤名。`answerAudienceAndReview` を「走査本体」とぼかす。`generateShoppingMenu` 欠。`:277` を skip 必須と「または対象を変更」が併記。44px/keyboard を skip 対象にしたまま個別で歩けと言う | **未閉じ** |
| D-02 | isolated は mount 後 350ms 以内の**最初の**活性化が 0 回。wizard は次 step の初回。keyboard は heading focused のあと 350ms 待って Space | P-03 本文 137–144 は「最初の」。テスト節 272 は「2発目 click」。P-03 134 はまだ「click / Space を無視」。受け口は pointerup | **未閉じ** |
| D-03 | 活性化 mutex の**擬似コード**。ポインタは label `.wizard-option`。unit は `.wizard-option` をクリック。input 直 click だけを緑にするな | 箇条書きのみ。`onChange` が mutex を見るかが無い。テスト節 266–272 は「ポインタ click」「再 click」「2発目 click」。`.wizard-option` を要求しない。`getByRole("radio")` 直 click を禁じていない | **未閉じ** |

## §4 Critical

### C-1 pointerup 同期 `onNext` × 同一ジェスチャの後続 click × `onChange` 無ガード

- **攻撃**: §2 A-1。P-03 との合成。
- **live**: カードは `<label class="wizard-option">`（`cuisine-step.tsx:98–112`、`review-step.tsx:130–141`）。ヒット領域は `styles.css:208–211`（`min-height: 44px`）。4 条件の 2 枚目は調理時間「15分以内」/ 予算「節約優先」/ 材料「多め」/ 雰囲気「いつもの」（`review-step.tsx:597–706`）。wizard は step 分岐でコンポーネントを差し替える（`planner-wizard.tsx:403–566`）。
- **Spec**: D-03 114–124（受け口 pointerup、値は `onChange`、`activate` が同期で `onNext`）。P-03 129–135（同座標、350ms は活性化だけ）。
- **なぜテストが助けない**: 単体は unmount しない。wizard P-03 は「2 発目」ではなくても「遷移**後**の初回」であり、遷移を起こしたジェスチャの `click` を見ない。
- **必要な本文**: `onNext` を `pointerup` 同期で呼ばない（click が旧ページで消化されるまで遅延する）、または mount 後 350ms は `onChange` も無視する、または次 step を同座標に出さない。どれかを規則にする。mutex は `click` を購読しない限りこの経路を見ない。

閉じた骨格（`firstIncomplete`、4b、必須 4 問の「次へ」）とは別件。D-03 が pointerup に移した瞬間に P-03 の leftover モデル（click を握る）が死んでいる。

## §5 Important

### I-1 mutex と 350ms の順序、および同一 component 再利用

§2 A-2。リセットは「次 step の mount」だけ。`optional-choice-step.tsx` を 1 本、設定違い、に `key={step}` が無い。同一 type を同じ位置で props だけ変えると mutex も mount 時刻も残る。5 ページ目で立てた mutex が 6 ページ目を全死させる。既存 wizard は if 分岐なので偶然 remount するが、本文は key も `useEffect` リセットも要求しない。

### I-2 `onChange` と mutex の関係が擬似コードになっていない（§2 A-3）

裁定パッチ 3 は「擬似コード」。本文 120–124 は「2 回目以降は no-op」と書くが、no-op になる関数が `activate` だけなのか `onChange` も含むのか不明。未選択（pointerup+change）と既選択（pointerup のみ）と矢印（change のみ）と Space（keyup+click+場合により change）を 1 表で閉じないと、unit「各 1 回」は本線で偽赤か、矢印で偽緑になる。

Space の native 順は keyup のあと合成 click。keyup で同期 `onNext` すると C-1 と同じく次ページへ click が落ちる（index 0 の指定なし通過だけ無害）。

### I-3 P-03 がまだ「click / Space を無視」。テスト節がまだ「2発目 click」

- 134: 「活性化（click / Space）を無視する」
- 272: 「mount 直後 350ms 以内の**2発目** click では `onSelect` が走らない」

D-02 が直したのは 137–144 だけ。テスト契約を読む実装者は 2 発目を書き、初回 leftover を通す。受け口が pointerup なのにガード文言が click のままだと、pointerup をガードしない実装でも 272 は「2 発目 click」を fireEvent すれば緑。

### I-4 unit が `.wizard-option` をクリックすると書いていない

裁定: 「unit は `.wizard-option` をクリックして各 1 回。input 直 click だけを緑にしてはいけない」。

本文テスト節 266–270 は「ポインタ click」「再 click」。live の既存テストは `user.click(screen.getByRole("radio", ...))`（`planner-wizard.test.tsx:264, 306, 742`）。input 直 click は pointerup が input で発火して label へ bubble するので、**ハンドラを input の `onPointerUp` に置いても unit は緑**。実利用者のヒット領域は label 余白（`styles.css:208–219`）。label タップの pointerup は input に来ない（転送されるのは click だけ。これが D-03 で label を受け口にした理由）。input 直 click のテストは WebKit 転送 click 問題を再導入する。

jsdom（`vitest.config.ts:12`）の `PointerEvent.isPrimary` は init 無しだと falsy。`fireEvent.click` / `fireEvent.pointerUp` だけでは D-03 の `isPrimary` ゲートに全落ちする。userEvent で label を叩け、と書いていない。

### I-5 D-01 helper 名が live export と一致しない（§2 A-4, A-5）

| Spec の単位 | live | 判定 |
| --- | --- | --- |
| shopping `ensurePlannerReady` `:88–89` | その行は `generateShoppingMenu`。`ensurePlannerReady` は `:40–67` で review に行かない | 誤名。walker 欠落 |
| mobile 「走査本体」 | file-local `answerAudienceAndReview`（`:130–156`）。呼び出しは household `:173` / idea `:201` | 裁定が名前で足せと書いた helper をぼかした |
| generation-recovery 44px `:1259–1272` | `fits 320px ... 44px action targets` 内の audience → `5. 確認`（キーボード Space + `次へ`） | skip すると新ページの 44px を測らない |
| キーボード `:1358–1385` | `advances four questions ... keyboard only` の audience → heading `5. 確認` | 表は skip、個別は Space 歩き |
| pantry `:277–278` | `advanceToReviewWithHousehold` のあと戻る×1 で `4. 作る相手`、メンバーを張り直し、`clickWizardNext` → `5. 確認` | skip 必須と「対象を変更」が両立しない |

裁定が名前で足した `answerAudienceAndReview` が表に無い。`generateShoppingMenu` も無い。privacy 行（`history.ts:468`、mobile `:96`、full-journey `:336`、generation-recovery `:103` / `:440`）を置換側へ移したこと自体は正しい。

44px テストは現状 `次へ` を `expectMajorActionAtLeast44` している。新 4 ページに「次へ」は無い。skip すれば未測定。Space 歩きに切り替えるなら 戻る / スキップ / `.wizard-option` を測る指示が要る。本文はどちらも書いていない。

### I-6 指定なし通過の `.check()` が残る

裁定 Minor だったが、household フルウォーク（`full-journey.spec.ts:71–87`）は今 `.check()` で radio を確定している。Playwright の `.check()` は既チェックなら no-op。指定なしは既定 checked（P-05 / live `review-step.tsx:591`）。5〜7 ページを `.check()` で指定なし通過するとイベントが無く、自動遷移しない。個別は「4 ページを歩き、自動遷移を主張」とだけ書き、`.click()` を本文へ入れてない。household 本線 E2E が偽赤か、実装者が skip に逃げる。

### I-7 disabled の radio でも label の `onPointerUp` は発火する

現行 cuisine は input `onChange`（`cuisine-step.tsx:106–108`）。`disabled` の input は change も label 転送の活性化も起きない。D-03 は label に React `onPointerUp` を置く。input が `disabled={isSaving}` でも label ハンドラは止まらない。`activate` が `disabled` を見る規則が無い。保存中に step を飛ばせる。

### I-8 確認ヘルプが「確認に戻る」のまま

live `review-step.tsx:559–561`: 「直したあとは「確認に戻る」でこの画面に戻ります。」P-01 は追加条件 step に `nextLabel`（確認に戻る）を渡さない。本文は「9 ページ構成に合わせて見直す」だけで新文言が無い。新 4 つの「変更」から入った利用者は存在しないボタンを探す。

## §6 Minor

### M-1 7/8 ページの options / `onSelect` 未貼付

P-05 は labels 正本と literal 比較を指す。時間・予算と同じ粒度の配列が 7/8 に無い。live 正本は `review-step.tsx:664–716`（`more` / `less` / `selected_only` / `auto` と `standard` / `twist`、`""` → `null`）。裁定どおり計画は止めないが、本文へ貼っていない。

### M-2 radiogroup の `aria-labelledby`

「名前は heading 側」とだけ。live の `ReviewChoiceField` は `aria-labelledby={`${id}-label`}`（`review-step.tsx:119–126`）。cuisine の radiogroup は名前無し（`cuisine-step.tsx:92–96`、名前は section）。新 step が heading `id` を radiogroup に張るか不明。axe 追加は「primary はスキップ / 戻る」だけで、radiogroup 名を固定しない。

### M-3 `page.waitForTimeout(350)` とガード開始時刻

350ms の `useRef` は render 時。heading focus は `useEffect`（live `cuisine-step.tsx:45–47`）。ガードは focus より先に始まる。keyup 受けなら同一 Space の leftover は新ページに来ない（C-1 の click とは別）。E2E の待ちは「新ページの初回 Space がガードに食われる」用。

Playwright clock は当該 keyboard テストに無い（`waitForTimeout` 使用は shots のみ）。`waitForTimeout(350)` は実時間。`toBeFocused()` は mount 直後に通るので、待ちはガードとほぼ同時満了。実装が `<= 350` だと境界で偽赤。`vi.useFakeTimers()` の unit は Date を mock しないと `Date.now()` ガードが動かない。userEvent と fake timers の併用手順が無い。

### M-4 incomplete 時の `returnToReviewAfterEdit`

裁定 Minor。本文は任意 step の `onNext` を `advanceFromEditOr` にせよと既に書いており、live `advanceFromEditOr`（`planner-wizard.tsx:257–264`）は incomplete なら review に戻さない。追加の規則は無い。残っているのは「明示せよ」だけ。

## §7 偽陽性

| 攻撃 | 理由 |
| --- | --- |
| 骨格 / `firstIncomplete` / 4b / 必須 4 問の「次へ」/ contracts | 裁定どおり再開しない |
| P-01 stale クロージャ / idea 世代トークン | Closed |
| P-05 の時間・予算リテラル欠落 | Closed。7/8 未貼付は M-1 |
| Blink で label 転送 click の `detail === 0` のため前進不能 | 前回 C-1 False positive。D-03 は `detail` を見ないので再発しない |
| `pointerId === -1` が `isPrimary` を落とす | 主ポインタの `isPrimary` は true。chord 非主ボタンは対象外 |
| 350ms を Strict Mode が緩める | 前回 FP。`useRef(Date.now())` は remount で張り直す |
| 320px / 44px 不足（カード自体） | `.wizard-option` は既に 44px。不足ではなく、走査が skip されると**未測定**（I-5） |
| heading focus 前に 350ms が始まり leftover **Space** が通る | keyup 受けなら同一キーの Space は新ページに残らない。問題は Space ではなく後続 click（C-1） |
| mutex が 1 活性化 1 回になる（既選択指定なし / 矢印だけ見る） | 既選択は change 無し、矢印は pointerup 無し。壊れるのは未選択本線（I-2）と leftover（A-2 / C-1） |
| `e2e/fixtures/acceptance.ts` が walker | re-export のみ。対象外は正しい |
| generation-recovery `:866–871` / `:1026` | 人数未選択で audience 残留、cuisine→audience のあと emergency へ抜ける。review 非経由 |
| スキップの `goToStep("review")` が P-01 と衝突 | 編集中は `onSkipRest` を渡さない。再開しない |

## Assessment

実装禁止。D-03 を本文どおり組むと、モバイル本線の「15分以内」タップが次ページ index 1 を書き換える。mutex と 350ms はそれを止めない。テストは radio 直 click と「2発目」のままで緑にできる。D-01 は shopping の本番 walker を別名で列挙し、skip と Space 歩きが同じ行を指す。

APPROVE するには少なくとも次が Spec に要る。

1. C-1 のイベント順（pointerup 同期 `onNext` を禁止するか、350ms を `onChange` にもかけるか）。
2. `activate` / `onChange` / 350ms / mutex の**順序付き**擬似コード。未選択・既選択指定なし・Space・矢印の 4 行。
3. unit は `.wizard-option` を userEvent で叩き、350ms 内の**最初の**活性化が 0 回。`getByRole("radio")` 直 click 禁止。
4. D-01 表を live 名に直す（`generateShoppingMenu`、`answerAudienceAndReview`）。44px / keyboard / mobile は skip か歩行かを 1 つに決める。指定なし通過は `.click()`。
