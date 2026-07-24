import type { SupabaseClient } from "@supabase/supabase-js";
// Database の公開入口は generated 直 import ではなく re-export 側を使う（既存 client と同一）。
import type { Database } from "@/shared/types/database";
import { householdSafetyRevisionStorageKey } from "@/features/household/household-queries";
import { clearOwnedAuthStorage } from "./auth-flow";

/**
 * ログアウト / アカウント削除成功後に端末側の認証・復帰データを消す。
 * Plan 1 の ownedAuthStoragePrefixes 経由の clearOwnedAuthStorage だけを使い、
 * 広義の sb- 規則や auth 接頭辞の二重定義はしない。
 * signOut が「既にサーバー上にユーザーがいない」等で失敗しても掃除は完了させる。
 */
export async function clearLocalAuthAndDrafts(client: SupabaseClient<Database>): Promise<void> {
  await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  for (const storage of [localStorage, sessionStorage]) {
    clearOwnedAuthStorage(storage);
    for (const key of Object.keys(storage)) {
      if (
        key.startsWith("kondate:generation:") ||
        key.startsWith("kondate:shopping:") ||
        key === householdSafetyRevisionStorageKey
      ) {
        storage.removeItem(key);
      }
    }
  }
}
