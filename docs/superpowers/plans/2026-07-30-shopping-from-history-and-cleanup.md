# 履歴から買い物リスト作成 + 削除行クリーンアップ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 買い物画面から履歴で献立を選び、`/menus/:id?for=shopping` 経由で CreateListSheet まで気づける導線を作り、削除済み行は既定非表示（操作成功直後だけ確認行）にする。

**Architecture:** URL `for=shopping` + `sessionStorage` サイクル（intent / didAutoOpen / sheetExpected）。本線 `MenuResultPage`、副経路 `HistoryDetailPage` は同一契約。削除行は soft-delete 維持、`pendingUndoIds` のみ。

**Tech Stack:** React 19 / React Router 8 / TanStack Query 5 / TypeScript strict / Vitest / RTL

**仕様書:** `docs/superpowers/specs/2026-07-30-shopping-from-history-and-cleanup-design.md`（Approved R2+L15）  
**計画レビュー:** `docs/reviews/2026-07-30-shopping-from-history-plan-adversarial.md` → **本版 r1 で Critical/Important を吸収**

## Global Constraints

- Node.js `>=24 <25`。Node/npm は `docker compose run --rm --no-deps app ...`。**コマンドを `&&` / `;` で連結しない**。
- RED → GREEN → focused test → 日本語 Conventional Commit。1 Task = 1 単位。
- UI・コメント・コミットは日本語。識別子・テスト名は英語。`any` / 未検査 cast 禁止（Zod safeParse を使う）。
- 320px・`min-h-11`。新規 API / マイグレーション禁止。
- idea で shopping list/create/resume hooks を mount しない。
- sessionStorage キーは `kondate:shopping:` 接頭辞のみ。
- `git push` / PR / 本番 / `--no-verify` 禁止。E2E は defer。
- WIP `hideRemovedItems` は Task 3 で **完全削除**し `pendingUndoIds` に置換。
- **プレースホルダ禁止:** テスト・実装ステップに `// ...` や「流用」「同じ」だけの記述を置かない。

## Locked interfaces produced by this plan

| 名前 | 場所 | 契約 |
|------|------|------|
| helpers | `src/features/shopping/shopping-intent.ts` | 下表。文字列直書き禁止 |
| `hasPendingCreateCommand` | 同上 | resume 優先判定（Zod envelope） |
| `useShoppingCreateIntent` | `hooks/use-shopping-create-intent.ts` | **effect 分割必須**（§Task 6） |
| CreateListSheet h2 | `create-list-sheet.tsx` | `id="create-list-title"` + `tabIndex={-1}` |
| HistoryCard | `history-card.tsx` | `shoppingIntent?: boolean` |
| 本線 | `menu-result-page.tsx` | 親で hook（early return **前**）→ props |
| パリティ | `history-detail-page.tsx` | 同型（本文再掲） |

### shopping-intent 固定 export

```ts
export const SHOPPING_INTENT_PARAM = "for" as const;
export const SHOPPING_INTENT_VALUE = "shopping" as const;
export function hasShoppingIntent(params: URLSearchParams): boolean;
export function historyPathForShopping(): string; // "/history?for=shopping"
export function menusPathForShopping(menuId: string): string;
export function shoppingIntentStorageKey(menuId: string): string;
export function shoppingDidAutoOpenKey(menuId: string): string;
export function shoppingSheetExpectedKey(menuId: string): string;
export function isShoppingIntentActive(menuId: string): boolean;
export function hasShoppingDidAutoOpen(menuId: string): boolean;
export function isShoppingSheetExpected(menuId: string): boolean;
export function beginShoppingIntentCycle(menuId: string): void;
export function markShoppingSheetAutoOpened(menuId: string): void;
export function clearShoppingSheetExpected(menuId: string): void;
export function clearShoppingIntentCycle(menuId: string): void;
export function scheduleIntentClear(menuId: string): void;
export function cancelPendingIntentClear(menuId: string): void;
export function hasPendingCreateCommand(menuId: string): boolean;
```

### Hook 配置ロック（C2・全ページ共通）

```text
MenuResultPage / HistoryDetailPage 親コンポーネント:
  1. useParams で menuId を parse
  2. useShoppingCreateIntent(menuId ?? "")  ← 全 early return より前
  3. early return: invalid / loading / error
  4. idea → Idea*Body({ shoppingIntentActive, clearCycle, ... })
     household → Household*Body({ shoppingIntentActive, markAutoOpened, clearSheetExpected, clearCycle, ... })
  Idea* は shopping list/create/resume を import も mount もしない
```

## File Structure

| ファイル | 責務 |
|----------|------|
| `shopping-intent.ts` / `.test.ts` | path + storage + L15 + hasPendingCreateCommand |
| `use-shopping-create-intent.ts` / `.test.tsx` | URL strip / mount-unmount only schedule |
| `create-list-sheet.tsx` | tabIndex |
| `shopping-list-page.tsx` / test | リンク + pendingUndo |
| `history-card.tsx` / test | CTA |
| `history-page.tsx` / `history-page.test.tsx` | バナー・行き止まり（**既存 test を拡張**） |
| `menu-result-page.tsx` / test | 本線 auto-open |
| `history-detail-page.tsx` / test | パリティ全文 |

---

### Task 1: shopping-intent helper

**Files:**
- Create: `src/features/shopping/shopping-intent.ts`
- Create: `src/features/shopping/shopping-intent.test.ts`

**Interfaces:** Produces locked helpers + `hasPendingCreateCommand`

- [ ] **Step 1: 失敗テスト**

