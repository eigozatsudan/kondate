import { z } from "zod";
import { isCurrentShareConsent, shareConsentVersion } from "@shared/contracts/share-consent";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";

/**
 * get_my_share_consent / upsert 応答の共通フィールド。
 * RPC は Json 戻りのため、ブラウザ側で Zod 検証してから使う。
 */
const shareConsentStateSchema = z
  .object({
    consent_version: z.string().nullable(),
    accepted_at: z.string().nullable(),
    revoked_at: z.string().nullable(),
  })
  .strict();

const upsertShareConsentResponseSchema = shareConsentStateSchema
  .extend({
    ok: z.literal(true),
  })
  .strict();

/**
 * list_my_shared_emergency_recipes の1件。
 * title + shared_on(date) のみ。recipe_id / source_menu_id は受け取らない。
 */
const sharedEmergencyRecipeListItemSchema = z
  .object({
    title: z.string(),
    // Postgres date → JSON は "YYYY-MM-DD"
    shared_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

const sharedEmergencyRecipeListSchema = z.array(sharedEmergencyRecipeListItemSchema);

export type ShareConsentState = z.infer<typeof shareConsentStateSchema>;
export type SharedEmergencyRecipeListItem = z.infer<typeof sharedEmergencyRecipeListItemSchema>;

/** AP5: timeout 時に in-flight RPC を abort するための任意 signal。 */
export type ShareConsentRpcOptions = {
  signal?: AbortSignal;
};

/**
 * supabase-js の rpc builder は thenable + abortSignal。
 * signal が無い既存呼び出しは引数形を変えない。
 */
async function awaitShareConsentRpc<T>(
  query: PromiseLike<T> & { abortSignal: (signal: AbortSignal) => PromiseLike<T> },
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) {
    return await query;
  }
  return await query.abortSignal(signal);
}

/** 本人の現行共有同意行を読む（未同意時は null フィールド）。 */
export async function getMyShareConsent(
  client: BrowserSupabaseClient,
  options?: ShareConsentRpcOptions,
): Promise<ShareConsentState> {
  const { data, error } = await awaitShareConsentRpc(
    client.rpc("get_my_share_consent"),
    options?.signal,
  );
  if (error !== null) throw new Error("共有の同意状態を読み込めませんでした");
  const parsed = shareConsentStateSchema.safeParse(data);
  if (!parsed.success) throw new Error("共有の同意状態を読み込めませんでした");
  return parsed.data;
}

/**
 * 共有同意の on/off。version は常に現行 shareConsentVersion を送る。
 * accept=true で再同意、false で revoke（設定トグルからも利用）。
 */
export async function upsertMyShareConsent(
  client: BrowserSupabaseClient,
  accept: boolean,
  options?: ShareConsentRpcOptions,
): Promise<ShareConsentState> {
  const { data, error } = await awaitShareConsentRpc(
    client.rpc("upsert_my_share_consent", {
      p_version: shareConsentVersion,
      p_accept: accept,
    }),
    options?.signal,
  );
  if (error !== null) throw new Error("共有の同意を保存できませんでした");
  const parsed = upsertShareConsentResponseSchema.safeParse(data);
  if (!parsed.success) throw new Error("共有の同意を保存できませんでした");
  return {
    consent_version: parsed.data.consent_version,
    accepted_at: parsed.data.accepted_at,
    revoked_at: parsed.data.revoked_at,
  };
}

/** 設定トグル off: 新規共有化を止める（既提供分は残る）。 */
export function revokeMyShareConsent(
  client: BrowserSupabaseClient,
  options?: ShareConsentRpcOptions,
): Promise<ShareConsentState> {
  return upsertMyShareConsent(client, false, options);
}

/** 設定トグル on: 現行 version で再同意する。 */
export function reacceptMyShareConsent(
  client: BrowserSupabaseClient,
  options?: ShareConsentRpcOptions,
): Promise<ShareConsentState> {
  return upsertMyShareConsent(client, true, options);
}

/**
 * 本人が提供済みの緊急候補一覧（title + shared_on のみ）。
 * id 相関に使えるフィールドは Zod で落とし、表示専用にする。
 */
export async function listMySharedEmergencyRecipes(
  client: BrowserSupabaseClient,
): Promise<SharedEmergencyRecipeListItem[]> {
  const { data, error } = await client.rpc("list_my_shared_emergency_recipes");
  if (error !== null) throw new Error("提供済みの一覧を読み込めませんでした");
  const parsed = sharedEmergencyRecipeListSchema.safeParse(data);
  if (!parsed.success) throw new Error("提供済みの一覧を読み込めませんでした");
  return parsed.data;
}

/** 現行版かつ未 revoke なら true（契約 isCurrentShareConsent と同じ判定）。 */
export function hasCurrentShareConsent(state: ShareConsentState | null): boolean {
  if (state === null || state.consent_version === null) return false;
  return isCurrentShareConsent({
    consent_version: state.consent_version,
    revoked_at: state.revoked_at,
  });
}
