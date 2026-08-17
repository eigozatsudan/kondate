import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./http.js";

const getUserMock = vi.hoisted(() => vi.fn());

vi.mock("./supabase-admin.js", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      getUser: getUserMock,
    },
  }),
}));

import { requireUser, requireUserWithEmail } from "./auth.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const TOKEN = "access-token-value";

function bearerRequest(token = TOKEN): Request {
  return new Request("http://127.0.0.1/api/example", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("requireUser", () => {
  beforeEach(() => {
    getUserMock.mockReset();
  });

  it("returns userId and accessToken when JWT is valid", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: USER_ID, email: "owner@example.com" } },
      error: null,
    });
    await expect(requireUser(bearerRequest())).resolves.toEqual({
      userId: USER_ID,
      accessToken: TOKEN,
    });
  });

  it("returns 401 when Authorization is missing", async () => {
    await expect(requireUser(new Request("http://127.0.0.1/api/example"))).rejects.toMatchObject({
      status: 401,
      code: "auth_required",
    });
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("returns 401 when getUser yields null user without error", async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    await expect(requireUser(bearerRequest())).rejects.toMatchObject({
      status: 401,
      code: "auth_required",
    });
  });

  it("C8: returns 401 when getUser user.id is not a non-empty string", async () => {
    for (const user of [
      { id: 123, email: "owner@example.com" },
      { email: "owner@example.com" },
      { id: "" },
    ]) {
      getUserMock.mockResolvedValue({
        data: { user },
        error: null,
      });
      await expect(requireUser(bearerRequest())).rejects.toMatchObject({
        status: 401,
        code: "auth_required",
      });
    }
  });

  it("C8: requireUser does not unchecked-cast getUser data.user", async () => {
    const source = await readFile("netlify/functions/_shared/auth.ts", "utf8");
    expect(source).not.toMatch(/\bdata\.user as\b/);
    expect(source).not.toMatch(/as \{ id: string/);
    expect(source).not.toMatch(/as unknown as/);
    expect(source).toMatch(/safeParse/);
  });
});

describe("requireUserWithEmail", () => {
  beforeEach(() => {
    getUserMock.mockReset();
  });

  it("returns normalized email when present and valid", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: USER_ID, email: "  Owner@Example.COM " } },
      error: null,
    });
    await expect(requireUserWithEmail(bearerRequest())).resolves.toEqual({
      userId: USER_ID,
      accessToken: TOKEN,
      email: "owner@example.com",
    });
  });

  it.each([
    ["null email", null],
    ["undefined email", undefined],
    ["empty email", ""],
    ["whitespace-only email", "   "],
    ["invalid email", "not-an-email"],
  ] as const)("returns closed 503 when %s", async (_label, email) => {
    getUserMock.mockResolvedValue({
      data: { user: { id: USER_ID, email } },
      error: null,
    });
    try {
      await requireUserWithEmail(bearerRequest());
      expect.unreachable("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      const httpError = error as HttpError;
      expect(httpError.status).toBe(503);
      expect(httpError.code).toBe("request_failed");
      expect(httpError.message).not.toMatch(/email|メール/iu);
      expect(httpError.code).not.toMatch(/email/iu);
    }
  });

  it("does not use identities[].identity_data.email as a fallback", async () => {
    getUserMock.mockResolvedValue({
      data: {
        user: {
          id: USER_ID,
          email: null,
          identities: [{ identity_data: { email: "fallback@example.com" } }],
        },
      },
      error: null,
    });
    await expect(requireUserWithEmail(bearerRequest())).rejects.toMatchObject({
      status: 503,
      code: "request_failed",
    });
  });
});
