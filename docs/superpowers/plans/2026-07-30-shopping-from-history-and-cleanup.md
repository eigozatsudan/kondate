# 履歴から買い物リスト作成 + 削除行クリーンアップ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 買い物画面から履歴で献立を選び、`/menus/:id?for=shopping` 経由で CreateListSheet まで気づける導線を作り、削除済み行は既定非表示（操作成功直後だけ確認行）にする。

**Architecture:** URL `for=shopping` + `sessionStorage` サイクル（intent / didAutoOpen / sheetExpected）で StrictMode 耐性のある intent を持ち、本線は `MenuResultPage`、副経路 `HistoryDetailPage` は同一契約。削除行は DB soft-delete を変えず、表示だけ `pendingUndoIds` で制御する。

**Tech Stack:** React 19 / React Router 8 / TanStack Query 5 / TypeScript strict / Vitest / RTL

**仕様書:** `docs/superpowers/specs/2026-07-30-shopping-from-history-and-cleanup-design.md`（**Approved R2+L15** — L1–L15 再導出禁止）

## Global Constraints

- Node.js `>=24 <25`。Node/npm は `docker compose run --rm --no-deps app ...`。**コマンドを `&&` / `;` で連結しない**（1 コマンド = 1 ツール呼び出し）。
- 各 Task は RED → GREEN → 対象検証（focused test + 必要なら typecheck）→ レビュー → **日本語 Conventional Commit**。1 Task = 1 作業単位。
- UI 文言・コメント・コミットは日本語。識別子・テスト名は英語。`any` / 未検査 cast 禁止。
- 320 CSS px・44×44（`min-h-11`）・横スクロールなし。
- **新規 API / マイグレーション禁止。** soft-delete・from-menu・resume command 契約は維持。
- idea 献立で shopping hooks / create pending を mount・作成しない。
- sessionStorage キーは必ず `kondate:shopping:` 接頭辞（`auth-cleanup` 対象）。
- `git push` / PR / 本番デプロイ / `--no-verify` 禁止。
- 作業ツリーに旧 WIP（`hideRemovedItems`）が残っている場合は **Task 3 で設計どおり `pendingUndoIds` に置換**し、中途半端な state を残さない。

## Locked interfaces produced by this plan

| 名前 | 場所 | 契約 |
|------|------|------|
| path/storage helpers | `src/features/shopping/shopping-intent.ts` | 下表 export。文字列直書き禁止 |
| `useShoppingCreateIntent` | `src/features/shopping/hooks/use-shopping-create-intent.ts` | menuId 受け取り、active / beginCycleFromUrl / markAutoOpened / clearCycle / schedule-cancel clear |
| CreateListSheet h2 | `create-list-sheet.tsx` | `id="create-list-title"` + `tabIndex={-1}` |
| HistoryCard | `history-card.tsx` | `shoppingIntent?: boolean`。household のみ買い物 CTA |
| 本線 auto-open | `menu-result-page.tsx` | 設計 §4 |
| パリティ | `history-detail-page.tsx` | 設計 §5 |

### shopping-intent 固定 export

```ts
export const SHOPPING_INTENT_PARAM = "for" as const;
export const SHOPPING_INTENT_VALUE = "shopping" as const;

export function hasShoppingIntent(params: URLSearchParams): boolean;
export function historyPathForShopping(): string; // "/history?for=shopping"
export function menusPathForShopping(menuId: string): string; // `/menus/${menuId}?for=shopping`
export function shoppingIntentStorageKey(menuId: string): string;
export function shoppingDidAutoOpenKey(menuId: string): string;
export function shoppingSheetExpectedKey(menuId: string): string;
export function clearShoppingIntentCycle(menuId: string): void;
export function beginShoppingIntentCycle(menuId: string): void; // intent=1, did/expected remove
export function markShoppingSheetAutoOpened(menuId: string): void; // did=1, expected=1
export function clearShoppingSheetExpected(menuId: string): void; // mustClose 用
export function isShoppingIntentActive(menuId: string): boolean;
export function hasShoppingDidAutoOpen(menuId: string): boolean;
export function isShoppingSheetExpected(menuId: string): boolean;
export function scheduleIntentClear(menuId: string): void;
export function cancelPendingIntentClear(menuId: string): void;
```

## File Structure

