# Secondary design review: 買い物リスト 履歴導線 + 削除行クリーンアップ

| 項目 | 値 |
|------|-----|
| 対象 | `docs/superpowers/specs/2026-07-30-shopping-from-history-and-cleanup-design.md` (R0 Draft) |
| 種別 | 二次設計レビュー（一次とコンテキスト非共有） |
| 日付 | 2026-07-30 |
| 照合 | MVP `2026-07-11-kondate-mvp-design.md` §9.1–9.2 / guided planner idea 買い物拒否 / `history-detail-page.tsx` / `shopping-list-page.tsx` / `history-card.tsx` / `CreateListSheet` / `ShoppingItemRow` |
| 判定 | **Needs revision** |

---

## Review posture

Read-only secondary pass. Focus: implementer-inventable gaps, locked-interface contradictions, auto-open / `for=shopping` races, removed-item display state machine, low-literacy traps. Confidence threshold for findings: high (≥80). Severity: Critical / Important / Minor.

---

## What the draft gets right

- Scope is correctly narrow: no API/DB/safety contract change; reuse `CreateListSheet` / from-menu / resume command.
- L3/L6 idea 拒否と soft-delete 契約維持は guided planner 設計・現行 `IdeaDetailBody`（買い物 hook 非 mount）と整合。
- `canCreateShoppingList = actionsEnabled && !shoppingListBusy && !createList.isPending` と D-C1 `forceNewMode` を明示維持している。
- `for` の許可値・未知値無視、URL replace 除去、auto-open 1 回、card CTA は household のみ、は実装可能な骨格になっている。
- 削除行を「既定非表示 + 直後だけ確認行」にする方向は、現行 `hideRemovedItems` の再マウント復活バグを正しく狙っている。
- MVP §9.2 undo を「同一画面表示中の誤操作向け」に限定する supersede を文書化している（黙った逸脱ではない）。

---

## Critical

### C1. Fail-closed が `canCreateShoppingList` 全体に掛かると、作成送信中・リスト再取得中に CreateListSheet が閉じる

**Confidence:** 95

**Where:** 設計 §4.2 手順 3 / L8、および現行 `history-detail-page.tsx` の定義

```ts
const shoppingListBusy =
  shoppingList.isFetching || !shoppingList.isSuccess || menuId.length === 0;
const canCreateShoppingList = actionsEnabled && !shoppingListBusy && !createList.isPending;
```

**Problem:**

設計は「`canCreateShoppingList` が false に転じたとき（再確認失敗・**busy**）: create シートを閉じる」と書く。しかし現行 `canCreateShoppingList` は次を含む:

1. `!createList.isPending` — 利用者が「作成する」を押した瞬間に `isPending === true` → シートを閉じる effect が走る。送信中 UI・二重送信防止・エラー表示の土台が消える。
2. `shoppingList.isFetching` — TanStack Query の背景 refetch / invalidate でも true。auto-open 後に focus・60s poll・他画面からの invalidate でシートが不意に閉じる。

手動ボタンの `disabled={!canCreateShoppingList}` と「開いたシートを閉じる条件」を同一述語にすると、送信中・busy が閉じる条件に混入する。D-M7（再生成シート）は `!actionsEnabled` だけを見て閉じる。買い物へ「同型拡張」するなら、閉じる条件は **安全ゲート／再検証の fail**（例: `!actionsEnabled`、必要なら `shoppingMutateBlocked` のうち gate 由来）に限定すべきで、`isPending` / 一時的 `isFetching` を含めてはいけない。

**Required fix:**

- シート **閉鎖** 条件を `canCreateShoppingList` から分離し、例えば:
  - close when: `shoppingIntent` 経路または create sheet 表示中に `!actionsEnabled`（および明示する恒久ブロック）
  - do **not** close when: `createList.isPending` / 一時的 `shoppingList.isFetching`
- 送信ボタン disabled と auto-open 前提は現行 `canCreateShoppingList` のままでよい。
- テストに「作成送信中にシートが残る」「active list の背景 refetch でシートが閉じない」を必須化。

---

### C2. 削除行 state machine が「楽観的に確認行を出す」と表示式・`ShoppingItemRow` で矛盾する

**Confidence:** 92

**Where:** 設計 §2.3 遷移表「削除 / 家にある 送信開始 → pending に追加（**楽観的に確認行を出す**）」と表示式

```text
displayItems =
  items where !isRemovedByUser OR id ∈ pendingUndoIds
```

