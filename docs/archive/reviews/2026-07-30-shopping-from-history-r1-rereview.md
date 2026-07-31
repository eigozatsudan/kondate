# R1 re-review: 買い物リスト 履歴導線 + 削除行クリーンアップ

| 項目 | 値 |
|------|-----|
| 対象 | `docs/archive/superpowers/specs/2026-07-30-shopping-from-history-and-cleanup-design.md`（**R1 改訂後**） |
| 日付 | 2026-07-30 |
| 種別 | 再レビュー（Critical / Important 残差のみ。擬陽性は再開しない） |
| 前提レビュー | `2026-07-30-shopping-from-history-primary-adversarial.md` / `2026-07-30-shopping-from-history-secondary-review.md` |
| 照合コード | `router.tsx`（`/menus/:menuId`→`MenuResultPage`、`/history/:menuId`→`HistoryDetailPage`）、`history-card.tsx`、`menu-result-page.tsx`（`forceNewMode` 未配線・`itemCount: items.length`）、`history-detail-page.tsx`（`forceNewMode` あり）、`shopping-list-page.tsx`（`hideRemovedItems` / 履歴リンク `/history`）、`create-list-sheet.tsx`（`h2#create-list-title`・`tabIndex` なし）、`auth-cleanup.ts`（`kondate:shopping:` 接頭辞）、`main.tsx`（`<StrictMode>`） |
| 判定 | **Needs revision** |

---

## 1. Verdict: **Needs revision**

R1 は一次・二次の Critical / Important の大半を本文・L 番号・File touch・Testing に正しく吸収している。ルート本線（MenuResult）、canOpen/mustClose 分離、pendingUndo 成功後のみ、idea 親 props、household0 行き止まり、D-C1 リンク、forceNewMode、バナー行列、resume 優先、helper 必須は実装可能な粒度まで落ちている。

しかし §1 の **intent 消費アルゴリズムが自己矛盾**しており、案1（カード → 確認後 CreateListSheet 自動 1 回）の **再入場**と、R1 が直したはずの **StrictMode 耐性**を再び壊し得る。ここを直さない限り実装 Ready とは言えない。

---

## 2. Adjudication table（prior C/I）

### Primary adversarial

| ID | Title | R1 disposition |
|----|-------|----------------|
| C-1 | CTA `/menus` vs auto-open 実装が history-detail のみ | **Fixed** — L2/L10、§4 MenuResult 本線、HistoryDetail パリティ、File touch / Testing path `/menus/`、Non-Goal 改訂 |
| C-2 | `for` 即 strip + state/ref で StrictMode intent 消滅 | **Partial** — sessionStorage 一回券（L9）は正しい方向。ただし **auto-open 実行直後に intent 消費 + consumed 設定**が再入場と remount を壊す（本レビュー New C-R1） |
| C-3 | fail-closed が `canCreateShoppingList` 全体（isPending/isFetching） | **Fixed** — L8、`canOpenCreateSheet` vs `mustCloseCreateSheet`、Testing fail-closed 行 |
| I-1 | `pendingUndoIds` 再フェッチ行が確認行を殺す | **Fixed** — 成功後のみ `add`、送信開始は触らない、背景 refetch でクリアしない、表示式 `isRemoved ∩ pending` |
| I-2 | 買い物文脈中タイトルが `for` を落とす | **Fixed** — §3.3 `shoppingIntent` 時タイトルも `menusPathForShopping` |
| I-3 | idea のみ / household CTA 0 行き止まり | **Fixed** — §3.2 固定 UI（planner / フィルタ解除 / 買い物に戻る） |
| I-4 | idea/household と intent 置き場未ロック | **Fixed** — §4.1 親で解決、Idea は props のみ・hooks 禁止 |
| I-5 | D-C1「履歴を開く」が `for` なし | **Fixed** — §2.3 `historyPathForShopping()` |
| I-6 | MenuResult に `forceNewMode` 未配線 | **Fixed** — L11、§4.3、File touch、Testing |
| I-7 | きれいにする後 undo 不能の説明不足 | **Fixed** — L12 + §2.4 説明 copy、supersede に UI 到達不能を明記 |

### Secondary independent

