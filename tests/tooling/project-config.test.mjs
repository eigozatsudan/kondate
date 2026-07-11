import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("pins Node 24 and exposes every verification script", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(manifest.type, "module");
  assert.equal(manifest.engines.node, ">=24 <25");
  assert.match(manifest.devDependencies["@netlify/functions"], /^\^5\./u);
  for (const name of [
    "build",
    "format:check",
    "lint",
    "typecheck",
    "test",
    "db:test",
    "db:types",
    "e2e",
  ]) {
    assert.equal(typeof manifest.scripts[name], "string", `missing ${name}`);
  }
  assert.equal(await readFile(".nvmrc", "utf8"), "24\n");
});