現行 `ShoppingItemRow` は `item.isRemovedByUser` のときだけ「〜をリストから外しました」+「元に戻す」を描画する。送信開始直後はサーバ上まだ `isRemovedByUser === false` のため:

- `id ∈ pendingUndoIds` でも **通常行** のまま（確認行にならない）
- 楽観確認行を出すには、ローカルで removed 相当に見せる別フラグ、optimistic cache 更新、または row 側が `pendingUndoIds` を解釈する必要がある

さらに初回マウント / 再フェッチ行:

> `pendingUndoIds` は空（**または**サーバでまだ removed でない id だけ残す）

「または」が実装分岐を許し、後者を字義どおり取ると **成功して server-removed になった id を pending から落とす** → 成功直後に確認行が消え、L5（外した直後だけ見せる）と逆になる。

**Required fix:**

1. 楽観 UI の正を一つに固定する:
   - **A (推奨・単純):** 送信開始では pending に入れず、**成功後 refetch で server-removed になった id だけ** pending に残して確認行を出す（失敗時は何もしない）。「楽観的」文言を削除。
   - **B:** 送信開始で optimistic に removed 表示するなら、`displayItems` と row の判定を `isRemovedByUser || id ∈ pendingUndoIds` の **removed 表示** に変え、失敗時ロールバックをテスト必須にする。
2. 再フェッチ時の pending 更新を単一路線に:
   - 成功後: server-removed のままの id は pending 維持
   - undo 成功 / サーバが non-removed に戻った id は pending から除去
   - 失敗: 対象 id を pending から除去
   - 「空にする」はきれいにする・アンマウントのみ
3. `ShoppingItemRow` 契約を変えるなら props を設計に書く。変えないなら A を選ぶ。

---

## Important

### I1. `idea` + `for=shopping` の処理位置が、現行 early branch と噛み合っていない

**Confidence:** 90

**Where:** 設計 §4.1–4.3、`HistoryDetailPage` の mode 分岐

現行:

```tsx
if (menuQuery.data.targetMode === "idea") {
  return <IdeaDetailBody ... />; // 買い物 hook / searchParams なし
}
return <HouseholdDetailBody ... />;
```

§4.3 は idea で自動シートなし + 上部説明 + 履歴へ、と書くが:

- `for` の読取・replace 除去・案内を **どのコンポーネント** が行うか未指定
- `HouseholdDetailBody` だけに置くと idea では intent もメッセージも出ない（実装者が発明 or 取りこぼす）
- 親で strip すると、loading 中に `for` を落としたあと idea と判明した場合の案内 state の受け渡しが必要
- idea では買い物 hook を mount してはならない（guided planner ロック）— auto-open 条件に触れるコードを idea 経路へ持ち込まない境界も明記が要る

**Required fix:**

- Parent（`HistoryDetailPage`）で `hasShoppingIntent` を読み、replace で `for` 除去、`shoppingIntent` を child に props で渡す、と固定する。
- `IdeaDetailBody`: intent 時のみ status メッセージ + 「履歴に戻る」「買い物に戻る」。shopping hooks は禁止のまま。
- `HouseholdDetailBody`: auto-open / fail-closed / CreateListSheet のみ。
- テスト: idea メニューを `?for=shopping` で開き、メッセージ表示・シート 0・shopping network 0。

---

### I2. Fail-closed / auto-open の「閉じる・開く」条件が D-M7 と同型と言いながら述語が違う

**Confidence:** 88

**Where:** §4.2、L8、既存 D-M7（`!actionsEnabled` で再生成シートのみ）

- 再生成: `!actionsEnabled` → sheetMode / postCook を閉じる。買い物シートは **現行未閉鎖**。
- 本設計: create を `canCreateShoppingList` で閉じ、reconcile は `shoppingMutateBlocked` を「推奨」。

「推奨」は実装者に任せ、reconcile を閉じない実装が仕様適合になってしまう。create と reconcile で述語が異なり、C1 の busy 混入とも複合する。

**Required fix:**

- create close: `shoppingSheet === "create" && !actionsEnabled`（または安全上必須の最小集合）を **必須** に。
- reconcile close: `shoppingSheet === "reconcile" && shoppingMutateBlocked`（または `!actionsEnabled || shoppingGate.blocked`）を **必須** に。busy-only では閉じない。
- D-M7 との差分表を 1 行で書く。

---

### I3. 履歴が idea のみ / お気に入りフィルタで household が消えたときの行き止まり

**Confidence:** 86

**Where:** §3.1 バナー、§6「お気に入りフィルタ」、L3 idea CTA 非表示

