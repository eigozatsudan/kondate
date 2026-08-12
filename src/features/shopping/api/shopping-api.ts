import { z } from "zod";
import {
  createShoppingListResponseSchema,
  previewShoppingDiffResponseSchema,
  reconcileShoppingListResponseSchema,
  shoppingItemMutationRequestSchema,
  shoppingItemMutationResponseSchema,
  shoppingListSafetyDataSchema,
  shoppingListSchema,
  type CreateShoppingListRequest,
  type CreateShoppingListResponse,
  type ReconcileShoppingListRequest,
  type ReconcileShoppingListResponse,
  type ShoppingDiff,
  type ShoppingItemMutationRequest,
  type ShoppingItemMutationResponse,
  type ShoppingList,
  type ShoppingListSafetyData,
} from "@shared/contracts/shopping";
import { assertBrowserDataPlaneAligned, requireAccessToken } from "@/features/auth/session";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

const failureSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

function envelopeSchema<T>(data: z.ZodType<T>) {
  return z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), data }), failureSchema]);
}

async function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const client = getBrowserSupabaseClient();
  const token = await requireAccessToken(client);
  const response = await fetch(path, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const parsed = envelopeSchema(schema).safeParse(await response.json());
  if (!parsed.success) throw new Error("買い物リストの応答を確認できませんでした");
  if (!parsed.data.ok)
    throw Object.assign(new Error(parsed.data.error.message), {
      code: parsed.data.error.code,
    });
  return parsed.data.data;
}

const rowLabel = (row: {
  menu_label_confirmation_id: string | null;
  source_warning_key: string;
  source_menu_id_snapshot: string;
  source_derivation_group_id: string;
  source_type: string;
  source_id_snapshot: string;
  source_path: string;
  source_display_name: string;
  allergen_id: string;
  allergen_display_name: string;
  anonymous_member_ref: string;
  member_display_name: string;
  dictionary_version: string;
  confirmation_status: string;
}) => ({
  confirmationId: row.menu_label_confirmation_id,
  warningKey: row.source_warning_key,
  sourceMenuId: row.source_menu_id_snapshot,
  sourceDerivationGroupId: row.source_derivation_group_id,
  sourceType: row.source_type,
  sourceId: row.source_id_snapshot,
  sourcePath: row.source_path,
  sourceDisplayName: row.source_display_name,
  allergenId: row.allergen_id,
  allergenDisplayName: row.allergen_display_name,
  anonymousMemberRef: row.anonymous_member_ref,
  memberDisplayName: row.member_display_name,
  dictionaryVersion: row.dictionary_version,
  confirmationStatus: row.confirmation_status,
});

export async function fetchActiveShoppingList(): Promise<ShoppingList | null> {
  const client = getBrowserSupabaseClient();
  // R1: pin と client JWT の乖離時は PostgREST を走らせない（B の active list を A chrome で出さない）
  await assertBrowserDataPlaneAligned(client);
  const { data, error } = await client
    .from("shopping_lists")
    .select(
      `
    id,status,version,
    shopping_items(id,list_id,display_name,normalized_name,store_section,quantity_value,
      quantity_text,unit,pantry_check_required,is_checked,is_manual,is_manually_edited,
      is_removed_by_user,created_at,shopping_label_confirmations(*)),
    shopping_label_confirmations(*)
  `,
    )
    .eq("status", "active")
    // SP-I9: 店舗区画 → 作成順 → id で安定ソートし、チェック後の行ジャンプを防ぐ
    .order("store_section", { referencedTable: "shopping_items", ascending: true })
    .order("created_at", { referencedTable: "shopping_items", ascending: true })
    .order("id", { referencedTable: "shopping_items", ascending: true })
    .maybeSingle();
  if (error !== null) throw new Error("買い物リストを読み込めませんでした");
  if (data === null) return null;
  return shoppingListSchema.parse({
    id: data.id,
    status: data.status,
    version: data.version,
    items: data.shopping_items.map((item) => ({
      id: item.id,
      listId: item.list_id,
      displayName: item.display_name,
      normalizedName: item.normalized_name,
      storeSection: item.store_section,
      quantityValue: item.quantity_value,
      quantityText: item.quantity_text,
      unit: item.unit,
      pantryCheckRequired: item.pantry_check_required,
      isChecked: item.is_checked,
      isManual: item.is_manual,
      isManuallyEdited: item.is_manually_edited,
      isRemovedByUser: item.is_removed_by_user,
      labelWarnings: item.shopping_label_confirmations
        .filter((label) => label.item_id !== null)
        .map(rowLabel),
    })),
    listLabelWarnings: data.shopping_label_confirmations
      .filter((label) => label.item_id === null)
      .map(rowLabel),
  });
}