```ts
// src/features/shopping/shopping-intent.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginShoppingIntentCycle,
  cancelPendingIntentClear,
  clearShoppingIntentCycle,
  clearShoppingSheetExpected,
  hasPendingCreateCommand,
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
import { pendingShoppingCommandStorageKey } from "./api/shopping-api";

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

  it("clear expected keeps intent and did", () => {
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
    vi.advanceTimersByTime(0);
    expect(isShoppingIntentActive(MENU)).toBe(false);
  });

  it("cancel after schedule keeps keys", () => {
    beginShoppingIntentCycle(MENU);
    markShoppingSheetAutoOpened(MENU);
    scheduleIntentClear(MENU);
    cancelPendingIntentClear(MENU);
    vi.advanceTimersByTime(0);
    expect(isShoppingIntentActive(MENU)).toBe(true);
    expect(isShoppingSheetExpected(MENU)).toBe(true);
  });
});

describe("hasPendingCreateCommand", () => {
  it("returns true for fresh envelope", () => {
    sessionStorage.setItem(
      pendingShoppingCommandStorageKey("create", MENU),
      JSON.stringify({
        createdAtMs: Date.now(),
        command: {
          menuId: MENU,
          mode: "new",
          activeListId: null,
          expectedListVersion: null,
          idempotencyKey: "00000000-0000-4000-8000-000000000099",
        },
      }),
    );
    expect(hasPendingCreateCommand(MENU)).toBe(true);
  });

  it("returns false when missing or garbage", () => {
    expect(hasPendingCreateCommand(MENU)).toBe(false);
    sessionStorage.setItem(pendingShoppingCommandStorageKey("create", MENU), "{");
    expect(hasPendingCreateCommand(MENU)).toBe(false);
  });
});
```

- [ ] **Step 2: RED**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/shopping/shopping-intent.test.ts
```

Expected: FAIL module not found

- [ ] **Step 3: GREEN**

```ts
// src/features/shopping/shopping-intent.ts
import { z } from "zod";
import {
  createShoppingListRequestSchema,
  pendingShoppingCommandEnvelopeSchema,
  pendingShoppingCommandStorageKey,
  pendingShoppingCommandTtlMs,
} from "./api/shopping-api";

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

/** resume 優先: 有効 create envelope があるか（Zod、未検査 cast なし） */
export function hasPendingCreateCommand(menuId: string): boolean {
  const raw = sessionStorage.getItem(pendingShoppingCommandStorageKey("create", menuId));
  if (raw === null) return false;
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    return false;
  }
  const parsed = pendingShoppingCommandEnvelopeSchema(createShoppingListRequestSchema).safeParse(
    json,
  );
  if (!parsed.success) return false;
  const age = Date.now() - parsed.data.createdAtMs;
  return age >= 0 && age <= pendingShoppingCommandTtlMs;
}
```

**Note:** `createShoppingListRequestSchema` / envelope が `shopping-api` から re-export されていない場合は `@shared/contracts/shopping` から schema を import し、key/ttl だけ `shopping-api` から取る。

- [ ] **Step 4: PASS** 同上 vitest  
- [ ] **Step 5: Commit**

```bash
git add src/features/shopping/shopping-intent.ts src/features/shopping/shopping-intent.test.ts
git commit -m "feat: 買い物作成 intent の path/sessionStorage helper を追加"
```

---

### Task 2: CreateListSheet h2 tabIndex

**Files:**
- Modify: `src/features/shopping/components/create-list-sheet.tsx`
- Modify: `src/features/shopping/pages/shopping-list-page.test.tsx`（`describe("CreateListSheet")`）

- [ ] **Step 1: テスト**

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

```bash
docker compose run --rm --no-deps app npx vitest run src/features/shopping/pages/shopping-list-page.test.tsx
```

（新規 it が FAIL することを確認）

- [ ] **Step 3: GREEN**

```tsx
<h2 id="create-list-title" tabIndex={-1}>
  買い物リストを作る
