import assert from "node:assert/strict";
import test from "node:test";
import { main, parseSmokeOrigin, runSmokeProbes } from "./smoke-production.mjs";

const origin = "https://kondate.example.com";

test("parseSmokeOrigin accepts exact HTTPS origin only", () => {
  assert.equal(parseSmokeOrigin(origin), origin);
});

test("parseSmokeOrigin rejects credentials query fragment path", () => {
  for (const bad of [
    "http://kondate.example.com",
    "https://user:pass@kondate.example.com",
    "https://kondate.example.com/path",
    "https://kondate.example.com?x=1",
    "https://kondate.example.com#frag",
    "https://kondate.example.com/",
  ]) {
    assert.throws(() => parseSmokeOrigin(bad), /smoke_origin_invalid/);
  }
});

test("runSmokeProbes hits exact probes with unchanged origin", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, method: init.method });
    if (url === `${origin}/`) {
      return {
        status: 200,
        text: async () => '<div id="root"></div>',
        json: async () => ({}),
      };
    }
    if (url === `${origin}/api/generations/menu`) {
      assert.equal(init.method, "POST");
      assert.equal(init.headers?.Authorization, undefined);
      return {
        status: 401,
        text: async () => "",
        // handleError と同一の nested envelope
        json: async () => ({
          ok: false,
          error: { code: "auth_required", message: "ログインが必要です" },
        }),
      };
    }
    if (url === `${origin}/api/account`) {
      assert.equal(init.method, "DELETE");
      return {
        status: 401,
        text: async () => "",
        json: async () => ({
          ok: false,
          error: { code: "auth_required", message: "ログインが必要です" },
        }),
      };
    }
    throw new Error(`unexpected url ${url}`);
  };

  const verified = await runSmokeProbes(origin, fetchImpl);
  assert.equal(verified, origin);
  assert.deepEqual(
    seen.map((s) => s.url),
    [`${origin}/`, `${origin}/api/generations/menu`, `${origin}/api/account`],
  );
});

test("main never authorizes generation routes", async () => {
  const lines = [];
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers?.Authorization, undefined);
    if (String(url).endsWith("/")) {
      return { status: 200, text: async () => '<div id="root"></div>', json: async () => ({}) };
    }
    return {
      status: 401,
      text: async () => "",
      json: async () => ({
        ok: false,
        error: { code: "auth_required", message: "ログインが必要です" },
      }),
    };
  };
  const code = await main([origin], fetchImpl, (line) => lines.push(line));
  assert.equal(code, 0);
  assert.equal(lines.length, 0);
});

test("runSmokeProbes rejects flat code envelope that is not the Functions contract", async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/")) {
      return { status: 200, text: async () => '<div id="root"></div>', json: async () => ({}) };
    }
    // 誤った flat 形状は本番ゲートで拒否する（false-green 防止）
    return {
      status: 401,
      text: async () => "",
      json: async () => ({ code: "auth_required" }),
    };
  };
  await assert.rejects(
    () => runSmokeProbes(origin, fetchImpl),
    (error) => error instanceof Error && /auth_required_missing/u.test(error.message),
  );
});
