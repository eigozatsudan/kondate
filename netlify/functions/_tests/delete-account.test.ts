import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../_shared/http.js";

const requireUserMock = vi.hoisted(() => vi.fn());
const adminDeleteUserMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("../_shared/auth.js", () => ({
  requireUser: requireUserMock,
}));

vi.mock("../_shared/supabase-admin.js", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      admin: {
        deleteUser: adminDeleteUserMock,
      },
    },
    rpc: rpcMock,
  }),
}));

const { createDeleteAccountHandler, default: productionHandler } =
  await import("../delete-account.js");

const USER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "20000000-0000-4000-8000-000000000099";
const ACCESS_TOKEN = "access-token-secret-value";
const EMAIL = "owner@example.com";

function makeDeleteRequest(
  body: unknown,
  options: { authorization?: string | null } = {},
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.authorization === undefined) {
    headers.set("authorization", `Bearer ${ACCESS_TOKEN}`);
  } else if (options.authorization !== null) {
    headers.set("authorization", options.authorization);
  }
  return new Request("http://127.0.0.1/api/account", {
    method: "DELETE",
    headers,
    body: JSON.stringify(body),
  });
}

describe("createDeleteAccountHandler", () => {
  const deleteUser = vi.fn();
  const authenticate = vi.fn();
  const releaseProcessingReservations = vi.fn();
  const logSink: string[] = [];

  beforeEach(() => {
    deleteUser.mockReset();
    authenticate.mockReset();
    releaseProcessingReservations.mockReset();
    requireUserMock.mockReset();
    adminDeleteUserMock.mockReset();
    rpcMock.mockReset();
    logSink.length = 0;
    authenticate.mockResolvedValue({ userId: USER_ID, accessToken: ACCESS_TOKEN });
    releaseProcessingReservations.mockResolvedValue({ error: null });
    deleteUser.mockResolvedValue({ error: null });
    rpcMock.mockResolvedValue({ data: 0, error: null });
    const capture = (...args: unknown[]) => {
      logSink.push(args.map((value) => String(value)).join(" "));
    };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "info").mockImplementation(capture);
    vi.spyOn(console, "warn").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
    vi.spyOn(console, "debug").mockImplementation(capture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function handler() {
    return createDeleteAccountHandler({
      authenticate,
      releaseProcessingReservations,
      deleteUser,
    });
  }

  function loggedText(): string {
    return logSink.join("\n");
  }

  it("returns 405 method_not_allowed for non-DELETE requests", async () => {
    const response = await handler()(
      new Request("http://127.0.0.1/api/account", { method: "POST" }),
    );
    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "method_not_allowed" },
    });
    expect(response.headers.get("allow")).toBe("DELETE");
    expect(authenticate).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("returns 401 auth_required when authentication fails", async () => {
    authenticate.mockRejectedValue(new HttpError(401, "auth_required", "ログインが必要です"));
    const response = await handler()(makeDeleteRequest({ confirmation: "削除する" }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "auth_required" },
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_request when the confirmation phrase differs", async () => {
    const response = await handler()(makeDeleteRequest({ confirmation: "delete" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("ignores an extra user_id in the body and deletes only the authenticated user", async () => {
    const response = await handler()(
      makeDeleteRequest({ confirmation: "削除する", user_id: OTHER_USER_ID }),
    );
    expect(response.status).toBe(200);
    expect(releaseProcessingReservations).toHaveBeenCalledWith(USER_ID);
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith(USER_ID);
    expect(deleteUser.mock.calls[0]).toHaveLength(1);
    expect(deleteUser).not.toHaveBeenCalledWith(OTHER_USER_ID);
  });

  it("returns 503 account_delete_failed when release RPC fails before deleteUser", async () => {
    releaseProcessingReservations.mockResolvedValue({ error: { message: "release failed" } });
    const response = await handler()(makeDeleteRequest({ confirmation: "削除する" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "account_delete_failed" },
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("returns 503 account_delete_failed when the Admin API reports an error", async () => {
    deleteUser.mockResolvedValue({ error: { message: "admin unavailable" } });
    const response = await handler()(makeDeleteRequest({ confirmation: "削除する" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "account_delete_failed",
        message: "削除できませんでした。時間をおいてもう一度お試しください",
      },
    });
    expect(releaseProcessingReservations).toHaveBeenCalledWith(USER_ID);
  });

  it("calls release then deleteUser with the authenticated user id and returns deleted:true", async () => {
    const response = await handler()(makeDeleteRequest({ confirmation: "削除する" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { deleted: true },
    });
    expect(releaseProcessingReservations).toHaveBeenCalledTimes(1);
    expect(releaseProcessingReservations).toHaveBeenCalledWith(USER_ID);
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith(USER_ID);
    expect(deleteUser.mock.calls[0]).toHaveLength(1);
    // release が delete より先
    expect(releaseProcessingReservations.mock.invocationCallOrder[0]).toBeLessThan(
      deleteUser.mock.invocationCallOrder[0]!,
    );
  });

  it("never logs the user id, email, or access token", async () => {
    authenticate.mockResolvedValue({
      userId: USER_ID,
      accessToken: ACCESS_TOKEN,
      email: EMAIL,
    });
    await handler()(makeDeleteRequest({ confirmation: "削除する" }));
    deleteUser.mockResolvedValueOnce({ error: { message: `failed for ${USER_ID}` } });
    await handler()(makeDeleteRequest({ confirmation: "削除する" }));

    const text = loggedText();
    expect(text).not.toContain(USER_ID);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(ACCESS_TOKEN);
  });
});

describe("production deleteUser adapter", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    adminDeleteUserMock.mockReset();
    rpcMock.mockReset();
    requireUserMock.mockResolvedValue({ userId: USER_ID, accessToken: ACCESS_TOKEN });
    adminDeleteUserMock.mockResolvedValue({ data: { user: null }, error: null });
    rpcMock.mockResolvedValue({ data: 0, error: null });
  });

  it("passes (authenticatedUser.userId, false) for hard deletion after release RPC", async () => {
    const response = await productionHandler(makeDeleteRequest({ confirmation: "削除する" }));
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("release_identity_and_global_for_user_processing", {
      p_user_id: USER_ID,
    });
    expect(adminDeleteUserMock).toHaveBeenCalledTimes(1);
    expect(adminDeleteUserMock).toHaveBeenCalledWith(USER_ID, false);
  });
});
