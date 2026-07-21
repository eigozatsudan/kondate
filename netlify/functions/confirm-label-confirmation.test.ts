import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmLabelConfirmationHandler } from "./confirm-label-confirmation.js";

describe("confirm-label-confirmation", () => {
  const requireUser = vi.fn();
  const rpc = vi.fn();
  const handler = confirmLabelConfirmationHandler(() => ({ requireUser, rpc }));
  const context = {
    params: {
      menuId: "40000000-0000-4000-8000-000000000001",
      confirmationId: "48000000-0000-4000-8000-000000000001",
    },
  } as never;

  beforeEach(() => {
    requireUser.mockReset();
    rpc.mockReset();
    requireUser.mockResolvedValue({
      userId: "10000000-0000-4000-8000-000000000001",
      accessToken: "token",
    });
  });

  it("rejects non-POST methods", async () => {
    const response = await handler(
      new Request("http://127.0.0.1/api/menus/x/label-confirmations/y/confirm", {
        method: "GET",
      }),
      context,
    );
    expect(response.status).toBe(405);
  });

  it("requires authentication before lookup", async () => {
    requireUser.mockRejectedValue(new Error("unauthorized"));
    const response = await handler(
      new Request("http://127.0.0.1/api/menus/x/label-confirmations/y/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedSafetyFingerprint: "a".repeat(64) }),
      }),
      context,
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns closed 404 when the owner RPC yields no row", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const response = await handler(
      new Request("http://127.0.0.1/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedSafetyFingerprint: "a".repeat(64) }),
      }),
      context,
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "confirmation_not_found" },
    });
  });

  it("returns the confirmed envelope for the owner", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: "48000000-0000-4000-8000-000000000001",
          confirmation_status: "confirmed",
          confirmed_at: "2026-07-11T00:00:00.000Z",
          confirmed_by: "10000000-0000-4000-8000-000000000001",
        },
      ],
      error: null,
    });
    const response = await handler(
      new Request("http://127.0.0.1/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedSafetyFingerprint: "a".repeat(64) }),
      }),
      context,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        confirmationStatus: "confirmed",
        confirmedBy: "10000000-0000-4000-8000-000000000001",
      },
    });
  });

  it("fails closed when the RPC row is malformed", async () => {
    rpc.mockResolvedValue({
      data: [{ id: "not-a-uuid", confirmation_status: 1 }],
      error: null,
    });
    const response = await handler(
      new Request("http://127.0.0.1/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedSafetyFingerprint: "a".repeat(64) }),
      }),
      context,
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "confirmation_failed" },
    });
  });
});
