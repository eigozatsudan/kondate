# 追加条件ウィザードstep化 — 第2デルタ再レビュー（二次）

- 日付: 2026-09-01
- 対象: `docs/superpowers/specs/2026-09-01-planner-optional-condition-steps-design.md` @ `06352949`（HEAD 一致）
- 入力: 前回裁定、一次（rereview2-primary）、敵対的（rereview2-adversarial）。live は wizard 分岐 / review-step / cuisine-step / shopping.ts / full-journey / generation-recovery / menu-domain-pantry:277 / package.json の react `^19.2.7` / React 19.2.7 ソース
- 実施者: 読み取り専用 Reviewer（一次・敵対的とは別コンテキスト）
- 判定: **REVISE — Critical 0 件。D-01 / D-03 未閉じ。D-02 は P-03 本文 Closed・テスト節 Partial。**

骨格（`firstIncomplete`、4b、必須4問の「次へ」、避ける食材は確認、contracts / Function、P-01 / P-05 本体）は再開しない。

## §1 Verdict

敵対 C-1 を Critical としては **不採用**。`pointerup` が React 19 の discrete であることは Confirmed だが、「ハンドラ末で flush して同一ジェスチャの click が次ページの `onChange` に落ち、予算が汚れる」の実現は **未確認**。値が汚れても 6〜8 は「戻る」で出られる（ガード対象外、本文 136 行）。Critical の基準を満たさない。ただし **仕様の穴自体は Important**: `activate` が pointerup から同期 `onNext` し、`onChange` は 350ms も mutex も見ない。これを本文どおり組むと、UA が click を次カードへ載せた場合に P-03 が死ぬ。遅延 `onNext` か、mount 後 350ms の `onChange` 無視か、同座標に次 step を出さない、のどれかを規則にする必要がある。

同一 `OptionalChoiceStep` の再利用は独立に Confirmed。本文 65–68 行は「1本、4ページは設定違い」。live `planner-wizard.tsx:403–566` は step ごとに別 `return` だが、外側 `<main>` は同型、子も同型なら `key={step}` 無しで instance が残る。mutex / mount 時刻が 5→6 へ持ち越す。既存 wizard が remount するのは Meal/Cuisine/Audience が **別 type** だからで、新4ページには当てはまらない。

D-01 は helper 名表まで入ったが、shopping を `ensurePlannerReady` と誤記し、表の「全行 skip」が個別の 4ページ歩き / キーボード Space と同時に立つ。`:277` は skip 必須と「または対象を変更」が併記。機械的に表どおり実装すると買い物 E2E と household / キーボードが赤になる。

D-03 は受け口を label の `onPointerUp` にした点は WebKit `detail` 前提と矛盾しない。裁決が求めた **順序付き擬似コード** が無く、`onChange` が mutex を見るかが無い。未選択本線（15分 / 節約 / 多め / ひねりたい）で `onSelect` が 2 回になる。

D-02 の P-03 本文（137–144 行）は「最初の活性化 0 回」に直った。テスト節 272 行はまだ「2発目 click」。本リポジトリの Plan Task は Spec の「テスト」箇条書きを入力にすることが多く、ここを Minor の誤字扱いすると leftover 初回 unit が再び消える。一次の Closed+Minor は不採用。D-02 は Partial、残差は Important。

実装開始は不可。

## §2 D-01〜D-03 閉じ確認

| ID | 裁定が要求した閉じ方 | 二次の結論 |
| --- | --- | --- |
| D-01 | helper 名で再列挙。privacy は見出し置換側。`:277` は対象変更+確認に戻る **か** 戻る×5 のあと skip。unit `746–764` はカード click | **未閉じ**。privacy 分離・`completeIdeaPlannerToReview` / `completeMinimumPlanner` / `savePlannerMeal` forward / unit カード click は入った。表の shopping が `ensurePlannerReady` `:88–89`（実体は `generateShoppingMenu`）。`answerAudienceAndReview` を「走査本体」とぼかす。表前置きが全行 skip のまま、個別が household 4ページ / キーボード Space / mobile 新4ページ追加を同時に要求。`:277` が二択のまま |
| D-02 | isolated は mount 後 350ms 以内の**最初の**活性化が 0 回。wizard は次 step の初回。keyboard は heading focused のあと 350ms 待って Space | **Partial**。P-03 137–144 / 345–348 行は閉じた。テスト節 272 行は「2発目 click」。P-03 134 行はまだ「活性化（click / Space）を無視する」（受け口は pointerup / keyup）。Plan がテスト節を抄る経路が前回 D-02 の失敗モードそのもの |
| D-03 | 活性化 mutex の**擬似コード**。ポインタは label `.wizard-option`。unit は `.wizard-option` をクリック。input 直 click だけを緑にするな | **未閉じ**。箇条書きのみ。`activate` = 常時 `onSelect`+`onNext`、`onChange` = `onSelect` のみ、が同時に立ち、mutex の対象関数が `activate` だけなのか不明。テスト節 266–270 は「ポインタ click」。`.wizard-option` を要求せず、`getByRole("radio")` 直 click を禁じていない |