export const createShoppingList = (
  input: CreateShoppingListRequest,
): Promise<CreateShoppingListResponse> =>
  post("/api/shopping-lists/from-menu", input, createShoppingListResponseSchema);

export const reconcileShoppingListRequest = (
  listId: string,
  input: ReconcileShoppingListRequest,
): Promise<ReconcileShoppingListResponse> =>
  post(`/api/shopping-lists/${listId}/reconcile`, input, reconcileShoppingListResponseSchema);

export const previewShoppingDiff = (
  menuId: string,
  menuVersion: number,
  list: ShoppingList,
): Promise<ShoppingDiff> =>
  post(
    `/api/shopping-lists/${list.id}/preview`,
    {
      sourceMenuId: menuId,
      sourceMenuVersion: menuVersion,
      expectedListVersion: list.version,
    },
    previewShoppingDiffResponseSchema,
  );

export const revalidateActiveShoppingList = (listId: string): Promise<ShoppingListSafetyData> =>
  post(`/api/shopping-lists/${listId}/revalidate`, {}, shoppingListSafetyDataSchema);

export async function mutateShoppingItem(
  input: ShoppingItemMutationRequest,
): Promise<ShoppingItemMutationResponse> {
  const parsed = shoppingItemMutationRequestSchema.parse(input);
  const client = getBrowserSupabaseClient();
  // R1: pin と client JWT 乖離時は auth.uid() スコープの mutate RPC を B として走らせない
  await assertBrowserDataPlaneAligned(client);
  const args = {
    p_list_id: parsed.listId,
    p_expected_list_version: parsed.expectedListVersion,
    p_expected_safety_fingerprint: parsed.expectedSafetyFingerprint,
    p_operation: parsed.operation,
    // 生成型は p_item_id を非 null な uuid として出力するが、SQL 側の
    // p_item_id uuid は nullable で、add_manual は必ず null を送る。
    // Zod で検証済みの値を実シグネチャへ合わせるための限定的な型合わせ。
    p_item_id: parsed.itemId as string,
    p_idempotency_key: parsed.idempotencyKey,
    p_payload: parsed.payload,
  };
  const { data, error } = await client.rpc("mutate_shopping_item", args);
  if (error !== null) {
    if (error.message.includes("list_version_conflict")) {
      throw Object.assign(new Error("買い物リストが更新されました"), {
        code: "list_version_conflict",
      });
    }
    if (error.message.includes("idempotency_payload_mismatch")) {
      throw Object.assign(new Error("前回と異なる内容で再送できません"), {
        code: "idempotency_payload_mismatch",
      });
    }
    if (error.message.includes("shopping_safety_fingerprint_changed")) {
      throw Object.assign(new Error("家族設定が変わりました"), {
        code: "shopping_safety_fingerprint_changed",
      });
    }
    throw new Error("買い物項目を更新できませんでした");
  }
  return shoppingItemMutationResponseSchema.parse(data);
}

/**
 * 送信済みだがレスポンスを取り逃した create / reconcile を、同じ idempotency key で
 * 自動再送するための保存領域。24時間を超えた記録・時計が巻き戻った記録・壊れた記録は
 * 送信前に必ず捨てる。
 *
 * SHOP3: localStorage が跨タブ正本（item mutate の SHOP4 と同型）。sessionStorage は
 * 同一タブ mirror / 旧クライアント残滓。Tab B が session 空のまま新 key を mint して
 * mode=new 二重作成する窓を閉じる。
 */
export const pendingShoppingCommandStorageKey = (kind: "create" | "reconcile", targetId: string) =>
  `kondate:shopping:${kind}:${targetId}`;
export const pendingShoppingCommandTtlMs = 24 * 60 * 60 * 1_000;
export const pendingShoppingCommandEnvelopeSchema = <T>(schema: z.ZodType<T>) =>
  z
    .object({
      createdAtMs: z.number().int().nonnegative(),
      command: schema,
    })
    .strict();

function writeStorageBestEffort(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* Quota / private mode — 他方の Storage に委ねる */
  }
}

function removeStorageBestEffort(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* 掃除失敗は残差として許容（auth-cleanup が後で拾う） */
  }
}

