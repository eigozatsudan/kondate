# 追加条件ウィザードstep化 — 第4デルタ再レビュー（二次）

- 日付: 2026-09-01
- 対象: spec @ `f7f7c1ad`
- 入力: rereview3-adjudication, rereview4-primary, rereview4-adversarial
- 判定: APPROVE — Critical 0、Important 0、Minor 9

## §1 Verdict

HEAD は `f7f7c1ad75eb3008cf6a519710aea6546f52e67b`。spec 全文・`386d8159..f7f7c1ad` の spec-only diff・live を再オープンして一次（APPROVE）と敵対（REVISE）を突き合わせた。

第3裁定の 4 系統は本文に落ちている。pantry `:263–278` は「対象を変更 → 確認に戻る」＋`clickWizardNext` 禁止。キーボード個別は 4 手。44px は「次へ」を測るな・押すな。歩きの 350ms は **そのページの mount**。骨格 / P-01 / P-05 / D-03 擬似コード本体 / D-02 初回 0 回 / D-01 helper 名はデルタで崩れていない。

食い違いは 2 点。どちらも Important の失敗経路（本線 E2E が必ず赤、または一文が反対実装を強制）を満たさない。

- **P-03 220–222（一次 M-1 / 敵対 I-1）**: 個別 458–467 が named recipe。heading 上 Space は 459–460 が否定する。P-03 の Space を heading に打ってから個別 4 手を直列しても、h2 の Space は `onKeyUp` に届かず no-op で、その後の `tabUntil` + Space は緑。P-03 だけを手順の全部と読む赤は、named recipe が既に揃っている stale 文の経路。**Minor。**
- **`tabUntil("<選ぶ選択肢>")` と radio group（敵対 I-2、一次は未指摘）**: Chromium の同名 radio は Tab がチェック済み（無ければ先頭）だけ。cuisine 踏襲と P-02 矢印は `name` を要求する。未チェックの「15分以内」等へは Tab では着けない。ただし live キーボードの `tabUntil("和食")` / `"朝食"` / `"人数だけ…"` はいずれも **未チェック集団の先頭** で、新ページの先頭は既チェックの「指定なし」。189 どおり Space で `onNext` する。指定なしで通過する実装は緑。反対実装の強制ではない。**Downgrade して Minor。**

Critical 0・Important 0 なので Minors が残っても APPROVE。Plan / 実装開始を止めない。パッチは計画前に本文へ足すと安いが、ブロッカーではない。

## §2 4系統の閉じ確認

| 系統 | 状態 | 1行根拠 |
| --- | --- | --- |
| pantry `:263–278` | **Closed** | Spec 408–414 は「対象を変更 → 選び直し → **確認に戻る**」。`clickWizardNext` 禁止。432–433 から「戻る×5、または」削除。live `planner-wizard.tsx:275–278` の `nextLabel`＝「確認に戻る」、`advanceFromEditOr` `:257–264`、`onEditStep` `:585–588`、unit `:770–772` / `:801–804`、`review-step.tsx:547`、`history.ts:41–42` は `"次へ"` 専用。現行 pantry `:263–278` は順送り戻る + `clickWizardNext` のまま（本文どおり書き換え対象） |
| Keyboard | **Closed** | 個別 458–467 は `toBeFocused()` → 350ms → `tabUntil` radio → Space。heading 上 Space は届かない（459–460）。h2 は `tabIndex={-1}`（`cuisine-step.tsx:89`、mount focus `:45–47`）。`tabUntil` は Tab 連打、`.focus()` 禁止（`:1193–1206`, `:1286`）。`tabUntil("次へ")` 禁止（447, 465）。P-03 220–222 の短い待ち文は Minor（§3 I-1） |
| 44px | **Closed** | 472–478。「次へ」を測らない・押さない。5 はスキップと戻る、6〜8 は戻る。前進は radio `.focus()` + `activateFocusedWithKeyboard(page, "Space")`。helper は `getByRole("button")` 専用（`:1103–1113`）。`.ui-btn` は `styles.css:2852–2854` で 44px。カード `.wizard-option` は `:208–211` で 44px だが helper 対象外。本文はヘルパ拡張を要求していない |
| 4ページ歩き 350ms | **Closed** | 共通 442–445。`blocked()` は **そのページの mount**（擬似コード 139, 144）。household 455、mobile 471、44px 475、キーボード 462–464 が同じ起点。手段はカード `.click()` か radio Space。指定なしは `.check()` 禁止（415–417, 449–450） |

