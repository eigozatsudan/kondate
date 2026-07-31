# 敵対的レビュー: 実装計画 `2026-07-30-shopping-from-history-and-cleanup.md`

| 項目 | 値 |
|------|-----|
| 対象 | `docs/archive/superpowers/plans/2026-07-30-shopping-from-history-and-cleanup.md`（commit `5c9d5b2` 時点） |
| 照合 | 設計 `docs/archive/superpowers/specs/2026-07-30-shopping-from-history-and-cleanup-design.md`（R2+L15）、`menu-result-page.tsx` / `history-detail-page.tsx` / `shopping-list-page.tsx` / `history-page.tsx` / `shopping-api.ts` |
| 日付 | 2026-07-30 |
| 判定 | **Needs revision**（初版）→ 計画 r1 で反映済み（`2026-07-30-shopping-from-history-and-cleanup.md` Plan revision summary） |

---

## Verdict

計画の分解（helper → 買い物表示 → 履歴 CTA → intent hook → MenuResult 本線 → Detail パリティ）と設計 L 番号の対応は概ね正しい。Task 1 の helper コードは実装可能で、L15 schedule/cancel の unit も足りている。

しかし **writing-plans 自身の「No Placeholders」に複数 Task が違反**しており、特に Task 6 の hook 設計は **現行ページの early-return + effect 依存配列と衝突**して、実装者がそのまま写経すると intent が消える／Rules of Hooks を踏みうる。Task 7–8 は「設計 §4 を見ろ」に近く、本線の auto-open が計画単体では再現不能。

**実装開始前に計画を改訂すること。**

---

## Findings table

| ID | Severity | Task / 箇所 | Title |
|----|----------|-------------|-------|
| C1 | **Critical** | Task 6 | `searchParams` 依存 effect の cleanup が毎回 `scheduleIntentClear` → strip 直後に intent 消滅し得る |
| C2 | **Critical** | Task 6–8 / MenuResult・HistoryDetail 構造 | hook 配置と early return が未ロック。写経で Rules of Hooks 違反 or idea で strip されない |
| C3 | **Critical** | Task 3 / 5 / 6 / 7 / 8 | 失敗テストが `// ...`・コメントのみで **計画の No Placeholders 違反**。RED が実行不能 |
| C4 | **Critical** | Task 7–8 | auto-open / mustClose / restore / 2 回目 `for=shopping` の実装コードがチェックリスト止まりで実装者が発明する |
| I1 | Important | Task 3 | `mutate` は失敗後も `refetch`。成功判定の置き場を `try` 内に固定しないと pendingUndo が汚染される |
| I2 | Important | Task 3 テスト | 削除後の mock list 差し替えタイミングが曖昧。既存 `mutate` 内 refetch と競合しフレーク |
| I3 | Important | 設計 §8 vs Task 7/9 | StrictMode 復帰・2 回目カード・isPending 中シート維持・mustClose 後非再開が必須テストから欠落 |
| I4 | Important | Task 5 | `MemoryRouter` 直書きは本リポジトリ慣例（`createMemoryRouter` + `RouterProvider`）と不一致。既存 `history-page.test.tsx` を無視 |
| I5 | Important | Task 7 idea | `clearCycle` と `showIdeaShoppingRejected` の順序・親 hook 生存時の再評価が未固定で flash / 二重 clear し得る |
| I6 | Important | Locked interfaces 表 | `beginCycleFromUrl` と実装名 `beginShoppingIntentCycle` が不一致 |
| I7 | Important | Task 8 | 「MenuResult と同じ」は skill 禁止の類似参照。パリティ手順が再発明を強いる |
| I8 | Important | Task 3 | 全件 removed 短文 UI のテストが無い（設計 §2.4 必須） |
| M1 | Minor | Task 2 | vitest `-t "programmatically focusable"` は describe 外だと他ファイルに当たる可能性。ファイル固定で十分 |
| M2 | Minor | Task 1 | `setTimeout(0)` と fake timers は環境差あり。`vi.advanceTimersByTime(0)` 明示の方が安全 |
| M3 | Minor | Task 7 | `hasPendingCreateCommand` の `as` cast。Zod envelope 既存を再利用した方が境界方針と一致 |

---

## Detailed findings

### [C1] Task 6: effect cleanup が searchParams 変更のたびに scheduleIntentClear — **Critical**

**Where:** Task 6 実装案

