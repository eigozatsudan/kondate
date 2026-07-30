# Secondary re-review (independent): Shopping-from-history R1

| 項目 | 値 |
|------|-----|
| 対象 | `docs/superpowers/specs/2026-07-30-shopping-from-history-and-cleanup-design.md`（R1 改訂後） |
| 日付 | 2026-07-30 |
| 種別 | 独立二次再レビュー（一次・二次 R0 の結論を前提にしない。設計全文と現行実装を再照合） |
| 判定 | **Needs revision** |
| 焦点 | 実装者が誤実装し得る曖昧さ / ルート正当性 / Intent StrictMode / fail-closed open vs close / pendingUndo 状態機械 / idea 境界 |
| 閾値 | Critical / Important のみ Ready を阻害。Confidence ≥ 80 のみ採用 |

**照合した正本・実装（read-only）**

- 設計 R1 全文
- `src/app/router.tsx`（`/menus/:menuId` → MenuResult、`/history/:menuId` → HistoryDetail）
- `src/main.tsx`（`<StrictMode>` あり）
- `src/features/history/components/history-card.tsx`（タイトル本線 `/menus/:id`）
- `src/features/generation/pages/menu-result-page.tsx`（household shopping hooks / `canCreateShoppingList` / CreateListSheet・`forceNewMode` 未配線）
- `src/features/history/pages/history-detail-page.tsx`（`forceNewMode={shoppingGate.blocked}` 既存）
- `src/features/history/hooks/use-menu-revalidation.ts`（`forcedChecking \|\| isPending \|\| isFetching` → `phase: "checking"`）
- `src/features/shopping/pages/shopping-list-page.tsx`（`hideRemovedItems` state）
- `src/features/shopping/components/shopping-item-row.tsx`（確認行は `isRemovedByUser` のみ）
- `src/features/auth/auth-cleanup.ts`（`kondate:shopping:` 接頭辞削除）
- `pendingShoppingCommandStorageKey`（`kondate:shopping:create:${menuId}`）

---

## Verdict: **Needs revision**

R1 は R0 の本線ルート不一致・StrictMode 用永続・open/close 分離・pendingUndo 成功後のみ・idea hooks 境界をかなり埋めている。方向性・Non-Goals・API/DB 非変更は健全で、実装可能な骨格になっている。

しかし **intent の `consumed` 一回券アルゴリズムは、同じ献立への 2 回目の `?for=shopping` を永久に殺す**。これは本線ユーザーフロー（キャンセル後の再選択、リスト作り直し）で必ず当たる。加えて open/close と intent 消費の組み合わせ、sticky intent、idea 拒否メッセージの表示持続に、実装者が誤った振る舞いを発明し得る隙間が残る。

**Ready 条件:** 下記 Critical を設計改訂で閉じること。Important も改訂または明示的ロックで閉じること。

---

## Findings table

| ID | Severity | Confidence | Area | Title |
|----|----------|------------|------|-------|
| C1 | **Critical** | 95 | Intent / §1 | 新規 `for=shopping` が `consumed` を消さない → 同一 menu の 2 回目 auto-open が死ぬ |
| I1 | **Important** | 90 | Fail-closed / L8 / §4.3 | `mustClose = !actionsEnabled` は再検証の一時 `checking` でも閉じる。consume-on-open と組み合わさるとシートが消え再 open しない |
| I2 | **Important** | 88 | Intent / §1 | auto-open 前に離脱すると intent が sticky。後で `for` なし再訪しても auto-open する |
| I3 | **Important** | 86 | Idea boundary / §4.2 | 「表示と同時に消費」を `shoppingIntentActive` 直結で実装すると拒否メッセージが一瞬で消える |

**Ready を阻害しない（確認済み・再指摘しない）**

| Area | 結論 |
|------|------|
| ルート | L2/L10/helper/File touch が本線 **MenuResult `/menus/:id`** に揃っている。HistoryDetail はパリティ。R0 C-1 は解消 |
| pendingUndo | 成功後のみ `add`、楽観確認行禁止、表示式 `removed ∩ pending`、きれいにするで `∅` が一意。ShoppingItemRow 契約と矛盾しない |
| idea hooks | 親で intent、Idea は props のみ、shopping hooks mount 禁止はロック済み（I3 は表示持続の話） |
| forceNewMode / itemCount / resume 優先 / helper 必須 | 実装可能な精度でロック済み |
| 削除行 Non-Goal（DB 非変更） | 健全 |

---

## What R1 gets right (independent confirmation)