## §3 二次判定表（一次・敵対の各 ID）

| 元 | ID | 元severity | 二次判定 | 最終 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| 一次 | Critical なし | — | Confirmed | — | 閉じ込め・次ページ誤値・safety/contracts は示せない |
| 敵対 | Critical なし | — | Confirmed | — | 同上。A-2 の張り付きは 5 に skip、6〜8 に戻る |
| 一次 | Important なし | — | Confirmed（I-2 を Minor として新規計上） | — | 本線が必ず赤になる分岐は残っていない |
| 敵対 | I-1 | Important | **Downgraded**（一次 M-1 と Duplicate） | Minor | 下記 I-1 |
| 敵対 | I-2 | Important | **Downgraded**（一次は未指摘） | Minor | 下記 I-2 |
| 一次 | M-1 | Minor | **Confirmed** | Minor | P-03 220–222 の stale Space 文 |
| 一次 | M-2 | Minor | **Confirmed** | Minor | 確認ヘルプが任意 step を書き分けない（335） |
| 一次 | M-3 | Minor | **Confirmed** | Minor | 7/8 の options / `onSelect` 未貼付（260–263） |
| 一次 | M-4 | Minor | **Confirmed** | Minor | radiogroup の `aria-labelledby` 未指定（74） |
| 一次 | M-5 | Minor | **Confirmed** | Minor | incomplete 時のフラグ（302–309） |
| 一次 | M-6 | Minor | **Confirmed** | Minor | wizard leftover のセレクタ（217–219, 360–361） |
| 敵対 | M-1 | Minor | **Confirmed** | Minor | 44px 個別 475–476 に heading 待ちが無い（A-3） |
| 敵対 | M-2 | Minor | **Confirmed** | Minor | skip の「指定なし」部分一致の残差（A-7） |
| 敵対 §6 | 擬似コード `name` | Minor 残差 | **Confirmed**（I-2 に畳む） | Minor | 167–175 に `name` が無い。踏襲が正 |

### I-1（敵対 Important → Minor）

- **Spec:** 220–222（P-03。デルタ外の旧文）、対 458–467（個別 4 手）、444–448（共通は「radio の Space」。Tab は書かない）
- **live:** `cuisine-step.tsx:89`（`h2 tabIndex={-1}`）、`:45–47`（mount focus）、擬似コード 172–174（`onKeyUp` は input）、`generation-recovery-results.spec.ts:1306–1314` / `:1343–1351`（heading のあと `tabUntil` で radio → Space）、`:1193–1206` / `:1286`（`.focus()` 禁止）
- **直列化は赤にならない。** P-03 の Space を heading に打つ → h2 に `onKeyUp` は無い → ページは進まない（no-op）。続けて個別 4 手（`toBeFocused` はまだ成立 → 350ms → `tabUntil` radio → Space）は緑。敵対の「両方を直列すると最初の Space で死ぬ」は、最初の Space が **偽赤の原因にならない** ことを示せていない。
- **P-03 だけをキーボード手順の全部と読む**と heading Space で偽赤、は実在する。ただし named recipe は個別 458–467（テスト名を引用し、heading 上 Space では届かないと明記）。校正: stale 文で named recipe が揃い、直列しても赤にならない → Minor。第3裁定パッチ 2 の「消す」が個別にだけ落ちた残差。
- **「6〜8 に戻る」では Minor にしていない。** 戻るは Critical の自動降格材料。ここでは失敗経路自体が本線レシピを赤にしない。

### I-2（敵対 Important → Minor）