| ID | Title | R1 disposition |
|----|-------|----------------|
| C1 | 送信中・fetch 中にシート close | **Fixed** — 一次 C-3 と同型（L8） |
| C2 | 楽観確認行 vs `ShoppingItemRow` / 再フェッチ矛盾 | **Fixed** — 一次 I-1 と同型（成功後のみ pending） |
| I1 | idea + for の処理位置 | **Fixed** — 一次 I-4 |
| I2 | reconcile close が「推奨」で任意 | **Fixed** — `mustCloseReconcileSheet` 必須、D-M7 差分一文 |
| I3 | household CTA 0 行き止まり | **Fixed** — 一次 I-3 |
| I4 | タイトルが for なし | **Fixed** — 一次 I-2 |
| I5 | safety「履歴を開く」 | **Fixed** — 一次 I-5 |
| I6 | empty/loading/error バナー行列 | **Fixed** — §3.1 必須行列 + `shoppingIntent` prop |
| I7 | itemCount 経路分裂・0 件 | **Fixed** — MenuResult+Detail とも non-removed、0 件 append 明示 |
| I8 | auto-open 時 focus/scroll | **Partial** — scrollIntoView + h2 focus は lock。ただし現行 `CreateListSheet` の h2 に `tabIndex={-1}` がなく、設計も未指定（本レビュー New I-R1） |
| I9 | resume と auto-open 競合 | **Fixed** — pending create envelope 中 auto-open 禁止 + Testing |

---

## 3. New findings（Critical / Important only）

### [C-R1] intent 消費が「再入場の auto-open」と StrictMode 再表示を殺す — **Critical**

**Confidence:** 96

**Where:** §1 Intent 解決アルゴリズム / 消費リスト、L9、§4.3 auto-open 行

```text
if URL for=shopping:
  sessionStorage.setItem(intentKey(menuId), "1")
  replace URL to drop `for`
shoppingIntentActive =
  intentKey === "1" && consumedKey !== "1"

消費（intentKey 削除 + consumed 設定）:
  - auto-open を実行した直後
  - …キャンセル / 成功 navigate / idea メッセージ…
```

**Code reality**

- アプリは `main.tsx` で全体 `<StrictMode>`。
- 本線 CTA は R1 どおり `/menus/:id?for=shopping` → `MenuResultPage`（`router.tsx` L77–78、カードタイトルは既に `/menus/:id`）。
- `auth-cleanup` は `kondate:shopping:` 接頭辞を消すため、R1 の key 名自体は掃除契約と整合。

**Why it's real（再入場）**

1. カード CTA → auto-open → **consumed 設定 + intent 削除**
2. ユーザーがシートをキャンセル（再度消費）または戻る
3. 履歴で再度「買い物リストを作る」→ URL `for=shopping` が **intent だけ再 set**
4. `consumedKey` は **クリアされない**
5. `shoppingIntentActive = true && false` → **二度目以降 auto-open しない**

案1の主経路（間違えてキャンセル → もう一度カード）が設計上死ぬ。idea 拒否メッセージも同じ consumed で再表示されない。

**Why it's real（StrictMode / remount）**

`canOpenCreateSheet` が初回 mount 時点で既に true のとき（TanStack Query の warm cache 等）:

1. Mount1: auto-open → sheet state + **intent 消費**
2. StrictMode unmount: **sheet state 破棄**
3. Mount2: URL は strip 済み、intent なし / consumed あり → auto-open なし → **シートが一瞬も残らない**

これは一次 C-2 が狙った「StrictMode で intent が消えて auto-open しない」の **別経路での再発**。async で canOpen が遅れるケースでは偶然通るが、契約として fail-closed ではない。

**Not a false positive:** 消費リストに「auto-open 実行直後」が明示され、URL 再入場時の consumed クリアがアルゴリズムに無い。`shoppingIntentActive` が consumed を AND している以上、字義実装で再入場は必ず失敗する。

**Required design fix（いずれか一つを L でロック）**

推奨:

```text
if URL for=shopping:
  set intentKey = "1"
  remove consumedKey          // 再入場で一回券を再発行
  strip `for`

// auto-open では消費しない
auto-open when active && canOpen && sheet===null && !pendingCreateEnvelope:
  setShoppingSheet("create")
  scroll/focus
  // intent は残す — sheet!==null が同一マウントの二重 open を防ぐ
  // StrictMode remount 後も intent が残り、もう一度だけ open できる

消費（intent 削除。consumed は使わないか、使うなら URL 再入場で必ず clear）:
  - キャンセル
  - 作成成功 navigate 直前
  - idea 拒否メッセージ表示直後
  - （menuId キー分離のまま）
```