| ファイル | 責務 |
|----------|------|
| `src/features/shopping/shopping-intent.ts` | URL / sessionStorage / L15 timer |
| `src/features/shopping/shopping-intent.test.ts` | helper unit |
| `src/features/shopping/hooks/use-shopping-create-intent.ts` | URL strip + mount/unmount cancel/schedule + active 読み |
| `src/features/shopping/hooks/use-shopping-create-intent.test.tsx` | strip / cycle / unmount schedule |
| `src/features/shopping/components/create-list-sheet.tsx` | h2 tabIndex |
| `src/features/shopping/pages/shopping-list-page.tsx` | リンク・pendingUndo・きれいにする |
| `src/features/shopping/pages/shopping-list-page.test.tsx` | 同上 |
| `src/features/history/components/history-card.tsx` | CTA + タイトル intent |
| `src/features/history/components/history-card.test.tsx` | CTA / idea / タイトル |
| `src/features/history/pages/history-page.tsx` | バナー・行き止まり |
| `src/features/history/pages/history-page.test.tsx` | バナー等（無ければ新規） |
| `src/features/generation/pages/menu-result-page.tsx` | 本線 auto-open |
| `src/features/generation/pages/menu-result-page.test.tsx` | 本線テスト |
| `src/features/history/pages/history-detail-page.tsx` | パリティ |
| `src/features/history/pages/history-detail-page.test.tsx` | パリティ代表 |

**触らない:** from-menu Netlify Function、DB マイグレーション、reconcile 差分計算、idea 買い物 API 解禁、E2E（明示指示があるまで defer）。

---

### Task 1: shopping-intent helper（path + sessionStorage + L15）

**Files:**
- Create: `src/features/shopping/shopping-intent.ts`
- Create: `src/features/shopping/shopping-intent.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: Locked interfaces の helper 一式

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/features/shopping/shopping-intent.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginShoppingIntentCycle,
  cancelPendingIntentClear,
  clearShoppingIntentCycle,
  clearShoppingSheetExpected,
  hasShoppingDidAutoOpen,
  hasShoppingIntent,
  historyPathForShopping,
  isShoppingIntentActive,
  isShoppingSheetExpected,
  markShoppingSheetAutoOpened,
  menusPathForShopping,
  scheduleIntentClear,
  shoppingDidAutoOpenKey,
  shoppingIntentStorageKey,
  shoppingSheetExpectedKey,
} from "./shopping-intent";

const MENU = "40000000-0000-4000-8000-000000000001";

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

describe("shopping-intent paths", () => {
  it("builds history and menus paths with for=shopping only", () => {
    expect(historyPathForShopping()).toBe("/history?for=shopping");
    expect(menusPathForShopping(MENU)).toBe(`/menus/${MENU}?for=shopping`);
    expect(hasShoppingIntent(new URLSearchParams("for=shopping"))).toBe(true);
    expect(hasShoppingIntent(new URLSearchParams("for=other"))).toBe(false);
  });

  it("uses kondate:shopping: storage key prefix", () => {
    expect(shoppingIntentStorageKey(MENU).startsWith("kondate:shopping:")).toBe(true);
    expect(shoppingDidAutoOpenKey(MENU).startsWith("kondate:shopping:")).toBe(true);
    expect(shoppingSheetExpectedKey(MENU).startsWith("kondate:shopping:")).toBe(true);
  });
});

describe("shopping-intent cycle", () => {
  it("begin cycle sets intent and clears did/expected", () => {
    markShoppingSheetAutoOpened(MENU);
    beginShoppingIntentCycle(MENU);
    expect(isShoppingIntentActive(MENU)).toBe(true);
    expect(hasShoppingDidAutoOpen(MENU)).toBe(false);
    expect(isShoppingSheetExpected(MENU)).toBe(false);
  });

  it("mark auto-open sets did and expected", () => {
    beginShoppingIntentCycle(MENU);
    markShoppingSheetAutoOpened(MENU);
    expect(hasShoppingDidAutoOpen(MENU)).toBe(true);
    expect(isShoppingSheetExpected(MENU)).toBe(true);
  });

  it("clear expected keeps intent and did for manual reopen after mustClose", () => {
    beginShoppingIntentCycle(MENU);
    markShoppingSheetAutoOpened(MENU);
    clearShoppingSheetExpected(MENU);
    expect(isShoppingIntentActive(MENU)).toBe(true);
    expect(hasShoppingDidAutoOpen(MENU)).toBe(true);
    expect(isShoppingSheetExpected(MENU)).toBe(false);
  });

  it("clear cycle removes all three keys", () => {
    beginShoppingIntentCycle(MENU);
    markShoppingSheetAutoOpened(MENU);
    clearShoppingIntentCycle(MENU);
    expect(isShoppingIntentActive(MENU)).toBe(false);
    expect(hasShoppingDidAutoOpen(MENU)).toBe(false);
    expect(isShoppingSheetExpected(MENU)).toBe(false);
  });
});

describe("L15 schedule/cancel", () => {
  it("schedule alone clears after timeout", () => {
    beginShoppingIntentCycle(MENU);
    scheduleIntentClear(MENU);
    expect(isShoppingIntentActive(MENU)).toBe(true);
    vi.runAllTimers();
    expect(isShoppingIntentActive(MENU)).toBe(false);
  });

  it("cancel after schedule keeps keys (StrictMode remount)", () => {
    beginShoppingIntentCycle(MENU);
    markShoppingSheetAutoOpened(MENU);
    scheduleIntentClear(MENU);
    cancelPendingIntentClear(MENU);
    vi.runAllTimers();
    expect(isShoppingIntentActive(MENU)).toBe(true);
    expect(isShoppingSheetExpected(MENU)).toBe(true);
  });
});
```

