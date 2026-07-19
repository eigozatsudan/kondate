import { beforeEach, expect, it, vi } from "vitest";

const { createClientMock, getServerEnvMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(() => ({ from: vi.fn() })),
  getServerEnvMock: vi.fn(() => ({
    supabase: {
      url: "https://abcdefghijklmnopqrst.supabase.co",
      publishableKey: "publishable-key",
      serviceRoleKey: "actual-secret-key",
    },
  })),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));
vi.mock("./env.js", () => ({ getServerEnv: getServerEnvMock }));

import { createUserScopedSupabase } from "./supabase-user.js";

beforeEach(() => vi.clearAllMocks());

it("creates a non-persisting user client with the publishable key and bearer token", () => {
  createUserScopedSupabase("access-token");
  expect(createClientMock).toHaveBeenCalledWith(
    "https://abcdefghijklmnopqrst.supabase.co",
    "publishable-key",
    {
      global: { headers: { Authorization: "Bearer access-token" } },
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  expect(createClientMock).not.toHaveBeenCalledWith(
    expect.anything(),
    "actual-secret-key",
    expect.anything(),
  );
});
