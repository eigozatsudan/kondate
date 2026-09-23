import { expect, it, vi } from "vitest";
import { getTasteLearningEnabled, setTasteLearningEnabled } from "./taste-learning-api";

it("reads taste_learning_enabled for the given user", async () => {
  const single = vi.fn().mockResolvedValue({ data: { taste_learning_enabled: true }, error: null });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const client = { from } as never;

  await expect(getTasteLearningEnabled(client, "user-1")).resolves.toBe(true);
  expect(from).toHaveBeenCalledWith("profiles");
  expect(select).toHaveBeenCalledWith("taste_learning_enabled");
  expect(eq).toHaveBeenCalledWith("user_id", "user-1");
});

it("throws an opaque error when the read fails", async () => {
  const single = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const client = { from } as never;

  await expect(getTasteLearningEnabled(client, "user-1")).rejects.toThrow(
    "taste_learning_read_failed",
  );
});

it("rejects a malformed read payload instead of trusting raw data", async () => {
  const single = vi
    .fn()
    .mockResolvedValue({ data: { taste_learning_enabled: "yes" }, error: null });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const client = { from } as never;

  await expect(getTasteLearningEnabled(client, "user-1")).rejects.toThrow();
});

it("writes via set_taste_learning_enabled and returns the server boolean", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
  const client = { rpc } as never;

  await expect(setTasteLearningEnabled(client, false)).resolves.toBe(false);
  expect(rpc).toHaveBeenCalledWith("set_taste_learning_enabled", { p_enabled: false });
});

it("throws an opaque error when the write fails", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
  const client = { rpc } as never;

  await expect(setTasteLearningEnabled(client, true)).rejects.toThrow(
    "taste_learning_write_failed",
  );
});

it("rejects a malformed write payload instead of trusting raw data", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: "true", error: null });
  const client = { rpc } as never;

  await expect(setTasteLearningEnabled(client, true)).rejects.toThrow();
});

it("N-1: forwards an AbortSignal to rpc().abortSignal() without changing the no-signal call shape", async () => {
  const signal = new AbortController().signal;
  const abortSignal = vi.fn().mockResolvedValue({ data: false, error: null });
  const rpc = vi.fn().mockReturnValue({ abortSignal });
  const client = { rpc } as never;

  await expect(setTasteLearningEnabled(client, false, { signal })).resolves.toBe(false);
  expect(rpc).toHaveBeenCalledWith("set_taste_learning_enabled", { p_enabled: false });
  expect(abortSignal).toHaveBeenCalledWith(signal);
});