- [ ] **Step 2: テスト実行（失敗確認）**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run src/features/shopping/shopping-intent.test.ts
```

Expected: FAIL（module not found）

- [ ] **Step 3: 実装**

```ts
// src/features/shopping/shopping-intent.ts
/** 買い物作成意図（URL for=shopping + sessionStorage サイクル）。PII なし。 */

export const SHOPPING_INTENT_PARAM = "for" as const;
export const SHOPPING_INTENT_VALUE = "shopping" as const;

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

export function isShoppingIntentActive(menuId: string): boolean {
  return sessionStorage.getItem(shoppingIntentStorageKey(menuId)) === "1";
}

export function hasShoppingDidAutoOpen(menuId: string): boolean {
  return sessionStorage.getItem(shoppingDidAutoOpenKey(menuId)) === "1";
}

export function isShoppingSheetExpected(menuId: string): boolean {
  return sessionStorage.getItem(shoppingSheetExpectedKey(menuId)) === "1";
}

/** 新サイクル: intent を立て、did/expected を落とす（2 回目カード用）。 */
export function beginShoppingIntentCycle(menuId: string): void {
  sessionStorage.setItem(shoppingIntentStorageKey(menuId), "1");
  sessionStorage.removeItem(shoppingDidAutoOpenKey(menuId));
  sessionStorage.removeItem(shoppingSheetExpectedKey(menuId));
}

export function markShoppingSheetAutoOpened(menuId: string): void {
  sessionStorage.setItem(shoppingDidAutoOpenKey(menuId), "1");
  sessionStorage.setItem(shoppingSheetExpectedKey(menuId), "1");
}

export function clearShoppingSheetExpected(menuId: string): void {
  sessionStorage.removeItem(shoppingSheetExpectedKey(menuId));
}

export function clearShoppingIntentCycle(menuId: string): void {
  sessionStorage.removeItem(shoppingIntentStorageKey(menuId));
  sessionStorage.removeItem(shoppingDidAutoOpenKey(menuId));
  sessionStorage.removeItem(shoppingSheetExpectedKey(menuId));
}

// L15: StrictMode unmount→remount で即クリアしない
const pendingClears = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleIntentClear(menuId: string): void {
  cancelPendingIntentClear(menuId);
  const handle = setTimeout(() => {
    pendingClears.delete(menuId);
    clearShoppingIntentCycle(menuId);
  }, 0);
  pendingClears.set(menuId, handle);
}

export function cancelPendingIntentClear(menuId: string): void {
  const handle = pendingClears.get(menuId);
  if (handle === undefined) return;
  clearTimeout(handle);
  pendingClears.delete(menuId);
}
```

- [ ] **Step 4: テスト成功**

Run: 同上 vitest  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/shopping/shopping-intent.ts src/features/shopping/shopping-intent.test.ts
git commit -m "feat: 買い物作成 intent の path/sessionStorage helper を追加"
```

---

### Task 2: CreateListSheet の h2 を focus 可能に（L14）

**Files:**
- Modify: `src/features/shopping/components/create-list-sheet.tsx`
- Modify: `src/features/shopping/pages/shopping-list-page.test.tsx` 内 `describe("CreateListSheet")`（既存）

**Interfaces:**
- Consumes: なし
- Produces: `h2#create-list-title` に `tabIndex={-1}`

- [ ] **Step 1: 失敗テスト**

`CreateListSheet` の describe に追加:

```ts
it("exposes create-list-title heading as programmatically focusable", () => {
  render(
    <CreateListSheet
      activeList={null}
      pending={false}
      safetyBlocked={false}
      onSubmit={() => undefined}
      onCancel={() => undefined}
    />,
  );
  const heading = screen.getByRole("heading", { name: "買い物リストを作る" });
  expect(heading).toHaveAttribute("id", "create-list-title");
  expect(heading).toHaveAttribute("tabIndex", "-1");
});
```

- [ ] **Step 2: RED**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run src/features/shopping/pages/shopping-list-page.test.tsx -t "programmatically focusable"
```

Expected: FAIL tabIndex

- [ ] **Step 3: GREEN**

`create-list-sheet.tsx` の h2 を:

```tsx
<h2 id="create-list-title" tabIndex={-1}>
  買い物リストを作る
