import type { SupabaseClient } from "@supabase/supabase-js";
// Database の公開入口は generated 直 import ではなく re-export 側を使う（既存 client と同一）。
import type { Database } from "@/shared/types/database";
import { householdSafetyRevisionStorageKey } from "@/features/household/household-queries";
import { withTimeout } from "./async-timeout";
import { clearOwnedAuthStorage } from "./auth-flow";

export type ClearLocalAuthOptions = {
  /**
   * 通常ログアウト・アカウント削除後は local（この端末のみ）。
   * 全端末の refresh を無効化したい経路だけ global を明示する。
   * global 失敗時は local にフォールバックする。
   */
  signOutScope?: "local" | "global";
};

/**
 * signOut の上限。gotrue は local でも logout API を await し、
 * hang すると storage 掃除と後続遷移が永久に止まる（A2）。
 */
export const SIGN_OUT_TIMEOUT_MS = 4_000;

/** マジックリンク宛先・送信 UI（sessionStorage）。owned prefix 外のため明示掃除。 */
const MAGIC_LINK_RESIDUAL_KEYS = [
  "kondate.auth.lastMagicEmail",
  "kondate.auth.magicSentUi",
] as const;

function clearOwnedBrowserStorage(): void {
  for (const storage of [localStorage, sessionStorage]) {
    clearOwnedAuthStorage(storage);
    for (const key of MAGIC_LINK_RESIDUAL_KEYS) {
      storage.removeItem(key);
    }
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

async function signOutBestEffort(
  client: SupabaseClient<Database>,
  scope: "local" | "global",
): Promise<void> {
  if (scope === "global") {
    await client.auth
      .signOut({ scope: "global" })
      .catch(() => client.auth.signOut({ scope: "local" }).catch(() => undefined));
    return;
  }
  await client.auth.signOut({ scope: "local" }).catch(() => undefined);
}

/**
 * ログアウト / アカウント削除成功後に端末側の認証・復帰データを消す。
 * Plan 1 の ownedAuthStoragePrefixes 経由の clearOwnedAuthStorage だけを使い、
 * 広義の sb- 規則や auth 接頭辞の二重定義はしない。
 * signOut が失敗・timeout しても storage 掃除は必ず完了させる。
 */
export async function clearLocalAuthAndDrafts(
  client: SupabaseClient<Database>,
  options: ClearLocalAuthOptions = {},
): Promise<void> {
  const scope = options.signOutScope ?? "local";
  // hang でも storage 掃除へ進む（reject だけ握る旧実装では never-settle を防げなかった）
  try {
    await withTimeout(signOutBestEffort(client, scope), SIGN_OUT_TIMEOUT_MS);
  } catch {
    // timeout / 予期しない throw — 端末 storage は下で必ず消す
  }
  clearOwnedBrowserStorage();
}
