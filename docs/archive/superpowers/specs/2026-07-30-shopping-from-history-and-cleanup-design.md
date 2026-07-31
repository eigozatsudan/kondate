# 買い物リスト: 履歴からの作成導線と削除行クリーンアップ

| 項目 | 値 |
|------|-----|
| 文書 | `docs/archive/superpowers/specs/2026-07-30-shopping-from-history-and-cleanup-design.md` |
| 日付 | 2026-07-30 |
| 状態 | **Approved for implementation**（計画: `docs/archive/superpowers/plans/2026-07-30-shopping-from-history-and-cleanup.md`） |
| 関連 | MVP `2026-07-11-kondate-mvp-design.md` §9.1–9.2、Plan 5 買い物、`CreateListSheet` / `menu-result-page` / `history-detail-page` / `shopping-list-page`、idea 拒否（`2026-07-22-guided-planner-optional-household-design.md`） |
| 人間合意 | 方針 **A**（履歴カード CTA）+ **案1**（確認後 CreateListSheet 自動）; 削除行クリーンアップの再訪復活を直す |
| レビュー | R0 一次敵対的 + 二次独立 → R1 で Critical/Important を吸収。再レビュー対象は本改訂 |

---

## Overview

買い物リストが空のとき「履歴から選ぶ」は `/history` へ飛ばすが、履歴**一覧**に買い物作成ボタンがなく、作成は詳細画面のアクション群の中盤にしかない。低リテラシー利用者が気づけない。

あわせて「リストをきれいにする」が React state のみのため、ページ遷移・リロードで削除確認行が戻る。

本設計は **API・DB・安全再検査のサーバ契約を変えず**、次の2点だけを直す。

1. 買い物文脈を保った **履歴 → 献立結果（`/menus/:id`）→ CreateListSheet** の発見可能な導線
2. 削除済み行の **既定非表示 + 操作成功直後だけ確認行**（きれいにする／離脱で戻らない）

---

## Background & Motivation

| 領域 | 現状 | 痛み |
|------|------|------|
| 買い物 empty | 「履歴から選ぶ」→ `/history` | 文脈切れ |
| 履歴一覧 | タイトル・お気に入り・削除のみ | 買い物 CTA なし |
| 詳細本線 | カードは **`/menus/:id` → `MenuResultPage`**（`router.tsx`）。`/history/:menuId` は `HistoryDetailPage`（副経路） | 作成ボタンが中盤で気づきにくい |
| 削除行 | soft-delete 全表示 + `hideRemovedItems` state | きれいにしても再マウントで復活 |

### 人間と合意済みのロック（再導出禁止）

| # | 決定 |
|---|------|
| L1 | 方針 **A**: 履歴カードに「買い物リストを作る」。買い物から来たとき一覧上部に案内 |
| L2 | カード CTA → **`/menus/:menuId?for=shopping`**（本線は **MenuResultPage**）。安全再確認後 CreateListSheet **自動 1 回** |
| L3 | アイデア献立カードに買い物 CTA **なし**。idea + intent はメッセージのみ（shopping hooks 禁止） |
| L4 | 新規 API / マイグレーション / 一覧上 create HTTP **なし** |
| L5 | 削除済み行は**既定非表示**。同一マウントで **mutation 成功後**だけ確認行＋「元に戻す」。きれいにする／離脱で消える |
| L6 | soft-delete / `is_removed_by_user` / 差分 protected のサーバ契約 **変更なし** |
| L7 | クエリは **`for=shopping` のみ**有効。他値は無視 |
| L8 | **開く**条件と **閉じる**条件を分離（下記）。`isPending` / 一時 `isFetching` ではシートを閉じない |
| L9 | 買い物 intent は **`sessionStorage`（PII なし）**。`?for=shopping` のたびに **新サイクル**（consumed / didAutoOpen をクリア）。即 URL strip 可 |
| L10 | 本線実装先は **`menu-result-page.tsx`**。`history-detail-page.tsx` は同一契約の **パリティ必須**（e2e `/history/:id` 用） |
| L11 | MenuResult の CreateListSheet に **`forceNewMode={shoppingGate.blocked}` 必須**（D-C1。現状 history-detail のみ配線） |
| L12 | きれいにする近傍に **「まちがえたらその場で元に戻す」** 説明を置く（後から UI で undo 不能） |
| L13 | auto-open 実行だけでは intent を消さない。**終端**（キャンセル / 作成成功 / idea 拒否 / **遅延 unmount クリア**）で `clearShoppingIntentCycle`。StrictMode 復帰は **`sheetExpected` のみ**（mustClose は sheetExpected を消し自動再開しない） |
| L14 | CreateListSheet の h2（`#create-list-title`）に **`tabIndex={-1}`** を付け、auto-open 後 focus 可能にする（契約は呼び出し側が focus。見出し属性は CreateListSheet 最小変更で可） |
| L15 | ページ unmount 時の `clearShoppingIntentCycle` は **同期では行わない**。`setTimeout(0)`（または microtask）で遅延し、**同一 menuId の remount でキャンセル**する（StrictMode 耐性）。実ナビ離脱では遅延後にクリアし sticky intent を防ぐ |

