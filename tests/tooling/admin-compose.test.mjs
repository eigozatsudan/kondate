/**
 * 運用管理コンソール（admin）のリポジトリ境界契約。
 * compose ports・秘密 ignore・root tooling が admin を噛まないことを固定する。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("../..", import.meta.url)));

test("compose.admin.yaml publishes only loopback 5193 and builds from ./admin", () => {
  const yaml = readFileSync(join(root, "compose.admin.yaml"), "utf8");
  assert.match(yaml, /127\.0\.0\.1:5193:5193/);
  assert.doesNotMatch(yaml, /^\s*-\s*["']?5193:5193["']?\s*$/m);
  assert.match(yaml, /context:\s*\.\/admin/);
  // コンテナ内は 0.0.0.0 listen。ホスト公開は上の 127.0.0.1:5193。
  assert.match(yaml, /ADMIN_BIND_HOST:\s*"0\.0\.0\.0"/);
});

test(".env.admin is gitignored (.env alone is not enough)", () => {
  const out = execFileSync("git", ["check-ignore", "-v", ".env.admin"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.match(out, /\.env\.admin/);
});

test("root .dockerignore lists .env.admin", () => {
  const text = readFileSync(join(root, ".dockerignore"), "utf8");
  assert.match(text, /^\.env\.admin$/m);
});

test("eslint ignores admin/**", () => {
  const text = readFileSync(join(root, "eslint.config.js"), "utf8");
  assert.match(text, /admin\/\*\*/);
});

test("root format scripts prune ./admin", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const key of ["format", "format:check"]) {
    const script = pkg.scripts[key];
    assert.ok(typeof script === "string", `${key} script missing`);
    assert.match(script, /-path '\.\/admin' -prune/);
  }
});

test("admin/.dockerignore exists for build context ./admin", () => {
  const text = readFileSync(join(root, "admin/.dockerignore"), "utf8");
  assert.match(text, /node_modules/);
  assert.match(text, /\.env/);
});
