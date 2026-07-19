// @vitest-environment node
import { EventEmitter } from "node:events";
import { request as requestHttp } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { menuResponseFormat } from "../../shared/contracts/generation.js";
import { createOpenRouterMockServer } from "./server.mjs";

let server;

const primaryModel = "mock/kondate-primary:free";
const repairModel = "mock/kondate-repair:free";
const messageSentinel = "PRIVATE_MESSAGE_SENTINEL";
const bearerSentinel = "local-mock-key";
const invalidBearer = "PRIVATE_BEARER_SENTINEL";
const unfinishedRequestDeadlineMs = 5_000;

const startServer = async () => {
  server = createOpenRouterMockServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Mock server did not bind a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
};

const validRequest = ({ models = [primaryModel, repairModel] } = {}) => ({
  models,
  messages: [{ role: "user", content: messageSentinel }],
  response_format: structuredClone(menuResponseFormat),
  provider: { require_parameters: true },
  temperature: 0.2,
  stream: false,
});

const send = async (origin, options = {}) =>
  fetch(`${origin}${options.path ?? "/api/v1/chat/completions"}`, {
    method: options.method ?? "POST",
    headers: {
      Authorization: `Bearer ${options.bearer ?? "local-mock-key"}`,
      "Content-Type": options.contentType ?? "application/json",
      ...(options.scenario ? { "X-Kondate-Mock-Scenario": options.scenario } : {}),
    },
    body:
      (options.method ?? "POST") === "GET"
        ? undefined
        : (options.body ?? JSON.stringify(validRequest(options))),
  });

const createUnfinishedOversizedRequest = (origin) => {
  let request;
  let response;
  let timeout;
  let onResponseEnd = () => {};
  let onRequestError = () => {};
  const promise = new Promise((resolve, reject) => {
    const url = new URL(origin);
    let responseReceived = false;
    request = requestHttp(
      {
        hostname: url.hostname,
        port: url.port,
        path: "/api/v1/chat/completions",
        method: "POST",
        headers: {
          Authorization: "Bearer local-mock-key",
          "Content-Type": "application/json",
          "Transfer-Encoding": "chunked",
        },
      },
      (incomingResponse) => {
        response = incomingResponse;
        responseReceived = true;
        response.resume();
        onResponseEnd = () => {
          clearTimeout(timeout);
          resolve({ status: response.statusCode, connection: response.headers.connection });
        };
        response.once("end", onResponseEnd);
      },
    );
    timeout = setTimeout(() => {
      request.destroy();
      reject(new Error("oversized unfinished request did not receive a prompt response"));
    }, unfinishedRequestDeadlineMs);
    onRequestError = (error) => {
      if (!responseReceived) {
        clearTimeout(timeout);
        reject(error);
      }
    };
    request.once("error", onRequestError);
    request.write("x".repeat(1_000_001));
  });
  const cleanup = () => {
    clearTimeout(timeout);
    response?.off("end", onResponseEnd);
    request?.off("error", onRequestError);
    request?.destroy();
  };
  return { promise, cleanup };
};

