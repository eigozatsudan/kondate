import { describe, expect, it, vi } from "vitest";
import { config, createHandler } from "../auth-continuation-deposit.js";
import {
  decryptContinuationCode,
  encryptContinuationCode,
  sha256,
} from "../_shared/auth-continuation-crypto.js";

const ORIGIN = "https://app.test";
const STATE = "s".repeat(43);
const CONTINUATION_ID = "10000000-0000-4000-8000-000000000001";
const AUTH_CODE = "oauth-authorization-code-value-for-roundtrip";

describe("auth continuation deposit", () => {
  it("reads the ID only from the route params and rejects an ID in JSON", async () => {
    expect(config).toMatchObject({
      path: "/api/auth/continuations/:continuationId/callback",
      method: "POST",
      rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip"] },
    });
    const deposit = vi.fn().mockResolvedValue(true);
    const handler = createHandler({
      origin: ORIGIN,
      encryptionKey: new Uint8Array(32),
      deposit,
    });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({
          id: CONTINUATION_ID,
          state: STATE,
          code: "code",
        }),
      }),
      { params: { continuationId: CONTINUATION_ID } },
    );
    expect(response.status).toBe(400);
    expect(deposit).not.toHaveBeenCalled();
  });

  it("rejects missing Origin with a closed continuation_unavailable envelope", async () => {
    const deposit = vi.fn();
    const handler = createHandler({
      origin: ORIGIN,
      encryptionKey: new Uint8Array(32).fill(3),
      deposit,
    });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: STATE, code: AUTH_CODE }),
      }),
      { params: { continuationId: CONTINUATION_ID } },
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      error: {
        code: "continuation_unavailable",
        message: "認証をもう一度お試しください",
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/ciphertext|stack|secret|iv/iu);
    expect(deposit).not.toHaveBeenCalled();
  });

  it("rejects wrong Origin with a closed continuation_unavailable envelope", async () => {
    const deposit = vi.fn();
    const handler = createHandler({
      origin: ORIGIN,
      encryptionKey: new Uint8Array(32).fill(3),
      deposit,
    });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: "https://evil.test", "content-type": "application/json" },
        body: JSON.stringify({ state: STATE, code: AUTH_CODE }),
      }),
      { params: { continuationId: CONTINUATION_ID } },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "continuation_unavailable" },
    });
    expect(deposit).not.toHaveBeenCalled();
  });

  it("binds deposit to the hashed state and returns closed 404 when the transition rejects", async () => {
    const deposit = vi.fn().mockResolvedValue(false);
    const handler = createHandler({
      origin: ORIGIN,
      encryptionKey: new Uint8Array(32).fill(5),
      deposit,
    });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ state: STATE, code: AUTH_CODE }),
      }),
      { params: { continuationId: CONTINUATION_ID } },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "continuation_unavailable" },
    });
    expect(deposit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CONTINUATION_ID,
        origin: ORIGIN,
        stateHash: await sha256(STATE),
      }),
    );
    // 平文 state は transition に渡さない
    expect(deposit.mock.calls[0]?.[0]).not.toHaveProperty("state");
  });

  it("encrypts the code before deposit and returns 204 without exposing ciphertext", async () => {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
    let stored: {
      ciphertext: Uint8Array;
      iv: Uint8Array;
      stateHash: Uint8Array;
      origin: string;
    } | null = null;

    const deposit = vi
      .fn()
      .mockImplementation(
        async (input: {
          ciphertext: Uint8Array;
          iv: Uint8Array;
          stateHash: Uint8Array;
          origin: string;
        }) => {
          // 平文 code が transition に漏れていないこと
          const asText = new TextDecoder().decode(input.ciphertext);
          expect(asText).not.toBe(AUTH_CODE);
          expect(input.ciphertext.byteLength).toBeGreaterThan(0);
          expect(input.iv.byteLength).toBe(12);
          stored = {
            ciphertext: input.ciphertext,
            iv: input.iv,
            stateHash: input.stateHash,
            origin: input.origin,
          };
          return true;
        },
      );

    const handler = createHandler({ origin: ORIGIN, encryptionKey, deposit });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ state: STATE, code: AUTH_CODE }),
      }),
      { params: { continuationId: CONTINUATION_ID } },
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(deposit).toHaveBeenCalledTimes(1);
    expect(stored).not.toBeNull();
    // AAD 付き AES-GCM で復号できること（encrypt-before-deposit の証拠）
    await expect(
      decryptContinuationCode(
        { ciphertext: stored!.ciphertext, iv: stored!.iv },
        CONTINUATION_ID,
        ORIGIN,
        encryptionKey,
      ),
    ).resolves.toBe(AUTH_CODE);
    expect(stored!.stateHash).toEqual(await sha256(STATE));
  });

  it("uses real crypto material that is not the zero key for a successful deposit", async () => {
    // ゼロ埋め key でも動くが、成功経路では乱数 key を使うことを明示する
    const encryptionKey = new Uint8Array(32);
    crypto.getRandomValues(encryptionKey);
    expect(encryptionKey.some((byte) => byte !== 0)).toBe(true);

    const deposit = vi.fn().mockResolvedValue(true);
    const handler = createHandler({ origin: ORIGIN, encryptionKey, deposit });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ state: STATE, code: AUTH_CODE }),
      }),
      { params: { continuationId: CONTINUATION_ID } },
    );
    expect(response.status).toBe(204);
    const input = deposit.mock.calls[0]?.[0] as { ciphertext: Uint8Array; iv: Uint8Array };
    // 同一平文でも IV がランダムなので、独立 encrypt と一致しない
    const other = await encryptContinuationCode(AUTH_CODE, CONTINUATION_ID, ORIGIN, encryptionKey);
    expect(Buffer.from(input.iv).equals(Buffer.from(other.iv))).toBe(false);
  });
});