</h2>
```

- [ ] **Step 4: PASS + Commit**

```bash
git add src/features/shopping/components/create-list-sheet.tsx src/features/shopping/pages/shopping-list-page.test.tsx
git commit -m "fix: 買い物リスト作成シート見出しをプログラム focus 可能にする"
```

---

### Task 3: 買い物リスト — リンクと削除行表示（pendingUndoIds）

**Files:**
- Modify: `src/features/shopping/pages/shopping-list-page.tsx`
- Modify: `src/features/shopping/pages/shopping-list-page.test.tsx`

**Interfaces:**
- Consumes: `historyPathForShopping` from Task 1
- Produces: empty/safety/「別の献立」リンク、`pendingUndoIds` 表示機械

**Discard/replace:** 既存 WIP の `hideRemovedItems` があれば **削除**し、設計 §2.4 に置換。

- [ ] **Step 1: 失敗テストを追加・更新**

```ts
// shopping-list-page.test.tsx に追加（import historyPathForShopping）

it("links empty-state history pick to for=shopping", async () => {
  fetchActiveShoppingList.mockResolvedValue(null);
  // 既存 render パターンで empty を出す
  // ...
  const link = await screen.findByRole("link", { name: "履歴から選ぶ" });
  expect(link).toHaveAttribute("href", historyPathForShopping());
});

it("links safety recovery history to for=shopping", async () => {
  // safetyGate blocked 相当の既存セットアップを流用
  const link = await screen.findByRole("link", { name: "履歴を開く" });
  expect(link).toHaveAttribute("href", historyPathForShopping());
});

it("hides server-removed rows by default and shows them only after successful remove", async () => {
  await renderPage(
    makeShoppingList([
      makeItem({ id: ITEM_ID, displayName: "にんじん" }),
      makeItem({ id: OTHER_ITEM_ID, displayName: "玉ねぎ", isRemovedByUser: true }),
    ]),
  );
  expect(screen.queryByText("玉ねぎをリストから外しました")).not.toBeInTheDocument();
  // にんじんを削除成功 → refetch で removed
  mutateShoppingItem.mockResolvedValue({
    listId: LIST_ID,
    version: 2,
    itemId: ITEM_ID,
    replayed: false,
  });
  await user.click(screen.getByRole("button", { name: "削除" }));
  fetchActiveShoppingList.mockResolvedValue(
    makeShoppingList(
      [
        makeItem({ id: ITEM_ID, displayName: "にんじん", isRemovedByUser: true }),
        makeItem({ id: OTHER_ITEM_ID, displayName: "玉ねぎ", isRemovedByUser: true }),
      ],
      { version: 2 },
    ),
  );
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: shoppingKeys.active(OWNER_ID) });
  });
  // 成功した id のみ pending に入り確認行
  expect(await screen.findByText("にんじんをリストから外しました")).toBeInTheDocument();
  expect(screen.queryByText("玉ねぎをリストから外しました")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "リストをきれいにする" }));
  expect(screen.queryByText("にんじんをリストから外しました")).not.toBeInTheDocument();
});

it("offers another menu link when list has items", async () => {
  await renderPage(makeShoppingList([makeItem()]));
  const link = screen.getByRole("link", { name: "別の献立から作る" });
  expect(link).toHaveAttribute("href", historyPathForShopping());
});
```

（既存の `hides removed rows after the user cleans up` が `hideRemovedItems` 前提なら、上記成功後機械に合わせて書き換える。）

- [ ] **Step 2: RED**

Run: focused vitest on new tests  
Expected: FAIL

- [ ] **Step 3: GREEN 実装要点**

`shopping-list-page.tsx`:

1. `import { historyPathForShopping } from "../shopping-intent";` と `import { Link } from "react-router";`（または既存の a に `href={historyPathForShopping()}`）。
2. `const [pendingUndoIds, setPendingUndoIds] = useState<ReadonlySet<string>>(() => new Set());` — **hideRemovedItems 削除**。
3. `mutate` 成功パスで、`operation` が `remove` | `mark_at_home` なら `setPendingUndoIds` に itemId を add。`undo` 成功なら delete。失敗時は触らない。
4. `displayItems = list.items.filter((i) => !i.isRemovedByUser || pendingUndoIds.has(i.id))`
5. セクションは `displayItems` で filter。
6. きれいにする: `pendingUndoIds` に server-removed 表示行があるとき。説明文 L12 固定:

```tsx
<p className="type-small">
  外した項目の表示を消します。まちがえて消したときは、その場の「元に戻す」を先に押してください
</p>
```

7. empty: `Link to={historyPathForShopping()}` 「履歴から選ぶ」
8. safety: 同様「履歴を開く」
9. リスト末尾 secondary: 「別の献立から作る」
10. 全件 removed かつ pending 空: 「買うものは今ありません」+ 追加 + 別の献立

mutate 成功検出の例（既存 `mutate` 内）:

```ts
const itemId = value.itemId;
await mutateShoppingItem(/* ... */);
// 成功後:
if (
  itemId !== null &&
  (value.operation === "remove" || value.operation === "mark_at_home")
) {
  setPendingUndoIds((prev) => new Set(prev).add(itemId));
}
if (itemId !== null && value.operation === "undo") {
  setPendingUndoIds((prev) => {
    const next = new Set(prev);
    next.delete(itemId);
    return next;
  });
}
// その後既存の refetch
```

- [ ] **Step 4: テスト PASS**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/shopping/pages/shopping-list-page.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/features/shopping/pages/shopping-list-page.tsx src/features/shopping/pages/shopping-list-page.test.tsx
git commit -m "feat: 買い物の履歴導線と削除行の既定非表示を追加"
```