---

## Goals & Non-Goals

### Goals

- 買い物 → 履歴 → カード（または文脈中タイトル）→ `/menus/:id` → 確認後シートまで意図が途切れない
- 通常の履歴タブ閲覧でも household カードから買い物作成に気づける
- 削除行がリストを埋めない。きれいにしたあと再訪しても埋まらない
- 320px・44×44・平易日本語。既存 create API / resume / CreateListSheet 再利用

### Non-Goals

- アイデア献立の買い物対応
- 一覧からの直接 create HTTP
- 削除行の DB 物理削除
- reconcile 差分ロジックの変更
- 生成フロー固有の `?recovered=1` 等の変更（**`?for=shopping` は履歴由来として MenuResult で処理する** — Non-Goal ではない）
- 本番デプロイ / `git push`

**MVP §9.2 注記:** 「結果からワンタップ」は生成結果経路の表現。履歴経路は **再確認必須のためカード → 詳細 → シート**であり、安全ゲートを省略しない。

---

## Spec supersede

| 文書・実装 | 本設計 |
|------------|--------|
| 買い物 empty「履歴から選ぶ」→ `/history` | **`/history?for=shopping`** |
| 買い物 safety「履歴を開く」→ `/history` | **`/history?for=shopping`** |
| 履歴一覧に買い物 CTA なし | household カードに CTA → `/menus/:id?for=shopping` |
| MenuResult / HistoryDetail の `for` 未処理 | intent 解決・auto-open・idea メッセージ・forceNewMode（MenuResult） |
| `hideRemovedItems` state | **既定非表示 + 成功後 pendingUndoIds** |
| MVP §9.2 undo | **同一マウントで確認行が出ている間のみ UI から到達**。API undo は残るが非表示行には UI 到達しない |

**維持:** from-menu API、new/append、resume command、`idea_menu_not_supported`、進捗から removed 除外、CreateListSheet の props 契約（呼び出し側 key/itemCount/forceNewMode のみ）。

---

## Proposed Design

### 1. クエリと sessionStorage 契約

| 種類 | キー / 値 | 意味 |
|------|-----------|------|
| URL | `for=shopping` | 買い物作成意図の**新サイクル**入口 |
| sessionStorage | `kondate:shopping:intent:v1:${menuId}` = `"1"` | この献立で買い物作成を求めている（案内表示用） |
| sessionStorage | `kondate:shopping:did-auto-open:v1:${menuId}` = `"1"` | このサイクルで初回 auto-open 済み（再確認のたびに自動で開き直さない） |
| sessionStorage | `kondate:shopping:sheet-expected:v1:${menuId}` = `"1"` | **いまシートが表示されているべき**（StrictMode で state 喪失時の復帰用。mustClose / キャンセルで消す） |

既存 `auth-cleanup` は `kondate:shopping:` 接頭辞を消す。**全キーは同接頭辞必須**。

**R1 の `consumed` キーは使わない**（再入場を壊すため廃止）。

#### Intent 解決アルゴリズム（MenuResult / HistoryDetail 親）