- **Spec:** 463–464（新 4 手の `tabUntil`）、75 / 342（先頭「指定なし」既チェック）、65–68（cuisine 踏襲。列挙は Surface / Inset / Stack / h2 / `wizard-option*` で、`name` は書いていない）、104 / 190（矢印は値のみ。native の矢印移動は同名 group が要る）、167–175（擬似コードの `<input>` に `name` 無し）、466（キーボードは `.focus()` 禁止）、189（既選択 Space は `onKeyUp` の `activate` で `onNext` 1）
- **live / UA:** `cuisine-step.tsx:102` `name="genre"`、`meal-step.tsx:107` `name="meal"`、`audience-step.tsx:279,292` `name="audience-mode"`、`review-step.tsx:131–133` `name={id}`。キーボード live `:1309–1312` 朝食、`:1346–1349` 和食、`:1361–1366` アイデアは **いずれも DOM 先頭**（audience は `mobile-accessibility.spec.ts:134–135` で nth(0)＝アイデア）。`tabUntil` `:1193–1206`。E2E は chromium のみ（`playwright.config.ts:46–53`）。Blink の同名 radio は Sequential Focus Navigation でチェック済み（無ければ先頭）だけが Tab 対象。他は Arrow。Chromium 41456887 は WontFix（group は Tab では単一コントロール）。
- **未チェックへ Tab で着けない、は事実。** `name` を付け（P-02 矢印と踏襲先がそうする）、`選ぶ選択肢` を「15分以内」「節約優先」「ひねりたい（主菜を定番から外す）」にすると、heading からの最初の Tab は既チェック「指定なし」。次の Tab は group を抜け、5 ならスキップ、その次が戻る。32 回で throw。Arrow は 4 手に無く、Arrow だけだと 190 どおり `onNext` しない。`.focus()` は 466 が禁止。44px は `.focus()` できるので同じラベルで緑、キーボードだけ赤、は **その fill-in を選んだとき** 成立する。
- **本線が必ず赤ではない。** (1) live の `tabUntil("和食")` アナログは「未チェック集団の先頭」であり、新ページの先頭は「指定なし」。(2) キーボード named test は review まで進むこと（401, 458）で、household の「ひねりたい」（454–456）は pointer の別行。(3) 既チェック「指定なし」は 1 Tab で着き、189 の Space で進む。(4) 擬似コードに `name` が無くても、`name`＋指定なし、の合成が生きる。反対実装の強制ではない。
- **「6〜8 に戻る」では落としていない。** テスト契約の自己矛盾なら Important のまま残す。ここでは named recipe を指定なしで実装すると緑なので Minor。本文へ (a) この 4 ページの `選ぶ選択肢` は既チェックの「指定なし」、または (b) 非デフォルトは Tab で group に入ったあと Arrow → Space、を一文足す。擬似コードの `name` は踏襲が正、と同時に書く。

## §4 残ブロッカー（Plan 開始前に本文へ書くこと）

なし。APPROVE。

## §5 Minor

計画は止めない。本文へ足すと Plan の誤読が安い。

1. **P-03 220–222**（一次 M-1 / 敵対 I-1）: `toBeFocused()` → 350ms → `tabUntil` radio → Space に揃え、heading 上 Space と読める文を消す。
2. **I-2（新規）**: キーボード 4 手の `選ぶ選択肢` を「指定なし」（1 Tab）、または非デフォルトは Arrow のあと Space、に固定する。擬似コードへ `name`（踏襲が正）を足す。
3. **確認ヘルプ**（一次 M-2）: Spec 335。任意 step は `nextLabel` を渡さない（314–316）。live `review-step.tsx:559–561` は必須4問の「確認に戻る」のまま。選ぶと確認に戻る、と書き分ける。
4. **7/8 の options / `onSelect`**（一次 M-3）: Spec 260–263。live `:664–684` / `:696–716`、`planner-labels.ts:23–37` を時間・予算と同じ粒度で貼る。P-05 本体は Closed。
5. **radiogroup の `aria-labelledby`**（一次 M-4）: Spec 74。live `ReviewChoiceField` は `:119–126`。cuisine の radiogroup は無名（`:92–96`）、名前は section（`:85`）。heading `id` を radiogroup に張ると一文。
6. **incomplete 時のフラグ**（一次 M-5）: Spec 302–309。live household `:542–546` は先に flag を落として incomplete なら `firstIncomplete`。`advanceFromEditOr` 経由で `firstIncomplete` に留まり、フラグは `returnToReviewIfQuestionsComplete` が落とす、と一文。
7. **wizard leftover も `.wizard-option`**（一次 M-6）: isolated 343–345 は label。wizard 単位 217–219 / 360–361 はセレクタ未固定。live wizard は radio 直 click（`:306, :742`）。
8. **44px 個別の heading 待ち**（敵対 M-1 / A-3）: 475–476 の矢印列先頭へ `expect(heading).toBeVisible()`。共通 444 の繰り返し。個別だけを完全手順と読むと 350ms が mount より前に始まり得る。共通と合成すれば緑。
9. **skip の「指定なし」部分一致**（敵対 M-2 / A-7）: 5 ページ目で `getByRole("button", { name: "指定なし" })` がスキップに部分一致する、と一行。本文の測定名はフル、`tabUntil` は radio、click は `.wizard-option` なので本線は死なない。

