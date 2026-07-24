import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { main, verifyBrowserSecrets } from "./verify-browser-secrets.mjs";

function withTree(build) {
  const root = mkdtempSync(join(tmpdir(), "kondate-browser-secrets-"));
  try {
    build(root);
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

test("clean fixtures pass and absent dist is accepted before build", () => {
  const root = withTree((dir) => {
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "shared"), { recursive: true });
    writeFileSync(join(dir, "src", "app.ts"), "export const ok = true;\n");
    writeFileSync(join(dir, "shared", "contracts.ts"), "export const x = 1;\n");
  });
  try {
    const findings = verifyBrowserSecrets({
      root,
      env: {
        OPENROUTER_API_KEY: "or-secret-value",
        SUPABASE_SERVICE_ROLE_KEY: "sr-secret-value",
      },
    });
    assert.deepEqual(findings, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detects forbidden variable name and secret value with redacted diagnostics", () => {
  const secret = "super-secret-openrouter-key-value";
  const root = withTree((dir) => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src", "leak.ts"),
      `const OPENROUTER_API_KEY = "x";\nconst v = "${secret}";\n`,
    );
  });
  try {
    const findings = verifyBrowserSecrets({
      root,
      env: { OPENROUTER_API_KEY: secret },
    });
    assert.ok(findings.some((f) => f.variable === "OPENROUTER_API_KEY"));
    const lines = [];
    const code = main({
      root,
      env: { OPENROUTER_API_KEY: secret },
      write: (line) => lines.push(line),
    });
    assert.equal(code, 1);
    assert.ok(lines.every((line) => !line.includes(secret)));
    assert.ok(lines.some((line) => line.includes("OPENROUTER_API_KEY")));
    assert.ok(lines.some((line) => line.includes("src/leak.ts")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("requireDist fails closed when dist is absent after expected build", () => {
  const root = withTree((dir) => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "app.ts"), "export {};\n");
  });
  try {
    const lines = [];
    const code = main({
      root,
      env: {},
      requireDist: true,
      write: (line) => lines.push(line),
    });
    assert.equal(code, 1);
    assert.deepEqual(lines, ["browser_secrets: dist_missing"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scans dist when present", () => {
  const secret = "service-role-leaked-value";
  const root = withTree((dir) => {
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(join(dir, "src", "app.ts"), "export {};\n");
    writeFileSync(join(dir, "dist", "assets.js"), `var x="${secret}";\n`);
  });
  try {
    const findings = verifyBrowserSecrets({
      root,
      env: { SUPABASE_SERVICE_ROLE_KEY: secret },
      requireDist: true,
    });
    assert.ok(findings.some((f) => f.file === "dist/assets.js"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