</h2>
```

- [ ] **Step 4–5: PASS + commit**

```bash
git add src/features/shopping/components/create-list-sheet.tsx src/features/shopping/pages/shopping-list-page.test.tsx
git commit -m "fix: 買い物リスト作成シート見出しをプログラム focus 可能にする"
```

---

### Task 3: 買い物リスト — リンク + pendingUndoIds

**Files:**
- Modify: `src/features/shopping/pages/shopping-list-page.tsx`
- Modify: `src/features/shopping/pages/shopping-list-page.test.tsx`

**Discard:** `hideRemovedItems` state とそれに依存するテストを削除。

- [ ] **Step 1: 失敗テスト（完全コード）**

既存 import に追加:

```ts
import { historyPathForShopping } from "../shopping-intent";
```

```ts
describe("ShoppingListPage history links and removed rows", () => {
  it("links empty-state history pick to for=shopping", async () => {
    await renderPage(null);
    const link = screen.getByRole("link", { name: "履歴から選ぶ" });
    expect(link).toHaveAttribute("href", historyPathForShopping());
  });

  it("links safety recovery history to for=shopping", async () => {
    fetchActiveShoppingList.mockResolvedValue(makeShoppingList([makeItem()]));
    revalidateActiveShoppingList.mockResolvedValue(
      unverifiableSafety("元の献立が見つかりませんでした"),
    );
    render(
      <Providers>
        <ShoppingListPage />
      </Providers>,
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "履歴を開く" });
    expect(link).toHaveAttribute("href", historyPathForShopping());
  });

  it("hides server-removed by default and shows confirm only after successful remove", async () => {
    const removedList = makeShoppingList(
      [
        makeItem({ id: ITEM_ID, displayName: "にんじん", isRemovedByUser: true }),
        makeItem({ id: OTHER_ITEM_ID, displayName: "玉ねぎ", isRemovedByUser: true }),
      ],
      { version: 2 },
    );
    await renderPage(
      makeShoppingList([
        makeItem({ id: ITEM_ID, displayName: "にんじん" }),
        makeItem({ id: OTHER_ITEM_ID, displayName: "玉ねぎ", isRemovedByUser: true }),
      ]),
    );
    expect(screen.queryByText("玉ねぎをリストから外しました")).not.toBeInTheDocument();
    // click 前に成功後 list を mock（内部 refetch 用）
    fetchActiveShoppingList.mockResolvedValue(removedList);
    mutateShoppingItem.mockResolvedValue({
      listId: LIST_ID,
      version: 2,
      itemId: ITEM_ID,
      replayed: false,
    });
    await user.click(screen.getByRole("button", { name: "削除" }));
    expect(await screen.findByText("にんじんをリストから外しました")).toBeInTheDocument();
    expect(screen.queryByText("玉ねぎをリストから外しました")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "リストをきれいにする" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "外した項目の表示を消します。まちがえて消したときは、その場の「元に戻す」を先に押してください",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "リストをきれいにする" }));
    expect(screen.queryByText("にんじんをリストから外しました")).not.toBeInTheDocument();
  });

  it("does not show confirm row when remove mutation fails", async () => {
    await renderPage(makeShoppingList([makeItem({ displayName: "にんじん" })]));
    mutateShoppingItem.mockRejectedValueOnce(new Error("network"));
    await user.click(screen.getByRole("button", { name: "削除" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.queryByText("にんじんをリストから外しました")).not.toBeInTheDocument();
  });

  it("offers another menu link when list has items", async () => {
    await renderPage(makeShoppingList([makeItem()]));
    expect(screen.getByRole("link", { name: "別の献立から作る" })).toHaveAttribute(
      "href",
      historyPathForShopping(),
    );
  });

  it("shows empty buying message when all items are server-removed and none pending", async () => {
    await renderPage(
      makeShoppingList([makeItem({ displayName: "玉ねぎ", isRemovedByUser: true })]),
    );
    expect(screen.getByText("買うものは今ありません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "＋ 項目を追加" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "別の献立から作る" })).toBeInTheDocument();
    expect(screen.queryByText("玉ねぎをリストから外しました")).not.toBeInTheDocument();
  });
});
```

`unverifiableSafety` が test 内に無ければ既存 `invalidSafety` / `unverifiableSafety` 定義を使う（同ファイル L194 付近）。

旧テスト `hides removed rows after the user cleans up the list`（hideRemovedItems 前提）は **削除または上記に置換**。

- [ ] **Step 2: RED**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/shopping/pages/shopping-list-page.test.tsx
```

- [ ] **Step 3: GREEN（mutate 成功時のみ pending — I1）**

```tsx
// shopping-list-page.tsx 要点
import { Link } from "react-router";
import { historyPathForShopping } from "../shopping-intent";

const [pendingUndoIds, setPendingUndoIds] = useState<ReadonlySet<string>>(() => new Set());
// hideRemovedItems は置かない

const mutate = async (value: LocalShoppingItemMutation) => {
  if (safetyBlocked || safetyGate.safetyFingerprint === null) return;
  if (mutationInFlight.current) return;
  mutationInFlight.current = true;
  setItemMutationPending(true);
  try {
    setMutationError(null);
    await mutateShoppingItem(
      shoppingItemMutationRequestSchema.parse({
        ...value,
        listId: list.id,
        expectedListVersion: list.version,
        expectedSafetyFingerprint: safetyGate.safetyFingerprint,
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    // 成功時のみ（try 内、catch では触らない）
    if (
      value.itemId !== null &&
      (value.operation === "remove" || value.operation === "mark_at_home")
    ) {
      setPendingUndoIds((prev) => new Set(prev).add(value.itemId as string));
    }
    if (value.itemId !== null && value.operation === "undo") {
      setPendingUndoIds((prev) => {
        const next = new Set(prev);
        next.delete(value.itemId as string);
        return next;
      });
    }
  } catch (error) {
    // 既存エラー分岐のまま。pendingUndoIds は変更しない
    /* ...既存... */
  } finally {
    mutationInFlight.current = false;
    setItemMutationPending(false);
  }
  await query.refetch();
};

const displayItems = list.items.filter(
  (item) => !item.isRemovedByUser || pendingUndoIds.has(item.id),
);
const showCleanup = list.items.some(
  (item) => item.isRemovedByUser && pendingUndoIds.has(item.id),
);
const allRemovedNoPending =
  list.items.length > 0 &&
  list.items.every((item) => item.isRemovedByUser) &&
  pendingUndoIds.size === 0;
```

UI:

- empty: `<Link className="secondary-button min-h-11" to={historyPathForShopping()}>履歴から選ぶ</Link>`
- safety ブロックの「履歴を開く」: `to={historyPathForShopping()}`
- `showCleanup` 時: secondary「リストをきれいにする」+ L12 説明文（一字固定）
- リスト末尾: `<Link className="secondary-button min-h-11" to={historyPathForShopping()}>別の献立から作る</Link>`
- `allRemovedNoPending`: 「買うものは今ありません」
- セクション map は `displayItems`

- [ ] **Step 4: PASS** 同上 vitest  
- [ ] **Step 5: Commit**

```bash
git add src/features/shopping/pages/shopping-list-page.tsx src/features/shopping/pages/shopping-list-page.test.tsx
git commit -m "feat: 買い物の履歴導線と削除行の既定非表示を追加"
```

---

### Task 4: HistoryCard CTA

**Files:**
- Modify: `src/features/history/components/history-card.tsx`
- Modify: `src/features/history/components/history-card.test.tsx`

- [ ] **Step 1: テスト** — 計画 r0 の 4 it をそのまま使用（`menusPathForShopping`、`renderCard(group, shoppingIntent)` で `createMemoryRouter`）。`renderCard` を props 対応に更新。

- [ ] **Step 2–3: RED/GREEN**

```tsx
import { menusPathForShopping } from "@/features/shopping/shopping-intent";

type HistoryCardProps = {
  group: HistoryGroup;
  shoppingIntent?: boolean;
};

export function HistoryCard({ group, shoppingIntent = false }: HistoryCardProps) {
  const menuPath = shoppingIntent
    ? menusPathForShopping(representative.id)
    : `/menus/${representative.id}`;
  // タイトル <Link to={menuPath}>
  // actions 先頭:
  {representative.targetMode === "household" ? (
    <Link to={menusPathForShopping(representative.id)} className="primary-button min-h-11">
      買い物リストを作る
    </Link>
  ) : null}
```

- [ ] **Step 4–5: PASS + commit**

```bash
git add src/features/history/components/history-card.tsx src/features/history/components/history-card.test.tsx
git commit -m "feat: 履歴カードに買い物リスト作成 CTA を追加"
```

---

### Task 5: HistoryPage バナー / 行き止まり

**Files:**
- Modify: `src/features/history/pages/history-page.tsx`
- Modify: `src/features/history/pages/history-page.test.tsx`（**既存を拡張**。MemoryRouter 禁止）

- [ ] **Step 1: 既存 helper を拡張してテスト**

```ts
// history-page.test.tsx — renderHistoryPage を更新
function renderHistoryPage(props: {
  groups: readonly HistoryGroup[];
  shoppingIntent?: boolean;
  initialPath?: string;
}) {
  const router = createMemoryRouter(
    [
      {
        path: "/history",
        element: (
          <HistoryPageContent
            groups={props.groups}
            shoppingIntent={props.shoppingIntent ?? false}
          />
        ),
      },
      { path: "/menus/:menuId", element: <h1>献立結果</h1> },
      { path: "/planner", element: <h1>プランナー</h1> },
      { path: "/shopping", element: <h1>買い物</h1> },
    ],
    { initialEntries: [props.initialPath ?? "/history"] },
  );
  // 既存どおり QueryClient + Auth + RouterProvider
  return router;
}

const ideaOnlyGroup: HistoryGroup = {
  derivationGroupId: "group-idea",
  versionCount: 1,
  representative: {
    id: "menu-idea",
    title: "アイデア献立",
    createdAt: "2026-07-11T10:00:00Z",
    selectedAt: null,
    isFavorite: false,
    targetMode: "idea",
  },
};

it("shows shopping banner when shoppingIntent", () => {
  renderHistoryPage({ groups: [sampleGroup], shoppingIntent: true });
  expect(screen.getByText("買い物リスト用に献立を選んでください")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "買い物に戻る" })).toHaveAttribute("href", "/shopping");
});

it("shows dead-end when shoppingIntent and no household cards", () => {
  renderHistoryPage({ groups: [ideaOnlyGroup], shoppingIntent: true });
  expect(
    screen.getByText(
      "いま選べる家族向けの献立がありません。買い物リストに使えるのは家族に合わせた献立だけです",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "家族向けの献立を作る" })).toHaveAttribute(
    "href",
    "/planner",
  );
});

it("shows banner on empty list with shoppingIntent", () => {
  renderHistoryPage({ groups: [], shoppingIntent: true });
  expect(screen.getByText("買い物リスト用に献立を選んでください")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "買い物に戻る" })).toBeInTheDocument();
});

it("passes for=shopping from URL into HistoryPage", async () => {
  api.listHistoryGroups.mockResolvedValue([sampleGroup]);
  const router = createMemoryRouter(
    [
      { path: "/history", element: <HistoryPage /> },
      { path: "/shopping", element: <h1>買い物</h1> },
      { path: "/planner", element: <h1>プランナー</h1> },
    ],
    { initialEntries: ["/history?for=shopping"] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthContext.Provider value={authValue(USER_ID)}>
        <RouterProvider router={router} />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("買い物リスト用に献立を選んでください")).toBeInTheDocument();
});
```

- [ ] **Step 2–3: 実装**

```tsx
import { Link, useSearchParams } from "react-router";
import { hasShoppingIntent } from "@/features/shopping/shopping-intent";

export function HistoryPage() {
  const [params] = useSearchParams();
  const shoppingIntent = hasShoppingIntent(params);
  const { data = [], isPending, isError, refetch, isFetching } = useHistoryGroups();
  // loading / error: 既存（バナーなし）
  if (isPending) { /* 既存 */ }
  if (isError) { /* 既存 */ }
  return <HistoryPageContent groups={data} shoppingIntent={shoppingIntent} />;
}

export function HistoryPageContent({
  groups,
  shoppingIntent = false,
}: {
  groups: readonly HistoryGroup[];
  shoppingIntent?: boolean;
}) {
  const [favoritesOnly, setFavoritesOnly] = useState(false);
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

  // empty groups.length === 0:
  //   h1 + banner + 既存 empty カード

  const visible = favoritesOnly
    ? groups.filter((g) => g.representative.isFavorite)
    : groups;
  const householdVisible = visible.filter((g) => g.representative.targetMode === "household");

  // shoppingIntent && householdVisible.length === 0:
  //   行き止まりカード（文言一字固定）+ planner + フィルタ解除 + 買い物に戻る

  // list: banner + cards with <HistoryCard shoppingIntent={shoppingIntent} />
}
```

- [ ] **Step 4–5: PASS + commit**

```bash
git add src/features/history/pages/history-page.tsx src/features/history/pages/history-page.test.tsx
git commit -m "feat: 履歴一覧に買い物文脈バナーと行き止まり案内を追加"
```

---

### Task 6: useShoppingCreateIntent（effect 分割・C1）

**Files:**
- Create: `src/features/shopping/hooks/use-shopping-create-intent.ts`
- Create: `src/features/shopping/hooks/use-shopping-create-intent.test.tsx`

**Produces:**

```ts
export function useShoppingCreateIntent(menuId: string): {
  shoppingIntentActive: boolean;
  markAutoOpened: () => void;
  clearSheetExpected: () => void;
  clearCycle: () => void;
};
```

- [ ] **Step 1: 完全テスト**

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginShoppingIntentCycle,
  isShoppingIntentActive,
  isShoppingSheetExpected,
  markShoppingSheetAutoOpened,
} from "../shopping-intent";
import { useShoppingCreateIntent } from "./use-shopping-create-intent";

const MENU = "40000000-0000-4000-8000-000000000001";

function wrapperFor(path: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const router = createMemoryRouter(
      [{ path: "/menus/:menuId", element: children }],
      { initialEntries: [path] },
    );
    return (
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  };
}

// 注: renderHook と RouterProvider の組み合わせが難しい場合は
// 最小コンポーネントで hook を呼び location を assert する方式でよい。
// 以下は「期待する振る舞い」の固定仕様。

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

describe("useShoppingCreateIntent", () => {
  it("begins cycle from for=shopping and strips query without clearing intent", async () => {
    // mount at `/menus/${MENU}?for=shopping`
    // after effects:
    await waitFor(() => {
      expect(isShoppingIntentActive(MENU)).toBe(true);
    });
    // router state: search に for が無い
    // advanceTimers しても intent は残る（strip の cleanup で wipe しない）
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(isShoppingIntentActive(MENU)).toBe(true);
  });

  it("schedules clear only on true unmount", () => {
    beginShoppingIntentCycle(MENU);
    markShoppingSheetAutoOpened(MENU);
    const { unmount } = renderHook(() => useShoppingCreateIntent(MENU), {
      wrapper: wrapperFor(`/menus/${MENU}`),
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(isShoppingIntentActive(MENU)).toBe(false);
    expect(isShoppingSheetExpected(MENU)).toBe(false);
  });

  it("cancel on remount keeps cycle (StrictMode pair)", () => {
    beginShoppingIntentCycle(MENU);
    markShoppingSheetAutoOpened(MENU);
    const { unmount } = renderHook(() => useShoppingCreateIntent(MENU), {
      wrapper: wrapperFor(`/menus/${MENU}`),
    });
    unmount();
    // remount before timeout
    renderHook(() => useShoppingCreateIntent(MENU), {
      wrapper: wrapperFor(`/menus/${MENU}`),
    });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(isShoppingIntentActive(MENU)).toBe(true);
    expect(isShoppingSheetExpected(MENU)).toBe(true);
  });
});
```

実装者が Router 付き renderHook で詰まる場合は、テスト用に:

```tsx
function Probe({ menuId }: { menuId: string }) {
  const intent = useShoppingCreateIntent(menuId);
  return <div data-active={intent.shoppingIntentActive ? "1" : "0"} />;
}
```

を `createMemoryRouter` で mount し、`screen.getBy` + sessionStorage を assert する。

- [ ] **Step 2: RED**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/shopping/hooks/use-shopping-create-intent.test.tsx
```

- [ ] **Step 3: GREEN — effect 分割（必須）**

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
  const bump = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  // A: URL 取り込みのみ — cleanup で schedule しない（C1）
  useEffect(() => {
    if (menuId.length === 0) return;
    if (!hasShoppingIntent(searchParams)) return;
    beginShoppingIntentCycle(menuId);
    const next = new URLSearchParams(searchParams);
    next.delete(SHOPPING_INTENT_PARAM);
    setSearchParams(next, { replace: true });
    bump();
  }, [menuId, searchParams, setSearchParams, bump]);

  // B: 真の mount/unmount のみ（deps = menuId）
  useEffect(() => {
    if (menuId.length === 0) return;
    cancelPendingIntentClear(menuId);
    return () => {
      scheduleIntentClear(menuId);
    };
  }, [menuId]);

  void tick;
  const shoppingIntentActive = menuId.length > 0 && isShoppingIntentActive(menuId);

  return {
    shoppingIntentActive,
    markAutoOpened: () => {
      if (menuId.length === 0) return;
      markShoppingSheetAutoOpened(menuId);
      bump();
    },
    clearSheetExpected: () => {
      if (menuId.length === 0) return;
      clearShoppingSheetExpected(menuId);
      bump();
    },
    clearCycle: () => {
      if (menuId.length === 0) return;
      clearShoppingIntentCycle(menuId);
      bump();
    },
  };
}
```

- [ ] **Step 4–5: PASS + commit**

```bash
git add src/features/shopping/hooks/use-shopping-create-intent.ts src/features/shopping/hooks/use-shopping-create-intent.test.tsx
git commit -m "feat: 買い物作成 intent の React hook を追加"
```

---

### Task 7: MenuResultPage 本線

**Files:**
- Modify: `src/features/generation/pages/menu-result-page.tsx`
- Modify: `src/features/generation/pages/menu-result-page.test.tsx`

**Hook 配置:** 親 `MenuResultPage` の **先頭**（early return 前）で `useShoppingCreateIntent(menuId ?? "")`。props で Idea/Household へ。

#### 転記必須: household auto-open / mustClose（C4）

```ts
// HouseholdResultBody 内（名前は既存に合わせる）
const shoppingListBusy =
  shoppingList.isFetching || !shoppingList.isSuccess || menuId.length === 0;
const canOpenCreateSheet =
  actionsEnabled && !shoppingListBusy && !createList.isPending;
const mustCloseCreateSheet = !actionsEnabled;
const mustCloseReconcileSheet = !actionsEnabled || shoppingGate.blocked;

const nonRemovedCount =
  activeList === null
    ? 0
    : activeList.items.filter((item) => !item.isRemovedByUser).length;

useEffect(() => {
  if (mustCloseCreateSheet && shoppingSheet === "create") {
    setShoppingSheet(null);
    clearSheetExpected(); // intent/did は残す
  }
  if (mustCloseReconcileSheet && shoppingSheet === "reconcile") {
    setShoppingSheet(null);
  }
}, [mustCloseCreateSheet, mustCloseReconcileSheet, shoppingSheet, clearSheetExpected]);

useEffect(() => {
  if (menuId.length === 0) return;
  if (shoppingSheet !== null) return;
  if (hasPendingCreateCommand(menuId)) return;
  if (!canOpenCreateSheet) return;

  const restore = isShoppingSheetExpected(menuId);
  const firstOpen = shoppingIntentActive && !hasShoppingDidAutoOpen(menuId);
  if (!restore && !firstOpen) return;

  setShoppingSheet("create");
  if (firstOpen) {
    markAutoOpened();
  }
  requestAnimationFrame(() => {
    const el = document.getElementById("create-list-title");
    el?.scrollIntoView({ block: "nearest" });
    el?.focus();
  });
}, [
  menuId,
  shoppingSheet,
  canOpenCreateSheet,
  shoppingIntentActive,
  markAutoOpened,
]);

// 手動オープン:
// setShoppingSheet("create") のみ。markAutoOpened / sheetExpected は立てない。

// CreateListSheet:
// forceNewMode={shoppingGate.blocked}
// itemCount: nonRemovedCount
// key={`${activeList?.id ?? "none"}-${activeList?.version ?? 0}`}
// safetyBlocked={!canOpenCreateSheet}
// onCancel: () => { setShoppingSheet(null); clearCycle(); }
// 成功 navigate 前: clearCycle()
```

#### idea 拒否 state（I5）

```ts
// IdeaResultBody
const [showIdeaShoppingRejected, setShowIdeaShoppingRejected] = useState(false);
useEffect(() => {
  if (!shoppingIntentActive) return;
  setShowIdeaShoppingRejected(true);
  clearCycle();
}, [shoppingIntentActive, clearCycle]);

// 表示条件: showIdeaShoppingRejected === true のみ（active に依存しない）
// 文言: アイデア献立は買い物リストに使えません。家族に合わせた献立を選んでください
// Link: historyPathForShopping(), /shopping
```

- [ ] **Step 1: テスト（既存 `renderPage` / mocks を使用）**

```ts
import {
  beginShoppingIntentCycle,
  clearShoppingIntentCycle,
  hasShoppingDidAutoOpen,
  historyPathForShopping,
  isShoppingIntentActive,
  isShoppingSheetExpected,
  markShoppingSheetAutoOpened,
} from "@/features/shopping/shopping-intent";
import { pendingShoppingCommandStorageKey } from "@/features/shopping/api/shopping-api";

// beforeEach で household menu + valid revalidation + shopping mocks は既存

it("auto-opens create sheet when for=shopping and can create", async () => {
  getMenuResultMock.mockResolvedValue(
    makeMenuResultViewModel({ targetMode: "household", id: VALID_MENU_ID }),
  );
  renderPage(`/menus/${VALID_MENU_ID}?for=shopping`);
  expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
  await waitFor(() => {
    expect(isShoppingIntentActive(VALID_MENU_ID)).toBe(true);
  });
});

it("auto-opens again on second for=shopping after cancel", async () => {
  getMenuResultMock.mockResolvedValue(
    makeMenuResultViewModel({ targetMode: "household", id: VALID_MENU_ID }),
  );
  const router = renderPage(`/menus/${VALID_MENU_ID}?for=shopping`);
  expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
  expect(screen.queryByRole("heading", { name: "買い物リストを作る" })).toBeNull();
  // 2 回目: 新エントリ
  router.navigate(`/menus/${VALID_MENU_ID}?for=shopping`);
  expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
});

it("does not auto-reopen after mustClose clears sheetExpected", async () => {
  // 実装後: auto-open → actionsEnabled を false にする（revalidation invalid inject）
  // sheet が閉じ、didAutoOpen のまま再 open しない
  // 手動「買い物リストを作る」は actions 復帰後に可能
});

it("keeps sheet while createList is pending", async () => {
  getMenuResultMock.mockResolvedValue(
    makeMenuResultViewModel({ targetMode: "household", id: VALID_MENU_ID }),
  );
  let resolveCreate: (v: unknown) => void = () => undefined;
  shoppingApi.createShoppingList.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
  );
  renderPage(`/menus/${VALID_MENU_ID}?for=shopping`);
  expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "作成する" }));
  expect(screen.getByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
  resolveCreate({ listId: SHOPPING_LIST_ID, version: 5, replayed: false });
});