```ts
useEffect(() => {
  cancelPendingIntentClear(menuId);
  if (hasShoppingIntent(searchParams)) {
    beginShoppingIntentCycle(menuId);
    setSearchParams(/* strip for */, { replace: true });
  }
  return () => {
    scheduleIntentClear(menuId);
  };
}, [menuId, searchParams, setSearchParams, refreshActive]);
```

**Why it's real**

1. 初回 mount: `for=shopping` → `beginShoppingIntentCycle` → `setSearchParams` で `for` 削除  
2. `searchParams` 更新で **effect が再実行**  
3. **前回 cleanup** が `scheduleIntentClear(menuId)`（`setTimeout(0)`）  
4. 新 effect 先頭の `cancelPendingIntentClear` が間に合えば生存  

これは「同一コミット内で cleanup→setup が必ず同期的に連続する」前提に依存する。React のバッチ・Concurrent・テストの `act` 区切り・`setTimeout(0)` と microtask の順序で、**begin した直後に timeout が発火してサイクルが消える**レースが残る。

さらに `for` 以外の query が後から付く／親が re-render で `searchParams` 参照が変わると、**ページに居たまま** cleanup→schedule が走り、cancel 漏れで sticky ではなく **生存中 wipe** になる。

設計 L15 の schedule は **「ページ unmount」専用**であり、「effect 再実行の cleanup」ではない。

**Not FP:** 依存に `searchParams` を入れ、cleanup で無条件 schedule している計画コードが明示されている。

**Required plan fix**

effect を分割してロックする:

```ts
// A: URL 取り込みのみ（cleanup で schedule しない）
useEffect(() => {
  if (menuId.length === 0) return;
  if (!hasShoppingIntent(searchParams)) return;
  beginShoppingIntentCycle(menuId);
  const next = new URLSearchParams(searchParams);
  next.delete(SHOPPING_INTENT_PARAM);
  setSearchParams(next, { replace: true });
  refreshActive();
}, [menuId, searchParams, setSearchParams, refreshActive]);

// B: mount/unmount のみ（deps = [menuId]）
useEffect(() => {
  if (menuId.length === 0) return;
  cancelPendingIntentClear(menuId);
  return () => {
    scheduleIntentClear(menuId);
  };
}, [menuId]);
```

Task 6 テストに「strip 後も intent が残る」「searchParams 再レンダーで wipe されない」を必須化。

---

### [C2] hook 配置 vs early return / idea 分岐が未ロック — **Critical**

**Code today** (`menu-result-page.tsx` L97–155, `history-detail-page.tsx` L94–155):

- 親は `menuId` parse 後、**pending / error で early return**
- その後 `idea` vs `household` で **別コンポーネント**に分岐
- household 専用に shopping hooks。idea は shopping hooks **禁止**（guided planner / コメント brief step 11）

**Plan says**

- Task 7: 「親 `MenuResultPage` で `useShoppingCreateIntent(menuId)`。loading 中でも mount 可」
- idea: shopping hooks を idea 枝に置かない
- 一方で intent strip と idea 拒否は intent が必要

**Failure modes**

| 実装者がやること | 結果 |
|------------------|------|
| hook を household body にだけ置く | idea + `for=shopping` で URL strip も拒否メッセージも動かない |
| hook を early return **の後**に置く | Rules of Hooks 違反（pending→data で hook 数が変わる） |
| hook を親の先頭に置き idea に props | 正しいが **計画に疑似コードが無い** |

**Required plan fix**

Task 6/7 に固定手順を本文で書く:

1. `useShoppingCreateIntent(menuId ?? "")` は **親の全 early return より前**（`menuId` が null なら no-op: begin しない / schedule しない）  
2. `shoppingIntentActive` を `IdeaResultBody` / `HouseholdResultBody` に props で渡す  
3. idea body は props のみ。shopping list query / create mutation / resume **を import も mount もしない**  
4. HistoryDetail も同型を Task 8 に全文コピー（「同じ」禁止）

---

### [C3] 複数 Task がプレースホルダテスト — **Critical**（計画品質）

writing-plans skill: *「Write tests for the above (without actual test code)」「// ...」は plan failure*.

| Task | 問題 |
|------|------|
| 3 | empty テストに `// 既存 render パターン` / `// ...`。safety は「既存セットアップを流用」のみ |
| 5 | `MemoryRouter` 断片 + HistoryPage 本体テストがコメント 1 行 |
| 6 | strip / unmount テストがコメント骨格のみ |
| 7 | auto-open / idea / forceNew / pending がすべてコメント。command fixture が `/* valid create command */` |
| 8 | auto-open・itemCount がコメントのみ。「MenuResult と同じ配線」 |