1. **ルート本線がコードと一致**: `history-card` タイトルは既に `/menus/:id`。router も MenuResult。R1 の L2/L10 と `menusPathForShopping` はこれに一致し、history-detail のみ賢くなる失敗モードを塞いでいる。
2. **open と close の述語分離という方針は正しい**: 現行 `canCreateShoppingList` に `isPending` / `shoppingListBusy` が入っているため、close にそのまま掛けると送信中・背景 refetch でシートが消える。R1 の L8 方針自体は必要。
3. **pendingUndo 状態機械は一意**: R0 の「楽観確認行」と `ShoppingItemRow` の矛盾は消えている。マウント時 `∅` で再訪復活バグの根を断てる。
4. **idea 第一線**: カード CTA なし + 親で hooks 非 mount + サーバ `idea_menu_not_supported` 維持は guided-planner と整合。
5. **sessionStorage 接頭辞** `kondate:shopping:` は `auth-cleanup` と整合。ログアウトで intent も消える。
6. **テスト表**に fail-closed / StrictMode storage / resume / HistoryDetail パリティが入っており、検証可能な受け入れ条件になっている。

---

## Detailed findings

### [C1] 新規 `for=shopping` が `consumed` をクリアしない — **Critical** (95)

**Where:** §1 Intent 解決アルゴリズム

```text
if URL for=shopping:
  sessionStorage.setItem(intentKey(menuId), "1")
  replace URL to drop `for`
shoppingIntentActive =
  intentKey === "1" && consumedKey !== "1"

消費: intentKey 削除 + consumed 設定
  - auto-open 実行直後
  - idea メッセージ表示直後
  - 作成成功 navigate 直前
  - CreateListSheet キャンセル直後
```

**Why it's real**

1 回目: `for=shopping` → intent セット → auto-open または cancel/idea で **consumed=`"1"`**。

2 回目（同じ `menuId`、履歴カード CTA やタイトルから再び `?for=shopping`）:

1. URL あり → `intentKey="1"` を書く（**consumed は触らない**）
2. strip
3. `shoppingIntentActive = true && consumed!=="1"` → **false**
4. auto-open しない。idea 拒否メッセージも出ない

本線シナリオで再現する:

- シートを誤ってキャンセル → 履歴に戻り同じ献立を再タップ
- 作成成功後にリストを捨て、別日に同じ献立から再作成
- idea を一度踏んで consumed されたあと、別経路で同 id を開く（稀だが同一鍵）

StrictMode 用の「一回券」が **タブ寿命の永久券** になっており、URL の新規 intent より consumed が強い。L9「一回券」の意図（同一ナビゲーション内の二重 auto-open 抑制）を超えて、**正当な再入場を潰す**。

**Not a false positive:** アルゴリズム擬似コードに「URL 時に consumed を消す」行が無い。実装者が verbatim 実装すると必ず壊れる。

**Concrete design fix（必須）:**

```text
on mount / searchParams change:
  if URL for=shopping:
    sessionStorage.setItem(intentKey(menuId), "1")
    sessionStorage.removeItem(consumedKey(menuId))   // ← 新規入場で一回券をリセット
    replace URL to drop `for` (keep other params)
  shoppingIntentActive =
    sessionStorage.getItem(intentKey(menuId)) === "1"
    && sessionStorage.getItem(consumedKey(menuId)) !== "1"
```

テスト必須:

- 同一 menu で `for=shopping` → auto-open → cancel → 再度 `for=shopping` → **もう一度** auto-open
- idea で拒否消費後、別 household menu は影響しない（key に menuId）こと

---

### [I1] `mustClose = !actionsEnabled` は一時 recheck でも閉じ、consume-on-open と衝突する — **Important** (90)

**Where:** §4.3 / L8

```text
canOpenCreateSheet = actionsEnabled && !shoppingListBusy && !createList.isPending
mustCloseCreateSheet = !actionsEnabled
// 含めない: createList.isPending, 一時 isFetching のみ
```

**Code today**

```ts
// use-menu-revalidation.ts
phase = forcedChecking || isPending || isFetching ? "checking" : ...

// menu-result / history-detail
actionsEnabled =
  phase === "checked" && result !== undefined && isRevalidationActionable(result)
```

60s poll・focus・visibility・online・household Realtime のたびに `beginRecheck()` → `phase: "checking"` → **`actionsEnabled === false`**。

**Why it's real**

L8 は「一時 `isFetching` では閉じない」と書くが、その除外が指しているのは文脈上 `shoppingList.isFetching` であり、**再検証側の一時 fetching は `!actionsEnabled` に吸収されて close 条件に残る**。実装者は次のどちらにも読める:

- A: D-M7 と同型で `!actionsEnabled` なら checking 中も閉じる（擬似コードどおり）
- B: L8 文言どおり一時 fetch では閉じない（再検証 checking も除外）

