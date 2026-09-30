import { beforeEach, expect, it, vi } from "vitest";
import handler, { config } from "../menu-generation-background.js";
import { requireUserWithEmail } from "../_shared/auth.js";
import { executeMenuBackground } from "../_shared/menu-background.js";
import { HttpError } from "../_shared/http.js";
import * as http from "../_shared/http.js";
import { menuBackgroundSignatureHeaders } from "../_shared/menu-background-signature.js";
vi.mock("../_shared/env.js", () => ({
  getServerEnv: () => ({ generationIntegrity: { requestHmacKey: new Uint8Array(32).fill(7) } }),
}));
vi.mock("../_shared/auth.js", () => ({ requireUserWithEmail: vi.fn() }));
vi.mock("../_shared/menu-background.js", () => ({
  executeMenuBackground: vi.fn(() => Promise.resolve()),
}));
vi.mock("../_shared/local-mock-scenario.js", () => ({ readLocalMockScenario: () => undefined }));
const user = {
  userId: "85000000-0000-4000-8000-000000000001",
  accessToken: "secret-token",
  email: "private@example.invalid",
};
const command = {
  commandVersion: "generation-command.v3",
  kind: "new_menu",
  qualityMode: false,
  request: {
    idempotencyKey: "82000000-0000-4000-8000-000000000001",
    draftId: "84000000-0000-4000-8000-000000000001",
    draftRevision: 1,
    privacyNoticeVersion: "2026-07-29.v1",
    expiredPantryConfirmations: [],
  },
};
const token = "91000000-0000-4000-8000-000000000001";
function request(body: unknown, signed = true, timestamp = Date.now()) {
  const rawBody = JSON.stringify(body);
  const authorization = "Bearer secret-token";
  return new Request("https://trusted.example/.netlify/functions/menu-generation-background", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization,
      ...(signed
        ? menuBackgroundSignatureHeaders(
            new Uint8Array(32).fill(7),
            authorization,
            rawBody,
            timestamp,
          )
        : {}),
    },
    body: rawBody,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserWithEmail).mockResolvedValue(user);
});
it("is an independent Netlify background function and authenticates before execution", async () => {
  expect(config.background).toBe(true);
  expect(config.method).toBe("POST");
  expect(config.rateLimit).toEqual({ windowLimit: 5000, windowSize: 180, aggregateBy: ["ip"] });
  await handler(request({ command, token }));
  expect(executeMenuBackground).toHaveBeenCalledWith(user, command, token, undefined);
});
it("rejects unsigned direct invocation before Auth", async () => {
  await handler(request({ command, token }, false));
  expect(requireUserWithEmail).not.toHaveBeenCalled();
  expect(executeMenuBackground).not.toHaveBeenCalled();
});
it("permanent Auth rejection completes normally rather than retrying", async () => {
  vi.mocked(requireUserWithEmail).mockRejectedValue(
    new HttpError(401, "auth_required", "認証してください"),
  );
  await expect(handler(request({ command, token }))).resolves.toBeUndefined();
});
it("does not execute with an invalid or expired bearer session", async () => {
  vi.mocked(requireUserWithEmail).mockRejectedValue(
    new HttpError(401, "auth_required", "認証してください"),
  );
  await expect(handler(request({ command, token }))).resolves.toBeUndefined();
  expect(executeMenuBackground).not.toHaveBeenCalled();
});
it.each([
  { command, token: "invalid" },
  { command, token, ownerId: user.userId },
  { command: { ...command, kind: "regenerate_dish" }, token },
])("rejects an invalid worker envelope before execution", async (body) => {
  await expect(handler(request(body))).resolves.toBeUndefined();
  expect(requireUserWithEmail).not.toHaveBeenCalled();
  expect(executeMenuBackground).not.toHaveBeenCalled();
});
it.each(["signature", "authorization", "timestamp"])(
  "rejects tampered %s before Auth",
  async (field) => {
    const input = request({ command, token });
    const header = field === "authorization" ? "authorization" : `x-kondate-background-${field}`;
    input.headers.set(
      header,
      field === "authorization"
        ? "Bearer other-token"
        : field === "timestamp"
          ? String(Date.now() - 1000)
          : "a".repeat(64),
    );
    await handler(input);
    expect(requireUserWithEmail).not.toHaveBeenCalled();
  },
);
it("rejects changed raw body before Auth", async () => {
  const input = request({ command, token });
  await handler(
    new Request(input.url, {
      method: "POST",
      headers: input.headers,
      body: JSON.stringify({ command, token: "91000000-0000-4000-8000-000000000002" }),
    }),
  );
  expect(requireUserWithEmail).not.toHaveBeenCalled();
});
it.each([125_000, 180_000, -10_000])(
  "rejects expired or future timestamp %s before Auth",
  async (age) => {
    await handler(request({ command, token }, true, Date.now() - age));
    expect(requireUserWithEmail).not.toHaveBeenCalled();
  },
);
it("allows 60s platform retry while independently authenticating", async () => {
  await handler(request({ command, token }, true, Date.now() - 60_000));
  expect(requireUserWithEmail).toHaveBeenCalledTimes(1);
  expect(executeMenuBackground).toHaveBeenCalledTimes(1);
});
it.each([new Error("network unavailable"), new HttpError(503, "request_failed", "処理できません")])(
  "propagates transient failure for platform retry",
  async (error) => {
    vi.mocked(executeMenuBackground).mockRejectedValueOnce(error);
    await expect(handler(request({ command, token }))).rejects.toBe(error);
  },
);
it("returns normally for permanent persisted command rejection", async () => {
  vi.mocked(executeMenuBackground).mockRejectedValueOnce(
    new HttpError(409, "idempotency_conflict", "確認してください"),
  );
  await expect(handler(request({ command, token }))).resolves.toBeUndefined();
});
it("bounds a noncooperative unauthenticated body reader without Auth or retry", async () => {
  vi.useFakeTimers();
  const read = vi
    .spyOn(http, "readJsonTextWithLimit")
    .mockImplementationOnce(() => new Promise(() => {}));
  try {
    const result = handler(request({ command, token }));
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toBeUndefined();
    expect(requireUserWithEmail).not.toHaveBeenCalled();
  } finally {
    read.mockRestore();
    vi.useRealTimers();
  }
});
it.each([
  ["x-kondate-background-timestamp", "invalid"],
  ["x-kondate-background-signature", "A".repeat(64)],
  ["authorization", "invalid"],
])("rejects malformed %s without reading body", async (header, value) => {
  const input = request({ command, token });
  input.headers.set(header, value);
  await handler(input);
  expect(input.bodyUsed).toBe(false);
  expect(requireUserWithEmail).not.toHaveBeenCalled();
});
it("rejects unsigned path changes without reading body", async () => {
  const original = request({ command, token });
  const input = new Request("https://trusted.example/other", {
    method: "POST",
    headers: original.headers,
    body: JSON.stringify({ command, token }),
  });
  await handler(input);
  expect(input.bodyUsed).toBe(false);
  expect(requireUserWithEmail).not.toHaveBeenCalled();
});