/** 単一 Storage から TTL 内 create/reconcile command を読む。不正・期限切れは捨てる。 */
function readPendingShoppingCommandFrom<T>(
  storage: Storage,
  key: string,
  schema: z.ZodType<T>,
): T | null {
  let saved: string | null;
  try {
    saved = storage.getItem(key);
  } catch {
    return null;
  }
  if (saved === null) return null;
  try {
    const parsed = pendingShoppingCommandEnvelopeSchema(schema).safeParse(JSON.parse(saved));
    if (parsed.success) {
      const age = Date.now() - parsed.data.createdAtMs;
      if (age >= 0 && age <= pendingShoppingCommandTtlMs) return parsed.data.command;
    }
  } catch {
    /* 下の removeItem で捨てる */
  }
  removeStorageBestEffort(storage, key);
  return null;
}

/**
 * create/reconcile sticky を local→session の順で読む。
 * local 命中時は session へ mirror、session のみ命中時は local へ promote（SHOP3）。
 */
export function readPendingShoppingCommand<T>(
  kind: "create" | "reconcile",
  targetId: string,
  schema: z.ZodType<T>,
): T | null {
  const key = pendingShoppingCommandStorageKey(kind, targetId);
  const fromLocal = readPendingShoppingCommandFrom(localStorage, key, schema);
  if (fromLocal !== null) {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) writeStorageBestEffort(sessionStorage, key, raw);
    } catch {
      /* mirror optional */
    }
    return fromLocal;
  }
  const fromSession = readPendingShoppingCommandFrom(sessionStorage, key, schema);
  if (fromSession !== null) {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw !== null) writeStorageBestEffort(localStorage, key, raw);
    } catch {
      /* promote optional */
    }
    return fromSession;
  }
  return null;
}

function writePendingShoppingCommandEnvelope(key: string, command: unknown): void {
  const payload = JSON.stringify({ createdAtMs: Date.now(), command });
  writeStorageBestEffort(localStorage, key, payload);
  writeStorageBestEffort(sessionStorage, key, payload);
}

/**
 * SHOP9: reconcile sticky / suppress の targetId は listId だけでは足りない。
 * sourceMenuId を混ぜ、MenuA の pending が MenuB 詳細から resume/clobber されない粒度にする。
 */
export function reconcileCommandTargetId(listId: string, sourceMenuId: string): string {
  return `${listId}:${sourceMenuId}`;
}

/** Web Locks 名: create/reconcile sticky mint をタブ間で直列化する（SHOP2）。 */
export const pendingShoppingCommandClaimLockName = (
  kind: "create" | "reconcile",
  targetId: string,
) => `kondate:shopping:command-claim:${kind}:${targetId}`;

/**
 * SHOP1: create sheet 再送で sticky を再利用するか。
 * mode だけを照合する。activeListId / expectedListVersion は適用成功で必ず進むため
 * 不一致だけで key を捨てると、適用済み+応答ロスト後の手動 sheet 再送が新 UUID になり
 * mode=new は active archive→第二リスト（dual-create / 進捗 wipe）に倒れる。
 * 同一 body+key を server early-replay / findMutationReplay に当てる。
 * ユーザーが mode を選び直したときだけ false → rebuild（SHOP6）。
 */
export function isCreateShoppingStickyReusable(
  saved: CreateShoppingListRequest,
  intent: Pick<CreateShoppingListRequest, "mode">,
): boolean {
  return saved.mode === intent.mode;
}

/**
 * SHOP1: reconcile sheet 再送で sticky を再利用するか。
 * expectedListVersion は適用で進むため照合しない（version 不一致だけで key 破棄しない）。
 * approval / source が変わったときだけ false → rebuild（SHOP6）。
 */
export function isReconcileShoppingStickyReusable(
  saved: ReconcileShoppingListRequest,
  intent: Pick<ReconcileShoppingListRequest, "sourceMenuId" | "sourceMenuVersion" | "approval">,
): boolean {
  const sorted = (xs: readonly string[]) => [...xs].toSorted();
  return (
    saved.sourceMenuId === intent.sourceMenuId &&
    saved.sourceMenuVersion === intent.sourceMenuVersion &&
    JSON.stringify({
      addKeys: sorted(saved.approval.addKeys),
      replaceItemIds: sorted(saved.approval.replaceItemIds),
      removeItemIds: sorted(saved.approval.removeItemIds),
    }) ===
      JSON.stringify({
        addKeys: sorted(intent.approval.addKeys),
        replaceItemIds: sorted(intent.approval.replaceItemIds),
        removeItemIds: sorted(intent.approval.removeItemIds),
      })
  );
}

