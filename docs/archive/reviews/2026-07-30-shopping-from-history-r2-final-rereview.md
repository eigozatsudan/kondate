# Final re-review (R2): 買い物リスト 履歴導線 + 削除行クリーンアップ

| 項目 | 値 |
|------|-----|
| 対象 | `docs/archive/superpowers/specs/2026-07-30-shopping-from-history-and-cleanup-design.md`（**R2・再レビュー残差吸収後**） |
| 日付 | 2026-07-30 |
| 種別 | R2 final re-review（残 Critical / Important のみ。擬陽性・既決 Minor は再開しない） |
| 前提 | R1 re-review `…-r1-rereview.md` / secondary `…-r1-secondary-rereview.md` |
| 照合 | 設計 R2 全文、`main.tsx`（`<StrictMode>`）、`menu-result-page.tsx`（`actionsEnabled` / D-M7 close）、`create-list-sheet.tsx`（h2 に `tabIndex` なし）、`router.tsx` 本線 `/menus/:menuId` |
| 判定 | **Needs revision** |

---

## 1. Verdict: **Needs revision**

R2 は R1 残差の **大半を正しく閉じている**。`consumed` 廃止と `?for=shopping` 新サイクル、auto-open 非消費、`sheetExpected` による mustClose 後の自動再開禁止、idea 拒否の mount ローカル state、`tabIndex={-1}`、mustClose 方針の明示的ロックは実装可能な粒度まで落ちている。

しかし L13 / §1 終端表が **同時に要求する 2 条件が字義実装で両立しない**:

1. ページ **unmount** で `clearShoppingIntentCycle`（sticky 禁止）
2. StrictMode remount 時に **`sheetExpected=1` で sheet 復帰**

アプリは `main.tsx` で全体 `<StrictMode>` であり、React 18+ の simulated unmount は effect cleanup を走らせる。naive な unmount クリアは `sheetExpected` ごと消し、R2 が直したはずの StrictMode sheet 喪失を再発させる。逆に unmount クリアを省略すると二次 I2（sticky intent）が戻る。

**「どう unmount を StrictMode と区別するか」が未ロック**のまま Ready にはできない。

Open: **Critical 1 / Important 0**（§7 の `consumed` 残滓は Minor 扱い — 本文 §1 が正本で十分）。

---

## 2. Adjudication of R1 residuals（R2 が閉じたか）

| R1 residual | Source | R2 disposition | Final |
|-------------|--------|----------------|-------|
| `consumed` が 2 回目 `?for=shopping` を殺す | C-R1 / 二次 C1 | `consumed` **廃止**。`for=shopping` で intent set + `didAutoOpen`/`sheetExpected` remove。auto-open は intent を消さない（L9/L13、§1、Testing「2 回目」） | **Fixed** |
| StrictMode で sheet 消滅（intent 消費後 remount） | C-R1 | `sheetExpected` + `shouldRestoreSheet`（L13、§1、Testing） | **Not fixed** — unmount 全クリアと矛盾（本レビュー C-F1） |
| mustClose（一時 revalidation）後に sheet が戻らない | 二次 I1 | **意図的採用**: mustClose=`!actionsEnabled`（checking 含む）、sheetExpected 除去、**自動再開しない・手動 CTA**（§4.3、R2 非採用リスト、Testing） | **Fixed**（方針ロック。曖昧さは解消） |
| sticky intent（`for` なし再訪で突然 auto-open） | 二次 I2 | unmount でサイクル全クリア（L13、§1 終端、Testing） | **Partial** — 意図は正しいが C-F1 の解決なしでは実装不能 or StrictMode 再破 |
| idea 拒否メッセージ flash | 二次 I3 | mount ローカル `showIdeaShoppingRejected` + storage クリア後も表示（§4.2、Testing） | **Fixed** |
| h2 focus に `tabIndex={-1}` 未ロック | I-R1 | L14 + §4.3 + Testing | **Fixed**（現行 `create-list-sheet.tsx` h2 に未実装なのは設計どおり差分） |

### 閉じたもの（再指摘しない）

