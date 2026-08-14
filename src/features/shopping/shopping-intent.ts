import { createShoppingListRequestSchema } from "@shared/contracts/shopping";
import { clearShoppingCommand, readPendingShoppingCommand } from "./api/shopping-api";

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
 * resume 優先: 有効な create envelope が local/session にあるか（SHOP3 跨タブ正本）。
 * 壊れた JSON・Zod 不一致・TTL 超過・時計巻き戻しは false（未検査 cast なし）。
 */
export function hasPendingCreateCommand(menuId: string): boolean {
  return readPendingShoppingCommand("create", menuId, createShoppingListRequestSchema) !== null;
}

/**
 * SHOP6 + SHOP3: create/reconcile シートを開いているあいだ resume を止める印。
 * React の shoppingSheet は remount で消えるが Storage は残るため、
 * モード/approval 選び直し中のハードリロードで旧 sticky が自動 POST される窓を閉じる。
 * localStorage 正本で他タブにも suppress を共有し、Tab A シート表示中に Tab B が
 * auto-resume する dual-intent 窓を閉じる（item sticky SHOP4 と同型）。
 * Cancel / 成功 / code 付き fail / menu-detail 真 unmount（SHOP1 遅延 clear）で明示 clear
 * → sticky は残したまま resume 再送を再開できる（pause-not-abandon）。
 */
export function shoppingResumeSuppressKey(kind: "create" | "reconcile", targetId: string): string {
  return `kondate:shopping:resume-suppress:v1:${kind}:${targetId}`;
}