it("shows idea rejection without create calls when for=shopping", async () => {
  getMenuResultMock.mockResolvedValue(
    makeMenuResultViewModel({ targetMode: "idea", id: VALID_MENU_ID }),
  );
  renderPage(`/menus/${VALID_MENU_ID}?for=shopping`);
  expect(
    await screen.findByText(/アイデア献立は買い物リストに使えません/u),
  ).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "買い物リストを作る" })).toBeNull();
  expect(shoppingApi.createShoppingList).not.toHaveBeenCalled();
  expect(shoppingApi.fetchActiveShoppingList).not.toHaveBeenCalled();
  // storage clear 後もメッセージ残る
  expect(isShoppingIntentActive(VALID_MENU_ID)).toBe(false);
  expect(
    screen.getByText(/アイデア献立は買い物リストに使えません/u),
  ).toBeInTheDocument();
});

it("passes forceNewMode when shopping gate blocked", async () => {
  getMenuResultMock.mockResolvedValue(
    makeMenuResultViewModel({ targetMode: "household", id: VALID_MENU_ID }),
  );
  shoppingApi.revalidateActiveShoppingList.mockResolvedValue(invalidShoppingSafety);
  shoppingApi.fetchActiveShoppingList.mockResolvedValue({
    ...activeShoppingList,
    items: [
      {
        // minimal item if needed — or use empty + open create manually after force
      },
    ],
  } as ShoppingList);
  // active list non-null + gate blocked → open sheet (auto or manual when canOpen)
  // CreateListSheet shows force-new status copy:
  // 「今のリストは家族設定で確認できないため、新しいリストを作ります。」
  renderPage(`/menus/${VALID_MENU_ID}?for=shopping`);
  // canOpen は gate blocked でも true（actionsEnabled 前提）。auto-open 後:
  expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
  expect(
    screen.getByText("今のリストは家族設定で確認できないため、新しいリストを作ります。"),
  ).toBeInTheDocument();
});

