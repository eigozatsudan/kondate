import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/shared/types/database";
import { householdSafetyRevisionStorageKey } from "@/features/household/household-queries";
import {
  clearLocalAuthAndDrafts,
  clearOwnedLocalDataBestEffort,
  clearSoftSessionResidualBestEffort,
  SIGN_OUT_TIMEOUT_MS,
} from "./auth-cleanup";

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
  storage.setItem("kondate:flyer:sticky:v1:user-1", '{"key":"k","fingerprint":"f"}');
  storage.setItem(
    "kondate:expired-pantry-confirm:v1:user-1",
    '{"dayKey":"2026-07-11","checks":[]}',
  );
  // AP1: feedback 曖昧 fingerprint（free-form 本文を含む）。ログアウト/削除で消す
  storage.setItem(
    "kondate:feedback:ambiguous-fingerprint",
    "bug_report\nアレルギーとメール address@example.com を含む自由記述",
  );
  storage.setItem(householdSafetyRevisionStorageKey, "revision-1");
  // 無関係な設定は残す
  storage.setItem("kondate:preferences", "keep-me");
}

describe("clearLocalAuthAndDrafts", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes owned auth/recovery keys from both storages and keeps unrelated preferences", async () => {
    seedOwnedKeys(localStorage);
    seedOwnedKeys(sessionStorage);
    // AUTH-3: マジックリンク宛先は owned prefix 外だがログアウトで消す
    sessionStorage.setItem("kondate.auth.lastMagicEmail", "user@example.com");
    sessionStorage.setItem(
      "kondate.auth.magicSentUi",
      JSON.stringify({ email: "user@example.com", flowId: "f", resendAvailableAt: "t" }),
    );

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
      expect(storage.getItem("kondate:flyer:sticky:v1:user-1")).toBeNull();
      expect(storage.getItem("kondate:expired-pantry-confirm:v1:user-1")).toBeNull();
      expect(storage.getItem("kondate:feedback:ambiguous-fingerprint")).toBeNull();
      expect(storage.getItem(householdSafetyRevisionStorageKey)).toBeNull();
      expect(storage.getItem("kondate:preferences")).toBe("keep-me");
    }
    expect(sessionStorage.getItem("kondate.auth.lastMagicEmail")).toBeNull();
    expect(sessionStorage.getItem("kondate.auth.magicSentUi")).toBeNull();
  });

  it("uses global signOut when signOutScope is global and falls back to local on failure", async () => {
    const signOut = vi
      .fn()
      .mockRejectedValueOnce(new Error("global unavailable"))
      .mockResolvedValueOnce({ error: null });
    const client = {
      auth: { signOut },
    } as unknown as SupabaseClient<Database>;

    await clearLocalAuthAndDrafts(client, { signOutScope: "global" });

    expect(signOut).toHaveBeenNthCalledWith(1, { scope: "global" });
    expect(signOut).toHaveBeenNthCalledWith(2, { scope: "local" });
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

  it("clears storage even when signOut never settles (A2)", async () => {
    vi.useFakeTimers();
    seedOwnedKeys(localStorage);
    seedOwnedKeys(sessionStorage);
    const signOut = vi.fn().mockReturnValue(new Promise(() => undefined));
    const client = {
      auth: { signOut },
    } as unknown as SupabaseClient<Database>;

    const pending = clearLocalAuthAndDrafts(client);
    await vi.advanceTimersByTimeAsync(SIGN_OUT_TIMEOUT_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(localStorage.getItem("kondate.auth.supabase")).toBeNull();
    expect(localStorage.getItem("kondate:generation:v2")).toBeNull();
    expect(localStorage.getItem("kondate:preferences")).toBe("keep-me");
  });

  it("clearOwnedLocalDataBestEffort removes owned keys without signOut (AP5)", () => {
    seedOwnedKeys(localStorage);
    seedOwnedKeys(sessionStorage);
    sessionStorage.setItem("kondate.auth.lastMagicEmail", "user@example.com");
    clearOwnedLocalDataBestEffort();
    for (const storage of [localStorage, sessionStorage]) {
      expect(storage.getItem("kondate.auth.supabase")).toBeNull();
      expect(storage.getItem("kondate:generation:v2")).toBeNull();
      // AP1: free-form fingerprint も second-pass で消える
      expect(storage.getItem("kondate:feedback:ambiguous-fingerprint")).toBeNull();
      expect(storage.getItem("kondate:preferences")).toBe("keep-me");
    }
    expect(sessionStorage.getItem("kondate.auth.lastMagicEmail")).toBeNull();
  });

  it("C7: clearSoftSessionResidualBestEffort clears drafts/session but keeps flow secret", () => {
    seedOwnedKeys(localStorage);
    localStorage.setItem("kondate.auth.lastMagicEmail", "user@example.com");
    clearSoftSessionResidualBestEffort();
    expect(localStorage.getItem("kondate.auth.supabase")).toBeNull();
    expect(localStorage.getItem("kondate:generation:v2")).toBeNull();
    expect(localStorage.getItem("kondate:feedback:ambiguous-fingerprint")).toBeNull();
    expect(localStorage.getItem("kondate.auth.lastMagicEmail")).toBeNull();
    // 進行中 continuation secret は温存（C7）
    expect(
      localStorage.getItem("kondate.auth.flow.10000000-0000-4000-8000-000000000001"),
    ).not.toBeNull();
    expect(localStorage.getItem("kondate:preferences")).toBe("keep-me");
  });

  it("C3/C10: soft residual clears pending-deposit and PKCE verifier but keeps flow secret", () => {
    const flowId = "10000000-0000-4000-8000-0000000000c3";
    localStorage.setItem(
      `kondate.auth.flow.${flowId}`,
      JSON.stringify({ id: flowId, secret: "A".repeat(43) }),
    );
    localStorage.setItem(
      `kondate.auth.supabase.pending-deposit.${flowId}`,
      JSON.stringify({
        state: "B".repeat(43),
        code: "authorization-code-plain",
        expiresAtMs: Date.now() + 60_000,
      }),
    );
    localStorage.setItem("kondate.auth.supabase-code-verifier", "pkce-verifier");
    localStorage.setItem(
      `kondate.auth.supabase.callback-owner.${flowId}`,
      new Date().toISOString(),
    );
    localStorage.setItem(
      `kondate.auth.supabase.continuation-complete.${flowId}`,
      JSON.stringify({ flowId, returnTo: "/planner" }),
    );
    localStorage.setItem("kondate:preferences", "keep-me");

    clearSoftSessionResidualBestEffort();

    // C3: authorization code 平文を残さない
    expect(localStorage.getItem(`kondate.auth.supabase.pending-deposit.${flowId}`)).toBeNull();
    // C10: PKCE verifier も soft で消す
    expect(localStorage.getItem("kondate.auth.supabase-code-verifier")).toBeNull();
    // C7: secret / callback-owner / completion は温存
    expect(localStorage.getItem(`kondate.auth.flow.${flowId}`)).not.toBeNull();
    expect(localStorage.getItem(`kondate.auth.supabase.callback-owner.${flowId}`)).not.toBeNull();
    expect(
      localStorage.getItem(`kondate.auth.supabase.continuation-complete.${flowId}`),
    ).not.toBeNull();
    expect(localStorage.getItem("kondate:preferences")).toBe("keep-me");
  });

  it("AP1: clears kondate:feedback free-form fingerprint on logout and best-effort pass", async () => {
    const freeForm = "other\n共有端末に残してはいけない自由記述 PII";
    localStorage.setItem("kondate:feedback:ambiguous-fingerprint", freeForm);
    sessionStorage.setItem("kondate:feedback:ambiguous-fingerprint", freeForm);
    localStorage.setItem("kondate:preferences", "keep-me");

    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: { signOut },
    } as unknown as SupabaseClient<Database>;

    await clearLocalAuthAndDrafts(client);
    expect(localStorage.getItem("kondate:feedback:ambiguous-fingerprint")).toBeNull();
    expect(sessionStorage.getItem("kondate:feedback:ambiguous-fingerprint")).toBeNull();
    expect(localStorage.getItem("kondate:preferences")).toBe("keep-me");

    // second-pass 経路でも同様
    localStorage.setItem("kondate:feedback:ambiguous-fingerprint", freeForm);
    clearOwnedLocalDataBestEffort();
    expect(localStorage.getItem("kondate:feedback:ambiguous-fingerprint")).toBeNull();
    expect(localStorage.getItem("kondate:preferences")).toBe("keep-me");
  });
});