これでは subagent が **RED を再現できない**。Task 1 だけが skill 準拠。

**Required plan fix**

Task 3/5/6/7/8 の各必須テストを、**現行テストファイルの import・mock・helper 名を使った完全なコード**に書き直す（`renderPage` / `makeShoppingList` / `OWNER_ID` / menu-result の existing shopping setup を開いて転記）。「流用」禁止。

---

### [C4] Task 7–8 が振る舞いチェックリストのみ — **Critical**

設計が確定した難しい部分（shouldAutoOpen / shouldRestoreSheet / mustClose と sheetExpected / 手動 open は expected を立てない / resume 優先 / focus）が **Step 3 の箇条書き**に留まっている。

実装者が「effect 1 本に全部詰める」と C1 と同型バグや、mustClose で `clearCycle` してしまって手動再開不能、restore と auto-open の条件取り違えが起きやすい。

**Required plan fix**

Task 7 に **転記可能な effect 疑似コード**を入れる（設計 §1 を計画内に閉じる）:

```ts
// household body 内（名前は実装に合わせて可）
useEffect(() => {
  if (mustCloseCreateSheet && shoppingSheet === "create") {
    setShoppingSheet(null);
    clearSheetExpected(); // サイクルは消さない
  }
  if (mustCloseReconcileSheet && shoppingSheet === "reconcile") {
    setShoppingSheet(null);
  }
}, [mustCloseCreateSheet, mustCloseReconcileSheet, shoppingSheet, ...]);

useEffect(() => {
  if (shoppingSheet !== null) return;
  if (hasPendingCreateCommand(menuId)) return;
  if (!canOpenCreateSheet) return;

  const restore = isShoppingSheetExpected(menuId);
  const firstOpen =
    shoppingIntentActive &&
    !hasShoppingDidAutoOpen(menuId);

  if (!restore && !firstOpen) return;

  setShoppingSheet("create");
  if (firstOpen) markAutoOpened();
  // restore では mark しない
  requestAnimationFrame(() => {
    const el = document.getElementById("create-list-title");
    el?.scrollIntoView({ block: "nearest" });
    el?.focus();
  });
}, [canOpenCreateSheet, shoppingIntentActive, shoppingSheet, menuId, ...]);
```

Task 8 は同じブロックを **HistoryDetail 用に再掲**（参照のみ禁止）。

---

### [I1] Task 3: mutate 成功判定の置き場 — **Important**

現行 `mutate`（`shopping-list-page.tsx` L115–157）:

- `try { await mutateShoppingItem } catch { エラー表示 }`
- `finally { inFlight 解除 }`
- **成功・失敗どちらでも** `await query.refetch()`

計画の「成功後 add」例が try の外に置かれると、失敗でも pending に入る。

**Fix:** 計画コードを次に固定:

```ts
try {
  await mutateShoppingItem(...);
  if (value.itemId !== null && (value.operation === "remove" || value.operation === "mark_at_home")) {
    setPendingUndoIds((prev) => new Set(prev).add(value.itemId!));
  }
  if (value.itemId !== null && value.operation === "undo") {
    setPendingUndoIds((prev) => {
      const next = new Set(prev);
      next.delete(value.itemId!);
      return next;
    });
  }
} catch (error) {
  // 既存エラー分岐のみ。pendingUndo は触らない
} finally {
  ...
}
await query.refetch();
```

失敗時テスト 1 本: mutate reject 後に確認行が出ない。

---

### [I2] Task 3 削除テストのフレーク — **Important**

計画:

```ts
await user.click(削除);
fetchActiveShoppingList.mockResolvedValue(removedList); // click の後
await act(refetchQueries...);
```

本番コードは click 処理内で `mutate` → 内部 `refetch` する。**mock 差し替えが click より後だと、内部 refetch が旧 list を返す**。

**Fix:**

```ts
fetchActiveShoppingList.mockResolvedValue(removedList); // click 前
mutateShoppingItem.mockResolvedValue(...);
await user.click(削除);
await screen.findByText("にんじんをリストから外しました");
// 手動 refetchQueries は不要なら削除
```

---

### [I3] 設計 §8 必須テストの欠落 — **Important**

設計 Testing 表にあるが計画 Task 7/9 に無い（またはプレースホルダのみ）:

