import { createShoppingListRequestSchema } from "@shared/contracts/shopping";
import {
  pendingShoppingCommandEnvelopeSchema,
  pendingShoppingCommandStorageKey,
  pendingShoppingCommandTtlMs,
} from "./api/shopping-api";

/** URL クエリで買い物作成 intent を示すパラメータ名（固定: for） */
export const SHOPPING_INTENT_PARAM = "for" as const;
/** URL クエリで買い物作成 intent を示す値（固定: shopping） */
export const SHOPPING_INTENT_VALUE = "shopping" as const;

/** searchParams に for=shopping があるか */
export function hasShoppingIntent(params: URLSearchParams): boolean {
  return params.get(SHOPPING_INTENT_PARAM) === SHOPPING_INTENT_VALUE;
}

/** 買い物導線用の履歴一覧 path（クエリのみ固定） */
export function historyPathForShopping(): string {
  return "/history?for=shopping";
}

/** 買い物導線用の献立結果 path（menuId + for=shopping） */
export function menusPathForShopping(menuId: string): string {
  return `/menus/${menuId}?for=shopping`;
}

/**
 * sessionStorage キーは必ず `kondate:shopping:` 接頭辞。
 * intent / did-auto-open / sheet-expected の3つで1サイクルを表す。
 */
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

/** サイクル開始: intent を立て、did / expected はリセット（再入場でも sheet を再 open できるように） */
export function beginShoppingIntentCycle(menuId: string): void {
  sessionStorage.setItem(shoppingIntentStorageKey(menuId), "1");
  sessionStorage.removeItem(shoppingDidAutoOpenKey(menuId));
  sessionStorage.removeItem(shoppingSheetExpectedKey(menuId));
}
/** 自動 open 済みと「sheet が開いている想定」を同時に記録 */
export function markShoppingSheetAutoOpened(menuId: string): void {
  sessionStorage.setItem(shoppingDidAutoOpenKey(menuId), "1");
  sessionStorage.setItem(shoppingSheetExpectedKey(menuId), "1");
}
/** sheet を閉じたあと expected だけ落とす（intent / did は残す） */
export function clearShoppingSheetExpected(menuId: string): void {
  sessionStorage.removeItem(shoppingSheetExpectedKey(menuId));
}
/** サイクル終了: 3キーすべて削除 */
export function clearShoppingIntentCycle(menuId: string): void {
  sessionStorage.removeItem(shoppingIntentStorageKey(menuId));
  sessionStorage.removeItem(shoppingDidAutoOpenKey(menuId));
  sessionStorage.removeItem(shoppingSheetExpectedKey(menuId));
}

/** L15: unmount 時に遅延 clear するための timer 管理（menuId 単位） */
const pendingClears = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * 次 tick で intent サイクルを消す。Strict Mode の remount では
 * cancelPendingIntentClear が先に呼ばれ、誤 clear を防ぐ。
 */
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

/**
 * resume 優先: 有効な create envelope が sessionStorage にあるか。
 * 壊れた JSON・Zod 不一致・TTL 超過・時計巻き戻しは false（未検査 cast なし）。
 */
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

/**
 * SHOP6: create/reconcile シートを開いているあいだ resume を止める印。
 * React の shoppingSheet は remount で消えるが sessionStorage は残るため、
 * モード/approval 選び直し中のハードリロードで旧 sticky が自動 POST される窓を閉じる。
 * Cancel / 成功 / code 付き fail で明示 clear → SHOP1 どおり sticky 再送を再開できる。
 */
export function shoppingResumeSuppressKey(kind: "create" | "reconcile", targetId: string): string {
  return `kondate:shopping:resume-suppress:v1:${kind}:${targetId}`;
}

export function isShoppingResumeSuppressed(
  kind: "create" | "reconcile",
  targetId: string,
): boolean {
  return sessionStorage.getItem(shoppingResumeSuppressKey(kind, targetId)) === "1";
}

export function markShoppingResumeSuppress(kind: "create" | "reconcile", targetId: string): void {
  sessionStorage.setItem(shoppingResumeSuppressKey(kind, targetId), "1");
}

export function clearShoppingResumeSuppress(kind: "create" | "reconcile", targetId: string): void {
  sessionStorage.removeItem(shoppingResumeSuppressKey(kind, targetId));
}

/**
 * SHOP2: list gate blocked 中は create resume が enabled=false のため
 * submitCreate 内の append clear が到達しない。blocked 遷移時に mode=append
 * sticky だけを捨て、forceNew 誘導と ready 復帰後の旧 append 自動再送を防ぐ。
 * mode=new は D-C1 どおり保持する。
 * @returns true のとき append sticky を捨てた
 */
export function discardAppendCreateCommandIfPresent(menuId: string): boolean {
  const key = pendingShoppingCommandStorageKey("create", menuId);
  const raw = sessionStorage.getItem(key);
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
  if (age < 0 || age > pendingShoppingCommandTtlMs) return false;
  if (parsed.data.command.mode !== "append") return false;
  sessionStorage.removeItem(key);
  return true;
}
