import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createE2eFunctionServer, startE2eFunctionServer } from "./e2e-function-server.mjs";

const routes = new Map([
  [
    "/netlify/functions/auth-continuation-create.ts",
    {
      config: { path: "/api/auth/continuations", method: "POST" },
      default: async (request) =>
        Response.json({
          origin: request.headers.get("origin"),
          contentType: request.headers.get("content-type"),
          body: await request.text(),
        }),
    },
  ],
  [
    "/netlify/functions/auth-continuation-deposit.ts",
    {
      config: {
        path: "/api/auth/continuations/:continuationId/callback",
        method: "POST",
      },
      default: async () => new Response(null, { status: 204 }),
    },
  ],
  [
    "/netlify/functions/auth-continuation-claim.ts",
    {
      config: {
        path: "/api/auth/continuations/:continuationId/claim",
        method: "POST",
      },
      default: async (_request, context) => Response.json(context.params),
    },
  ],
  [
    "/netlify/functions/emergency-menus.ts",
    {
      config: { path: "/api/emergency-menus", method: "GET" },
      default: async (request) =>
        Response.json({
          meal: new URL(request.url).searchParams.get("meal"),
          authorization: request.headers.get("authorization"),
        }),
    },
  ],
]);

async function withServer(loadModule, run) {
  const server = await createE2eFunctionServer({
    loadModule,
    logger: { error() {} },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test("routes from exported config, forwards required request fields, and passes route params", async () => {
  await withServer(
    async (path) => routes.get(path),
    async (origin) => {
      const createResponse = await fetch(`${origin}/api/auth/continuations`, {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:5173",
          "content-type": "application/json",
        },
        body: '{"state":"test"}',
      });
      assert.deepEqual(await createResponse.json(), {
        origin: "http://127.0.0.1:5173",
        contentType: "application/json",
        body: '{"state":"test"}',
      });
      const claimResponse = await fetch(
        `${origin}/api/auth/continuations/11111111-1111-4111-8111-111111111111/claim`,
        { method: "POST" },
      );
      assert.deepEqual(await claimResponse.json(), {
        continuationId: "11111111-1111-4111-8111-111111111111",
      });
      const emergencyResponse = await fetch(`${origin}/api/emergency-menus?meal=dinner`, {
        headers: { authorization: "Bearer e2e-token" },
      });
      assert.deepEqual(await emergencyResponse.json(), {
        meal: "dinner",
        authorization: "Bearer e2e-token",
      });
    },
  );
});

test("returns 404 when config has no matching method and logs no secret on handler failure", async () => {
  const entries = [];
  const server = await createE2eFunctionServer({
    loadModule: async () => ({
      config: { path: "/api/auth/continuations", method: "POST" },
      default: async () => {
        throw new Error("secret-code");
      },
    }),
    logger: { error: (entry) => entries.push(entry) },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${origin}/api/auth/continuations`, { method: "GET" })).status, 404);
    assert.equal(
      (
        await fetch(`${origin}/api/auth/continuations`, {
          method: "POST",
          body: "secret-code",
        })
      ).status,
      500,
    );
    assert.deepEqual(entries, [
      {
        code: "e2e_function_handler_failed",
        method: "POST",
        path: "/api/auth/continuations",
      },
    ]);
  } finally {
    server.close();
  }
});

test("closes the HTTP server and Vite middleware server exactly once", async () => {
  let viteCloseCount = 0;
  const functionServer = await startE2eFunctionServer({
    createVite: async () => ({
      ssrLoadModule: async (path) => routes.get(path),
      close: async () => {
        viteCloseCount += 1;
      },
    }),
  });

  await functionServer.close();
  await functionServer.close();

  assert.equal(viteCloseCount, 1);
  await assert.rejects(fetch("http://127.0.0.1:5174/api/auth/continuations"));
});