afterEach(async () => {
  const activeServer = server;
  server = undefined;
  if (activeServer) {
    await new Promise((resolve, reject) =>
      activeServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("returns a deterministic health payload", async () => {
  const origin = await startServer();
  const response = await fetch(`${origin}/health`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

describe("strict chat completion protocol", () => {
  it("accepts the exact generation request and returns the selected model", async () => {
    const origin = await startServer();
    const response = await send(origin);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.model).toBe(primaryModel);
    expect(JSON.parse(body.choices[0].message.content).outcome).toBe("success");
  });

  it.each([
    ["wrong method", { method: "GET" }, 404],
    ["wrong path", { path: "/api/v1/models" }, 404],
    ["invalid json", { body: "{" }, 400],
    ["wrong content type", { contentType: "text/plain" }, 400],
    ["wrong bearer", { bearer: invalidBearer }, 401],
  ])("rejects %s", async (_name, options, status) => {
    const origin = await startServer();
    expect((await send(origin, options)).status).toBe(status);
  });

  it.each([
    ["null body", null],
    ["array body", []],
    ["missing field", { ...validRequest(), stream: undefined }],
    ["extra field", { ...validRequest(), top_p: 1 }],
    ["wrong nested provider", { ...validRequest(), provider: null }],
    [
      "extra nested provider field",
      { ...validRequest(), provider: { require_parameters: true, x: 1 } },
    ],
    ["wrong models type", { ...validRequest(), models: primaryModel }],
    ["wrong messages type", { ...validRequest(), messages: "message" }],
    ["wrong message role", { ...validRequest(), messages: [{ role: "tool", content: "x" }] }],
    [
      "extra message field",
      { ...validRequest(), messages: [{ role: "user", content: "x", name: "x" }] },
    ],
    ["wrong response format type", { ...validRequest(), response_format: null }],
    ["wrong temperature type", { ...validRequest(), temperature: "0.2" }],
    ["wrong stream type", { ...validRequest(), stream: "false" }],
    ["non-free model", validRequest({ models: ["mock/paid"] })],
    ["duplicate models", validRequest({ models: [repairModel, repairModel] })],
    ["wrong model order", validRequest({ models: [repairModel, primaryModel] })],
  ])("rejects %s", async (_name, value) => {
    const origin = await startServer();
    const response = await send(origin, { body: JSON.stringify(value) });
    expect(response.status).toBe(400);
  });

  it("rejects oversized bodies", async () => {
    const origin = await startServer();
    const response = await send(origin, { body: `{"padding":"${"x".repeat(1_000_001)}"}` });
    expect(response.status).toBe(413);
  });

  it("writes only one 413 for a completely sent oversized body", async () => {
    const isolatedServer = createOpenRouterMockServer();
    const statuses = [];
    const unhandledRejections = [];
    const { promise: flushed, resolve: resolveFlushed } = Promise.withResolvers();
    const request = Object.assign(new EventEmitter(), {
      method: "POST",
      url: "/api/v1/chat/completions",
      headers: {
        authorization: "Bearer local-mock-key",
        "content-type": "application/json",
      },
      pause: vi.fn(),
      destroy: vi.fn(),
    });
    const response = Object.assign(new EventEmitter(), {
      headersSent: false,
      writableEnded: false,
      shouldKeepAlive: true,
      writeHead(status) {
        statuses.push(status);
        if (this.headersSent) throw new Error("headers already sent");
        this.headersSent = true;
        return this;
      },
      end(...args) {
        this.writableEnded = true;
        const callback = args.find((argument) => typeof argument === "function");
        queueMicrotask(() => {
          callback?.();
          resolveFlushed();
        });
        return this;
      },
      destroy: vi.fn(),
    });
    const onUnhandledRejection = (reason) => unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      isolatedServer.emit("request", request, response);
      request.emit("data", Buffer.alloc(1_000_001));
      request.emit("end");
      await flushed;
      expect(statuses.filter((status) => status === 413)).toHaveLength(1);
      expect(statuses).not.toContain(400);
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  it("closes parallel oversized unfinished streams after flushing 413", async () => {
    const origin = await startServer();
    const unhandledRejections = [];
    const onUnhandledRejection = (reason) => unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(process.stdout, "write").mockImplementation(() => true),
      vi.spyOn(process.stderr, "write").mockImplementation(() => true),
    ];
    const clients = [
      createUnfinishedOversizedRequest(origin),
      createUnfinishedOversizedRequest(origin),
    ];

    try {
      const results = await Promise.all(clients.map((client) => client.promise));
      expect(results).toEqual([
        { status: 413, connection: "close" },
        { status: 413, connection: "close" },
      ]);
      const health = await fetch(`${origin}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok" });
      expect(unhandledRejections).toEqual([]);
      expect(spies.flatMap((spy) => spy.mock.calls.flat())).toEqual([]);
    } finally {
      for (const client of clients) client.cleanup();
      process.off("unhandledRejection", onUnhandledRejection);
      for (const spy of spies) spy.mockRestore();
    }
  });

  it.each(["unknown", "__proto__", "constructor"])(
    "rejects unknown scenario %s",
    async (scenario) => {
      const origin = await startServer();
      expect((await send(origin, { scenario })).status).toBe(404);
    },
  );
});

describe("stateless repair sequence", () => {
  it("repeats primary-malformed and repair-success pairs in parallel", async () => {
    const origin = await startServer();
    const pairs = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const primary = await send(origin, { scenario: "invalid-then-success" });
        const repair = await send(origin, {
          scenario: "invalid-then-success",
          models: [repairModel],
        });
        return [await primary.json(), await repair.json()];
      }),
    );
    for (const [primary, repair] of pairs) {
      expect(primary.model).toBe(primaryModel);
      expect(primary.choices[0].message.content).toBe("{not-json");
      expect(repair.model).toBe(repairModel);
      expect(JSON.parse(repair.choices[0].message.content).outcome).toBe("success");
    }
  });

  it("does not log request or fixture secrets", async () => {
    const origin = await startServer();
    const fixtureSentinel = "必須食材と安全条件を同時に満たせません。";
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(process.stdout, "write").mockImplementation(() => true),
      vi.spyOn(process.stderr, "write").mockImplementation(() => true),
    ];
    const response = await send(origin, { scenario: "constraint-conflict" });
    expect(response.status).toBe(200);
    const output = spies.flatMap((spy) => spy.mock.calls.flat()).join(" ");
    expect(output).not.toContain(bearerSentinel);
    expect(output).not.toContain(messageSentinel);
    expect(output).not.toContain(fixtureSentinel);
    for (const spy of spies) spy.mockRestore();
  });

  it("closes an aborted request without an unhandled rejection", async () => {
    const origin = new URL(await startServer());
    await new Promise((resolve) => {
      const request = requestHttp({
        hostname: origin.hostname,
        port: origin.port,
        path: "/api/v1/chat/completions",
        method: "POST",
        headers: {
          Authorization: "Bearer local-mock-key",
          "Content-Type": "application/json",
        },
      });
      request.on("error", resolve);
      request.write('{"models":[');
      request.destroy();
      setTimeout(resolve, 20);
    });
  });
});