---

### Task 4: HistoryCard — 買い物 CTA とタイトル intent

**Files:**
- Modify: `src/features/history/components/history-card.tsx`
- Modify: `src/features/history/components/history-card.test.tsx`

**Interfaces:**
- Consumes: `menusPathForShopping`
- Produces: `HistoryCardProps.shoppingIntent?: boolean`（default false）

- [ ] **Step 1: 失敗テスト**

```ts
import { menusPathForShopping } from "@/features/shopping/shopping-intent";

function renderCard(group: HistoryGroup, shoppingIntent = false) {
  const router = createMemoryRouter(
    [
      {
        path: "/history",
        element: <HistoryCard group={group} shoppingIntent={shoppingIntent} />,
      },
      { path: "/menus/:menuId", element: <h1>献立結果</h1> },
    ],
    { initialEntries: ["/history"] },
  );
  // ... Provider 同じ
}

it("shows shopping CTA for household only", () => {
  renderCard(householdGroup());
  const cta = screen.getByRole("link", { name: "買い物リストを作る" });
  expect(cta).toHaveAttribute("href", menusPathForShopping("menu-household"));
  expect(cta).toHaveClass("min-h-11");
});

it("hides shopping CTA for idea menus", () => {
  renderCard(ideaGroup());
  expect(screen.queryByRole("link", { name: "買い物リストを作る" })).toBeNull();
});

it("keeps plain title path without shopping intent", () => {
  renderCard(householdGroup(), false);
  expect(screen.getByRole("link", { name: "家族の献立" })).toHaveAttribute(
    "href",
    "/menus/menu-household",
  );
});

it("uses shopping path on title when shoppingIntent", () => {
  renderCard(householdGroup(), true);
  expect(screen.getByRole("link", { name: "家族の献立" })).toHaveAttribute(
    "href",
    menusPathForShopping("menu-household"),
  );
});
```

- [ ] **Step 2: RED → Step 3: GREEN**

`history-card.tsx`:

```tsx
import { menusPathForShopping } from "@/features/shopping/shopping-intent";

type HistoryCardProps = {
  group: HistoryGroup;
  /** 履歴が for=shopping 文脈のとき true。タイトルも買い物 intent を付ける */
  shoppingIntent?: boolean;
};

export function HistoryCard({ group, shoppingIntent = false }: HistoryCardProps) {
  // ...
  const menuPath = shoppingIntent
    ? menusPathForShopping(representative.id)
    : `/menus/${representative.id}`;
  // タイトル Link to={menuPath}
  // actions 先頭:
  {representative.targetMode === "household" && (
    <Link
      to={menusPathForShopping(representative.id)}
      className="primary-button min-h-11"
    >
      買い物リストを作る
    </Link>
  )}
```

- [ ] **Step 4: PASS + Commit**

```bash
git add src/features/history/components/history-card.tsx src/features/history/components/history-card.test.tsx
git commit -m "feat: 履歴カードに買い物リスト作成 CTA を追加"
```

---

### Task 5: HistoryPage — バナーと household 0 行き止まり

**Files:**
- Modify: `src/features/history/pages/history-page.tsx`
- Create or Modify: `src/features/history/pages/history-page.test.tsx`

**Interfaces:**
- Consumes: `hasShoppingIntent`, `historyPathForShopping`（戻るは `/shopping`）
- Produces: `HistoryPageContent({ groups, shoppingIntent })`

- [ ] **Step 1: 失敗テスト**

```tsx
// history-page.test.tsx
import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { HistoryPageContent } from "./history-page";
// mock useHistoryGroups if testing HistoryPage with searchParams

it("shows shopping banner when shoppingIntent", () => {
  render(
    <MemoryRouter>
      <HistoryPageContent groups={[householdGroup]} shoppingIntent />
    </MemoryRouter>,
  );
  expect(screen.getByText("買い物リスト用に献立を選んでください")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "買い物に戻る" })).toHaveAttribute("href", "/shopping");
});

it("shows dead-end when shoppingIntent and no household cards", () => {
  render(
    <MemoryRouter>
      <HistoryPageContent groups={[ideaOnlyGroup]} shoppingIntent />
    </MemoryRouter>,
  );
  expect(
    screen.getByText(/いま選べる家族向けの献立がありません/u),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "家族向けの献立を作る" })).toHaveAttribute(
    "href",
    "/planner",
  );
});

it("shows banner on empty list with shoppingIntent", () => {
  render(
    <MemoryRouter>
      <HistoryPageContent groups={[]} shoppingIntent />
    </MemoryRouter>,
  );
  expect(screen.getByText("買い物リスト用に献立を選んでください")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "買い物に戻る" })).toBeInTheDocument();
});
```