- 二重 open 抑制は **`shoppingSheet===null`**（＋必要なら mount-local ref）で足りる。auto-open 成功を sessionStorage 消費にしてはならない。
- Testing 必須追加:
  - **同一 menu で `for=shopping` を 2 回入場**（キャンセル後）→ 毎回 sheet 1 回
  - **StrictMode ラップで auto-open 後もシートが見える**（auth-callback と同型）

---

### [I-R1] h2 focus に `tabIndex={-1}` が未ロック — **Important**

**Confidence:** 88

**Where:** §4.3「見出し（h2）へ focus」、二次 I8 の R1 対応

**Code:** `create-list-sheet.tsx` L34–35:

```tsx
<section className="card stack" aria-labelledby="create-list-title">
  <h2 id="create-list-title">買い物リストを作る</h2>
```

`tabIndex` なし。リポジトリ内の同型（`pantry-form.tsx`、`audience-step.tsx`、`welcome-page.tsx`）は見出し focus 時に **`tabIndex={-1}`** を付けている。

**Why:** 非フォーカス可能要素への `.focus()` はブラウザによって無視される。scrollIntoView だけでは「作成シートまで途切れない」がキーボード / 読み上げで弱い。二次 I8 の意図が半減する。

**Required fix:** auto-open 時 focus 対象を次のいずれかで固定:

- `CreateListSheet` の h2 に `tabIndex={-1}`（呼び出し側 contract 最小変更）、または
- 既存の「作成する」primary ボタンへ focus

Testing: auto-open 後 `document.activeElement` がシート内。

---

## 4. Minor（非ブロック・簡潔）

| ID | Note |
|----|------|
| M-R1 | AppShell 上 `/menus/` は planner 配色のまま（一次 M-3）。Option A 採用の帰結。許容でよい。 |
| M-R2 | sessionStorage 例外（拒否環境）の try/catch は login と同型で実装時に寄せれば足りる。設計一文あるとよいが Ready は阻まない。 |
| M-R3 | 通常履歴でも household カード先頭が買い物 primary（二次 M1）。L1 ロック済み。 |

これらだけでは **Ready を妨げない**。

---

## 5. What R1 closed cleanly（確認のみ）

| 領域 | コードとの一致 |
|------|----------------|
| 本線ルート | カードは既に `/menus/:id`。R1 が MenuResult を本線にしたのは正しい（C-1 Option A） |
| forceNewMode | history-detail のみ配線（L913）。MenuResult 未配線は L11 で必須化済み |
| 削除行 | `hideRemovedItems` useState のみ（shopping-list-page L50/197–200）。R1 の pending 機械は痛みに対して十分 |
| D-C1 リンク | empty / safety とも `href="/history"`（L91–93, L230–231）。R1 が helper に寄せる |
| auth-cleanup | `kondate:shopping:` 接頭辞。R1 key は掃除対象に入る |
| canOpen/mustClose | 現行 `canCreateShoppingList` に isPending/isFetching が含まれる事実と、close 分離の必要性が一致 |
| soft-delete / API | 非変更のまま。表示 SM のみ |

---

## 6. Required edits before implementation planning

1. **C-R1（必須）:** §1 消費リストから **「auto-open 実行直後」を削除**。URL `for=shopping` 検知時に **consumed を clear（再発行）**するか、consumed キー自体を廃止。キャンセル / 成功 / idea のみ消費。StrictMode・再入場の Testing を §8 に追加。
2. **I-R1（必須に近い）:** focus 対象に `tabIndex={-1}` または primary ボタン focus を一文 lock。
3. Revision Summary に本レビュー ID（C-R1 / I-R1）と disposition を追記。

C-R1 だけ解けば **Ready for implementation** に上げられる。I-R1 は実装中の取りこぼしになりやすいので設計に残すことを強く推奨する。

---

## Summary counts（residual only）

| Severity | Count |
|----------|------:|
| Critical | 1 |
| Important | 1 |
| Minor | 3 |

**Design status: Needs revision** — prior C/I の本文ロックはほぼ完了。残るブロッカーは intent 一回券の **消費タイミングと再入場再発行**（C-R1）のみが Critical。