```text
on mount / searchParams change (menuId 確定後):
  if URL for=shopping:
    // 新サイクル: 二度目のカード押下でも auto-open できる
    sessionStorage.setItem(intentKey(menuId), "1")
    sessionStorage.removeItem(didAutoOpenKey(menuId))
    sessionStorage.removeItem(sheetExpectedKey(menuId))
    replace URL to drop `for` only (keep other params)

  shoppingIntentActive =
    sessionStorage.getItem(intentKey(menuId)) === "1"

  // idea / household 分岐の前に URL strip は親の責任
  // shoppingIntentActive を props で Idea* / Household* へ渡す
```

#### Auto-open / 復帰 / 終端

```text
// 初回 auto-open（household のみ）
shouldAutoOpen =
  shoppingIntentActive
  && canOpenCreateSheet
  && shoppingSheet === null
  && no valid pending create envelope for menuId
  && didAutoOpen !== "1"

on shouldAutoOpen:
  setShoppingSheet("create")
  set didAutoOpen = "1"
  set sheetExpected = "1"
  scrollIntoView + focus h2#create-list-title
  // intent は残す（案内用）

// StrictMode remount 等: React sheet state だけ消えた場合
shouldRestoreSheet =
  sheetExpected === "1"
  && canOpenCreateSheet
  && shoppingSheet === null
  && no pending resume

on shouldRestoreSheet:
  setShoppingSheet("create")
  // didAutoOpen / sheetExpected / intent は触らない

// 安全 fail-closed
on mustCloseCreateSheet:
  setShoppingSheet(null)
  remove sheetExpected          // 復帰しない
  // intent と didAutoOpen は残す → 手動 CTA で再オープン可
  // didAutoOpen があるので shouldAutoOpen は再発火しない
```

終端（`clearShoppingIntentCycle(menuId)` = intent + didAutoOpen + sheetExpected をすべて remove）:

| イベント | 動作 |
|----------|------|
| CreateListSheet キャンセル | sheet null + **同期**サイクル全クリア |
| 作成成功 → navigate `/shopping` 直前 | **同期**サイクル全クリア |
| idea 拒否 UI 表示開始 | **同期**サイクル全クリア + mount ローカル `showIdeaShoppingRejected=true` |
| ページ unmount | **遅延クリア（L15）** — 下記 |

#### Unmount クリア（L15・StrictMode 安全）

同期 unmount で即 `clearShoppingIntentCycle` すると、React StrictMode の unmount→remount で `sheetExpected` が消え、§1 の sheet 復帰が死ぬ。

実装契約（module スコープの `Map<menuId, timerId>` または helper 内）:

```text
on MenuResult/HistoryDetail mount (menuId):
  cancelPendingIntentClear(menuId)   // 遅延クリアを破棄

on unmount:
  scheduleIntentClear(menuId)        // setTimeout(0) で clearShoppingIntentCycle(menuId)

// StrictMode: unmount が schedule → 直後 remount が cancel → storage 生存 → shouldRestoreSheet 可
// 実ナビ離脱: unmount schedule → remount なし → timeout でクリア → sticky intent なし
// menuId 変更: 旧 id は unmount schedule、新 id は別キー
```

`scheduleIntentClear` / `cancelPendingIntentClear` を `shopping-intent.ts` に置き、テストで「schedule 後 cancel するとキーが残る」「schedule のみだと消える」を固定する。

**pending create resume 優先:**  
有効 create envelope がある間は shouldAutoOpen / shouldRestoreSheet **ともしない**。

### 2. 買い物リストページ

#### 2.1 Empty

- 「献立を作る」→ `/planner`
- 「履歴から選ぶ」→ **`historyPathForShopping()`** = `/history?for=shopping`（**`Link` 必須**。素の `<a href>` 禁止はしないが helper 文字列と一致）

#### 2.2 リストあり

- リスト末尾（「＋ 項目を追加」の近く）に secondary **「別の献立から作る」** → 同じ `historyPathForShopping()`
- primary は追加のまま

#### 2.3 Safety error（D-C1）

- 「履歴を開く」→ **`historyPathForShopping()`**（クエリなし `/history` は廃止）

#### 2.4 削除行表示（L5）— state 機械（一意）

用語:

