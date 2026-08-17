import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/shared/types/database";
import { householdSafetyRevisionStorageKey } from "@/features/household/household-queries";
import { PWA_INSTALL_TIP_DISMISSED_KEY } from "@/features/pwa/install-tip-storage";
import {
  clearExpiredSessionAuthAndDrafts,
  clearLocalAuthAndDrafts,
  clearOwnedLocalDataBestEffort,
  hasOwnedLocalDataResidual,
  clearSoftResidualRecoverySuppressed,
  clearSoftSessionResidualBestEffort,
  isSoftResidualRecoverySuppressed,
  SIGN_OUT_TIMEOUT_MS,
  SOFT_RESIDUAL_RECOVERY_SUPPRESS_KEY,
} from "./auth-cleanup";
import { SOFT_RESIDUAL_RECOVERY_REARM_EVENT } from "./soft-residual-recovery-suppress";

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
  // 無関係な設定は残す（PWA 案内 dismiss も端末設定として logout / second-pass 後に残す）
  storage.setItem("kondate:preferences", "keep-me");
  storage.setItem(PWA_INSTALL_TIP_DISMISSED_KEY, "1");
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
      expect(storage.getItem(PWA_INSTALL_TIP_DISMISSED_KEY)).toBe("1");
    }
    expect(sessionStorage.getItem("kondate.auth.lastMagicEmail")).toBeNull();
    expect(sessionStorage.getItem("kondate.auth.magicSentUi")).toBeNull();
  });

  it("clears committed live session mark from localStorage", async () => {
    localStorage.setItem(
      "kondate.auth.liveSession",
      JSON.stringify({ userId: "user-1", storedAt: new Date().toISOString() }),
    );
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: { signOut },
    } as unknown as SupabaseClient<Database>;

    await clearLocalAuthAndDrafts(client);

    expect(localStorage.getItem("kondate.auth.liveSession")).toBeNull();
  });

  it("clears leftover email OTP completed mark from sessionStorage", async () => {
    sessionStorage.setItem(
      "kondate.auth.emailOtpCompleted",
      JSON.stringify({ storedAt: new Date().toISOString() }),
    );
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: { signOut },
    } as unknown as SupabaseClient<Database>;

    await clearLocalAuthAndDrafts(client);

    expect(sessionStorage.getItem("kondate.auth.emailOtpCompleted")).toBeNull();
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
    expect(localStorage.getItem(PWA_INSTALL_TIP_DISMISSED_KEY)).toBe("1");
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
    expect(localStorage.getItem(PWA_INSTALL_TIP_DISMISSED_KEY)).toBe("1");
  });

  it("AP8: hasOwnedLocalDataResidual is true only while owned keys remain", () => {
    expect(hasOwnedLocalDataResidual()).toBe(false);
    localStorage.setItem("kondate:generation:v2", "{}");
    expect(hasOwnedLocalDataResidual()).toBe(true);
    localStorage.removeItem("kondate:generation:v2");
    expect(hasOwnedLocalDataResidual()).toBe(false);
    sessionStorage.setItem("kondate:feedback:ambiguous-fingerprint:x", "hash");
    expect(hasOwnedLocalDataResidual()).toBe(true);
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
      expect(storage.getItem(PWA_INSTALL_TIP_DISMISSED_KEY)).toBe("1");
    }
    expect(sessionStorage.getItem("kondate.auth.lastMagicEmail")).toBeNull();
  });

  it("C5/C-R3: expired-session cleanup keeps sibling flow/PKCE/pending and session persist", async () => {
    const flowId = "10000000-0000-4000-8000-0000000000c5";
    const flowKey = `kondate.auth.flow.${flowId}`;
    const pendingKey = `kondate.auth.supabase.pending-deposit.${flowId}`;
    const ownerKey = `kondate.auth.supabase.callback-owner.${flowId}`;
    localStorage.setItem(
      flowKey,
      JSON.stringify({
        id: flowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "http://127.0.0.1:5173",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt: new Date().toISOString(),
      }),
    );
    localStorage.setItem(
      pendingKey,
      JSON.stringify({
        state: "B".repeat(43),
        code: "authorization-code-plain",
        expiresAtMs: Date.now() + 60_000,
      }),
    );
    localStorage.setItem(ownerKey, new Date().toISOString());
    localStorage.setItem("kondate.auth.supabase-code-verifier", "pkce-verifier");
    localStorage.setItem("kondate.auth.supabase", '{"access_token":"session"}');
    localStorage.setItem("kondate:generation:v2", '{"kind":"x"}');

    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: { signOut },
    } as unknown as SupabaseClient<Database>;

    await clearExpiredSessionAuthAndDrafts(client);

    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(localStorage.getItem(flowKey)).not.toBeNull();
    // C-R3: callback-owner がある sibling mid-login pending は残す（strip 後 re-deposit 正本）
    expect(localStorage.getItem(pendingKey)).not.toBeNull();
    expect(localStorage.getItem(ownerKey)).not.toBeNull();
    expect(localStorage.getItem("kondate.auth.supabase-code-verifier")).toBe("pkce-verifier");
    expect(localStorage.getItem("kondate.auth.supabase")).toBeNull();
    expect(localStorage.getItem("kondate:generation:v2")).toBeNull();
    expect(isSoftResidualRecoverySuppressed()).toBe(true);
  });

  it("C4/R3: soft residual clears drafts/session/completion but preserves sibling flow secrets", () => {
    seedOwnedKeys(localStorage);
    localStorage.setItem("kondate.auth.lastMagicEmail", "user@example.com");
    clearSoftSessionResidualBestEffort();
    expect(localStorage.getItem("kondate.auth.supabase")).toBeNull();
    expect(localStorage.getItem("kondate:generation:v2")).toBeNull();
    expect(localStorage.getItem("kondate:feedback:ambiguous-fingerprint")).toBeNull();
    expect(localStorage.getItem("kondate.auth.lastMagicEmail")).toBeNull();
    // R3: sibling mid-login の flow secret は温存（C4 は共有 suppress で silent complete を閉じる）
    expect(
      localStorage.getItem("kondate.auth.flow.10000000-0000-4000-8000-000000000001"),
    ).not.toBeNull();
    expect(localStorage.getItem("kondate:preferences")).toBe("keep-me");
    expect(localStorage.getItem(PWA_INSTALL_TIP_DISMISSED_KEY)).toBe("1");
    // C4: origin 共有 localStorage で residual recovery を抑止（新タブからも見える）
    expect(isSoftResidualRecoverySuppressed()).toBe(true);
    expect(localStorage.getItem(SOFT_RESIDUAL_RECOVERY_SUPPRESS_KEY)).toBe("1");
  });

  it("C4/R3: soft residual clears completion; preserves PKCE/secret/callback-owner and sibling pending", () => {
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
      JSON.stringify({
        flowId,
        returnTo: "/planner",
        completedAt: new Date().toISOString(),
      }),
    );
    localStorage.setItem("kondate:preferences", "keep-me");
    localStorage.setItem(PWA_INSTALL_TIP_DISMISSED_KEY, "1");

    clearSoftSessionResidualBestEffort();

    // C-R3: callback-owner 付き pending は sibling mid-login として残す
    expect(localStorage.getItem(`kondate.auth.supabase.pending-deposit.${flowId}`)).not.toBeNull();
    expect(localStorage.getItem("kondate.auth.supabase-code-verifier")).toBe("pkce-verifier");
    expect(localStorage.getItem(`kondate.auth.flow.${flowId}`)).not.toBeNull();
    expect(localStorage.getItem(`kondate.auth.supabase.callback-owner.${flowId}`)).not.toBeNull();
    // C4: completion short-circuit は閉じる
    expect(
      localStorage.getItem(`kondate.auth.supabase.continuation-complete.${flowId}`),
    ).toBeNull();
    expect(localStorage.getItem("kondate:preferences")).toBe("keep-me");
    expect(localStorage.getItem(PWA_INSTALL_TIP_DISMISSED_KEY)).toBe("1");
    expect(isSoftResidualRecoverySuppressed()).toBe(true);
    expect(localStorage.getItem(SOFT_RESIDUAL_RECOVERY_SUPPRESS_KEY)).toBe("1");
  });

  it("C1: soft residual / 401 keep claim-poll lease keys so live sibling exchange is not orphaned", async () => {
    const flowId = "10000000-0000-4000-8000-0000000000c1";
    const lastAt = String(Date.now() + 4_000);
    const exchangeKey = `kondate.auth.supabase.claim-poll-exchange.${flowId}`;
    const leaseKey = `kondate.auth.supabase.claim-poll-target-lease.${flowId}.liveinstance01`;
    const lastAtKey = "kondate.auth.supabase.claim-poll-last-at";
    const cursorKey = "kondate.auth.supabase.claim-poll-cursor";
    const leaseJson = JSON.stringify({
      flowId,
      instanceId: "liveinstance01",
      refreshedAt: Date.now(),
      pending: false,
    });
    const exchangeJson = JSON.stringify({
      flowId,
      instanceId: "exchange-live",
      refreshedAt: Date.now(),
    });
    for (const storage of [localStorage, sessionStorage]) {
      storage.setItem(lastAtKey, lastAt);
      storage.setItem(exchangeKey, exchangeJson);
      storage.setItem(leaseKey, leaseJson);
      storage.setItem(cursorKey, flowId);
      storage.setItem("kondate.auth.supabase", '{"access_token":"session"}');
    }

    clearSoftSessionResidualBestEffort();

    expect(localStorage.getItem(lastAtKey)).toBe(lastAt);
    expect(localStorage.getItem(exchangeKey)).toBe(exchangeJson);
    expect(localStorage.getItem(leaseKey)).toBe(leaseJson);
    expect(sessionStorage.getItem(lastAtKey)).toBe(lastAt);
    expect(sessionStorage.getItem(exchangeKey)).toBe(exchangeJson);
    expect(sessionStorage.getItem(leaseKey)).toBe(leaseJson);
    // last-at / lease 以外の claim-poll 残渣（cursor）は未知キーとして消してよい
    expect(localStorage.getItem(cursorKey)).toBeNull();
    expect(localStorage.getItem("kondate.auth.supabase")).toBeNull();

    localStorage.setItem(lastAtKey, lastAt);
    localStorage.setItem(exchangeKey, exchangeJson);
    localStorage.setItem(leaseKey, leaseJson);
    localStorage.setItem("kondate.auth.supabase", '{"access_token":"session"}');
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: { signOut },
    } as unknown as SupabaseClient<Database>;
    await clearExpiredSessionAuthAndDrafts(client);
    expect(localStorage.getItem(lastAtKey)).toBe(lastAt);
    expect(localStorage.getItem(exchangeKey)).toBe(exchangeJson);
    expect(localStorage.getItem(leaseKey)).toBe(leaseJson);
    expect(localStorage.getItem("kondate.auth.supabase")).toBeNull();
  });

  it("C5/C-R3: soft residual still clears prior-user pending without callback-owner", () => {
    const flowId = "10000000-0000-4000-8000-0000000000c5";
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

    clearSoftSessionResidualBestEffort();

    // 共有端末の prior-user pending 平文は消す。sibling mid-login 印（owner）は無い
    expect(localStorage.getItem(`kondate.auth.supabase.pending-deposit.${flowId}`)).toBeNull();
    expect(localStorage.getItem(`kondate.auth.flow.${flowId}`)).not.toBeNull();
    expect(isSoftResidualRecoverySuppressed()).toBe(true);
  });

  it("C4: soft residual suppress is shared via localStorage (new-tab visible; sessionStorage empty)", () => {
    // soft したタブと新タブを模擬: localStorage のみ共有、sessionStorage は空
    seedOwnedKeys(localStorage);
    clearSoftSessionResidualBestEffort();
    expect(localStorage.getItem(SOFT_RESIDUAL_RECOVERY_SUPPRESS_KEY)).toBe("1");
    sessionStorage.clear();
    // 新タブ相当: sessionStorage が空でも共有 suppress が効く
    expect(sessionStorage.getItem(SOFT_RESIDUAL_RECOVERY_SUPPRESS_KEY)).toBeNull();
    expect(isSoftResidualRecoverySuppressed()).toBe(true);
    // R3: secret は残ったまま（新タブ residual は suppress で止め、secret burn ではない）
    expect(
      localStorage.getItem("kondate.auth.flow.10000000-0000-4000-8000-000000000001"),
    ).not.toBeNull();
  });

  it("R4: clearSoftResidualRecoverySuppressed dispatches rearm only when suppress was set", () => {
    // rearm イベントは suppress が立っていた clear だけ（無印 clear では発火しない）
    const events: Event[] = [];
    const onRearm = (e: Event): void => {
      events.push(e);
    };
    window.addEventListener(SOFT_RESIDUAL_RECOVERY_REARM_EVENT, onRearm);
    try {
      clearSoftResidualRecoverySuppressed();
      expect(events).toHaveLength(0);

      localStorage.setItem(SOFT_RESIDUAL_RECOVERY_SUPPRESS_KEY, "1");
      clearSoftResidualRecoverySuppressed();
      expect(isSoftResidualRecoverySuppressed()).toBe(false);
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe(SOFT_RESIDUAL_RECOVERY_REARM_EVENT);
    } finally {
      window.removeEventListener(SOFT_RESIDUAL_RECOVERY_REARM_EVENT, onRearm);
    }
  });

  it("AP1: clears kondate:feedback free-form fingerprint on logout and best-effort pass", async () => {
    const freeForm = "other\n共有端末に残してはいけない自由記述 PII";
    localStorage.setItem("kondate:feedback:ambiguous-fingerprint", freeForm);
    sessionStorage.setItem("kondate:feedback:ambiguous-fingerprint", freeForm);
    localStorage.setItem("kondate:preferences", "keep-me");
    localStorage.setItem(PWA_INSTALL_TIP_DISMISSED_KEY, "1");

    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: { signOut },
    } as unknown as SupabaseClient<Database>;

    await clearLocalAuthAndDrafts(client);
    expect(localStorage.getItem("kondate:feedback:ambiguous-fingerprint")).toBeNull();
    expect(sessionStorage.getItem("kondate:feedback:ambiguous-fingerprint")).toBeNull();
    expect(localStorage.getItem("kondate:preferences")).toBe("keep-me");
    expect(localStorage.getItem(PWA_INSTALL_TIP_DISMISSED_KEY)).toBe("1");

    // second-pass 経路でも同様
    localStorage.setItem("kondate:feedback:ambiguous-fingerprint", freeForm);
    clearOwnedLocalDataBestEffort();
    expect(localStorage.getItem("kondate:feedback:ambiguous-fingerprint")).toBeNull();
    expect(localStorage.getItem("kondate:preferences")).toBe("keep-me");
    expect(localStorage.getItem(PWA_INSTALL_TIP_DISMISSED_KEY)).toBe("1");
  });
});