| 設計ケース | 計画 |
|------------|------|
| 2 回目 `?for=shopping`（キャンセル後）でも auto-open | 欠落 |
| mustClose 後 auto 再開しない・手動 CTA 可 | 欠落 |
| StrictMode: schedule+cancel で sheetExpected 復帰 | helper のみ。ページ級なし |
| isPending 中シートが閉じない | 欠落 |
| unmount 後 for なし再入場で auto-open しない | hook テストに曖昧 |

**Fix:** Task 7 の Step 1 に上記を **完全テストコード**で追加。Task 9 coverage 表を更新。

---

### [I4] Task 5 のテストハーネスが既存と不一致 — **Important**

- 既存: `src/features/history/pages/history-page.test.tsx` が既にあり、`createMemoryRouter` + `RouterProvider` を使用
- 計画: `MemoryRouter`（この repo の他画面はほぼ createMemoryRouter）
- `HistoryPageContent` の props 拡張時、`accessibility.test.tsx` の `<HistoryPageContent groups={[]} />` は default で動くが、計画が既存 test の更新手順を書いていない

**Fix:** 既存 `history-page.test.tsx` を Modify 対象に明記し、render helper を既存に合わせて完全コード化。

---

### [I5] idea 拒否の state 機械が曖昧 — **Important**

計画 Task 7.2:

> `shoppingIntentActive` または初回に `showIdeaShoppingRejected` state  
> 表示時 `clearCycle()` 同期

順序の取り方:

1. active true → setShow true → clearCycle → active false（親 tick）→ show が active 依存だと **flash で消える**  
2. clearCycle を先にすると active false のまま show を立て忘れる  

**Fix:** 固定:

```ts
// IdeaResultBody
const [showRejected, setShowRejected] = useState(false);
useEffect(() => {
  if (!shoppingIntentActive && !/* 初回だけ見る ref */) return;
  // 正: active を見た瞬間に
  setShowRejected(true);
  clearCycle(); // storage だけ消す。showRejected は local
}, [shoppingIntentActive, clearCycle]);
// 表示は showRejected のみを見る
```

テスト: clear 後もメッセージが残る（設計済み、計画に完全コードで）。

---

### [I6] Locked interface 名称の不一致 — **Important**

| 表 | 本文 export |
|----|-------------|
| `beginCycleFromUrl` | `beginShoppingIntentCycle` |

実装者が表だけ見ると存在しない関数を呼ぶ。

**Fix:** 表を `beginShoppingIntentCycle` に統一。

---

### [I7] Task 8「同じ配線」— **Important**

skill の *Similar to Task N 禁止*。パリティでも HistoryDetail 固有の props 名・IdeaDetailBody 署名が違う。

**Fix:** Task 8 に HistoryDetail 用のファイルパス・コンポーネント名・effect 全文を再掲。

---

### [I8] 全件 removed の empty 短文 — **Important**

設計 §2.4: 「買うものは今ありません」+ 追加 + 別の献立。Task 3 実装 10 にはあるが **テストが無い**。

**Fix:** Task 3 にテスト 1 本追加。

---

## What the plan gets right

1. Task 1 helper の完全コードと L15 unit は設計 C-F1 対策として妥当。  
2. 本線 MenuResult / パリティ HistoryDetail のファイル分割は router 実態と一致。  
3. soft-delete 非変更・idea hooks 禁止・forceNewMode・itemCount non-removed・D-C1 リンクは設計と整合。  
4. Task 3 が WIP `hideRemovedItems` を捨てる指示は正しい（現状 worktree に WIP あり）。  
5. canOpen vs mustClose の分離方針は設計 L8 と一致（実装コード不足が問題）。  
6. Global Constraints（Docker 単コマンド、push 禁止、E2E defer）はプロジェクト方針と一致。

---

## Recommended revision order

1. **C1** Task 6 effect 分割を計画本文に固定 + テスト  
2. **C2** hook を親・early return 前・props 配布と明記（MenuResult + HistoryDetail）  
3. **C3/C4** Task 3/5/6/7/8 のテストと auto-open effect を完全コード化  
4. **I1–I3, I5, I8** 成功判定・フレーク・設計テスト・idea state・全件 removed  
5. **I4/I6/I7** ハーネス・命名・パリティ再掲  

その後、二次レビューで「プレースホルダ 0・effect が設計 §1 と 1:1」を確認してから subagent 実装へ。

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 4 |
| Important | 8 |
| Minor | 3 |

**Needs revision.** 設計は Ready でも、**この計画のまま実装に入ると Task 6–8 で高確率で再作業**になる。