## §3 二次判定表

| 元ID | 判定 | 最終severity | 根拠 |
| --- | --- | --- | --- |
| 敵対 C-1（同一ジェスチャの後続 click が次ページ `onChange` を汚染） | **Confirmed**（仕様の穴）。実現（次カードへ click が落ちる）は **未確認**。Critical は **Downgraded** | **Important** | live `package.json:41` は `react` `^19.2.7`。React 19.2.7 `getEventPriority` は `pointerup` を `DiscreteEventPriority` に含む（`ReactDOMEventListener.js`）。`dispatchDiscreteEvent` は優先度を立てて `dispatchEvent` するだけで、ハンドラ末 `flushSync` は呼ばない。sync 作業は `ensureRootIsScheduled` → `scheduleMicrotask` → `processRootScheduleInMicrotask` で、「Synchronous work is always flushed at the end of the microtask」。敵対の「ハンドラ末で flush」は不正確。click より前に microtask checkpoint が走るかは UA 依存で、この二次では Blink / WebKit を実行していない。切断ノードの後続 click が touch で `elementFromPoint` へ飛ぶかも **未確認**。Blink は pointer ハンドラが target を外すと互換 mouse/click を **まだ繋がっている祖先へ retarget** する経路があり（crbug 608003）、その場合 click は `.wizard-option-list` / `<main>` に落ち、次カードの radio は `change` しない。仕様側の穴は独立に立つ: D-03 は pointerup で同期 `onNext`、値は無ガードの `onChange`、350ms は「活性化ハンドラの先頭」だけ。P-03 は 4ページが同座標と前提。単体は `onNext` mock で unmount しない。wizard P-03 は「遷移**後**の初回」であり、遷移を起こしたジェスチャの click を見ない。6〜8 は「戻る」がガード対象外なので閉じ込めにはならない。値が汚れる本線リスクとしては Important |
| 同一 `OptionalChoiceStep` 再利用（敵対 I-1 の後半） | **Confirmed** | **Important** | 本文 65–68 行に `key={step}` も `useEffect` リセットも無い。live wizard は `if (step === …) return (<main>…</main>)`（`planner-wizard.tsx:403–566`）。`<main>` は同型で再利用。子が同 type なら hooks/`useRef` が残る。mutex リセットは「次 step の mount」だけ（本文 122–124 行）。5ページ目で立てた mutex が 6ページ目を全死させる。脱出は「戻る」→5ページ目のスキップ（スキップは mutex 対象外）。`key={step}` か、step 変更で mutex / `mountedAt` を張り直す規則が本文に無い |
| 一次 I-1 / 敵対 I-5（shopping 誤名、skip vs 歩き vs キーボード、`:277` 二択） | **Confirmed**（両者 Duplicate、D-01） | **Important** | `e2e/fixtures/shopping.ts`: `ensurePlannerReady` は `:40–67` で朝食 radio まで。`:88–89` は `generateShoppingMenu`（`:70–99`）の `clickWizardNext` + `"5. 確認"`。fixture `:26–27` は両方を呼ぶ。helper 名で押さえる表が行番号の関数を別 export に貼っている。`skipOptionalPlannerSteps` を `ensurePlannerReady` に挟んでも買い物生成は旧見出しを待つ。表は household `:71–73` とキーボード `:1358–1385` と 44px `:1259–1272` と mobile「走査本体」を skip 対象にする。個別は household を「スキップを使わず4ページ」、キーボードを「Space で通過」、mobile を「新4ページを追加」。live household は `full-journey.spec.ts:71–73` の直後 `:84–87` で確認の雰囲気 radiogroup に `.check()`（確認から `ReviewChoiceField` を消す設計なので skip するとひねりの対象が無い）。キーボードは `tabUntil` + Space / Enter のみ（`:1283–1383`、programmatic focus 禁止）。skip helper はスキップ**ボタン**の pointer。44px は `expectMajorActionAtLeast44(..., "次へ")`（`:1267`）。新4ページに「次へ」は無い（本文 86 行）。`:277` は表では skip、戻る回数節は `:263–264` を戻る×5 **または**「対象を変更」。live は `advanceToReviewWithHousehold` のあと順送り「戻る」（`:263`）、メンバー張り直し、`clickWizardNext`（`history.ts:41–42` は name `"次へ"` 専用）→ `"5. 確認"`。対象を変更するとボタンは「確認に戻る」（`planner-wizard.tsx:275–278`）、編集中は `onSkipRest` を渡さない。`answerAudienceAndReview`（`mobile-accessibility.spec.ts:130–156`、呼出 household `:173` / idea `:201`）が表に名前で無い |
| 一次 I-2 / 敵対 I-2（`onChange` が mutex 外で `onSelect` 2回、擬似コード欠落） | **Confirmed**（両者 Duplicate、D-03） | **Important** | 裁決パッチ 3 は「擬似コード」。本文 120–124 行は `activate` = `onSelect`+`onNext` + mutex、「値だけは `onChange`（`onSelect` のみ）」「同一活性化の 2回目以降は no-op」。no-op になる関数が `activate` だけか `onChange` も含むか不明。live radio は controlled `onChange` のみ（`cuisine-step.tsx:106–108`、`review-step.tsx:137–139`）。未選択 pointer: pointerup → `activate`（`onSelect` 1）→ native `change` → `onChange`（`onSelect` 2）。既選択「指定なし」再タップは `change` が無いので 1 回。unit「各 1 回」を既選択だけにすると緑。`onChange` から `activate` すると矢印が飛ぶ（P-02）。mutex を step 寿命の `onSelect` 抑制にすると矢印 2回目以降が止まる。未選択・既選択指定なし・Space・矢印の 4 行が無い。Space の native 順は keyup のあと合成 click。keyup で同期 `onNext` すると C-1 と同じクラス（次ページへ click）。index 0 の指定なし通過だけ無害 |
| D-02 テスト節「2発目」（一次 M-1 Minor / 敵対 I-3 Important） | **Confirmed**。一次の Minor は **不採用** | **Important** | P-03 137–144 行は「最初の活性化 0 回」+ wizard 初回 click。テスト節 272 行は「mount 直後 350ms 以内の**2発目** click では `onSelect` が走らない」。134 行はまだ「click / Space」。受け口は pointerup / keyup。Plan のテスト Task は本文「テスト」箇条書きを抄ることが多く、前回 D-02 が Important だった理由そのもの。P-03 本文を正としても、テスト節が残ると leftover 初回 unit を書かない実装が緑になる |
| 敵対 I-4（unit が `.wizard-option` を要求していない） | **Confirmed** | **Important** | 裁決: 「unit は `.wizard-option` をクリックして各 1 回。input 直 click だけを緑にしてはいけない」。テスト節 266–270 は「ポインタ click」「再 click」。live 既存は `user.click(screen.getByRole("radio", …))`（`planner-wizard.test.tsx:264, 306, 742`）。label の `onPointerUp` は input からの bubble でも発火するので、radio 直 click でも handler は緑。実利用者のヒット領域は label 余白（`styles.css:208–219`、`min-height: 44px`）。label タップの pointerup は input に来ない（転送されるのは click だけ。D-03 が label を受け口にした理由）。`vitest.config.ts:12` は jsdom。`PointerEvent.isPrimary` は init 無しだと falsy になり得る。`fireEvent.pointerUp` だけでは D-03 の `isPrimary` ゲートに全落ちする。userEvent で **label** を叩け、と書いていない |
| 敵対 I-6（指定なし通過の `.check()`） | **Confirmed**。前回 Minor から格上げ | **Important** | `full-journey.spec.ts:84–87` は確認の雰囲気に `.check()`。Playwright の `.check()` は既チェックなら **no-op**（click しない）。指定なしは既定 checked（P-05 / live `review-step.tsx:591`）。個別は「スキップを使わず4ページを歩き、自動遷移を主張」。5〜7 を `.check()` で指定なし通過するとイベントが無く、6〜8 に「次へ」もスキップも無いので張り付く。8ページ目の「ひねりたい」は未選択なので `.check()` は click する。詰まるのは先頭 3 ページの指定なし。本文は `.click()` を入れてない。household 本線 E2E が偽赤か、実装者が skip に逃げる。D-01 の歩き契約に食い込むので計画を止めない Minor では足りない |
| 敵対 I-7（disabled でも label `onPointerUp` が発火） | **Confirmed**（一次 I-2 成立条件 4 と Duplicate 気味、規則としては独立） | **Important** | 現行 cuisine は input `disabled={disabled}` + `onChange`（`cuisine-step.tsx:103–108`）。disabled input は change も label 転送の活性化も起きない。D-03 は label に React `onPointerUp` を置く。input が `disabled={isSaving}` でも label の JS ハンドラは止まらない。`activate` が `disabled` を見る規則が無い。保存中に step を飛ばせる。擬似コードの先頭で見る対象 |
| 敵対 I-8（確認ヘルプが「確認に戻る」のまま） | **Confirmed**。Important は **Downgraded** | **Minor** | live `review-step.tsx:559–561`: 「直したあとは「確認に戻る」でこの画面に戻ります。」P-01 は追加条件 step に `nextLabel` を渡さない。必須 4 問はまだ `nextLabel` を渡す（`planner-wizard.tsx:275–278`）。選択で `advanceFromEditOr` するのでボタン欠落で閉じ込めにはならない。前回裁定どおり Minor。本文は「9ページ構成に合わせて見直す」だけで新文言が無いのは残差 |
| 一次 M-4 / 敵対 I-1 前半（mutex を 350ms より先に立てる） | **Confirmed**。一次の Minor は **不採用**（再利用と合成するため） | **Important** | P-03 は「活性化ハンドラの先頭で」350ms 判定。D-03 は mutex を `activate()` に置く。チェック順は書いていない。mutex を先に立ててから 350ms で return すると、同一 step では 350ms 後の正規 1 発目も no-op。6〜8 に「次へ」もスキップも無い。再利用（上段）と合成すると 5ページ目の活性化が 6ページ目を閉じ込める。擬似コードに「350ms miss では mutex を立てない。mutex の前に `disabled` と 350ms を見る」が要る |
| 敵対 M-1（7/8 options 未貼付） | **Confirmed** | **Minor** | 前回どおり。P-05 本体は Closed。live 正本 `review-step.tsx:664–716` |
| 敵対 M-2（radiogroup `aria-labelledby`） | **Confirmed** | **Minor** | 本文 73 行は「名前は heading 側」。live `ReviewChoiceField` は `aria-labelledby={`${id}-label`}`（`review-step.tsx:119–126`）。cuisine の radiogroup は名前無し（`cuisine-step.tsx:92–96`）。axe 追加は primary のスキップ / 戻るだけで radiogroup 名を固定しない |
| 敵対 M-3（`waitForTimeout(350)` とガード開始時刻） | **Confirmed** | **Minor** | 350ms の `useRef` は render 時。heading focus は `useEffect`（`cuisine-step.tsx:45–47`）。`h2` は `tabIndex={-1}`（`:89`）で Space の対象ではない。一次 M-3 どおり、待ちのあとに radio へ Tab すると書かないと heading 上 Space で偽赤。`<= 350` 境界と fake timers + `Date.now()` の手順は本文に無い。計画は止めない |
| 敵対 M-4（incomplete 時の `returnToReviewAfterEdit`） | **Confirmed**（残差のみ） | **Minor** | 本文は任意 step の `onNext` を `advanceFromEditOr` にせよと既に書いてある。live `advanceFromEditOr`（`planner-wizard.tsx:257–264`）は incomplete なら review に戻さない。追加の規則は「明示せよ」だけ |
| 一次 M-2（`answerAudienceAndReview` が「走査本体」） | **Duplicate** | — | D-01 / 一次 I-1 に含む。名前で書けば消える |
| 一次 M-3（キーボードが heading 上 Space と読める） | **Duplicate** | — | 敵対 M-3 に含む |