/**
 * create/reconcile sticky の読取→mint→書込。
 * mode / approval などユーザーがシートで選び直した意図と一致しない sticky は
 * 破棄して rebuild する（同一 targetId でも誤 mode 再送を防ぐ）。
 * version 不一致だけでは捨てないこと（isCreate/ReconcileShoppingStickyReusable を参照）。
 * isReusable 省略時は TTL 内なら常に再利用（resume 経路向け）。
 */
export function persistedShoppingCommand<T>(
  kind: "create" | "reconcile",
  targetId: string,
  schema: z.ZodType<T>,
  build: (idempotencyKey: string) => T,
  isReusable?: (saved: T) => boolean,
): T {
  const key = pendingShoppingCommandStorageKey(kind, targetId);
  const saved = readPendingShoppingCommand(kind, targetId, schema);
  if (saved !== null) {
    // 互換判定が無い（resume）か、意図が一致するときだけ sticky を返す
    if (isReusable === undefined || isReusable(saved)) return saved;
    // 意図不一致: 両 Storage から捨てて rebuild
    removeStorageBestEffort(localStorage, key);
    removeStorageBestEffort(sessionStorage, key);
  }
  const command = schema.parse(build(crypto.randomUUID()));
  writePendingShoppingCommandEnvelope(key, command);
  // SHOP2: 書込後 re-read。Locks 無し競合で他タブが先勝ちした場合は共有 sticky を優先する。
  const again = readPendingShoppingCommand(kind, targetId, schema);
  if (again !== null && (isReusable === undefined || isReusable(again))) {
    return again;
  }
  return command;
}

/**
 * SHOP2: create/reconcile の sticky 読取→mint→書込を Web Locks で直列化し、
 * 両タブが sticky 空で同時に別 UUID を mint する pre-write TOCTOU を閉じる。
 * ロック保持は mint のみ（ネットワーク送信は外）。Locks 非対応は write-then-reread にフォールバック。
 */
export async function claimShoppingCommand<T>(
  kind: "create" | "reconcile",
  targetId: string,
  schema: z.ZodType<T>,
  build: (idempotencyKey: string) => T,
  isReusable?: (saved: T) => boolean,
): Promise<T> {
  const run = (): T => persistedShoppingCommand(kind, targetId, schema, build, isReusable);
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (locks !== undefined && typeof locks.request === "function") {
    return locks.request(pendingShoppingCommandClaimLockName(kind, targetId), () => run());
  }
  return run();
}

export const clearShoppingCommand = (kind: "create" | "reconcile", targetId: string) => {
  const key = pendingShoppingCommandStorageKey(kind, targetId);
  removeStorageBestEffort(localStorage, key);
  removeStorageBestEffort(sessionStorage, key);
};

/**
 * SHOP2 + SHOP4: item mutate の失応答 sticky（24h TTL・成功時 clear）。
 * localStorage に書き同一 origin の他タブと共有し multi-tab dual add_manual を防ぐ
 * （sessionStorage だけだと Tab B が新 UUID を mint する）。sessionStorage にも
 * ミラーし、旧クライアント残滓の読取と同一タブ reload を維持する。
 * in-memory ref だけでは消える残窓を閉じる。
 *
 * SHOP2 (adversarial multi-intent): list あたり **intentKey 単位の multi-slot**。
 * 旧 single-slot は異 intent claim が既存 sticky を上書きし、適用済み add_manual の
 * 再試行が新 UUID → dual-add になっていた。v2 store は intent ごとに upsert し、
 * 他 intent を clobber しない。legacy 単一 envelope も読取時に v2 へ昇格する。
 */
export const pendingItemMutationStorageKey = (listId: string) =>
  `kondate:shopping:item-mutate:${listId}`;

/** Web Locks 名: 同一 list の sticky mint をタブ間で直列化する（SHOP6）。 */
export const pendingItemMutationClaimLockName = (listId: string) =>
  `kondate:shopping:item-mutate-claim:${listId}`;

/** list あたり同時保持する intent slot 上限（異常蓄積の fail-safe）。 */
const maxPendingItemMutationSlots = 16;

const pendingItemMutationEntrySchema = z
  .object({
    createdAtMs: z.number().int().nonnegative(),
    intentKey: z.string().min(1),
    request: shoppingItemMutationRequestSchema,
  })
  .strict();

const pendingItemMutationStoreV2Schema = z
  .object({
    v: z.literal(2),
    entries: z.array(pendingItemMutationEntrySchema),
  })
  .strict();

