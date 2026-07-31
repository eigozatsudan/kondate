import type { SupabaseClient } from "@supabase/supabase-js";
// Database の公開入口は generated 直 import ではなく re-export 側を使う（既存 client と同一）。
import type { Database } from "@/shared/types/database";
import { householdSafetyRevisionStorageKey } from "@/features/household/household-queries";
import { clearOwnedAuthStorage } from "./auth-flow";

export type ClearLocalAuthOptions = {
  /**
   * U1-003: 通常ログアウトは global で refresh を無効化し、
   * アカウント削除後などサーバー user が既に無い経路は local に落とす。
   * 既定は local（削除後 best-effort と後方互換）。
   */
  signOutScope?: "local" | "global";
};

/**
 * ログアウト / アカウント削除成功後に端末側の認証・復帰データを消す。
 * Plan 1 の ownedAuthStoragePrefixes 経由の clearOwnedAuthStorage だけを使い、
 * 広義の sb- 規則や auth 接頭辞の二重定義はしない。
 * signOut が「既にサーバー上にユーザーがいない」等で失敗しても掃除は完了させる。
 */
export async function clearLocalAuthAndDrafts(
  client: SupabaseClient<Database>,
  options: ClearLocalAuthOptions = {},
): Promise<void> {
  const scope = options.signOutScope ?? "local";
  // global が失敗しても local にフォールバックして端末掃除は完了させる
  if (scope === "global") {
    await client.auth
      .signOut({ scope: "global" })
      .catch(() => client.auth.signOut({ scope: "local" }).catch(() => undefined));
  } else {
    await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
  for (const storage of [localStorage, sessionStorage]) {
    clearOwnedAuthStorage(storage);
    for (const key of Object.keys(storage)) {
      if (
        key.startsWith("kondate:generation:") ||
        key.startsWith("kondate:shopping:") ||
        key === householdSafetyRevisionStorageKey ||
        // U4-003: user-scoped revision キーも掃除
        key.startsWith(`${householdSafetyRevisionStorageKey}:`)
      ) {
        storage.removeItem(key);
      }
    }
  }
}