`for=shopping` バナーは「家族に合わせた献立の買い物リストを作るを押します」と指示するが:

- 履歴が idea のみ → CTA 付きカードが 0
- お気に入りフィルタで household が消える → バナーは残るが押せる CTA が無い（§6 は「既存 empty フィルタ UI」のみ）

低リテラシー利用者は「どれを押せばいいか」バナーと画面が矛盾したまま止まる。Non-Goal の idea 買い物対応を崩さずとも、**明示的な行き止まり文**が要る。

**Required fix:**

- `for=shopping` かつ表示中の household カードが 0 のとき:
  - 「いま選べる家族向けの献立がありません」
  - primary: 献立を作る `/planner`
  - secondary: お気に入り解除（フィルタ時）/ 買い物に戻る
- idea のみの通常 empty との文言差をテストする。

---

### I4. タイトルリンクが `for` なし — 買い物文脈の意図的切断が低リテラシー罠

**Confidence:** 85

**Where:** §3.2「タイトルリンクは従来どおり `/menus/:id`（`for` なし）」

発見性のためにカードへ primary CTA を足す一方、最も大きなタップ領域（タイトル）は買い物 intent を落とす。バナーで CTA 名を示しても、習慣的にタイトルを押す利用者は詳細に着地して **自動シートなし**（手動ボタンは中盤のまま）。Goals の「意図が画面上で途切れない」と緊張する。

**Required fix（いずれかをロック）:**

- **A:** `for=shopping` 一覧表示中だけタイトルも `menusPathForShopping(id)` にする（見返し汚染を買い物文脈に限定）。
- **B:** タイトルは `for` なしのままにするが、詳細側で「一覧から来た」以外の手段は持たない旨を受け入れ、詳細上部の sticky 案内 + 手動 CTA を **アクション列先頭** に移す（本設計は auto-open のみで手動位置は未変更）。
- 推奨は A（買い物文脈中のみ）。B なら手動ボタン位置変更を Goals に含める。

---

### I5. 買い物リスト既存の「履歴を開く」回復導線が `for=shopping` に更新されない

**Confidence:** 84

**Where:** §2.1–2.2 は empty / 「別の献立から作る」のみ。`shopping-list-page.tsx` safety error ブロック:

```tsx
<a className="secondary-button min-h-11" href="/history">履歴を開く</a>
```

D-C1 回復（削除済み出典で gate blocked）はまさに「履歴から別献立で新しいリスト」が目的。`for=shopping` を付けないと本設計のバナー・カード CTA・auto-open が使えない。実装者が旧 href を残すと導線が半分だけ直る。

**Required fix:**

- safety error の「履歴を開く」も `historyPathForShopping()` に含めると明記。
- テスト: gate error UI のリンクが `?for=shopping`。

---

### I6. 履歴 empty / loading / error とバナーの合成が未固定

**Confidence:** 83

**Where:** §3.1、§6「履歴 0 件」、現行 `HistoryPage` / `HistoryPageContent`

- `groups.length === 0` は `HistoryPageContent` が早期 return し、バナー用 `useSearchParams` の置き場がない。
- loading / error は `HistoryPage` 側で h1 前後が別構造。
- §6 は「既存 empty + バナー併記可」と任意表現。

実装者が loading 中に `for` を落としたり、empty でバナーを省略したりする余地がある。

**Required fix:**

- マトリクス必須化:

| 状態 | for=shopping バナー | 本文 |
|------|---------------------|------|
| loading | 任意（出さなくてよい） | 既存 |
| error | 任意 | 既存 |
| empty 0 件 | **必須** | 既存 empty + 買い物に戻る |
| list | **必須** | §3.1 文言 |

- `HistoryPageContent` が params を読むか、props で `shoppingIntent: boolean` を受け取るかを file touch に固定。

---

### I7. CreateListSheet `itemCount` と「件」の定義が呼び出し経路で分裂したまま

**Confidence:** 82

**Where:** §2.3「履歴詳細でシートを出すときは non-removed 件数」、Non-Goal の menu-result

- 進捗は `!isRemovedByUser`。
- 本設計は history-detail の `itemCount` だけ修正。
- menu-result は Non-Goal で `items.length` のまま（削除済み含む）— 許容だが、「件」の意味が画面で割れる。
- 全件 removed の active list で append「0件」になる挙動は history 経路では良いが、auto-open 時に forceNew / append 初期値との関係（0 件なら new を勧める等）は未記載。

**Required fix:**