type PendingItemMutationEntry = z.infer<typeof pendingItemMutationEntrySchema>;

export type PendingItemMutationSticky = {
  intentKey: string;
  request: ShoppingItemMutationRequest;
};

function isEntryWithinTtl(entry: PendingItemMutationEntry, nowMs: number): boolean {
  const age = nowMs - entry.createdAtMs;
  return age >= 0 && age <= pendingShoppingCommandTtlMs;
}

/**
 * Storage 生 JSON を v2 entries に正規化する。
 * legacy 単一 envelope（{createdAtMs,intentKey,request}）も 1 slot として受理する。
 * 不正・全期限切れは null（呼び出し側が当該 Storage を捨てる）。
 */
function parsePendingItemMutationEntries(
  raw: string,
  nowMs: number = Date.now(),
): PendingItemMutationEntry[] | null {
  try {
    const json: unknown = JSON.parse(raw);
    const v2 = pendingItemMutationStoreV2Schema.safeParse(json);
    if (v2.success) {
      const live = v2.data.entries.filter((entry) => isEntryWithinTtl(entry, nowMs));
      // 空配列は「正当な空 store」ではなく期限切れ扱い（キー削除）
      return live.length > 0 ? live : null;
    }
    const legacy = pendingItemMutationEntrySchema.safeParse(json);
    if (legacy.success && isEntryWithinTtl(legacy.data, nowMs)) {
      return [legacy.data];
    }
  } catch {
    /* corrupt */
  }
  return null;
}

function serializePendingItemMutationStore(entries: PendingItemMutationEntry[]): string {
  return JSON.stringify({ v: 2 as const, entries });
}

/** 単一 Storage から TTL 内 entries を読む。不正・期限切れは当該 Storage から捨てる。 */
function readPendingItemMutationEntriesFrom(
  storage: Storage,
  key: string,
): PendingItemMutationEntry[] | null {
  let saved: string | null;
  try {
    saved = storage.getItem(key);
  } catch {
    return null;
  }
  if (saved === null) return null;
  const entries = parsePendingItemMutationEntries(saved);
  if (entries === null) {
    removeStorageBestEffort(storage, key);
    return null;
  }
  return entries;
}

function readAllPendingItemMutationEntries(listId: string): PendingItemMutationEntry[] {
  const key = pendingItemMutationStorageKey(listId);
  // 共有正本は localStorage。他タブが書いた鍵を先に拾う（SHOP4）。
  const fromLocal = readPendingItemMutationEntriesFrom(localStorage, key);
  if (fromLocal !== null) {
    try {
      // v2 正規化済みを両 Storage に書き戻し（legacy 昇格・期限切れ刈り込み）
      const payload = serializePendingItemMutationStore(fromLocal);
      writeStorageBestEffort(localStorage, key, payload);
      writeStorageBestEffort(sessionStorage, key, payload);
    } catch {
      /* mirror optional */
    }
    return fromLocal;
  }
  const fromSession = readPendingItemMutationEntriesFrom(sessionStorage, key);
  if (fromSession !== null) {
    try {
      const payload = serializePendingItemMutationStore(fromSession);
      writeStorageBestEffort(localStorage, key, payload);
      writeStorageBestEffort(sessionStorage, key, payload);
    } catch {
      /* promote optional */
    }
    return fromSession;
  }
  return [];
}

function writeAllPendingItemMutationEntries(
  listId: string,
  entries: PendingItemMutationEntry[],
): void {
  const key = pendingItemMutationStorageKey(listId);
  if (entries.length === 0) {
    removeStorageBestEffort(localStorage, key);
    removeStorageBestEffort(sessionStorage, key);
    return;
  }
  const payload = serializePendingItemMutationStore(entries);
  writeStorageBestEffort(localStorage, key, payload);
  writeStorageBestEffort(sessionStorage, key, payload);
}

/**
 * list の sticky を読む。
 * - intentKey 指定: その intent の slot（無ければ null）
 * - 省略: 先頭の live entry（単一 slot 時代のテスト互換。multi 時は任意の 1 件）
 */
export function readPendingItemMutation(
  listId: string,
  intentKey?: string,
): PendingItemMutationSticky | null {
  const entries = readAllPendingItemMutationEntries(listId);
  const hit =
    intentKey === undefined
      ? (entries[0] ?? null)
      : (entries.find((entry) => entry.intentKey === intentKey) ?? null);
  if (hit === null) return null;
  return { intentKey: hit.intentKey, request: hit.request };
}

