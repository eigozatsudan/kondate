import { describe, expect, it, vi } from "vitest";

const stripeCtor = vi.hoisted(() =>
  vi.fn(function StripeMock(this: { mocked: boolean }, ..._args: unknown[]) {
    void _args;
    this.mocked = true;
  }),
);

vi.mock("stripe", () => ({
  default: stripeCtor,
}));

function lastCtorOptions(): Record<string, unknown> {
  const call = stripeCtor.mock.calls.at(-1);
  expect(call).toBeDefined();
  expect(call!.length).toBeGreaterThanOrEqual(2);
  return call![1] as Record<string, unknown>;
}

describe("createStripeClient", () => {
  it("pins apiVersion and applies mockBaseUrl host/protocol/port when provided", async () => {
    stripeCtor.mockClear();
    const { createStripeClient, STRIPE_API_VERSION } = await import("./billing-stripe.js");

    createStripeClient("sk_test_x", {
      mockBaseUrl: "http://stripe-mock:1919",
    });

    expect(stripeCtor).toHaveBeenCalledTimes(1);
    const options = lastCtorOptions();
    expect(options.apiVersion).toBe(STRIPE_API_VERSION);
    expect(options.host).toBe("stripe-mock");
    expect(options.protocol).toBe("http");
    expect(options.port).toBe("1919");
  });

  it("does not set host when mockBaseUrl is omitted", async () => {
    stripeCtor.mockClear();
    const { createStripeClient } = await import("./billing-stripe.js");

    createStripeClient("sk_test_x");

    const options = lastCtorOptions();
    expect(options).not.toHaveProperty("host");
    expect(options).not.toHaveProperty("protocol");
    expect(options).not.toHaveProperty("port");
  });
});