- history-detail（本設計範囲）: `itemCount = items.filter(i => !i.isRemovedByUser).length` をロック（済みに近い）。
- `itemCount === 0` かつ activeList 非 null のときのシート文言（「今のリストへ追加（0件）」でよいか、new を既定にするか）を一文ロック。CreateListSheet 契約変更なしなら「0件表示のまま append 可」でよいが明示する。
- menu-result の不一致は Non-Goal として Revision に「既知の表示差」と書く。

---

### I8. Auto-open 時のフォーカス / 読み上げが弱く、低リテラシー・a11y でシートに気づかない

**Confidence:** 82

**Where:** §7「見出しがフォーカス可能領域の近く（既存 sheet）」

`CreateListSheet` はページ中盤アクション近くの `section.card` であり、modal/dialog ではない。auto-open しても:

- フォーカスはカード CTA からの遷移先（ページ先頭付近）に残りがち
- シートはスクロールしないと見えない（ボタン群の下）
- `role="status"` 案内はあるが、シート出現自体の通知は弱い

Goals の「詳細 → 作成シートまで途切れない」は、視覚的にシートが viewport 外だと失敗する。

**Required fix:**

- auto-open 成功時: シートコンテナへ `scrollIntoView` + 見出しまたは「作成する」へ focus（既存に focus 移動が無ければ追加を設計に書く）。
- または auto-open 中だけシートを sticky / 上部 status 直下に出す配置をロック。
- テスト: auto-open 後にシート見出しが document 内にあり、可能なら focus がシート内。

---

### I9. pending command resume と auto-open の競合が未記載

**Confidence:** 80

**Where:** §4.2、維持事項の sessionStorage resume、`useResumeShoppingCommand`

詳細マウントで resume が create を再送し得る。その間 `createList.isPending` や navigate(`/shopping`) が走り、同時に auto-open effect も条件を見る。

**Required fix:**

- pending create envelope が当該 `menuId` に存在する間は auto-open しない（resume に譲る）。
- または resume 完了（成功 navigate / 失敗 clear）後にのみ intent を評価。
- テスト: sessionStorage に create pending がある状態で `?for=shopping` を開いてもシートを二重に出さない。

---

## Minor

### M1. カード常時 primary CTA が「見返し」一覧を買い物色に染める

`for` なしの通常履歴でも全 household カード先頭が「買い物リストを作る」primary。L1 ロック済みのため仕様通りだが、お気に入り・削除との視覚階層が買い物偏重。文言を secondary にする選択肢は人間合意と矛盾し得るため、実装時は primary のまま、余白だけ 320px で折返し確認、で足りる。

### M2. StrictMode + replace の二重実行

intent ref + autoOpenedRef で 1 回制限は記載済み。`setSearchParams` replace の二重呼び出しは無害だが、テストで URL から `for` が消えることだけ断言すれば足りる。

### M3. 「別の献立から作る」の配置

§2.2「ページ下部またはヘッダ近く」— どちらかに固定した方が 320px での発見性が安定。推奨: リスト末尾（追加ボタン付近）に secondary。

### M4. 共有 helper が任意

`shopping-intent.ts` は「任意」だが file touch では新規必須。任意をやめ、helper 経由を必須にする。

### M5. MVP §9.2「ワンタップで作成」との表現差

MVP は結果からのワンタップ。本設計の履歴経路は 一覧 CTA → 詳細再確認 → シートで複数手。supersede 対象外の MVP 文言との関係を「履歴経路は再確認必須のため 2 ステップ」と注記するとレビュー摩擦が減る。

---

## Locked interface / codebase cross-check

| 項目 | 結果 |
|------|------|
| `POST /api/shopping-lists/from-menu` | 変更なし — OK |
| idea `422 idea_menu_not_supported` / UI 非表示 | L3 維持 — OK。I1 で詳細メッセージ位置のみ要固定 |
| `CreateListSheet` props 契約 | 変更なし。呼び出し側 key / itemCount のみ — OK。I7 の 0 件を補足 |
| `canCreateShoppingList` / D-C1 forceNew | 維持宣言は正しいが、**閉じる条件への流用が C1 で危険** |
| soft-delete / `is_removed_by_user` | L6 維持 — OK |
| MVP §9.2 undo | supersede 明示 — OK。ただし C2 の表示 SM が未完成だと undo 到達不能時間帯が意図より長い/短い |
| 進捗から削除除外 | 維持 — OK |
| menu-result 導線 | Non-Goal — OK |
| `IdeaDetailBody` 買い物非 mount | 維持必須 — I1 で構造を固定すること |

---

## Race / edge matrix（auto-open & for=shopping）

