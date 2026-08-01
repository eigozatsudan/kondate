import { expect, it, vi } from "vitest";
import { shareConsentVersion } from "@shared/contracts/share-consent";
import {
  getMyShareConsent,
  hasCurrentShareConsent,
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