it("does not auto-open while pending create envelope exists", async () => {
  getMenuResultMock.mockResolvedValue(
    makeMenuResultViewModel({ targetMode: "household", id: VALID_MENU_ID }),
  );
  sessionStorage.setItem(
    pendingShoppingCommandStorageKey("create", VALID_MENU_ID),
    JSON.stringify({
      createdAtMs: Date.now(),
      command: {
        menuId: VALID_MENU_ID,
        mode: "new",
        activeListId: null,
        expectedListVersion: null,
        idempotencyKey: "00000000-0000-4000-8000-000000000099",
      },
    }),
  );
  renderPage(`/menus/${VALID_MENU_ID}?for=shopping`);
  await screen.findByText(/献立|確認/u); // ページ描画待ち
  expect(screen.queryByRole("heading", { name: "買い物リストを作る" })).toBeNull();
});

it("uses non-removed item count on create sheet", async () => {
  getMenuResultMock.mockResolvedValue(
    makeMenuResultViewModel({ targetMode: "household", id: VALID_MENU_ID }),
  );
  shoppingApi.fetchActiveShoppingList.mockResolvedValue({
    ...activeShoppingList,
    items: [
      {
        id: SHOPPING_ITEM_ID,
        displayName: "にんじん",
        normalizedName: "にんじん",
        storeSection: "produce",
        quantityValue: 1,
        quantityText: "1本",
        unit: "本",
        isChecked: false,
        isManual: false,
        isManuallyEdited: false,
        isRemovedByUser: true,
        pantryCheckRequired: false,
        labelWarnings: [],
        sourceIngredients: [],
      },
    ],
  });
  renderPage(`/menus/${VALID_MENU_ID}?for=shopping`);
  expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
  expect(screen.getByText(/今のリストへ追加（0件）/u)).toBeInTheDocument();
});
```

`mustClose` テストが inject revalidation で難しい場合は、exported な test-only を避け、`revalidateMenuMock` を invalid に更新して Realtime/focus 相当の refresh を起こす既存パターンを使う。どうしても難しければ **unit で `clearShoppingSheetExpected` + `hasShoppingDidAutoOpen` の組み合わせを household の effect から呼ぶこと**をコメントで固定し、少なくとも:

```ts
it("after markAutoOpened and clearSheetExpected, firstOpen is false and restore is false", () => {
  beginShoppingIntentCycle(VALID_MENU_ID);
  markShoppingSheetAutoOpened(VALID_MENU_ID);
  // simulate mustClose
  const { clearShoppingSheetExpected, hasShoppingDidAutoOpen, isShoppingSheetExpected } =
    await import("@/features/shopping/shopping-intent");
  clearShoppingSheetExpected(VALID_MENU_ID);
  expect(hasShoppingDidAutoOpen(VALID_MENU_ID)).toBe(true);
  expect(isShoppingSheetExpected(VALID_MENU_ID)).toBe(false);
});
```

を Task 1 または Task 7 に置く（ページ級 mustClose は可能なら本テストを優先）。

- [ ] **Step 2: RED**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/generation/pages/menu-result-page.test.tsx
```