- **server-removed**: `item.isRemovedByUser === true`
- **pendingUndoIds**: `Set<string>`。**永続化しない**。mutation **成功後**に確認行を出すための id 集合

表示式（`ShoppingItemRow` 契約は変更しない = 確認行は `isRemovedByUser` のときだけ）:

```text
displayItems =
  items where
    !isRemovedByUser
    OR (isRemovedByUser AND id ∈ pendingUndoIds)
```

遷移（矛盾禁止）:

| イベント | pendingUndoIds |
|----------|----------------|
| mount | `∅` |
| 削除 / 家にある **送信開始** | **変更しない**（楽観確認行にしない。通常行のまま pending） |
| 同操作 **成功**（mutate OK、必要なら refetch 後） | `add(id)` |
| 同操作 **失敗** | 触らない（元から無い） |
| 「元に戻す」**成功** | `delete(id)` |
| サーバが non-removed に戻った id（undo 成功後の refetch） | `delete(id)`（防御） |
| 同一マウント中の背景 refetch / Realtime | **原則クリアしない**。server-removed ∩ pending の確認行を維持 |
| 「リストをきれいにする」 | `∅` |
| unmount | 破棄 |

きれいにするボタン:

- 表示条件: `displayItems` に server-removed かつ pending の行が **1 件以上**
- ラベル: **リストをきれいにする**
- 直下または aria 説明: **「外した項目の表示を消します。まちがえて消したときは、その場の「元に戻す」を先に押してください」**（L12）

全件 server-removed かつ pending 空:

- active list は維持（`data === null` にしない）
- 短文: **「買うものは今ありません」**
- 「＋ 項目を追加」+ 「別の献立から作る」

進捗: 現行どおり `!isRemovedByUser` のみ（pending 中の removed も分母に入れない）。

### 3. 履歴一覧

#### 3.1 バナー行列（必須）

`shoppingIntent = hasShoppingIntent(searchParams)` を **HistoryPage が読み**、`HistoryPageContent` に `shoppingIntent: boolean` で渡す（empty 早期 return でもバナー可能にする）。

| 状態 | バナー | 本文 |
|------|--------|------|
| loading | 出さなくてよい | 既存 |
| error | 出さなくてよい | 既存 |
| empty 0 件 | **必須**（shoppingIntent 時） | 既存 empty + 「買い物に戻る」`/shopping` + 必要なら献立を作る |
| list（1 件以上） | **必須** | 下記文言 |

list バナー文言:

- 強: **「買い物リスト用に献立を選んでください」**
- 補: 「家族に合わせた献立」の **買い物リストを作る** を押します。アイデア献立は使えません
- 「買い物に戻る」→ `/shopping`

#### 3.2 household CTA 0 件の行き止まり（必須）

`shoppingIntent` かつ **表示中**のカードに household が 0（idea のみ、またはお気に入りフィルタで household 消滅）:

- 「いま選べる家族向けの献立がありません。買い物リストに使えるのは家族に合わせた献立だけです」
- primary: **家族向けの献立を作る** → `/planner`
- secondary: フィルタ中なら「すべての献立を表示」; 常に **買い物に戻る**

#### 3.3 HistoryCard

| 条件 | UI |
|------|-----|
| household | actions **先頭**に primary **買い物リストを作る** → `menusPathForShopping(id)` |
| idea | 買い物 CTA **なし** |

タイトル Link:

- **`shoppingIntent === true` のとき**（親から prop）: タイトルも **`menusPathForShopping(id)`**（低リテラシーがタイトルを押しても intent 維持）
- `shoppingIntent === false`: 従来どおり `/menus/:id`（`for` なし）

`HistoryCard` props に `shoppingIntent?: boolean`（default false）を追加。

### 4. 献立詳細本線: MenuResultPage（L10）

`/menus/:menuId` = `MenuResultPage`。履歴カードの本線。

#### 4.1 親の責任

1. §1 の intent 解決（URL strip + sessionStorage）
2. loading / error は既存
3. `targetMode === "idea"` → `Idea*Body` に `shoppingIntentActive` のみ渡す。**shopping hooks / create query / resume create を mount しない**
4. household → 既存 shopping hooks + 下記

#### 4.2 Idea + intent

