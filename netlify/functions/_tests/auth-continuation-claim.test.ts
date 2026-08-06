import { describe, expect, it, vi } from "vitest";
import { config, createHandler, parseClaimedContinuationRow } from "../auth-continuation-claim.js";
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
      rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip"] },
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
    const body: unknown = await response.json();
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
    expect(claim).toHaveBeenCalledTimes(1);
    const claimInput = claim.mock.calls[0]?.[0] as {
      id: string;
      stateHash: Uint8Array;
      secretHash: Uint8Array;
      origin: string;
      now: string;
    };
    expect(claimInput.id).toBe(CONTINUATION_ID);
    expect(claimInput.origin).toBe(ORIGIN);
    expect(typeof claimInput.now).toBe("string");
    expect(claimInput.stateHash).toEqual(await sha256(STATE));
    expect(claimInput.secretHash).toEqual(await sha256(SECRET));
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
          // C3 / C4: 本番 RPC は claimed 後も ciphertext を保持し、同一資格情報で再提示する
          store.claimed = true;
          return {
            ciphertext: store.ciphertext,
            iv: store.iv,
            returnTo: store.returnTo,
          };
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
    const body: unknown = await response.json();
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

    // C3: 再利用 claim は冪等に同じ code を返す（single-use burn ではない）
    const replay = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ secret: SECRET, state: STATE }),
      }),
      { params: { continuationId: CONTINUATION_ID } },
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({
      ok: true,
      data: { code: AUTH_CODE, returnTo: RETURN_TO },
    });
    expect(claim).toHaveBeenCalledTimes(2);
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

  it("C1: returns 410 when claim succeeds but decrypt fails (code already burned)", async () => {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
    const wrongKey = crypto.getRandomValues(new Uint8Array(32));
    const encrypted = await encryptContinuationCode(
      AUTH_CODE,
      CONTINUATION_ID,
      ORIGIN,
      encryptionKey,
    );
    const claim = vi.fn().mockResolvedValue({
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      returnTo: RETURN_TO,
    });
    // claim は成功するが handler 側の鍵が違う → decrypt 失敗
    const handler = createHandler({ origin: ORIGIN, encryptionKey: wrongKey, claim });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ secret: SECRET, state: STATE }),
      }),
      { params: { continuationId: CONTINUATION_ID } },
    );
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "continuation_unavailable" },
    });
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("C1: returns 410 when claim succeeds but returnTo fails response schema", async () => {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
    const encrypted = await encryptContinuationCode(
      AUTH_CODE,
      CONTINUATION_ID,
      ORIGIN,
      encryptionKey,
    );
    const claim = vi.fn().mockResolvedValue({
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      returnTo: "//evil.example",
    });
    const handler = createHandler({ origin: ORIGIN, encryptionKey, claim });
    const response = await handler(
      new Request("https://functions.test", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ secret: SECRET, state: STATE }),
      }),
      { params: { continuationId: CONTINUATION_ID } },
    );
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "continuation_unavailable" },
    });
  });

  it("C1 residual: returns 410 when claim reports gone (fromBytea / IV after burn)", async () => {
    // production createAdminTransition が parseClaimedContinuationRow で "gone" を返す経路。
    // ciphertext は RPC 側で既に single-use 消去済みのため 404 リトライ不可。
    const claim = vi.fn().mockResolvedValue("gone");
    const handler = createHandler({
      origin: ORIGIN,
      encryptionKey: new Uint8Array(32).fill(3),
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
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "continuation_unavailable" },
    });
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("C1 residual: parseClaimedContinuationRow maps invalid bytea / IV length to gone", () => {
    expect(
      parseClaimedContinuationRow({
        encrypted_code: "not-bytea",
        code_iv: "\\x000000000000000000000000",
        return_to: RETURN_TO,
      }),
    ).toBe("gone");

    expect(
      parseClaimedContinuationRow({
        encrypted_code: "\\xdeadbeef",
        code_iv: "not-bytea",
        return_to: RETURN_TO,
      }),
    ).toBe("gone");

    // AES-GCM IV は 12 bytes 固定。11 bytes は不正
    expect(
      parseClaimedContinuationRow({
        encrypted_code: "\\xdeadbeef",
        code_iv: "\\x0000000000000000000000",
        return_to: RETURN_TO,
      }),
    ).toBe("gone");

    // 正常系: ciphertext + 12-byte IV
    const ok = parseClaimedContinuationRow({
      encrypted_code: "\\xdeadbeef",
      code_iv: "\\x000000000000000000000000",
      return_to: RETURN_TO,
    });
    expect(ok).not.toBe("gone");
    if (ok !== "gone") {
      expect(ok.returnTo).toBe(RETURN_TO);
      expect(ok.ciphertext).toEqual(Uint8Array.from([0xde, 0xad, 0xbe, 0xef]));
      expect(ok.iv.byteLength).toBe(12);
    }
  });
});