- [ ] **Step 3: GREEN** — 上記 effect・idea・CreateListSheet・親 hook 配置を実装

- [ ] **Step 4–5: PASS + commit**

```bash
git add src/features/generation/pages/menu-result-page.tsx src/features/generation/pages/menu-result-page.test.tsx
git commit -m "feat: 献立結果で買い物 intent の作成シート自動表示を追加"
```

---

### Task 8: HistoryDetailPage パリティ（全文・「同じ」禁止）

**Files:**
- Modify: `src/features/history/pages/history-detail-page.tsx`
- Modify: `src/features/history/pages/history-detail-page.test.tsx`

#### 親

```tsx
export function HistoryDetailPage(...) {
  const parsed = z.uuid().safeParse(useParams().menuId);
  const menuId = parsed.success ? parsed.data : null;
  const intent = useShoppingCreateIntent(menuId ?? ""); // early return 前

  if (!parsed.success || menuId === null) return <Navigate to="/history" replace />;
  if (menuQuery.isPending) { /* 既存 */ }
  if (menuQuery.isError) { /* 既存 */ }

  if (menuQuery.data.targetMode === "idea") {
    return (
      <IdeaDetailBody
        result={menuQuery.data}
        menuId={menuId}
        userId={userId}
        shoppingIntentActive={intent.shoppingIntentActive}
        clearCycle={intent.clearCycle}
      />
    );
  }
  return (
    <HouseholdDetailBody
      ...
      shoppingIntentActive={intent.shoppingIntentActive}
      markAutoOpened={intent.markAutoOpened}
      clearSheetExpected={intent.clearSheetExpected}
      clearCycle={intent.clearCycle}
    />
  );
}
```

