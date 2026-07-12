// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { createOpenRouterMockServer } from "./server.mjs";

let server;

afterEach(async () => {
  if (server) {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("returns a deterministic health payload", async () => {
  server = createOpenRouterMockServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Mock server did not bind a TCP port");
  }
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});