| ケース | 設計の扱い | 二次評価 |
|--------|------------|----------|
| for 除去タイミング | intent 記録直後 replace。シート成否を待たない | 良い。I1 で parent 実施を固定 |
| 再確認中 | 案内のみ、canCreate まで待つ | 良い |
| canCreate true → 背景 isFetching | fail-closed で閉じうる | **C1 欠陥** |
| 作成 isPending | 同上で閉じうる | **C1 欠陥** |
| キャンセル後 | 再自動なし、手動可 | 良い |
| StrictMode | ref で 1 回 | 良い |
| idea + for | メッセージ | **I1 構造不足** |
| 戻る | replace により詳細再入場で for なし | 良い。履歴へ戻ると for 付きのまま — 意図通り |
| リロード詳細 | for 済み strip 後は intent 消失 | 許容だが一文あるとよい（手動 CTA） |
| pending resume | 未記載 | **I9** |
| activeList 遅延 | busy 後 open + key | 良い。open 条件から isFetching 閉鎖を分離すれば成立 |
| 二重カードタップ | 同一詳細 1 回 | 良い |

---

## Removed-item display state machine（完全性）

| イベント | 期待 | 草案 | 判定 |
|----------|------|------|------|
| 初回マウント（既存 removed） | 非表示 | 既定非表示 | OK（現行と逆。テスト更新必須） |
| 削除/家にある 成功 | 確認行+undo | 曖昧（楽観 vs 成功後） | **C2** |
| 失敗 | 確認行なし | pending 除去 | OK（A 採用時） |
| きれいにする | 全確認行 hide | pending clear | OK |
| 離脱・再訪 | 非表示 | unmount で破棄 | OK |
| undo 成功 | 通常行に戻る | pending 除去 | OK（成功後 server 状態と整合させる必要） |
| 別タブで removed | ローカル pending のみ | 記載あり | OK |
| 全件 removed | 短文 empty、list null にしない | §2.3 | OK。実装追加 |
| cleanup ボタン表示 | pending∩server-removed のみ | 記載 | OK（C2 確定後） |
| 再フェッチ時 pending | 単一ルール必要 | 「または」で二択 | **C2** |

---

## Low-literacy UX traps

1. **タイトル vs CTA（I4）** — 大きい方を押すと買い物文脈が消える。
2. **idea のみ履歴（I3）** — バナーが存在しないボタンを指す。
3. **シートが画面外（I8）** — auto-open してもスクロールしないと「何も起きなかった」。
4. **送信でシート消滅（C1）** — 「作成する」直後に UI が消えると失敗に見える。
5. **きれいにする後 undo 不可** — L5 合意済み。初回の「リストをきれいにする」近くに「消えた行は戻せません。必要なら追加から入れ直してください」の一文があると安心（任意・Minor 寄りの Important 候補だったが L5 で許容範囲）。

---

## Test plan gaps（§8 への追加推奨）

- create 送信中シートが閉じない（C1）
- active list refetch 中シートが閉じない（C1）
- 削除成功後に確認行、失敗後に確認行なし（C2 確定後）
- 再マウントで既存 removed 非表示（既存テスト「初期表示で removed が見える」は反転）
- idea `?for=shopping` メッセージ・シート 0・shopping request 0（I1）
- household カード 0 + for=shopping の行き止まり（I3）
- safety error「履歴を開く」が `?for=shopping`（I5）
- empty 履歴 + for=shopping バナー（I6）
- pending resume 中 auto-open なし（I9）
- auto-open 後シートが focus/scroll 対象（I8）

---

## Recommended revision order

1. **C1** シート閉鎖述語を `canCreateShoppingList` から分離
2. **C2** 削除行 SM を楽観なし（A）か完全楽観（B）のどちらかに単一化
3. **I1** intent を parent で処理し idea/household に分岐 props
4. **I2** create/reconcile close を必須で固定
5. **I3–I6, I8–I9** 導線・empty・focus・resume
6. Revision Summary に二次指摘とロック更新を追記

---

## Summary counts

| 重要度 | 件数 |
|--------|------|
| Critical | 2 |
| Important | 9 |
| Minor | 5 |

**Ready / Needs revision:** **Needs revision**

Critical 2 件（fail-closed 述語の誤用、削除行 state machine の内部矛盾）を解かないまま実装に入ると、作成シートの消失と削除確認行の出方が実装者ごとに割れ、低リテラシー向け導線の主目的を損なう。Important は主に idea/empty 行き止まり、intent 配置、focus、resume 競合、回復リンクの `for=shopping` 統一。