さらに R1 は auto-open **実行直後に intent 消費**する。A で実装した場合のシーケンス:

1. auto-open → sheet 表示 → **consume**
2. その後 60s poll / タブ復帰 focus → checking → mustClose → sheet null
3. intent は消費済み → **再 auto-open しない**
4. 手動ボタンは `canOpen` 復帰後に押せるが、案1「確認後シート自動」の文脈が消える

D-M7 の再生成シートと同型 close は安全側として理解できるが、**買い物 auto-open + 即 consume** とそのまま組むと「勝手に閉じたまま戻らない」。L8 の「一時 isFetching では閉じない」とも読みが衝突する。

**Concrete design fix（いずれかをロック）:**

**推奨 Fix A — close を終端失敗に限定し、L8 と一致させる**

```text
mustCloseCreateSheet =
  revalidation.phase === "error"
  || (revalidation.phase === "checked"
      && result が non-actionable)

// phase === "checking" 中はシートを維持し、
// safetyBlocked={!canOpenCreateSheet} で送信だけ止める
```

**Fix B — D-M7 同型 close を維持するなら consume を遅らせる**

```text
mustCloseCreateSheet = !actionsEnabled   // checking 含むと明記
// 消費は auto-open 実行時ではなく:
//   cancel / 作成成功 navigate / idea 拒否を state に確定した時のみ
// auto-open 再評価:
//   shoppingIntentActive && canOpen && sheet===null && !resume
//   → checking で閉じたあと checked に戻れば再 open してよい
// 二重 effect 抑制は mount ローカル ref のみ（sessionStorage consumed は使わないか、
//   「ユーザーが閉じた」ときだけ立てる）
```

テスト必須:

- シート表示中に revalidation recheck（checking）が走っても、採用した Fix の期待どおり（維持 or 閉じるが intent 残存で復帰）
- `createList.isPending` 中はシートが残る（R1 既存）
- `shoppingList.isFetching` のみでは閉じない（R1 既存）

---

### [I2] auto-open 前離脱で intent が sticky — **Important** (88)

**Where:** §1 消費リスト / L9

消費トリガは auto-open 実行・idea 表示・成功・キャンセルのみ。  
**ページ離脱・別タブ履歴閲覧・`menuId` 変更以外のナビゲーションでは intentKey を消さない**（「旧 menu のキーを触らない」と明記）。

**Why it's real**

1. `/menus/X?for=shopping` → intent セット、strip
2. 再検証や list fetch が終わる前にユーザーが戻る / 他へ遷移
3. intentKey が sessionStorage に残る
4. 後で履歴から **`/menus/X`（`for` なし）** を開く（通常閲覧）
5. `shoppingIntentActive === true` → 条件が揃った瞬間に **突然 CreateListSheet auto-open**

これは「買い物文脈の発見可能性」を超えて、通常の献立結果閲覧をハイジャックする。低リテラシー向けには「勝手にシートが出た」事故になる。

StrictMode 耐性のために sessionStorage を使う以上、**タブ内の寿命とクリア条件**を設計が握らないと実装者が「残してよい」と読む。

**Concrete design fix:**

次のいずれか（または組み合わせ）を §1 にロックする:

1. **TTL**: intent 書き込み時に timestamp（または別キー）を保存し、例: 5 分超は active とみなさない  
2. **成功しない離脱でクリア**: `menuId` を持つ詳細ページの、実ナビゲーションによる unmount で intentKey を削除。ただし React StrictMode の simulated unmount で消えないよう、  
   - URL 由来の初回 write 後 N ms は cleanup で消さない、または  
   - React の state restore に任せ sessionStorage は「URL strip 直後の同一 tick バックアップ」に限定する  
3. **active 条件を狭める**: `shoppingIntentActive` は「この mount で URL に `for=shopping` があった、または mount 開始から T 秒以内に intent が書かれた」場合のみ

テスト必須:

- `for=shopping` で入る → シートを出さず `/history` へ → 同じ menu を `for` なしで開く → **auto-open しない**
- `for=shopping` で入る → StrictMode 相当の二重 effect でも intent は生存し、canOpen 後 1 回 open

---

### [I3] idea 拒否メッセージが「active 直結 + 即消費」だと消える — **Important** (86)

**Where:** §4.2

```text
- 上部 role=status: 「アイデア献立は買い物リストに使えません…」
- メッセージ表示と同時に intent 消費（再表示ループ防止）
```

**Why it's real**

実装者が次のように書くと壊れる:

```ts
// 悪い例
const showIdeaReject = shoppingIntentActive;
useEffect(() => {
  if (shoppingIntentActive) consumeIntent(menuId);
}, [shoppingIntentActive]);
```