function readResumeSuppressFlag(storage: Storage, key: string): boolean {
  try {
    return storage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeResumeSuppressFlag(storage: Storage, key: string, present: boolean): void {
  try {
    if (present) storage.setItem(key, "1");
    else storage.removeItem(key);
  } catch {
    /* Quota / private mode */
  }
}

export function isShoppingResumeSuppressed(
  kind: "create" | "reconcile",
  targetId: string,
): boolean {
  const key = shoppingResumeSuppressKey(kind, targetId);
  // local 正本: 他タブの sheet open を共有。session は同一タブ mirror / 旧残滓。
  // session→local の promote はしない（他タブが clear したあとに session 残滓で
  // suppress が永久に残る窓を作るため）。
  if (readResumeSuppressFlag(localStorage, key)) return true;
  return readResumeSuppressFlag(sessionStorage, key);
}

export function markShoppingResumeSuppress(kind: "create" | "reconcile", targetId: string): void {
  const key = shoppingResumeSuppressKey(kind, targetId);
  writeResumeSuppressFlag(localStorage, key, true);
  writeResumeSuppressFlag(sessionStorage, key, true);
  // SHOP1: live タブが sheet / 意図的 suppress を持っている印。他タブの boot が
  // 共有 local 正本を落とさないよう occupancy lock を保持する（タブ死亡で自動解放）。
  holdShoppingSheetOccupancy(kind, targetId);
}

export function clearShoppingResumeSuppress(kind: "create" | "reconcile", targetId: string): void {
  const key = shoppingResumeSuppressKey(kind, targetId);
  writeResumeSuppressFlag(localStorage, key, false);
  writeResumeSuppressFlag(sessionStorage, key, false);
  releaseShoppingSheetOccupancy(kind, targetId);
}

/**
 * SHOP2 (adversarial): hard reload / クラッシュでは React unmount の
 * scheduleResumeSuppressClear が走らず、local/session の resume-suppress と
 * 失応答 sticky が同居したまま auto-resume が 24h TTL まで凍る。
 * document（performance.timeOrigin）あたり target 1 回だけ suppress を落とす。
 * - SPA remount / StrictMode: 同一 timeOrigin なので 2 回目以降は no-op（シート選び直し中の suppress を壊さない）
 * - hard reload: 新しい JS 文脈 + 新しい timeOrigin で clear が再武装
 * - シート open 中の mount では呼び出し側が shoppingSheet を見て skip すること
 * - SHOP1: 他タブが occupancy lock を live 保持しているときは共有 local を落とさない
 *   （自タブ sheet=null の hard reload が Tab A の選び直し中 suppress を消す dual-intent 窓）
 * - current_safety 等の意図的 suppress も reload 後は 1 回 resume を試し、再 409 なら
 *   failShoppingCommand が再 mark する（永久 pause より復旧優先）
 * sticky 本体は触らない（pause-not-abandon の鍵は維持）。
 */
const resumeSuppressDocumentBootTokens = new Map<string, number>();

function resumeSuppressDocumentBootKey(kind: "create" | "reconcile", targetId: string): string {
  return `${kind}:${targetId}`;
}

function documentTimeOriginMs(): number {
  if (typeof performance !== "undefined" && typeof performance.timeOrigin === "number") {
    return performance.timeOrigin;
  }
  return 0;
}

/** SHOP1: 他タブが sheet / 意図的 suppress を live 保持しているあいだ boot が共有旗を落とさない lock */
export function shoppingSheetOccupancyLockName(
  kind: "create" | "reconcile",
  targetId: string,
): string {
  return `kondate:shopping:sheet-occupancy:${kind}:${targetId}`;
}

const occupancyHeldUntil = new Map<string, () => void>();

function holdShoppingSheetOccupancy(kind: "create" | "reconcile", targetId: string): void {
  const mapKey = resumeSuppressDocumentBootKey(kind, targetId);
  if (occupancyHeldUntil.has(mapKey)) return;
  let release = (): void => {};
  const untilReleased = new Promise<void>((resolve) => {
    release = resolve;
  });
  occupancyHeldUntil.set(mapKey, release);
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (locks === undefined || typeof locks.request !== "function") return;
  void locks
    .request(shoppingSheetOccupancyLockName(kind, targetId), () => untilReleased)
    .catch(() => {
      /* 保持失敗は Storage 旗のみ。boot は lock 無しなら orphan として落とす */
    });
}

function releaseShoppingSheetOccupancy(kind: "create" | "reconcile", targetId: string): void {
  const mapKey = resumeSuppressDocumentBootKey(kind, targetId);
  const release = occupancyHeldUntil.get(mapKey);
  if (release === undefined) return;
  occupancyHeldUntil.delete(mapKey);
  release();
}

async function isShoppingSheetOccupiedByLivePeer(
  kind: "create" | "reconcile",
  targetId: string,
): Promise<boolean> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (locks === undefined || typeof locks.request !== "function") return false;
  const name = shoppingSheetOccupancyLockName(kind, targetId);
  try {
    return await new Promise<boolean>((resolve, reject) => {
      void Promise.resolve(
        locks.request(name, { ifAvailable: true }, (lock) => {
          resolve(lock === null);
        }),
      ).catch(reject);
    });
  } catch {
    return false;
  }
}

/**
 * @returns true のとき実際に suppress を clear した
 */
export async function clearResumeSuppressOnDocumentBoot(
  kind: "create" | "reconcile",
  targetId: string,
): Promise<boolean> {
  const token = documentTimeOriginMs();
  const mapKey = resumeSuppressDocumentBootKey(kind, targetId);
  if (resumeSuppressDocumentBootTokens.get(mapKey) === token) return false;
  // SHOP1: 他タブ（またはこのタブ）が occupancy を live 保持なら共有旗を残す。
  // token は消費しない。peer 離脱後の同一 document 再評価で orphan を落とせる。
  if (await isShoppingSheetOccupiedByLivePeer(kind, targetId)) return false;
  resumeSuppressDocumentBootTokens.set(mapKey, token);
  if (!isShoppingResumeSuppressed(kind, targetId)) return false;
  clearShoppingResumeSuppress(kind, targetId);
  return true;
}

/** テスト用: document boot トークンと occupancy 保持を捨て、同一 timeOrigin でも再 clear できるようにする */
export function resetResumeSuppressDocumentBootForTests(): void {
  resumeSuppressDocumentBootTokens.clear();
  for (const release of occupancyHeldUntil.values()) release();
  occupancyHeldUntil.clear();
}

/**
 * SHOP1: resume-suppress の unmount 遅延 clear（intent clear と同型）。
 * Cancel なし abandon-navigate で suppress が残り sticky 復旧が凍る穴を閉じる。
 * StrictMode remount では cancel が先に走り、シート選び直し中の suppress は残す（SHOP6）。
 * sticky 本体は触らない（pause-not-abandon）。
 */
const pendingResumeSuppressClears = new Map<string, ReturnType<typeof setTimeout>>();

function resumeSuppressClearMapKey(kind: "create" | "reconcile", targetId: string): string {
  return `${kind}:${targetId}`;
}

export function scheduleResumeSuppressClear(kind: "create" | "reconcile", targetId: string): void {
  cancelPendingResumeSuppressClear(kind, targetId);
  const mapKey = resumeSuppressClearMapKey(kind, targetId);
  const handle = setTimeout(() => {
    pendingResumeSuppressClears.delete(mapKey);
    clearShoppingResumeSuppress(kind, targetId);
  }, 0);
  pendingResumeSuppressClears.set(mapKey, handle);
}

export function cancelPendingResumeSuppressClear(
  kind: "create" | "reconcile",
  targetId: string,
): void {
  const mapKey = resumeSuppressClearMapKey(kind, targetId);
  const handle = pendingResumeSuppressClears.get(mapKey);
  if (handle === undefined) return;
  clearTimeout(handle);
  pendingResumeSuppressClears.delete(mapKey);
}

/**
 * SHOP2 + SHOP1: list gate が真に invalid/unverifiable（phase=blocked / error）のとき
 * create resume が enabled=false のため submitCreate 内の append clear が到達しない。
 * その遷移でのみ mode=append sticky を捨て、forceNew 誘導と ready 復帰後の旧 append
 * 自動再送を防ぐ。一時的な phase=checking（focus / Realtime hard recheck）では
 * 呼ばないこと — 呼ばれると失応答 append 復旧鍵を捨てる（SHOP1）。
 * mode=new は D-C1 どおり保持する。
 * @returns true のとき append sticky を捨てた
 */
export function discardAppendCreateCommandIfPresent(menuId: string): boolean {
  const command = readPendingShoppingCommand("create", menuId, createShoppingListRequestSchema);
  if (command === null) return false;
  if (command.mode !== "append") return false;
  clearShoppingCommand("create", menuId);
  return true;
}
