import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { createBrowserSupabaseClient } from "./supabase";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: {} })),
}));

it("uses the owned Supabase auth storage prefix for sessions and PKCE", () => {
  createBrowserSupabaseClient({
    supabaseUrl: "http://127.0.0.1:8000",
    supabasePublishableKey: "anon-key",
  });
  expect(vi.mocked(createClient)).toHaveBeenCalledWith("http://127.0.0.1:8000", "anon-key", {
    // SDKモックの型情報が失われる境界で、検証対象の設定だけを確認する。
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    auth: expect.objectContaining({
      flowType: "pkce",
      detectSessionInUrl: false,
      storageKey: "kondate.auth.supabase",
    }),
  });
});