- 親が `shoppingIntentActive` を見た最初の idea 描画で mount ローカル `showIdeaShoppingRejected = true` にし、§1 どおり storage の intent/didAutoOpen をクリア
- `showIdeaShoppingRejected` の間、上部 `role="status"`: **「アイデア献立は買い物リストに使えません。家族に合わせた献立を選んでください」**
- 「履歴に戻る」→ `/history?for=shopping`、「買い物に戻る」→ `/shopping`
- storage クリア後も **ローカル state がある間はメッセージを出し続ける**（flash 防止）
- sessionStorage の create pending を idea では **作らない**（既存テスト維持）
- shopping hooks は mount しない

#### 4.3 Household: 開く / 閉じる / auto-open

```text
canOpenCreateSheet =
  actionsEnabled
  && !shoppingListBusy          // isFetching || !isSuccess || empty menuId
  && !createList.isPending

mustCloseCreateSheet =
  !actionsEnabled
  // 含めない: createList.isPending, 一時 isFetching のみ
  // 含む: 再確認 checking 中で actionsEnabled が false のとき
  // → シートは閉じる。didAutoOpen は残るので自動再オープンしない（手動ボタン）

mustCloseReconcileSheet =
  !actionsEnabled || shoppingGate.blocked
```

| 操作 | 条件 |
|------|------|
| 手動「買い物リストを作る」enabled | `canOpenCreateSheet` |
| 手動オープン時 | sheet create。**sheetExpected は立てない**（auto 復帰の対象外）。intent は触らない |
| auto-open / StrictMode 復帰 | §1 `shouldAutoOpen` / `shouldRestoreSheet` |
| create 強制クローズ | `mustCloseCreateSheet` → §1（sheetExpected のみ除去） |
| reconcile 強制クローズ | `mustCloseReconcileSheet` |
| キャンセル | sheet null + `clearShoppingIntentCycle` |

D-M7 差分: 再生成シートは `!actionsEnabled` で閉じる。買い物 create も同じ。**一時 revalidation で閉じたあと auto-open は再実行しない**（didAutoOpen）。ユーザーは手動 CTA。

CreateListSheet:

- `forceNewMode={shoppingGate.blocked}` **必須**（L11）
- `itemCount = items.filter(i => !i.isRemovedByUser).length`（0 件でも「今のリストへ追加（0件）」可）
- `key={\`${activeList?.id ?? "none"}-${activeList?.version ?? 0}\`}`
- `safetyBlocked={!canOpenCreateSheet}`
- h2 `#create-list-title` に **`tabIndex={-1}`**（L14）
- auto-open 後: `scrollIntoView` + 当該 h2 へ `focus()`

上部案内（`shoppingIntentActive` 中）:

- 確認中: 「買い物リストを作る前に、いまの家族設定を確認しています」
- 確認 NG: 既存エラー + 履歴/買い物リンク
- 確認 OK: 「この献立で買い物リストを作れます」

### 5. パリティ: HistoryDetailPage（`/history/:menuId`）

L10: **同じ** intent 解決・idea メッセージ・canOpen/mustClose・auto-open・forceNewMode（既にある）・itemCount・scroll/focus・resume 優先を実装する。共有できるなら小さな hook（例 `useShoppingCreateIntent(menuId)`）に寄せてよいが、**振る舞い契約は同一**。

### 6. 共有 helper（必須・任意ではない）

`src/features/shopping/shopping-intent.ts`:

```ts
export const SHOPPING_INTENT_PARAM = "for";
export const SHOPPING_INTENT_VALUE = "shopping";

export function hasShoppingIntent(params: URLSearchParams): boolean {
  return params.get(SHOPPING_INTENT_PARAM) === SHOPPING_INTENT_VALUE;
}

export function historyPathForShopping(): string {
  return "/history?for=shopping";
}

export function menusPathForShopping(menuId: string): string {
  return `/menus/${menuId}?for=shopping`;
}

export function shoppingIntentStorageKey(menuId: string): string {
  return `kondate:shopping:intent:v1:${menuId}`;
}

export function shoppingDidAutoOpenKey(menuId: string): string {
  return `kondate:shopping:did-auto-open:v1:${menuId}`;
}

export function shoppingSheetExpectedKey(menuId: string): string {
  return `kondate:shopping:sheet-expected:v1:${menuId}`;
}

export function clearShoppingIntentCycle(menuId: string): void {
  sessionStorage.removeItem(shoppingIntentStorageKey(menuId));
  sessionStorage.removeItem(shoppingDidAutoOpenKey(menuId));
  sessionStorage.removeItem(shoppingSheetExpectedKey(menuId));
}

// L15: StrictMode は unmount→remount が同期的に続く。即クリア禁止。
export function scheduleIntentClear(menuId: string): void { /* setTimeout(0) → clear */ }
export function cancelPendingIntentClear(menuId: string): void { /* clearTimeout */ }
```