`HistoryPage` 本体は `useSearchParams` + `hasShoppingIntent` で `shoppingIntent` を Content に渡すテストも 1 本:

```tsx
// Router initialEntries: ["/history?for=shopping"] で HistoryPage を mount（hooks mock）
```

- [ ] **Step 2–3: 実装**

```tsx
// history-page.tsx 要点
import { Link, useSearchParams } from "react-router";
import { hasShoppingIntent } from "@/features/shopping/shopping-intent";

export function HistoryPage() {
  const [params] = useSearchParams();
  const shoppingIntent = hasShoppingIntent(params);
  // loading/error は既存（バナー不要）
  return <HistoryPageContent groups={data} shoppingIntent={shoppingIntent} />;
}

export function HistoryPageContent({
  groups,
  shoppingIntent = false,
}: {
  groups: readonly HistoryGroup[];
  shoppingIntent?: boolean;
}) {
  // empty / list 両方で shoppingIntent 時バナー
  const banner = shoppingIntent ? (
    <section className="card stack" role="status">
      <p className="font-bold">買い物リスト用に献立を選んでください</p>
      <p className="type-small">
        「家族に合わせた献立」の「買い物リストを作る」を押します。アイデア献立は使えません。
      </p>
      <Link className="secondary-button min-h-11" to="/shopping">
        買い物に戻る
      </Link>
    </section>
  ) : null;

  // visible 計算後
  const householdVisible = visible.filter((g) => g.representative.targetMode === "household");
  // shoppingIntent && householdVisible.length === 0 → 行き止まりカード

  // HistoryCard に shoppingIntent={shoppingIntent}
}
```

行き止まり文言（一字固定）:

- 「いま選べる家族向けの献立がありません。買い物リストに使えるのは家族に合わせた献立だけです」
- primary: 家族向けの献立を作る → `/planner`
- secondary: フィルタ中なら「すべての献立を表示」; 常に買い物に戻る

- [ ] **Step 4: PASS + Commit**

```bash
git add src/features/history/pages/history-page.tsx src/features/history/pages/history-page.test.tsx
git commit -m "feat: 履歴一覧に買い物文脈バナーと行き止まり案内を追加"
```

---

### Task 6: useShoppingCreateIntent hook

**Files:**
- Create: `src/features/shopping/hooks/use-shopping-create-intent.ts`
- Create: `src/features/shopping/hooks/use-shopping-create-intent.test.tsx`

**Interfaces:**
- Consumes: Task 1 helpers, `useSearchParams` / `useNavigate` or `setSearchParams`
- Produces:

```ts
export function useShoppingCreateIntent(menuId: string): {
  shoppingIntentActive: boolean;
  /** auto-open 成功時に呼ぶ */
  markAutoOpened: () => void;
  /** mustClose 時 */
  clearSheetExpected: () => void;
  /** キャンセル・成功・idea 拒否 */
  clearCycle: () => void;
  refreshActive: () => void; // storage 再読で再レンダー用
};
```

- [ ] **Step 1: 失敗テスト（Router + sessionStorage）**

```tsx
import { renderHook, act } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
// wrapper with initial entry `/menus/${MENU}?for=shopping`

it("begins cycle and strips for=shopping from URL", async () => {
  // mount hook with menuId
  // expect isShoppingIntentActive(MENU)
  // expect location search without for
});

it("cancels pending clear on mount and schedules on unmount", () => {
  vi.useFakeTimers();
  beginShoppingIntentCycle(MENU);
  const { unmount } = renderHook(/* ... */);
  unmount();
  // after unmount without remount:
  act(() => {
    vi.runAllTimers();
  });
  expect(isShoppingIntentActive(MENU)).toBe(false);
});
```

- [ ] **Step 2–3: 実装**

```ts
// use-shopping-create-intent.ts
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import {
  beginShoppingIntentCycle,
  cancelPendingIntentClear,
  clearShoppingIntentCycle,
  clearShoppingSheetExpected,
  hasShoppingIntent,
  isShoppingIntentActive,
  markShoppingSheetAutoOpened,
  scheduleIntentClear,
  SHOPPING_INTENT_PARAM,
} from "../shopping-intent";

export function useShoppingCreateIntent(menuId: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tick, setTick] = useState(0);
  const refreshActive = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (menuId.length === 0) return;
    cancelPendingIntentClear(menuId);
    if (hasShoppingIntent(searchParams)) {
      beginShoppingIntentCycle(menuId);
      const next = new URLSearchParams(searchParams);
      next.delete(SHOPPING_INTENT_PARAM);
      setSearchParams(next, { replace: true });
      refreshActive();
    }
    return () => {
      scheduleIntentClear(menuId);
    };
  }, [menuId, searchParams, setSearchParams, refreshActive]);

  // tick を依存に含めて再評価
  void tick;
  const shoppingIntentActive = menuId.length > 0 && isShoppingIntentActive(menuId);

  return {
    shoppingIntentActive,
    markAutoOpened: () => {
      markShoppingSheetAutoOpened(menuId);
      refreshActive();
    },
    clearSheetExpected: () => {
      clearShoppingSheetExpected(menuId);
      refreshActive();
    },
    clearCycle: () => {
      clearShoppingIntentCycle(menuId);
      refreshActive();
    },
    refreshActive,
  };
}
```