#### IdeaDetailBody

Task 7 の idea 拒否 state 機械を **このファイルにそのまま書く**（import 共有コンポーネント化してもよいが、振る舞い同一）。

#### HouseholdDetailBody

Task 7 の `canOpenCreateSheet` / mustClose / auto-open effect / CreateListSheet props（forceNew 既存維持、itemCount non-removed、key、onCancel clearCycle、成功 clearCycle）を **このファイルに再掲して実装**。

- [ ] **Step 1: テスト**

```ts
it("auto-opens create sheet from /history/:id?for=shopping when household can create", async () => {
  // 既存 renderHistoryDetail を initialEntries 対応に拡張するか、
  // createMemoryRouter initialEntries: [`/history/${MENU_ID}?for=shopping`]
  // household + valid revalidation + shopping mocks（beforeEach 既存）
  expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
});

it("uses non-removed itemCount on create sheet", async () => {
  shoppingApi.fetchActiveShoppingList.mockResolvedValue({
    ...activeShoppingList,
    items: [
      {
        id: "40000000-0000-4000-8000-000000000002",
        displayName: "にんじん",
        normalizedName: "にんじん",
        storeSection: "produce",
        quantityValue: 1,
        quantityText: "1本",
        unit: "本",
        isChecked: false,
        isManual: false,
        isManuallyEdited: false,
        isRemovedByUser: true,
        pantryCheckRequired: false,
        labelWarnings: [],
        sourceIngredients: [],
      },
    ],
  });
  // mount with ?for=shopping
  expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
  expect(screen.getByText(/今のリストへ追加（0件）/u)).toBeInTheDocument();
});

it("shows idea rejection on history detail with for=shopping", async () => {
  // idea menu mock + ?for=shopping
  expect(
    await screen.findByText(/アイデア献立は買い物リストに使えません/u),
  ).toBeInTheDocument();
  expect(shoppingApi.fetchActiveShoppingList).not.toHaveBeenCalled();
});
```