## §4 残ブロッカー

Critical は無い。次を本文に埋め込んでから Plan / 実装開始。

1. **同一ジェスチャ leftover（C-1 クラス）**  
   `onNext` を `pointerup` / Space `keyup` から同期で呼ばない（click が旧ページで消化されるまで遅延する）、または mount 後 350ms は `onChange` も無視する、または次 step を同座標に出さない。どれかを規則にする。mutex は `click` を購読しない限りこの経路を見ない。elementFromPoint / microtask-before-click は未確認のまま、仕様として閉じる。

2. **`activate` / `onChange` / 350ms / mutex / `disabled` の順序付き擬似コード（D-03 + I-2 + mutex 順 + I-7）**  
   未選択・既選択指定なし・Space・矢印の 4 行。350ms miss と `disabled` では mutex を立てない。`onChange` を `activate` に通さない。`key={step}` か、step 変更で mutex / `mountedAt` をリセットする。

3. **D-01 表を live 名と skip/歩行の 1 列に直す**  
   `generateShoppingMenu`。`ensurePlannerReady` は外す。`answerAudienceAndReview` を名前で書く。前置きを「既定は skip。個別節が歩きを指定した行は skip しない」にする。household とキーボード導線と（新4ページを測るなら）mobile / 44px を skip 列から外すか、列に `skip / 4ページ / Space` を持たせる。`:277–278` を一文で固定する（「対象を変更 → 確認に戻る」**または**「戻る×5 → audience の `次へ` のあと skip」の片方）。44px を歩くなら 戻る / スキップ / `.wizard-option` を測ると書く。指定なし通過は `.click()`（`.check()` 禁止）。