**注意:** `searchParams` を effect 依存にすると strip 後に再実行される。`hasShoppingIntent` が false なら begin しないのでループしない。unmount cleanup は常に schedule。

- [ ] **Step 4: PASS + Commit**

```bash
git add src/features/shopping/hooks/use-shopping-create-intent.ts src/features/shopping/hooks/use-shopping-create-intent.test.tsx
git commit -m "feat: 買い物作成 intent の React hook を追加"
```

---

### Task 7: MenuResultPage 本線 — auto-open / forceNew / idea 拒否

**Files:**
- Modify: `src/features/generation/pages/menu-result-page.tsx`
- Modify: `src/features/generation/pages/menu-result-page.test.tsx`

**Interfaces:**
- Consumes: `useShoppingCreateIntent`, `historyPathForShopping`, pending command key 検査、CreateListSheet L14
- Produces: 設計 §4 の振る舞い

- [ ] **Step 1: 失敗テスト（代表）**

既存 `menu-result-page.test.tsx` の shopping create セットアップを流用し追加:

```ts
it("auto-opens create sheet when for=shopping and can create", async () => {
  // initial route `/menus/${MENU_ID}?for=shopping`
  // household menu, actions enabled, shopping list success
  expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
  // URL から for が消えている（router state）
});

it("shows idea rejection without shopping network when for=shopping", async () => {
  // idea menu + for=shopping
  expect(await screen.findByText(/アイデア献立は買い物リストに使えません/u)).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "買い物リストを作る" })).toBeNull();
  expect(shoppingApi.createShoppingList).not.toHaveBeenCalled();
});

it("passes forceNewMode when shopping gate is blocked", async () => {
  // gate blocked + open sheet manually or auto
  // assert radio append disabled / force new copy（既存 CreateListSheet 文言）
});

it("does not auto-open while pending create envelope exists", async () => {
  sessionStorage.setItem(
    pendingShoppingCommandStorageKey("create", MENU_ID),
    JSON.stringify({ createdAtMs: Date.now(), command: /* valid create command */ }),
  );
  // mount with for=shopping
  expect(screen.queryByRole("heading", { name: "買い物リストを作る" })).toBeNull();
});
```

- [ ] **Step 2: RED**

- [ ] **Step 3: GREEN 実装チェックリスト（menu-result-page）**

1. 親 `MenuResultPage` で `useShoppingCreateIntent(menuId)`（menuId 確定後）。loading 中でも mount 可。
2. idea 分岐:
   - `shoppingIntentActive` または初回に `showIdeaShoppingRejected` state
   - 表示時 `clearCycle()` 同期
   - メッセージ + Link 履歴 `historyPathForShopping()` + 買い物 `/shopping`
   - **shopping hooks を idea 枝に置かない**（現状維持）
3. household body:
   - 改名: `canOpenCreateSheet = actionsEnabled && !shoppingListBusy && !createList.isPending`（旧 canCreateShoppingList）
   - `mustCloseCreateSheet = !actionsEnabled`
   - `mustCloseReconcileSheet = !actionsEnabled || shoppingGate.blocked`
   - effect: mustClose 時 sheet null + `clearSheetExpected()`（create のとき）
   - effect: shouldAutoOpen / shouldRestoreSheet（設計 §1）
     - pending envelope: `sessionStorage.getItem(pendingShoppingCommandStorageKey("create", menuId))` が有効なら skip（`read` は既存 `persistedShoppingCommand` に頼らず、キー存在 + JSON parse 簡易 or export した hasPending helper）
   - auto-open 後: `markAutoOpened()` → rAF で `#create-list-title` の `scrollIntoView` + `focus`
   - CreateListSheet:
     - `forceNewMode={shoppingGate.blocked}`
     - `itemCount: activeList.items.filter(i => !i.isRemovedByUser).length`
     - `key={\`${activeList?.id ?? "none"}-${activeList?.version ?? 0}\`}`
     - `safetyBlocked={!canOpenCreateSheet}`
     - `onCancel`: sheet null + `clearCycle()`
   - 成功 navigate 前: `clearCycle()`
   - 手動オープン: sheet create のみ（sheetExpected 立てない）
   - 上部案内: shoppingIntentActive 中の status 文（設計 §4.3）