テスト・UI は文字列直書きせず helper を使う。

### 7. エラー・エッジ（要約）

| ケース | 挙動 |
|--------|------|
| StrictMode 二重 mount | sessionStorage intent で生存; consumed で二重 auto-open 抑制 |
| resume + for=shopping | resume 優先、auto-open しない |
| 二重カードタップ | 同一詳細、auto-open 1 回 |
| 全削除表示 | §2.4 短文 empty |
| itemCount 0 の active list | 「追加（0件）」可。forceNew は gate blocked 時のみ |

### 8. Testing（必須抜粋）

| 領域 | ケース |
|------|--------|
| shopping | empty / safety「履歴」/ 「別の献立」が `?for=shopping` |
| 削除 | 初期 server-removed 非表示; 成功後確認行; きれいにするで消える; 再マウント非表示; 失敗で確認行なし |
| history | banner list/empty; household0 行き止まり; card CTA household only; shoppingIntent 時タイトルも for=shopping |
| MenuResult | for=shopping → intent set + didAutoOpen clear → strip → canOpen 後 sheet; scroll/focus + tabIndex |
| MenuResult | **2 回目**の `?for=shopping`（キャンセル後）でも auto-open する |
| MenuResult | mustClose 後は sheetExpected なし → **自動再開しない**; 手動 CTA 可 |
| MenuResult | StrictMode: unmount schedule + remount cancel で storage 生存 → sheetExpected 復帰 |
| MenuResult | 実離脱: schedule のみでサイクルクリア → for なし再入場では auto-open しない |
| helper | scheduleIntentClear 後 cancel でキー残存; schedule のみで削除 |
| MenuResult | forceNewMode when gate blocked; itemCount excludes removed |
| idea | ローカル拒否メッセージが storage クリア後も残る; sheet 0; shopping network 0 |
| fail-closed | !actionsEnabled で create 閉じる; isPending 中はシート残る; isFetching のみで閉じない |
| resume | pending create 中は auto-open しない |
| HistoryDetail | パリティ代表ケース最低 1 |

---

## File touch list

| ファイル | 変更 |
|----------|------|
| `src/features/shopping/shopping-intent.ts` | **新規** helper + storage key |
| `src/features/shopping/shopping-intent.test.ts` | helper unit |
| `src/features/shopping/pages/shopping-list-page.tsx` | pendingUndo 機械、リンク 3 箇所、きれいにする説明、全削除短文 |
| `src/features/shopping/pages/shopping-list-page.test.tsx` | 表示・リンク |
| `src/features/history/pages/history-page.tsx` | intent prop、バナー行列、household0 |
| `src/features/history/pages/history-page.test.tsx` | バナー・行き止まり |
| `src/features/history/components/history-card.tsx` | CTA、タイトル intent |
| `src/features/history/components/history-card.test.tsx` | CTA / idea / タイトル |
| `src/features/generation/pages/menu-result-page.tsx` | **本線** intent・auto-open・close・forceNew・itemCount・focus |
| `src/features/generation/pages/menu-result-page.test.tsx` | 本線テスト |
| `src/features/history/pages/history-detail-page.tsx` | パリティ |
| `src/features/history/pages/history-detail-page.test.tsx` | パリティ代表 |

---

## Risks & Mitigations

