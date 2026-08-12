import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAccessTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/session", () => ({
  requireAccessToken: requireAccessTokenMock,
}));
vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

import { confirmLabelConfirmation, CONFIRM_LABEL_CLIENT_TIMEOUT_MS } from "./confirm-label-api";

const MENU_ID = "00000000-0000-4000-8000-000000000001";
const CONFIRMATION_ID = "00000000-0000-4000-8000-000000000002";
const FINGERPRINT = "live-safety-fingerprint";

describe("confirmLabelConfirmation", () => {
  beforeEach(() => {
    requireAccessTokenMock.mockReset();
    requireAccessTokenMock.mockResolvedValue("access-token");
  });

  it("posts expectedSafetyFingerprint with a client abort budget", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json({
          ok: true,
          data: {
            confirmationId: CONFIRMATION_ID,
            confirmationStatus: "confirmed",
            confirmedAt: "2026-08-01T00:00:00.000Z",
            confirmedBy: "00000000-0000-4000-8000-000000000099",
          },
        }),
      ),
    );
    await expect(
      confirmLabelConfirmation(MENU_ID, CONFIRMATION_ID, FINGERPRINT, { fetchImpl }),
    ).resolves.toMatchObject({
      confirmationId: CONFIRMATION_ID,
      confirmationStatus: "confirmed",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/menus/${MENU_ID}/label-confirmations/${CONFIRMATION_ID}/confirm`,
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({ expectedSafetyFingerprint: FINGERPRINT }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(CONFIRM_LABEL_CLIENT_TIMEOUT_MS).toBe(30_000);
  });

  // G15: hung proxy で確認 busy が永久化しない
  it("G15: aborts a hung confirm POST when the client timeout fires", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal ?? null;
          if (signal === null) {
            reject(new Error("missing abort signal"));
            return;
          }
          if (signal.aborted) {
            reject(new DOMException("The operation was aborted.", "AbortError"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    await expect(
      confirmLabelConfirmation(MENU_ID, CONFIRMATION_ID, FINGERPRINT, {
        fetchImpl,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws the error code from a closed error envelope", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json({
          ok: false,
          error: { code: "confirmation_not_found", message: "見つかりません" },
        }),
      ),
    );
    await expect(
      confirmLabelConfirmation(MENU_ID, CONFIRMATION_ID, FINGERPRINT, { fetchImpl }),
    ).rejects.toThrow("confirmation_not_found");
  });
});