**hasPendingCreate 簡易:**

```ts
function hasPendingCreateCommand(menuId: string): boolean {
  try {
    const raw = sessionStorage.getItem(pendingShoppingCommandStorageKey("create", menuId));
    if (raw === null) return false;
    const parsed = JSON.parse(raw) as { createdAtMs?: number };
    if (typeof parsed.createdAtMs !== "number") return false;
    const age = Date.now() - parsed.createdAtMs;
    return age >= 0 && age <= pendingShoppingCommandTtlMs;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: PASS**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/generation/pages/menu-result-page.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/features/generation/pages/menu-result-page.tsx src/features/generation/pages/menu-result-page.test.tsx
git commit -m "feat: 献立結果で買い物 intent の作成シート自動表示を追加"
```

---

### Task 8: HistoryDetailPage パリティ

**Files:**
- Modify: `src/features/history/pages/history-detail-page.tsx`
- Modify: `src/features/history/pages/history-detail-page.test.tsx`

**Interfaces:**
- Consumes: 同じ hook / helpers / canOpen-mustClose / forceNew（既存）/ itemCount
- Produces: 設計 §5 と MenuResult 同一振る舞い

- [ ] **Step 1: 失敗テスト（最低 2）**

```ts
it("auto-opens create sheet from /history/:id?for=shopping when household can create", async () => {
  // initialEntries [`/history/${MENU_ID}?for=shopping`]
  expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
});

it("uses non-removed itemCount on create sheet", async () => {
  // active list with one removed item → append label shows 非 removed 件数
});
```

- [ ] **Step 2–3: MenuResult と同じ配線を IdeaDetailBody / HouseholdDetailBody に適用**

- 親で `useShoppingCreateIntent(menuId)` → props で idea / household へ
- idea: 拒否 UI + clearCycle
- household: auto-open / mustClose / itemCount / cancel clearCycle / 成功 clearCycle
- 既存 `forceNewMode={shoppingGate.blocked}` は維持

- [ ] **Step 4: PASS**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/history/pages/history-detail-page.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/features/history/pages/history-detail-page.tsx src/features/history/pages/history-detail-page.test.tsx
git commit -m "feat: 履歴詳細でも買い物 intent の作成シートをパリティ実装"
```

---

### Task 9: 横断検証ゲート

**Files:** 変更なし（検証のみ）

- [ ] **Step 1: format**

```bash
docker compose run --rm --no-deps app npm run format:check
```

- [ ] **Step 2: lint**

```bash
docker compose run --rm --no-deps app npm run lint
```

- [ ] **Step 3: typecheck**

```bash
docker compose run --rm --no-deps app npm run typecheck
```

- [ ] **Step 4: 関連 vitest 一括**

```bash
docker compose run --rm --no-deps app npx vitest run \
  src/features/shopping/shopping-intent.test.ts \
  src/features/shopping/hooks/use-shopping-create-intent.test.tsx \
  src/features/shopping/pages/shopping-list-page.test.tsx \
  src/features/history/components/history-card.test.tsx \
  src/features/history/pages/history-page.test.tsx \
  src/features/generation/pages/menu-result-page.test.tsx \
  src/features/history/pages/history-detail-page.test.tsx
```

Expected: all PASS

- [ ] **Step 5: 仕様 coverage 自己確認**

| 設計 | Task |
|------|------|
| L1–L3 カード/idea | 4–5 |
| L2/L10 MenuResult 本線 | 7 |
| L5/L12 削除行 | 3 |
| L8 canOpen/mustClose | 7–8 |
| L9/L13/L15 intent | 1, 6 |
| L11 forceNew MenuResult | 7 |
| L14 tabIndex | 2 |
| HistoryDetail パリティ | 8 |
| D-C1 / empty リンク | 3 |

失敗があれば当該 Task に戻して修正コミット（`fix: ...`）。

---

## Spec coverage self-check（計画著者）

| 設計要件 | Task |
|----------|------|
| empty/safety/別の献立 `?for=shopping` | 3 |
| pendingUndo 既定非表示・成功後確認行・きれいにする | 3 |
| 履歴バナー・household0・カード CTA・タイトル intent | 4–5 |
| intent storage + L15 | 1, 6 |
| MenuResult auto-open / idea / forceNew / itemCount / focus | 2, 7 |
| HistoryDetail パリティ | 8 |
| resume 中 auto-open 禁止 | 7 |
| 横断 format/lint/typecheck | 9 |

**Placeholder scan:** TBD / 「similar to」なし。helper 署名は Task 1 と後続で一致。

**E2E:** 本計画に含めない（人間が明示したとき別 Task）。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-30-shopping-from-history-and-cleanup.md`.

**Two execution options:**

1. **Subagent-Driven（推奨）** — Task ごとに新しい subagent、Task 間レビュー  
2. **Inline Execution** — このセッションで executing-plans により逐次実行  

どちらで進めますか？