| リスク | 緩和 |
|--------|------|
| ルート取り違え（history-detail のみ実装） | L2/L10 本線 MenuResult 固定 + テスト path `/menus/` |
| StrictMode intent / sheet 消失 | L15 遅延 unmount クリア + sheetExpected 復帰 |
| 2 回目カードで auto-open しない | `for=shopping` で didAutoOpen クリア |
| sticky intent の不意 auto-open | 実離脱後の遅延 clear（L15） |
| 送信中シート消滅 | L8 mustClose ≠ canOpen |
| forceNew 未配線で append 罠 | L11 MenuResult 必須 |
| きれいにする後の後悔 | L12 説明 copy |
| resume 二重 UI | pending 中 auto-open 禁止 |
| シートが fold 下 | scrollIntoView + focus |

---

## Revision Summary

### R0 — 初稿

- A + 案1 + 削除既定非表示を文書化

### R1 — 一次敵対的 + 二次レビュー反映（擬陽性以外）

| 指摘 | 対応 |
|------|------|
| C-1 / ルート不一致 | 本線 **MenuResult** `/menus/:id`。HistoryDetail はパリティ必須（L2/L10） |
| C-2 StrictMode intent | sessionStorage intent（L9）※消費規則は R2 で再修正 |
| C-3 / 二次 C1 fail-closed 過大 | **canOpenCreateSheet** vs **mustCloseCreateSheet** 分離（L8） |
| I-1 / 二次 C2 pending 矛盾 | 成功後のみ pending。楽観確認行禁止 |
| I-2 / 二次 I4 タイトル | shoppingIntent 中はタイトルも `for=shopping` |
| I-3 / 二次 I3 行き止まり | household CTA 0 の固定 UI |
| I-4 / 二次 I1 idea 配置 | 親で intent、Idea は props のみ、hooks 禁止 |
| I-5 / 二次 I5 D-C1 | 「履歴を開く」も `?for=shopping` |
| I-6 forceNew MenuResult | L11 必須 |
| I-7 undo 説明 | L12 copy |
| 二次 I2 reconcile close | mustCloseReconcile 必須 |
| 二次 I6 banner 行列 | loading/error/empty/list 固定 |
| 二次 I7 itemCount | MenuResult+Detail とも non-removed |
| 二次 I8 focus | scrollIntoView + h2 focus（tabIndex は R2） |
| 二次 I9 resume | pending 中 auto-open 禁止 |
| Minor helper 任意 | helper **必須** |
| Minor 別の献立位置 | リスト末尾固定 |

### R2 — R1 再レビュー残差（擬陽性以外）

| 指摘 | 対応 |
|------|------|
| C-R1 / 二次 C1 consumed が再入場を殺す | **`for=shopping` で didAutoOpen+sheetExpected クリア**。consumed 廃止。auto-open では intent を消さない（L9/L13） |
| C-R1 StrictMode で sheet 消滅 | **`sheetExpected=1` のときだけ** sheet 復帰（mustClose は sheetExpected を消す） |
| 二次 I1 一時 revalidation | mustClose → sheetExpected クリア → **自動再開しない**、手動 CTA |
| 二次 I2 sticky intent | 実離脱は L15 遅延 clear |
| 二次 I3 idea メッセージ flash | **mount ローカル `showIdeaShoppingRejected`** |
| I-R1 h2 focus | **`tabIndex={-1}`**（L14） |
| R2 final C-F1 unmount vs StrictMode | **L15** schedule/cancel unmount clear |

**採用しなかったもの（擬陽性 / 意図的非採用）**

- Option B（カードを `/history/:id` へ寄せる）: 既存タイトル本線が `/menus` のため Option A
- 削除行 localStorage 永続 hide: 既定非表示で足りる
- mustClose を `actionsEnabled` から外して checking 中もシート維持: 安全 fail-closed（D-M7 同型）を優先。再開は手動
- CreateListSheet の mode 自動追従リファクタ: key で十分

### レビュー文書

- `docs/archive/reviews/2026-07-30-shopping-from-history-primary-adversarial.md`
- `docs/archive/reviews/2026-07-30-shopping-from-history-secondary-review.md`
- `docs/archive/reviews/2026-07-30-shopping-from-history-r1-rereview.md`
- `docs/archive/reviews/2026-07-30-shopping-from-history-r1-secondary-rereview.md`