| 領域 | 確認 |
|------|------|
| 再入場 auto-open | `for=shopping` → didAutoOpen clear → 新サイクル。キャンセル後 2 回目カードが死なない |
| mustClose ≠ canOpen | isPending / shoppingList isFetching のみでは閉じない。revalidation checking は閉じる（D-M7 同型・明示） |
| idea hooks 境界 / flash | 親 intent + ローカル拒否 state。hooks mount 禁止維持 |
| focus 契約 | h2 `tabIndex={-1}` + 呼び出し側 focus。リポジトリ内同型（pantry / audience 等）と一致 |
| 本線ルート / forceNewMode / pendingUndo / resume / helper | R1 時点で Fixed。R2 で退行なし |
| 二次 I1 の「consume-on-open と mustClose の衝突」 | consume-on-open 廃止で根を切断。閉じたあとは手動 CTA と明記 |

---

## 3. Remaining finding（Critical only）

### [C-F1] unmount 全クリアと StrictMode `sheetExpected` 復帰が両立しない — **Critical**

**Confidence:** 94

**Where:** L13、§1 終端表（「ページ **unmount**」行）、`shouldRestoreSheet`、§8 Testing の StrictMode 行と unmount 行、Risks「sticky intent」

**Locked requirements that collide**

```text
// L13 / §1
終端 clearShoppingIntentCycle:
  - キャンセル
  - 作成成功 navigate 直前
  - ページ unmount          ← sticky 禁止
  - idea 拒否

shouldRestoreSheet =
  sheetExpected === "1"     ← StrictMode で state 喪失時
  && canOpenCreateSheet
  && shoppingSheet === null
  && no pending resume
```

§8 は両方を必須テストにする:

- `StrictMode: sheetExpected=1 のときだけ sheet state 復帰`
- `unmount でサイクル全クリア → for なし再入場では auto-open しない`

**Code reality**

- `src/main.tsx` はアプリ全体を `<StrictMode>` で包む。
- React 18+ StrictMode は mount → **cleanup（unmount 相当）** → remount の順で effect を二重実行する。
- 字義どおりの実装:

```ts
useEffect(() => {
  return () => {
    clearShoppingIntentCycle(menuId); // intent + didAutoOpen + sheetExpected 全削除
  };
}, [menuId]);
```

**Failure sequence（案1本線 + warm cache で canOpen が初回から true）**

1. Mount1: `?for=shopping` → intent set、strip → `shouldAutoOpen` → sheet state + `didAutoOpen=1` + `sheetExpected=1`
2. StrictMode cleanup: **`clearShoppingIntentCycle`** → storage 空
3. Mount2: URL は strip 済み、`sheetExpected` なし → `shouldRestoreSheet` false、`shouldAutoOpen` false（intent も無し）
4. **シートが一瞬も残らない** — 一次 C-2 / R1 C-R1 StrictMode 経路の再発

**Why not a false positive**

- 「unmount」は React 用語として effect cleanup を指すのが自然。設計は別定義（実ナビゲーションのみ、等）を書いていない。
- `sheetExpected` が StrictMode で効く唯一の条件は **cleanup が storage を消さない**こと。L13 は両方を終端に並列掲載しており、優先順位も「StrictMode 耐性 unmount の判定方法」も無い。
- sticky 修正（二次 I2）と StrictMode 修正（C-R1）を **別々に足した結果の合成バグ**。R2 Revision Summary は両方 Fixed と書くが、同時充足の手順が無い。

**Not acceptable as “implementer will know”**

二次 I2 自身が提示した逃げ（TTL / 実ナビゲーションのみ clear / StrictMode では cleanup で消さない）を R2 は採用せず、素の「unmount で全クリア」だけにした。実装者が verbatim に従うと Testing の一方が必ず落ちる。

**Required design fix（いずれかを L13 / §1 にロック。推奨 A）**

**Fix A — StrictMode 耐性 deferred clear（推奨）**

```text
on real leave (component cleanup):
  schedule clearShoppingIntentCycle(menuId) on microtask / rAF / setTimeout(0)
  if the same menu detail remounts before the scheduled clear runs
    (StrictMode / 同一 route の再 mount):
      cancel the scheduled clear
      // sheetExpected / intent / didAutoOpen は残る → shouldRestoreSheet 可

on confirmed leave (scheduled clear fires with no remount):
  clearShoppingIntentCycle(menuId)
  // → for なし再入場では auto-open しない（sticky 禁止）
```

