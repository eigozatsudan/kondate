import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../_shared/http.js";
import type { SafeLogEvent } from "../_shared/logger.js";

const requireUserMock = vi.hoisted(() => vi.fn());
const adminDeleteUserMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());
const getServerEnvMock = vi.hoisted(() => vi.fn());
const getStripeClientFromEnvMock = vi.hoisted(() => vi.fn());

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

vi.mock("../_shared/env.js", () => ({
  getServerEnv: getServerEnvMock,
}));

vi.mock("../_shared/billing-stripe.js", () => ({
  getStripeClientFromEnv: getStripeClientFromEnvMock,
}));

const {
  createDeleteAccountHandler,
  cancelAllLiveSubscriptionsForUser,
  default: productionHandler,
} = await import("../delete-account.js");

const USER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "20000000-0000-4000-8000-000000000099";
const ACCESS_TOKEN = "access-token-secret-value";
const EMAIL = "owner@example.com";
const CUSTOMER_ID = "cus_test_delete_1";
const SUB_ACTIVE = "sub_active_1";
const SUB_TRIALING = "sub_trialing_1";
const SUB_PAST_DUE = "sub_past_due_1";
const SUB_CANCELED = "sub_canceled_1";

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
  const releaseFlyerProcessingReservations = vi.fn();
  const cancelBillingSubscriptions = vi.fn();
  const logSink: string[] = [];

  beforeEach(() => {
    deleteUser.mockReset();
    authenticate.mockReset();
    releaseProcessingReservations.mockReset();
    releaseFlyerProcessingReservations.mockReset();
    cancelBillingSubscriptions.mockReset();
    requireUserMock.mockReset();
    adminDeleteUserMock.mockReset();
    rpcMock.mockReset();
    logSink.length = 0;
    authenticate.mockResolvedValue({ userId: USER_ID, accessToken: ACCESS_TOKEN });
    releaseProcessingReservations.mockResolvedValue({ error: null });
    releaseFlyerProcessingReservations.mockResolvedValue({ error: null });
    cancelBillingSubscriptions.mockResolvedValue(undefined);
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
      releaseFlyerProcessingReservations,
      cancelBillingSubscriptions,
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
    expect(cancelBillingSubscriptions).not.toHaveBeenCalled();
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

  it("calls release_identity_and_global_for_user_processing before auth delete", async () => {
    await handler()(makeDeleteRequest({ confirmation: "削除する" }));
    expect(releaseProcessingReservations).toHaveBeenCalledWith(USER_ID);
    expect(releaseProcessingReservations.mock.invocationCallOrder[0]).toBeLessThan(
      deleteUser.mock.invocationCallOrder[0]!,
    );
  });

  it("calls cancelBillingSubscriptions before auth delete even when release flyer runs", async () => {
    await handler()(makeDeleteRequest({ confirmation: "削除する" }));
    expect(releaseFlyerProcessingReservations).toHaveBeenCalledWith(USER_ID);
    expect(cancelBillingSubscriptions).toHaveBeenCalledWith(USER_ID);
    expect(cancelBillingSubscriptions.mock.invocationCallOrder[0]).toBeLessThan(
      deleteUser.mock.invocationCallOrder[0]!,
    );
  });

  it("blocks auth-delete with billing_cancel_failed when cancelBillingSubscriptions throws (AP1)", async () => {
    cancelBillingSubscriptions.mockRejectedValue(new Error("stripe cancel boom"));
    const response = await handler()(makeDeleteRequest({ confirmation: "削除する" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "billing_cancel_failed",
        message: expect.stringMatching(/解約が完了しませんでした|請求が続く/u),
      },
    });
    expect(deleteUser).not.toHaveBeenCalled();
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

describe("cancelAllLiveSubscriptionsForUser", () => {
  const listMock = vi.fn();
  const cancelMock = vi.fn();
  const rpc = vi.fn();
  const events: SafeLogEvent[] = [];

  beforeEach(() => {
    listMock.mockReset();
    cancelMock.mockReset();
    rpc.mockReset();
    events.length = 0;
  });

  const stripe = {
    subscriptions: {
      list: listMock,
      cancel: cancelMock,
    },
  };

  const log = (event: SafeLogEvent) => {
    events.push(event);
  };

  it("skips Stripe when no billing customer and still allows auth delete path", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await cancelAllLiveSubscriptionsForUser({
      userId: USER_ID,
      admin: { rpc },
      stripe: stripe as never,
      log,
      requestId: "req-1",
      startedAt: Date.now(),
    });
    expect(rpc).toHaveBeenCalledWith("get_billing_customer_by_user", { p_user_id: USER_ID });
    expect(listMock).not.toHaveBeenCalled();
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("lists subscriptions by customer and cancels a single live sub", async () => {
    rpc.mockResolvedValue({ data: { stripe_customer_id: CUSTOMER_ID }, error: null });
    listMock.mockResolvedValue({
      data: [{ id: SUB_ACTIVE, status: "active" }],
    });
    cancelMock.mockResolvedValue({ id: SUB_ACTIVE, status: "canceled" });

    await cancelAllLiveSubscriptionsForUser({
      userId: USER_ID,
      admin: { rpc },
      stripe: stripe as never,
      log,
      requestId: "req-2",
      startedAt: Date.now(),
    });

    expect(listMock).toHaveBeenCalledWith({
      customer: CUSTOMER_ID,
      status: "all",
      limit: 100,
    });
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalledWith(SUB_ACTIVE);
  });

  it("cancels every live subscription when customer has multiple", async () => {
    rpc.mockResolvedValue({ data: { stripe_customer_id: CUSTOMER_ID }, error: null });
    listMock.mockResolvedValue({
      data: [
        { id: SUB_ACTIVE, status: "active" },
        { id: SUB_TRIALING, status: "trialing" },
        { id: SUB_PAST_DUE, status: "past_due" },
        { id: SUB_CANCELED, status: "canceled" },
      ],
    });
    cancelMock.mockResolvedValue({});

    await cancelAllLiveSubscriptionsForUser({
      userId: USER_ID,
      admin: { rpc },
      stripe: stripe as never,
      log,
      requestId: "req-3",
      startedAt: Date.now(),
    });

    // DB の 1 行ではなく list 結果の live 全件
    expect(cancelMock).toHaveBeenCalledTimes(3);
    expect(cancelMock).toHaveBeenCalledWith(SUB_ACTIVE);
    expect(cancelMock).toHaveBeenCalledWith(SUB_TRIALING);
    expect(cancelMock).toHaveBeenCalledWith(SUB_PAST_DUE);
    expect(cancelMock).not.toHaveBeenCalledWith(SUB_CANCELED);
  });

  it("tries remaining cancels then throws when one cancel fails (AP1 fail-closed)", async () => {
    rpc.mockResolvedValue({ data: { stripe_customer_id: CUSTOMER_ID }, error: null });
    listMock.mockResolvedValue({
      data: [
        { id: SUB_ACTIVE, status: "active" },
        { id: SUB_TRIALING, status: "trialing" },
      ],
    });
    cancelMock
      .mockRejectedValueOnce(new Error("stripe cancel boom"))
      .mockResolvedValueOnce({ id: SUB_TRIALING, status: "canceled" });

    await expect(
      cancelAllLiveSubscriptionsForUser({
        userId: USER_ID,
        admin: { rpc },
        stripe: stripe as never,
        log,
        requestId: "req-4",
        startedAt: Date.now(),
      }),
    ).rejects.toThrow(/cancel_failed/u);

    expect(cancelMock).toHaveBeenCalledTimes(2);
    expect(cancelMock).toHaveBeenCalledWith(SUB_ACTIVE);
    expect(cancelMock).toHaveBeenCalledWith(SUB_TRIALING);
    expect(events.some((e) => e.code === "billing_cancel_failed")).toBe(true);
    const failed = events.find((e) => e.code === "billing_cancel_failed");
    expect(failed?.stripeCustomerId).toBe(CUSTOMER_ID);
    expect(failed?.stripeSubscriptionId).toBe(SUB_ACTIVE);
    // email を載せない
    expect(JSON.stringify(events)).not.toContain(EMAIL);
  });

  it("allows delete path when stripe is null and no billing customer", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await cancelAllLiveSubscriptionsForUser({
      userId: USER_ID,
      admin: { rpc },
      stripe: null,
      log,
      requestId: "req-5",
      startedAt: Date.now(),
    });
    expect(rpc).toHaveBeenCalledWith("get_billing_customer_by_user", { p_user_id: USER_ID });
    expect(listMock).not.toHaveBeenCalled();
  });

  it("throws when stripe is null but billing customer exists (AP1)", async () => {
    rpc.mockResolvedValue({ data: { stripe_customer_id: CUSTOMER_ID }, error: null });
    await expect(
      cancelAllLiveSubscriptionsForUser({
        userId: USER_ID,
        admin: { rpc },
        stripe: null,
        log,
        requestId: "req-5b",
        startedAt: Date.now(),
      }),
    ).rejects.toThrow(/stripe_client_unavailable/u);
    expect(events.some((e) => e.code === "billing_cancel_failed")).toBe(true);
  });
});

describe("production deleteUser adapter", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    adminDeleteUserMock.mockReset();
    rpcMock.mockReset();
    getServerEnvMock.mockReset();
    getStripeClientFromEnvMock.mockReset();
    requireUserMock.mockResolvedValue({ userId: USER_ID, accessToken: ACCESS_TOKEN });
    adminDeleteUserMock.mockResolvedValue({ data: { user: null }, error: null });
    // release_identity → 0; release_flyer → 0; get_billing_customer → empty
    rpcMock.mockImplementation((name: string) => {
      if (name === "release_identity_and_global_for_user_processing") {
        return Promise.resolve({ data: 0, error: null });
      }
      if (name === "release_flyer_weekly_for_user_processing") {
        return Promise.resolve({ data: 0, error: null });
      }
      if (name === "get_billing_customer_by_user") {
        return Promise.resolve({ data: {}, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    getServerEnvMock.mockReturnValue({
      billingEnabled: false,
      stripe: undefined,
    });
  });

  it("passes (authenticatedUser.userId, false) for hard deletion after release RPC", async () => {
    const response = await productionHandler(makeDeleteRequest({ confirmation: "削除する" }));
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("release_identity_and_global_for_user_processing", {
      p_user_id: USER_ID,
    });
    expect(rpcMock).toHaveBeenCalledWith("release_flyer_weekly_for_user_processing", {
      p_user_id: USER_ID,
    });
    expect(adminDeleteUserMock).toHaveBeenCalledTimes(1);
    expect(adminDeleteUserMock).toHaveBeenCalledWith(USER_ID, false);
  });

  it("calls flyer release after identity release and before auth delete", async () => {
    const response = await productionHandler(makeDeleteRequest({ confirmation: "削除する" }));
    expect(response.status).toBe(200);
    const identityOrder = rpcMock.mock.calls.findIndex(
      (c) => c[0] === "release_identity_and_global_for_user_processing",
    );
    const flyerOrder = rpcMock.mock.calls.findIndex(
      (c) => c[0] === "release_flyer_weekly_for_user_processing",
    );
    expect(identityOrder).toBeGreaterThanOrEqual(0);
    expect(flyerOrder).toBeGreaterThanOrEqual(0);
    expect(identityOrder).toBeLessThan(flyerOrder);
    expect(rpcMock.mock.invocationCallOrder[flyerOrder]!).toBeLessThan(
      adminDeleteUserMock.mock.invocationCallOrder[0]!,
    );
  });

  it("skips Stripe when no billing customer and still deletes auth user", async () => {
    const listMock = vi.fn();
    getStripeClientFromEnvMock.mockReturnValue({
      subscriptions: { list: listMock, cancel: vi.fn() },
    });
    getServerEnvMock.mockReturnValue({
      billingEnabled: true,
      stripe: {
        secretKey: "sk_test_x",
        webhookSecret: "whsec_x",
        pricePlusMonthly: "price_m",
        pricePlusYearly: "price_y",
        apiVersion: "2026-06-24.dahlia",
      },
    });
    rpcMock.mockImplementation((name: string) => {
      if (name === "release_identity_and_global_for_user_processing") {
        return Promise.resolve({ data: 0, error: null });
      }
      if (name === "release_flyer_weekly_for_user_processing") {
        return Promise.resolve({ data: 0, error: null });
      }
      if (name === "get_billing_customer_by_user") {
        return Promise.resolve({ data: {}, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const response = await productionHandler(makeDeleteRequest({ confirmation: "削除する" }));
    expect(response.status).toBe(200);
    expect(listMock).not.toHaveBeenCalled();
    expect(adminDeleteUserMock).toHaveBeenCalledWith(USER_ID, false);
  });

  it("lists and cancels live sub then auth-deletes", async () => {
    const listMock = vi.fn().mockResolvedValue({
      data: [{ id: SUB_ACTIVE, status: "active" }],
    });
    const cancelMock = vi.fn().mockResolvedValue({ id: SUB_ACTIVE, status: "canceled" });
    getStripeClientFromEnvMock.mockReturnValue({
      subscriptions: { list: listMock, cancel: cancelMock },
    });
    getServerEnvMock.mockReturnValue({
      billingEnabled: true,
      stripe: {
        secretKey: "sk_test_x",
        webhookSecret: "whsec_x",
        pricePlusMonthly: "price_m",
        pricePlusYearly: "price_y",
        apiVersion: "2026-06-24.dahlia",
      },
    });
    rpcMock.mockImplementation((name: string) => {
      if (name === "release_identity_and_global_for_user_processing") {
        return Promise.resolve({ data: 0, error: null });
      }
      if (name === "release_flyer_weekly_for_user_processing") {
        return Promise.resolve({ data: 0, error: null });
      }
      if (name === "get_billing_customer_by_user") {
        return Promise.resolve({ data: { stripe_customer_id: CUSTOMER_ID }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const response = await productionHandler(makeDeleteRequest({ confirmation: "削除する" }));
    expect(response.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith({
      customer: CUSTOMER_ID,
      status: "all",
      limit: 100,
    });
    expect(cancelMock).toHaveBeenCalledWith(SUB_ACTIVE);
    expect(adminDeleteUserMock).toHaveBeenCalledWith(USER_ID, false);
    // cancel が delete より先
    expect(cancelMock.mock.invocationCallOrder[0]).toBeLessThan(
      adminDeleteUserMock.mock.invocationCallOrder[0]!,
    );
  });

  it("blocks auth-delete when one cancel fails among multiple live subs (AP1)", async () => {
    const listMock = vi.fn().mockResolvedValue({
      data: [
        { id: SUB_ACTIVE, status: "active" },
        { id: SUB_TRIALING, status: "trialing" },
      ],
    });
    const cancelMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("first cancel fails"))
      .mockResolvedValueOnce({});
    getStripeClientFromEnvMock.mockReturnValue({
      subscriptions: { list: listMock, cancel: cancelMock },
    });
    getServerEnvMock.mockReturnValue({
      billingEnabled: true,
      stripe: {
        secretKey: "sk_test_x",
        webhookSecret: "whsec_x",
        pricePlusMonthly: "price_m",
        pricePlusYearly: "price_y",
        apiVersion: "2026-06-24.dahlia",
      },
    });
    rpcMock.mockImplementation((name: string) => {
      if (name === "release_identity_and_global_for_user_processing") {
        return Promise.resolve({ data: 0, error: null });
      }
      if (name === "release_flyer_weekly_for_user_processing") {
        return Promise.resolve({ data: 0, error: null });
      }
      if (name === "get_billing_customer_by_user") {
        return Promise.resolve({ data: { stripe_customer_id: CUSTOMER_ID }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const response = await productionHandler(makeDeleteRequest({ confirmation: "削除する" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "billing_cancel_failed" },
    });
    expect(cancelMock).toHaveBeenCalledTimes(2);
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it("continues auth-delete when flyer release RPC fails (best-effort)", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "release_identity_and_global_for_user_processing") {
        return Promise.resolve({ data: 0, error: null });
      }
      if (name === "release_flyer_weekly_for_user_processing") {
        return Promise.resolve({ data: null, error: { message: "flyer release failed" } });
      }
      if (name === "get_billing_customer_by_user") {
        return Promise.resolve({ data: {}, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const response = await productionHandler(makeDeleteRequest({ confirmation: "削除する" }));
    expect(response.status).toBe(200);
    expect(adminDeleteUserMock).toHaveBeenCalledWith(USER_ID, false);
  });
});