/**
 * 同一 list の multi-slot RMW（mint / write / clear）を Web Locks で直列化する。
 * SHOP1: clear/write を unlocked のままにすると異 intent 同士の last-writer-wins で
 * 成功 clear 済み slot が復活し、適用済み key 再利用 → under-add になる。
 * Locks 非対応は同期 RMW のまま（同一タブ内は atomic、跨タブは best-effort）。
 */
async function withPendingItemMutationClaimLock<T>(listId: string, run: () => T): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (locks !== undefined && typeof locks.request === "function") {
    // callback は Lock 引数を無視（臨界区間だけを直列化）
    return locks.request(pendingItemMutationClaimLockName(listId), () => run());
  }
  return run();
}

/**
 * intentKey 単位で upsert（ロック外本体）。claim / locked write から呼ぶ。
 * 他 intent の slot は残す（SHOP2 multi-slot）。
 * slot 上限超過時は **書き込み対象以外** の最古 entry を落とす。
 */
function writePendingItemMutationUnlocked(
  listId: string,
  sticky: PendingItemMutationSticky,
): void {
  const nowMs = Date.now();
  const existing = readAllPendingItemMutationEntries(listId).filter(
    (entry) => entry.intentKey !== sticky.intentKey,
  );
  const next: PendingItemMutationEntry[] = [
    ...existing,
    {
      createdAtMs: nowMs,
      intentKey: sticky.intentKey,
      request: sticky.request,
    },
  ];
  // 上限: 最古から落とす（いま書いた intent は残す）
  next.sort((a, b) => a.createdAtMs - b.createdAtMs);
  while (next.length > maxPendingItemMutationSlots) {
    const dropIndex = next.findIndex((entry) => entry.intentKey !== sticky.intentKey);
    if (dropIndex < 0) break;
    next.splice(dropIndex, 1);
  }
  writeAllPendingItemMutationEntries(listId, next);
}

/** intent 単位 clear のロック外本体。intentKey 省略時は list 全 slot。 */
function clearPendingItemMutationUnlocked(listId: string, intentKey?: string): void {
  if (intentKey === undefined) {
    const key = pendingItemMutationStorageKey(listId);
    removeStorageBestEffort(localStorage, key);
    removeStorageBestEffort(sessionStorage, key);
    return;
  }
  const remaining = readAllPendingItemMutationEntries(listId).filter(
    (entry) => entry.intentKey !== intentKey,
  );
  writeAllPendingItemMutationEntries(listId, remaining);
}

/**
 * intentKey 単位で upsert。他 intent の slot は残す（SHOP2 multi-slot）。
 * SHOP1: claim と同じ list スコープ lock で RMW を直列化し、異 intent clear との
 * 交差 last-writer-wins（復活 / 必要 key 消失）を閉じる。
 */
export async function writePendingItemMutation(
  listId: string,
  sticky: PendingItemMutationSticky,
): Promise<void> {
  await withPendingItemMutationClaimLock(listId, () => {
    writePendingItemMutationUnlocked(listId, sticky);
  });
}

/**
 * intentKey 省略時は list 全 slot を捨てる。指定時はその intent だけ。
 * SHOP1: write と同じ claim lock 下で filter→write し multi-tab 交差 RMW を直列化。
 */
export async function clearPendingItemMutation(listId: string, intentKey?: string): Promise<void> {
  await withPendingItemMutationClaimLock(listId, () => {
    clearPendingItemMutationUnlocked(listId, intentKey);
  });
}

/**
 * SHOP6 + SHOP2 + SHOP1: 同一 list の sticky 読取→mint→書込を Web Locks で直列化し、
 * 両タブが sticky 未書込で同時に新 UUID を mint する pre-write TOCTOU を閉じる。
 * ロック保持は mint のみ（ネットワーク送信は外）で intentional 再 add の新 key は維持。
 * Locks 非対応環境は書込後 re-read にフォールバック（同一 intent の勝者 key を優先）。
 * 異 intent は別 slot に共存し、互いの idempotency key を上書きしない（SHOP2）。
 * write/clear も同一 lock 名を共有するため、mint 中に異 intent の clear が割り込まない。
 */