## §6 偽陽性・却下

| 項目 | 裁定 | 理由 |
| --- | --- | --- |
| 敵対 I-1 を Keyboard 系統の Important に残す | **Downgraded**（重大度） | named recipe 458–467 が 4 手。直列化は heading Space が no-op なだけで赤にならない。stale 文は Minor |
| 敵対 I-2 を Important に残す | **Downgraded**（重大度） | 未チェックへ Tab 不能は Chromium の事実。指定なし通過は緑。live 先頭アナログも指定なし。反対実装ではない |
| 敵対 A-3 を Important にする | **Rejected（重大度）** | 共通 444 が 44px を含む。個別の省略。敵対自身が Minor |
| 共通「指定なしは `.click()`」と Space が反対（A-4） | **Rejected** | 448 が click **か** Space。449–450 は `.check()` no-op の pointer 経路。指定なし Space は 189 |
| 既チェック Space は click が無いので前進しない（A-6） | **Rejected** | keyup の `activate`。Blink が simulated click を出さないことは本文 189 が織り込み済み。E2E は chromium |
| skip 部分一致で本線が死ぬ（A-7） | **Rejected**（本線）。残差は Minor 9 | `tabUntil` は radio、click は `.wizard-option`、測定名はフル |
| 44px の `.focus()` がキーボード only を破る（A-5） | **Rejected** | 別 test。live `:1096–1100` と本文 466 / 475–476 が分割 |
| `activateFocusedWithKeyboard` 既定 Enter（A-8） | **Rejected** | 本文 476 が `"Space"`。live の次へ Enter 延長は本文が禁じている |
| leftover を Critical に戻す（A-10） | **Rejected** | 350ms 中の `handleChange` 無視。click は `onPointerUp` を発火しない。6〜8 は戻る |
| React 19.2.7 は pointerup 末で `flushSync` | **Rejected**（機序） | discrete は真。flush は microtask |
| Space の既定が keydown なので mutex が間に合わない | **Rejected** | 主 UA は keyup。E2E は chromium |
| 6〜8 に戻るから I-1 / I-2 も落とす | **Rejected**（降格理由） | Critical の自動降格材料。テスト契約の自己矛盾は戻るでは消えない。I-1/I-2 の Minor 化は失敗経路が本線赤を強制しないから |
| pantry がまだ「次へ」/ 戻る×5 | **Rejected** | 408–414 / 432–433 が消した |
| 44px の「測る」が Space 前進の後に読める | **Rejected** | 一次どおり。前進手段の置換と測定対象の置換の並列。live `:1251–1256` は測ってから進む |
| household が page 8 で「ひねりたい」を `.check()` する現行を延長 | **Rejected** | 本文 415–417 / 449–450 / 454–456 はカード `.click()` |
| `expectMajorActionAtLeast44` が button 専用なのでカード 44px が未測定 | **Rejected** | live `:1097` が native radio を対象外。本文はカードを測れと言っていない |
| 骨格 / P-01 / P-05 / D-03 擬似コード本体 / D-02 初回 0 回 / D-01 helper 名 / 4b / contracts / firstIncomplete | **Rejected** | 再開しない。audience は `advanceFromEditOr("timeLimit")`（302–303）。live `:536–548` の `goToStep("review")` は書き換え対象 |
| firstIncomplete 非変更 | **Confirmed Closed** | Spec 45–48、live `src/features/planner/model/planner-wizard.ts:44–52` |
