import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/shared/types/database";
import { householdSafetyRevisionStorageKey } from "@/features/household/household-queries";
import { clearLocalAuthAndDrafts } from "./auth-cleanup";

function seedOwnedKeys(storage: Storage): void {
  storage.setItem("kondate.auth.flow.10000000-0000-4000-8000-000000000001", '{"id":"flow"}');
  storage.setItem("kondate.auth.supabase", '{"access_token":"session"}');
  // storageKey 派生の PKCE verifier も owned prefix 配下として消えること
  storage.setItem("kondate.auth.supabase-code-verifier", "pkce-verifier");
  storage.setItem(
    "kondate:generation:v2",
    JSON.stringify({
      kind: "regenerate_menu",
      request: { changeReason: "味を変えたい（自由記述）" },
    }),
  );
  storage.setItem("kondate:shopping:list:abc", '{"items":[]}');
  storage.setItem(householdSafetyRevisionStorageKey, "revision-1");
  // 無関係な設定は残す
  storage.setItem("kondate:preferences", "keep-me");
}

describe("clearLocalAuthAndDrafts", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("removes owned auth/recovery keys from both storages and keeps unrelated preferences", async () => {
    seedOwnedKeys(localStorage);
    seedOwnedKeys(sessionStorage);

    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: { signOut },
    } as unknown as SupabaseClient<Database>;

    await clearLocalAuthAndDrafts(client);

    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    for (const storage of [localStorage, sessionStorage]) {
      expect(storage.getItem("kondate.auth.flow.10000000-0000-4000-8000-000000000001")).toBeNull();
      expect(storage.getItem("kondate.auth.supabase")).toBeNull();
      expect(storage.getItem("kondate.auth.supabase-code-verifier")).toBeNull();
      expect(storage.getItem("kondate:generation:v2")).toBeNull();
      expect(storage.getItem("kondate:shopping:list:abc")).toBeNull();
      expect(storage.getItem(householdSafetyRevisionStorageKey)).toBeNull();
      expect(storage.getItem("kondate:preferences")).toBe("keep-me");
    }
  });

  it("resolves even when signOut fails because the server user is already gone", async () => {
    seedOwnedKeys(localStorage);
    const signOut = vi
      .fn()
      .mockRejectedValue(new Error("User from sub claim in JWT does not exist"));
    const client = {
      auth: { signOut },
    } as unknown as SupabaseClient<Database>;

    await expect(clearLocalAuthAndDrafts(client)).resolves.toBeUndefined();
    expect(localStorage.getItem("kondate:generation:v2")).toBeNull();
    expect(localStorage.getItem("kondate:preferences")).toBe("keep-me");
  });
});