export async function claimItemMutationSticky(
  listId: string,
  intentKey: string,
  buildNew: () => ShoppingItemMutationRequest,
): Promise<PendingItemMutationSticky> {
  return withPendingItemMutationClaimLock(listId, () => {
    const existing = readPendingItemMutation(listId, intentKey);
    if (existing !== null && existing.request.listId === listId) {
      return existing;
    }
    const request = buildNew();
    const sticky: PendingItemMutationSticky = { intentKey, request };
    // 既に claim lock 内なので unlocked 本体を使う（再帰 request で deadlock しない）
    writePendingItemMutationUnlocked(listId, sticky);
    // ロック無し競合や書込失敗時: 同一 intent が既に他タブで勝っていればそちらを使う
    const again = readPendingItemMutation(listId, intentKey);
    if (again !== null && again.request.listId === listId) {
      return again;
    }
    return sticky;
  });
}

/**
 * SHOP1 (adversarial): FP rebuild → idempotency_payload_mismatch → form abandon のあと、
 * 利用者が同内容を手動再入力すると新 UUID で dual-add する窓を縮退する。
 * サーバ content 冪等や RLS/idempotency ロックは触らず、同一 intentKey の再送を
 * **1 回目は確認ブロック・2 回目で許可**するクライアント DiD。
 * sticky TTL と同窓（24h）。
 * SHOP3 (adversarial 869bbe94): localStorage を multi-tab 正本にし（item sticky と同型）、
 * 他タブでの mismatch abandon 後 dual-add を縮退。session は mirror / legacy 昇格用。
 * 意図的 2 回目 re-add（armed 消費）は維持。content サーバ冪等は product 非対象。
 */
export const itemMutationMismatchGuardStorageKey = (listId: string) =>
  `kondate:shopping:item-mismatch-guard:v1:${listId}`;

const itemMutationMismatchGuardEntrySchema = z
  .object({
    intentKey: z.string().min(1),
    /** pending = 未確認 / armed = 警告表示済みで次送信を許可 */
    state: z.enum(["pending", "armed"]),
    atMs: z.number().int().nonnegative(),
  })
  .strict();

const itemMutationMismatchGuardStoreSchema = z
  .object({
    v: z.literal(1),
    entries: z.array(itemMutationMismatchGuardEntrySchema),
  })
  .strict();

type ItemMutationMismatchGuardEntry = z.infer<typeof itemMutationMismatchGuardEntrySchema>;

/**
 * 単一 Storage から TTL 内 guard entries を読む。
 * 不正・全期限切れは当該 Storage から捨て null（キー無しと区別）。
 */
function readMismatchGuardEntriesFrom(
  storage: Storage,
  key: string,
  nowMs: number,
): ItemMutationMismatchGuardEntry[] | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = itemMutationMismatchGuardStoreSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      removeStorageBestEffort(storage, key);
      return null;
    }
    const live = parsed.data.entries.filter((entry) => {
      const age = nowMs - entry.atMs;
      return age >= 0 && age <= pendingShoppingCommandTtlMs;
    });
    if (live.length === 0) {
      removeStorageBestEffort(storage, key);
      return null;
    }
    return live;
  } catch {
    removeStorageBestEffort(storage, key);
    return null;
  }
}

function readMismatchGuardEntries(listId: string, nowMs: number): ItemMutationMismatchGuardEntry[] {
  const key = itemMutationMismatchGuardStorageKey(listId);
  // 共有正本は localStorage（SHOP3 multi-tab）。他タブ mark を先に拾う。
  const fromLocal = readMismatchGuardEntriesFrom(localStorage, key, nowMs);
  if (fromLocal !== null) {
    try {
      const payload = JSON.stringify({ v: 1 as const, entries: fromLocal });
      writeStorageBestEffort(localStorage, key, payload);
      writeStorageBestEffort(sessionStorage, key, payload);
    } catch {
      /* mirror optional */
    }
    return fromLocal;
  }
  // legacy session-only → local へ昇格（旧クライアント残滓 / 同一タブ）
  const fromSession = readMismatchGuardEntriesFrom(sessionStorage, key, nowMs);
  if (fromSession !== null) {
    try {
      const payload = JSON.stringify({ v: 1 as const, entries: fromSession });
      writeStorageBestEffort(localStorage, key, payload);
      writeStorageBestEffort(sessionStorage, key, payload);
    } catch {
      /* promote optional */
    }
    return fromSession;
  }
  return [];
}

function writeMismatchGuardEntries(
  listId: string,
  entries: ItemMutationMismatchGuardEntry[],
): void {
  const key = itemMutationMismatchGuardStorageKey(listId);
  if (entries.length === 0) {
    removeStorageBestEffort(localStorage, key);
    removeStorageBestEffort(sessionStorage, key);
    return;
  }
  const payload = JSON.stringify({ v: 1 as const, entries });
  writeStorageBestEffort(localStorage, key, payload);
  writeStorageBestEffort(sessionStorage, key, payload);
}