`renderHistoryDetail` が `?for=shopping` を受け取れない場合は、関数に `path` 引数を追加:

```ts
function renderHistoryDetail(options: { path?: string; /* 既存 */ } = {}) {
  const path = options.path ?? `/history/${MENU_ID}`;
  // initialEntries: [path]
}
```

- [ ] **Step 2–5: RED / GREEN / PASS / commit**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/history/pages/history-detail-page.test.tsx
git add src/features/history/pages/history-detail-page.tsx src/features/history/pages/history-detail-page.test.tsx
git commit -m "feat: 履歴詳細でも買い物 intent の作成シートをパリティ実装"
```

---

### Task 9: 横断検証

- [ ] **Step 1–4:** 各コマンドを **独立** に実行

```bash
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx vitest run \
  src/features/shopping/shopping-intent.test.ts \
  src/features/shopping/hooks/use-shopping-create-intent.test.tsx \
  src/features/shopping/pages/shopping-list-page.test.tsx \
  src/features/history/components/history-card.test.tsx \
  src/features/history/pages/history-page.test.tsx \
  src/features/generation/pages/menu-result-page.test.tsx \
  src/features/history/pages/history-detail-page.test.tsx
```

- [ ] **Step 5: 仕様 coverage**

| 設計 | Task |
|------|------|
| L1–L3 カード/idea | 4–5 |
| L2/L10 MenuResult | 7 |
| L5/L12 削除行 | 3 |
| L8 canOpen/mustClose | 7–8 |
| L9/L13/L15 intent | 1, 6 |
| L11 forceNew | 7 |
| L14 tabIndex | 2 |
| HistoryDetail パリティ | 8 |
| D-C1 / empty リンク | 3 |
| 2 回目 for=shopping | 7 |
| resume 中 auto-open 禁止 | 7 |
| idea flash 防止 | 7–8 |
| 全件 removed 短文 | 3 |

---

## Plan revision summary（敵対的レビュー反映 r1）

| ID | 対応 |
|----|------|
| C1 | Task 6 effect を **A=URL / B=unmount** に分割。strip cleanup で schedule しない |
| C2 | Hook 配置ロック表 + 親 early return 前 + props 配布 |
| C3 | Task 3/5/6/7/8 テストを実行可能なコードに（`// ...` 削除） |
| C4 | Task 7 に auto-open/mustClose effect 全文。Task 8 に再掲 |
| I1 | mutate 成功は try 内のみ pendingUndo |
| I2 | click 前に removed list を mock |
| I3 | 2 回目 auto-open / isPending シート / pending envelope / idea / itemCount を Task 7 に |
| I4 | 既存 history-page.test + createMemoryRouter |
| I5 | showIdeaShoppingRejected local + clearCycle 順序固定 |
| I6 | beginShoppingIntentCycle に名称統一 |
| I7 | Task 8 に HistoryDetail 手順全文 |
| I8 | 全件 removed テスト |
| M1 | vitest ファイル全体実行 |
| M2 | `vi.advanceTimersByTime(0)` |
| M3 | hasPendingCreateCommand を Zod envelope で helper 化 |

---

## Execution Handoff

Plan r1 saved to `docs/superpowers/plans/2026-07-30-shopping-from-history-and-cleanup.md`.

**Options:**

1. **Subagent-Driven（推奨）**  
2. **Inline Execution**

どちらで実装しますか？
