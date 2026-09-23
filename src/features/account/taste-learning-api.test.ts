import { expect, it, vi } from "vitest";
import { getTasteLearningState, setTasteLearningEnabled } from "./taste-learning-api";

function makeReadClient(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as never, from, select, eq };
}

it("reads taste_learning_enabled and taste_learning_seq for the given user", async () => {
  const { client, from, select, eq } = makeReadClient({
    data: { taste_learning_enabled: true, taste_learning_seq: 4 },
    error: null,
  });

  await expect(getTasteLearningState(client, "user-1")).resolves.toEqual({
    enabled: true,
    seq: 4,
  });
  expect(from).toHaveBeenCalledWith("profiles");
  expect(select).toHaveBeenCalledWith("taste_learning_enabled, taste_learning_seq");
  expect(eq).toHaveBeenCalledWith("user_id", "user-1");
});

it("throws an opaque error when the read fails", async () => {
  const { client } = makeReadClient({ data: null, error: { message: "boom" } });

  await expect(getTasteLearningState(client, "user-1")).rejects.toThrow(
    "taste_learning_read_failed",
  );
});

it.each([
  ["a non-boolean enabled", { taste_learning_enabled: "yes", taste_learning_seq: 0 }],
  ["a missing seq", { taste_learning_enabled: true }],
  ["a negative seq", { taste_learning_enabled: true, taste_learning_seq: -1 }],
  ["a fractional seq", { taste_learning_enabled: true, taste_learning_seq: 1.5 }],
  ["a string seq", { taste_learning_enabled: true, taste_learning_seq: "1" }],
  [
    "an unsafe integer seq",
    { taste_learning_enabled: true, taste_learning_seq: Number.MAX_SAFE_INTEGER + 1 },
  ],
  ["an extra key", { taste_learning_enabled: true, taste_learning_seq: 0, user_id: "u" }],
])("rejects a malformed read payload with %s", async (_label, data) => {
  const { client } = makeReadClient({ data, error: null });

  await expect(getTasteLearningState(client, "user-1")).rejects.toThrow();
});

it("writes via set_taste_learning_enabled with the expected seq and returns the CAS result", async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: { enabled: false, seq: 3, applied: true },
    error: null,
  });
  const client = { rpc } as never;

  await expect(setTasteLearningEnabled(client, false, 2)).resolves.toEqual({
    enabled: false,
    seq: 3,
    applied: true,
  });
  expect(rpc).toHaveBeenCalledWith("set_taste_learning_enabled", {
    p_enabled: false,
    p_expected_seq: 2,
  });
});

it("returns the current server state when the CAS is not applied", async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: { enabled: true, seq: 7, applied: false },
    error: null,
  });
  const client = { rpc } as never;

  await expect(setTasteLearningEnabled(client, false, 5)).resolves.toEqual({
    enabled: true,
    seq: 7,
    applied: false,
  });
});

it("throws an opaque error when the write fails", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
  const client = { rpc } as never;

  await expect(setTasteLearningEnabled(client, true, 0)).rejects.toThrow(
    "taste_learning_write_failed",
  );
});

it.each([
  ["a bare boolean", true],
  ["a missing applied flag", { enabled: true, seq: 1 }],
  ["a non-boolean applied flag", { enabled: true, seq: 1, applied: "true" }],
  ["a negative seq", { enabled: true, seq: -1, applied: true }],
  ["a fractional seq", { enabled: true, seq: 0.5, applied: true }],
  ["an extra key", { enabled: true, seq: 1, applied: true, extra: 1 }],
])("rejects a malformed write payload with %s", async (_label, data) => {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  const client = { rpc } as never;

  await expect(setTasteLearningEnabled(client, true, 0)).rejects.toThrow();
});

it("forwards an AbortSignal to rpc().abortSignal() without changing the RPC arguments", async () => {
  const signal = new AbortController().signal;
  const abortSignal = vi.fn().mockResolvedValue({
    data: { enabled: false, seq: 1, applied: true },
    error: null,
  });
  const rpc = vi.fn().mockReturnValue({ abortSignal });
  const client = { rpc } as never;

  await expect(setTasteLearningEnabled(client, false, 0, { signal })).resolves.toEqual({
    enabled: false,
    seq: 1,
    applied: true,
  });
  expect(rpc).toHaveBeenCalledWith("set_taste_learning_enabled", {
    p_enabled: false,
    p_expected_seq: 0,
  });
  expect(abortSignal).toHaveBeenCalledWith(signal);
});
