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

  it("deposit then claim through a shared in-memory store is a real crypto roundtrip", async () => {
    // P1#3: deposit と claim を別テストではなく、共有 store 経由で encrypt→decrypt する。
    const { createHandler: createClaimHandler } = await import("../auth-continuation-claim.js");
    const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
    const SECRET = "k".repeat(43);
    const RETURN_TO = "/planner";
    type Stored = {
      ciphertext: Uint8Array;
      iv: Uint8Array;
      stateHash: Uint8Array;
      secretHash: Uint8Array;
      claimed: boolean;
    };
    const store: { row: Stored | null } = { row: null };

    const deposit = vi.fn().mockImplementation(async (input: {
      ciphertext: Uint8Array;
      iv: Uint8Array;
      stateHash: Uint8Array;
    }) => {
      store.row = {
        ciphertext: input.ciphertext,
        iv: input.iv,
        stateHash: input.stateHash,
        secretHash: await sha256(SECRET),
        claimed: false,
      };
      return true;
    });
    const claim = vi.fn().mockImplementation(
      async (input: { stateHash: Uint8Array; secretHash: Uint8Array }) => {
        if (store.row === null || store.row.claimed) return null;
        if (
          !Buffer.from(input.stateHash).equals(Buffer.from(store.row.stateHash)) ||
          !Buffer.from(input.secretHash).equals(Buffer.from(store.row.secretHash))
        ) {
          return null;
        }
        store.row.claimed = true;
        return {
          ciphertext: store.row.ciphertext,
          iv: store.row.iv,
          returnTo: RETURN_TO,
        };
      },
    );

    const depositHandler = createHandler({ origin: ORIGIN, encryptionKey, deposit });
    const depositResponse = await depositHandler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ state: STATE, code: AUTH_CODE }),
      }),
      { params: { continuationId: CONTINUATION_ID } },
    );
    expect(depositResponse.status).toBe(204);
    expect(store.row).not.toBeNull();
    // store 上は平文 code ではなく ciphertext
    expect(new TextDecoder().decode(store.row!.ciphertext)).not.toBe(AUTH_CODE);

    const claimHandler = createClaimHandler({ origin: ORIGIN, encryptionKey, claim });
    const claimResponse = await claimHandler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ secret: SECRET, state: STATE }),
      }),
      { params: { continuationId: CONTINUATION_ID } },
    );
    expect(claimResponse.status).toBe(200);
    const body = await claimResponse.json();
    expect(body).toEqual({ ok: true, data: { code: AUTH_CODE, returnTo: RETURN_TO } });
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/ciphertext|encrypted/iu);
    expect(raw).not.toContain(Buffer.from(store.row!.ciphertext).toString("hex"));
  });
});