/** mismatch abandon 直後に呼ぶ。同一 intent の次 1 回を確認ブロック対象にする。 */
export function markItemMutationMismatchGuard(listId: string, intentKey: string): void {
  const nowMs = Date.now();
  const others = readMismatchGuardEntries(listId, nowMs).filter(
    (entry) => entry.intentKey !== intentKey,
  );
  writeMismatchGuardEntries(listId, [...others, { intentKey, state: "pending", atMs: nowMs }]);
}

/**
 * add_manual 再送前に呼ぶ。
 * @returns true のとき送信を止める（pending→armed へ進め警告を出す）。
 *          false のとき送信してよい（ガード無し、または armed を消費して解除）。
 */
export function shouldBlockItemMutationAfterMismatch(listId: string, intentKey: string): boolean {
  const nowMs = Date.now();
  const entries = readMismatchGuardEntries(listId, nowMs);
  const hit = entries.find((entry) => entry.intentKey === intentKey);
  if (hit === undefined) return false;
  if (hit.state === "pending") {
    writeMismatchGuardEntries(
      listId,
      entries.map((entry) =>
        entry.intentKey === intentKey ? { intentKey, state: "armed" as const, atMs: nowMs } : entry,
      ),
    );
    return true;
  }
  // armed: 2 回目は許可しガードを外す（意図的な再追加）
  writeMismatchGuardEntries(
    listId,
    entries.filter((entry) => entry.intentKey !== intentKey),
  );
  return false;
}

/** テスト・成功後掃除用 */
export function clearItemMutationMismatchGuard(listId: string, intentKey?: string): void {
  if (intentKey === undefined) {
    const key = itemMutationMismatchGuardStorageKey(listId);
    removeStorageBestEffort(localStorage, key);
    removeStorageBestEffort(sessionStorage, key);
    return;
  }
  const nowMs = Date.now();
  writeMismatchGuardEntries(
    listId,
    readMismatchGuardEntries(listId, nowMs).filter((entry) => entry.intentKey !== intentKey),
  );
}

export type ReconcilableMenuSource = { sourceMenuId: string; sourceMenuVersion: number };

/**
 * 「使用中リストが同じ派生グループの古い版を取り込んでいる」判定。
 * 保存済みの警告 provenance ではなく、リストの取り込み元（shopping_list_sources）と
 * 献立の現在の版だけで決める。
 */
export async function fetchReconcilableMenuSource(
  menuId: string,
  listId: string,
): Promise<ReconcilableMenuSource | null> {
  const client = getBrowserSupabaseClient();
  // R1: pin 乖離時は menus / shopping_list_sources を B の JWT で読まない
  await assertBrowserDataPlaneAligned(client);
  const menu = await client
    .from("menus")
    .select("id,derivation_group_id,version")
    .eq("id", menuId)
    // Task 5 のHTTP/DB拒否（idea献立からの買い物リスト利用は不可）に対する
    // 防御層。サーバー側の拒否が万一漏れても、このクライアント側クエリでも
    // idea献立を読み込めなくする（fail closed）。
    .eq("target_mode", "household")
    .maybeSingle();
  if (menu.error !== null) throw new Error("献立を確認できませんでした");
  const menuRow = menu.data;
  if (menuRow === null) return null;
  const sources = await client
    .from("shopping_list_sources")
    .select("source_derivation_group_id,source_menu_version")
    .eq("list_id", listId);
  if (sources.error !== null) throw new Error("買い物リストの取り込み元を確認できませんでした");
  // U5-001: 「古い版がある」だけでは足りない。成功 reconcile 後も V1+V2 が残るため、
  // 同グループに登録済みの最大版が現在献立版未満のときだけ差分 CTA を出す。
  // （現在版が既に sources にあれば null → 再適用 409 ループを防ぐ）
  const sameGroupVersions = sources.data
    .filter((source) => source.source_derivation_group_id === menuRow.derivation_group_id)
    .map((source) => source.source_menu_version);
  if (sameGroupVersions.length === 0) return null;
  const maxRegisteredVersion = Math.max(...sameGroupVersions);
  if (maxRegisteredVersion >= menuRow.version) return null;
  return { sourceMenuId: menuRow.id, sourceMenuVersion: menuRow.version };
}
