import { expect, it, vi } from "vitest";
import { shareConsentVersion } from "@shared/contracts/share-consent";
import {
  getMyShareConsent,
  hasCurrentShareConsent,
  listMySharedEmergencyRecipes,
  reacceptMyShareConsent,
  revokeMyShareConsent,
  upsertMyShareConsent,
} from "./share-consent-api";

it("reads share consent via get_my_share_consent RPC", async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: {
      consent_version: shareConsentVersion,
      accepted_at: "2026-08-01T00:00:00.000Z",
      revoked_at: null,
    },
    error: null,
  });
  const client = { rpc } as never;

  await expect(getMyShareConsent(client)).resolves.toEqual({
    consent_version: shareConsentVersion,
    accepted_at: "2026-08-01T00:00:00.000Z",
    revoked_at: null,
  });
  expect(rpc).toHaveBeenCalledWith("get_my_share_consent");
});

it("upserts accept with the locked current shareConsentVersion", async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: {
      ok: true,
      consent_version: shareConsentVersion,
      accepted_at: "2026-08-01T00:00:00.000Z",
      revoked_at: null,
    },
    error: null,
  });
  const client = { rpc } as never;

  await expect(upsertMyShareConsent(client, true)).resolves.toEqual({
    consent_version: shareConsentVersion,
    accepted_at: "2026-08-01T00:00:00.000Z",
    revoked_at: null,
  });
  expect(rpc).toHaveBeenCalledWith("upsert_my_share_consent", {
    p_version: shareConsentVersion,
    p_accept: true,
  });
});

it("upserts revoke without requiring a new version string on the client", async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: {
      ok: true,
      consent_version: shareConsentVersion,
      accepted_at: "2026-08-01T00:00:00.000Z",
      revoked_at: "2026-08-01T01:00:00.000Z",
    },
    error: null,
  });
  const client = { rpc } as never;

  await expect(upsertMyShareConsent(client, false)).resolves.toMatchObject({
    revoked_at: "2026-08-01T01:00:00.000Z",
  });
  expect(rpc).toHaveBeenCalledWith("upsert_my_share_consent", {
    p_version: shareConsentVersion,
    p_accept: false,
  });
});

it("revokeMyShareConsent maps to upsert accept=false", async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: {
      ok: true,
      consent_version: shareConsentVersion,
      accepted_at: "2026-08-01T00:00:00.000Z",
      revoked_at: "2026-08-01T02:00:00.000Z",
    },
    error: null,
  });
  const client = { rpc } as never;

  await expect(revokeMyShareConsent(client)).resolves.toMatchObject({
    revoked_at: "2026-08-01T02:00:00.000Z",
  });
  expect(rpc).toHaveBeenCalledWith("upsert_my_share_consent", {
    p_version: shareConsentVersion,
    p_accept: false,
  });
});

it("reacceptMyShareConsent maps to upsert accept=true with current version", async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: {
      ok: true,
      consent_version: shareConsentVersion,
      accepted_at: "2026-08-01T03:00:00.000Z",
      revoked_at: null,
    },
    error: null,
  });
  const client = { rpc } as never;

  await expect(reacceptMyShareConsent(client)).resolves.toMatchObject({
    accepted_at: "2026-08-01T03:00:00.000Z",
    revoked_at: null,
  });
  expect(rpc).toHaveBeenCalledWith("upsert_my_share_consent", {
    p_version: shareConsentVersion,
    p_accept: true,
  });
});

it("lists shared emergency recipes as title + shared_on only", async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: [
      { title: "肉じゃが", shared_on: "2026-08-01" },
      { title: "野菜炒め", shared_on: "2026-07-30" },
    ],
    error: null,
  });
  const client = { rpc } as never;

  await expect(listMySharedEmergencyRecipes(client)).resolves.toEqual([
    { title: "肉じゃが", shared_on: "2026-08-01" },
    { title: "野菜炒め", shared_on: "2026-07-30" },
  ]);
  expect(rpc).toHaveBeenCalledWith("list_my_shared_emergency_recipes");
});

it("rejects list payloads that expose ids or omit required fields", async () => {
  const withId = vi.fn().mockResolvedValue({
    data: [{ title: "肉じゃが", shared_on: "2026-08-01", recipe_id: "r1" }],
    error: null,
  });
  await expect(listMySharedEmergencyRecipes({ rpc: withId } as never)).rejects.toThrow(
    "提供済みの一覧を読み込めませんでした",
  );

  const missingDate = vi.fn().mockResolvedValue({
    data: [{ title: "肉じゃが" }],
    error: null,
  });
  await expect(listMySharedEmergencyRecipes({ rpc: missingDate } as never)).rejects.toThrow(
    "提供済みの一覧を読み込めませんでした",
  );
});

it("treats only current version with revoked_at null as current consent", () => {
  expect(
    hasCurrentShareConsent({
      consent_version: shareConsentVersion,
      accepted_at: "2026-08-01T00:00:00.000Z",
      revoked_at: null,
    }),
  ).toBe(true);
  expect(
    hasCurrentShareConsent({
      consent_version: shareConsentVersion,
      accepted_at: "2026-08-01T00:00:00.000Z",
      revoked_at: "2026-08-01T01:00:00.000Z",
    }),
  ).toBe(false);
  expect(
    hasCurrentShareConsent({
      consent_version: "2026-07-01.v1",
      accepted_at: "2026-07-01T00:00:00.000Z",
      revoked_at: null,
    }),
  ).toBe(false);
  expect(
    hasCurrentShareConsent({
      consent_version: null,
      accepted_at: null,
      revoked_at: null,
    }),
  ).toBe(false);
  expect(hasCurrentShareConsent(null)).toBe(false);
});

it("AP5: forwards AbortSignal to rpc abortSignal without changing the no-signal call shape", async () => {
  const signal = new AbortController().signal;
  const abortSignal = vi.fn().mockResolvedValue({
    data: {
      ok: true,
      consent_version: shareConsentVersion,
      accepted_at: "2026-08-01T00:00:00.000Z",
      revoked_at: null,
    },
    error: null,
  });
  const rpc = vi.fn().mockReturnValue({ abortSignal });
  const client = { rpc } as never;

  await expect(upsertMyShareConsent(client, true, { signal })).resolves.toMatchObject({
    consent_version: shareConsentVersion,
    revoked_at: null,
  });
  expect(rpc).toHaveBeenCalledWith("upsert_my_share_consent", {
    p_version: shareConsentVersion,
    p_accept: true,
  });
  expect(abortSignal).toHaveBeenCalledWith(signal);
});

it("rejects malformed RPC payloads instead of trusting raw Json", async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: { ok: true, unexpected: true },
    error: null,
  });
  const client = { rpc } as never;

  await expect(upsertMyShareConsent(client, true)).rejects.toThrow(
    "共有の同意を保存できませんでした",
  );
});