**Fix B — unmount では消さず、sticky を別条件で殺す**

```text
// unmount では clear しない
shoppingIntentActive の auto-open 条件に追加:
  this mount observed URL for=shopping
  OR (intent===1 AND mount-local didArriveWithShoppingContext)
// 通常タイトル `/menus/:id`（for なし）では auto-open しない
// sessionStorage intent は案内バナー用に残してもよいが auto-open には使わない
```

**Fix C — storage を「同一 navigation のバックアップ」に限定**（二次 I2 option 3 系）

URL strip 直後の同一 tick だけ sessionStorage を読み、以降は React state。StrictMode は state restore パターンに寄せる。その場合 `sheetExpected` の役割を再定義すること。

**Testing 必須（C-F1 クローズ条件）**

1. StrictMode（または effect 二重 invoke）で auto-open 後もシートが残る / `sheetExpected` 経由で復帰する  
2. `for=shopping` 入場 → シート前または表示中に **実ナビゲーション**で離脱 → 同じ menu を `for` なしで開く → **auto-open しない**  
3. キャンセル後の 2 回目 `?for=shopping` は引き続き auto-open する（R2 既存・退行禁止）

---

## 4. Closed / non-blocking notes（Ready を阻まない）

| ID | Note |
|----|------|
| M-F1 | §7 エッジ表がまだ「**consumed** で二重 auto-open 抑制」と書く。§1 正本は `didAutoOpen` / `shoppingSheet===null`。実装は §1 に従えば壊れないが、R2 改訂で §7 と Risks「didAutoOpen 復帰」（正: **sheetExpected** 復帰）を直すこと。 |
| M-F2 | L9 の括弧書き「consumed / didAutoOpen をクリア」に廃止キー名が残る。同上。 |
| M-F3 | File touch に `create-list-sheet.tsx` が無い。L14 / Testing が正本なので取りこぼしリスクは低い。 |
| M-F4 | mustClose が revalidation checking でシートを閉じるのは R2 が安全側として明示採用。案1の「確認後自動」は初回 canOpen 到達時のみ。再指摘しない。 |

---

## 5. What R2 closed cleanly（確認）

| 残差 | 証拠 |
|------|------|
| 2 回目カード auto-open | §1 `for=shopping` で didAutoOpen/sheetExpected remove + Testing |
| auto-open 非消費 | L13「実行だけでは消さない」+ 終端リストから auto-open 削除 |
| mustClose 後の自動再開禁止 | sheetExpected remove + didAutoOpen 残存 + Testing |
| idea flash | `showIdeaShoppingRejected` mount ローカル |
| h2 focus | L14 `tabIndex={-1}`（現行コード未実装は差分として正しい） |
| 本線 MenuResult / パリティ / forceNewMode / pendingUndo | R1 Fixed のまま退行なし |

---

## 6. Required edit before implementation planning

1. **C-F1（必須）:** L13 / §1 終端の「unmount → 全クリア」と `shouldRestoreSheet` の **同時充足手順**を Fix A/B/C のいずれかでロックする。§8 に StrictMode 復帰 **と** 実離脱後 sticky 禁止の両方を、矛盾しない受け入れ条件として残す。  
2. （推奨・非ブロック）§7 / L9 / Risks の `consumed`・「didAutoOpen 復帰」表記を didAutoOpen / sheetExpected の現行モデルに合わせて掃除。

C-F1 だけ解けば **Ready for implementation**。

---

## Summary counts（open residual only）

| Severity | Count |
|----------|------:|
| Critical | 1 |
| Important | 0 |
| Minor（非ブロック） | 4 |

**Design status: Needs revision** — R1 の再入場・mustClose 方針・idea flash・tabIndex は閉じた。残ブロッカーは **StrictMode 復帰用 `sheetExpected` と sticky 禁止用 unmount クリアの自己矛盾（C-F1）** のみ。