1. render: active true → メッセージ表示  
2. effect: consume → active false  
3. 再 render: メッセージ消える（フラッシュのみ）

「再表示ループ防止」と「表示をユーザーが読めるまで残す」が同一フラグに載っている。§4.1 の idea hooks 禁止は守れるが、**表示の source of truth が未ロック**。

**Concrete design fix:**

```text
Idea body:
  // 親または Idea 内の React state（永続化不要）
  if (shoppingIntentActive && !ideaRejectLocked) {
    setIdeaRejectLocked(true)  // または親が consume 前に showIdeaShoppingReject=true を立てる
    consumeIntent(menuId)
  }
  showMessage = ideaRejectLocked || shoppingIntentActive

// メッセージは state が true の間、当該 Idea mount では出し続ける
// 「履歴に戻る」「買い物に戻る」でページを離れれば state 破棄でよい
```

テスト必須:

- idea + intent → メッセージが **安定表示**（即消えない）
- sheet 0・shopping network 0・intent 消費後もメッセージ残る
- 履歴に戻って再入場（C1 修正後）で再表示可能

---

## Focus checklist (requested)

| 焦点 | 結果 |
|------|------|
| 実装者が誤った振る舞いを発明し得るか | **Yes** — C1 は verbatim 実装で本線が死ぬ。I1–I3 は読みの分岐で誤実装し得る |
| ルート正当性 | **OK** — 本線 MenuResult、Detail パリティ。R0 ルート Critical は解消 |
| Intent StrictMode | **部分的** — sessionStorage 方針は妥当だが、consumed リセット欠落と sticky/TTL 未規定が残る |
| Fail-closed open vs close | **部分的** — pending/list fetch 分離は良い。`!actionsEnabled` と L8「一時 fetch」の関係が未ロック（I1） |
| pendingUndo 状態機械 | **OK** — 一意で ShoppingItemRow と整合。Critical/Important なし |
| idea 境界 | **hooks 境界 OK** / **拒否 UI 持続は I3** |

---

## Residual issues → required design edits (copy-ready)

### Must (Critical)

1. **§1**: `for=shopping` 検知時に `consumedKey(menuId)` を **removeItem** してから intent を立てる。  
2. **§8 Testing**: 同一 menu の 2 回目 `for=shopping` で auto-open が再発火するケースを必須化。

### Must for Ready (Important)

3. **§4.3 / L8**: `mustCloseCreateSheet` が revalidation `checking` を含むか否かを一文で固定。推奨は「終端失敗のみ close + checking 中は safetyBlocked」。D-M7 同型を選ぶなら consume を cancel/success/idea 確定時のみにし、intent 残存で re-open 可と書く。  
4. **§1**: intent のタブ内寿命（TTL または非 shopping 再訪で auto-open しない条件）を固定。  
5. **§4.2**: idea 拒否メッセージは `shoppingIntentActive` 消費後も **当該 mount の React state で維持**と固定。

### Optional (Minor — Ready 非阻害)

- auto-open 後の `scrollIntoView` / h2 focus は `useEffect` after paint と明記（DOM 未装着レース）。  
- History の `for=shopping` は **strip しない**（バナー用）と §3 に再掲すると実装者が MenuResult と同じく strip しない。  
- `pendingUndoIds` の型を `Set<string>` の React state と明記（ref のみにすると確認行が再描画されない）。

---

## Explicit non-issues (re-checked, not re-raised)

| 候補 | なぜ今は非指摘か |
|------|------------------|
| CTA → `/menus` vs 実装 history-detail のみ | R1 で本線 MenuResult に修正済み |
| 楽観 pending → 確認行 | R1 で成功後のみに修正済み |
| MenuResult の forceNewMode 漏れ | L11 必須ロック済み |
| タイトルが `for` を落とす | shoppingIntent 中はタイトルも `for=shopping` |
| household 0 行き止まり | §3.2 固定 UI |
| safety「履歴を開く」 | `historyPathForShopping()` |
| soft-delete 契約変更 | Non-Goal で正しい |

---

## Final verdict

**Needs revision**

残 Critical / Important（one-liners）:

- **C1:** 新規 `?for=shopping` 時に `consumed` を消さず、同一 menu の 2 回目 auto-open が死ぬ  
- **I1:** `mustClose=!actionsEnabled` が recheck の一時 checking でも閉じ、即 consume と組むとシートが戻らない（L8 とも衝突）  
- **I2:** auto-open 前離脱で intent が sticky し、`for` なし再訪で突然 auto-open する  
- **I3:** idea 拒否を active 直結＋即消費にするとメッセージが一瞬で消える（表示用 state が未ロック）
