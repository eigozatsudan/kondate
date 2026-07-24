import { describe, expect, it, vi } from "vitest";
import { config, createHandler } from "../auth-continuation-claim.js";
import { encryptContinuationCode, sha256 } from "../_shared/auth-continuation-crypto.js";

const ORIGIN = "https://app.test";
const STATE = "s".repeat(43);
const SECRET = "k".repeat(43);
const CONTINUATION_ID = "10000000-0000-4000-8000-000000000001";
const AUTH_CODE = "oauth-authorization-code-value-for-roundtrip";
const RETURN_TO = "/planner";

describe("auth continuation claim", () => {
  it("uses state and secret binding and hides unavailable continuations", async () => {
    expect(config).toMatchObject({
      path: "/api/auth/continuations/:continuationId/claim",
      method: "POST",
      rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip"] },
    });
    const claim = vi.fn().mockResolvedValue(null);
    const handler = createHandler({
      origin: ORIGIN,
      encryptionKey: new Uint8Array(32),
      claim,
    });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ secret: SECRET, state: STATE }),
      }),
      { params: { continuationId: CONTINUATION_ID } },
    );
    expect(response.status).toBe(404);
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CONTINUATION_ID,
        origin: ORIGIN,
      }),
    );
  });

  it("rejects missing Origin with a closed continuation_unavailable envelope", async () => {
    const claim = vi.fn();
    const handler = createHandler({
      origin: ORIGIN,
      encryptionKey: new Uint8Array(32).fill(1),
      claim,
    });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: SECRET, state: STATE }),
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
    // 閉じた error code 以外の機微情報を出さない
    expect(JSON.stringify(body)).not.toMatch(/ciphertext|stack|zod|issues/iu);
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(claim).not.toHaveBeenCalled();
  });

  it("rejects wrong Origin with a closed continuation_unavailable envelope", async () => {
    const claim = vi.fn();
    const handler = createHandler({
      origin: ORIGIN,
      encryptionKey: new Uint8Array(32).fill(1),
      claim,
    });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: "https://evil.test", "content-type": "application/json" },
        body: JSON.stringify({ secret: SECRET, state: STATE }),
      }),
      { params: { continuationId: CONTINUATION_ID } },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "continuation_unavailable" },
    });
    expect(claim).not.toHaveBeenCalled();
  });

  it("hashes state and secret for binding and never echoes them on failure", async () => {
    const claim = vi.fn().mockResolvedValue(null);
    const handler = createHandler({
      origin: ORIGIN,
      encryptionKey: new Uint8Array(32).fill(2),
      claim,
    });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ secret: SECRET, state: STATE }),
      }),
      { params: { continuationId: CONTINUATION_ID } },
    );
    expect(response.status).toBe(404);
    expect(claim).toHaveBeenCalledWith({
      id: CONTINUATION_ID,
      stateHash: await sha256(STATE),
      secretHash: await sha256(SECRET),
      origin: ORIGIN,
      now: expect.any(String),
    });
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(STATE);
  });

  it("decrypts after claim and returns a 200 envelope without ciphertext", async () => {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
    const encrypted = await encryptContinuationCode(
      AUTH_CODE,
      CONTINUATION_ID,
      ORIGIN,
      encryptionKey,
    );

    // in-memory transition double: deposit 相当の行を claim が返す
    const store = {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      returnTo: RETURN_TO,
      claimed: false,
    };

    const claim = vi
      .fn()
      .mockImplementation(
        async (input: { stateHash: Uint8Array; secretHash: Uint8Array; origin: string }) => {
          // state/secret ハッシュ不一致は null（binding 違反）
          if (
            input.origin !== ORIGIN ||
            !Buffer.from(input.stateHash).equals(Buffer.from(await sha256(STATE))) ||
            !Buffer.from(input.secretHash).equals(Buffer.from(await sha256(SECRET)))
          ) {
            return null;
          }
          if (store.claimed) return null;
          store.claimed = true;
          // claim 後は ciphertext を消去する ledger 契約を模倣
          const result = {
            ciphertext: store.ciphertext,
            iv: store.iv,
            returnTo: store.returnTo,
          };
          store.ciphertext = new Uint8Array(0);
          store.iv = new Uint8Array(0);
          return result;
        },
      );

    const handler = createHandler({ origin: ORIGIN, encryptionKey, claim });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ secret: SECRET, state: STATE }),
      }),
      { params: { continuationId: CONTINUATION_ID } },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: { code: AUTH_CODE, returnTo: RETURN_TO },
    });
    const raw = JSON.stringify(body);
    // ciphertext / iv を HTTP 応答に露出しない
    expect(raw).not.toMatch(/ciphertext|encrypted|\\x|code_iv/iu);
    expect(Buffer.from(encrypted.ciphertext).toString("hex")).not.toEqual("");
    expect(raw).not.toContain(Buffer.from(encrypted.ciphertext).toString("hex"));
    expect(raw).not.toContain(Buffer.from(encrypted.iv).toString("hex"));

    // 再利用 claim は失敗（single-use）
    const replay = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ secret: SECRET, state: STATE }),
      }),
      { params: { continuationId: CONTINUATION_ID } },
    );
    expect(replay.status).toBe(404);
  });

  it("rejects secret hash binding violations with a closed 404", async () => {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
    const encrypted = await encryptContinuationCode(
      AUTH_CODE,
      CONTINUATION_ID,
      ORIGIN,
      encryptionKey,
    );
    const claim = vi.fn().mockImplementation(async (input: { secretHash: Uint8Array }) => {
      if (!Buffer.from(input.secretHash).equals(Buffer.from(await sha256(SECRET)))) {
        return null;
      }
      return { ciphertext: encrypted.ciphertext, iv: encrypted.iv, returnTo: RETURN_TO };
    });
    const handler = createHandler({ origin: ORIGIN, encryptionKey, claim });
    const wrongSecret = "w".repeat(43);
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ secret: wrongSecret, state: STATE }),
      }),
      { params: { continuationId: CONTINUATION_ID } },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "continuation_unavailable" },
    });
  });
});