4. **テスト契約**  
   isolated unit は mount 後 350ms 以内の**最初の**活性化が 0 回（テスト節 272 の「2発目」を消す）。unit は `.wizard-option` を userEvent で叩き、`getByRole("radio")` 直 click だけを緑にしない。P-03 134 行の「click / Space」を受け口（pointerup / keyup）に合わせる。

## §5 偽陽性

| 攻撃 | 理由 |
| --- | --- |
| 骨格 / `firstIncomplete` / 4b / 必須 4 問の「次へ」/ contracts / Function | 裁定どおり再開しない。live `planner-wizard.ts:48–52` |
| P-01 stale クロージャ / idea 世代トークン | Closed |
| P-05 の時間・予算リテラル欠落 | Closed。7/8 未貼付は Minor |
| 敵対 C-1 を Critical にする | 6〜8 は「戻る」で出られる。click が次カードへ落ちるかは未確認。Important に落とす |
| 「React 19 は pointerup ハンドラ末で flushSync する」 | pointerup が discrete なのは真。flush は microtask。ハンドラ末 sync flush ではない |
| Blink で label 転送 click の `detail === 0` のため前進不能 | 前回 C-1 False positive。D-03 は `detail` を見ないので再発しない |
| `pointerId === -1` が `isPrimary` を落とす | 主ポインタの `isPrimary` は true。chord 非主ボタンは対象外 |
| 350ms を Strict Mode が緩める | 前回 FP。`useRef(Date.now())` は remount で張り直す。ただし **同 type 再利用**では remount しない（上段 Confirmed） |
| 320px / 44px 不足（カード自体） | `.wizard-option` は既に 44px（`styles.css:208–211`）。不足ではなく、走査が skip されると**未測定**（D-01） |
| heading focus 前に 350ms が始まり leftover **Space** が通る | keyup 受けなら同一キーの Space は新ページに残らない。問題は Space ではなく後続 click（C-1 クラス） |
| mutex が 1 活性化 1 回になる（既選択指定なし / 矢印だけ見る） | 既選択は change 無し、矢印は pointerup 無し。壊れるのは未選択本線（I-2）と leftover / 再利用 |
| `e2e/fixtures/acceptance.ts` が walker | re-export のみ。対象外は正しい |
| generation-recovery `:866–871` / `:1026` | 人数未選択で audience 残留、cuisine→audience のあと emergency へ抜ける。review 非経由 |
| スキップの `goToStep("review")` が P-01 と衝突 | 編集中は `onSkipRest` を渡さない。再開しない |
| axe 表の 6〜8 ページ primary=「戻る」 | ハーネスは named button の可視だけ |
| `ensurePlannerReady` に skip を足せば足りる | meal までしか開かない。足す対象は `generateShoppingMenu` |
| 確認ヘルプ欠落で 6〜8 に閉じ込め | 選択が `advanceFromEditOr` するのでボタンを探しても進める。Minor |

---

判定: **REVISE — Critical 0 件**。D-02 の P-03 本文と骨格 / P-01 / P-05 は APPROVE 相当。D-01 の helper 名と skip/歩きの切り分け、D-03 の順序付き擬似コード（`onSelect` ちょうど 1 回、350ms miss で mutex を立てない、`key={step}`）、同一ジェスチャ leftover を `onChange` 側でも閉じる規則、テスト節の「2発目」削除と `.wizard-option` / `.click()` が本文に入るまで Plan / 実装開始は禁止。
