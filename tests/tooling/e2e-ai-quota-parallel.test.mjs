/**
 * Spec §7.3 / Phase 3 Task 10+11: per-test global AI truncate と workers 並列の fail-closed。
 *
 * workers>1 のとき test/fixture が共有カウンタを truncate すると他 worker の枠を破壊する。
 * 許可: scripts/reset-e2e-ai-quota.sh とそれを呼ぶ scripts/run-e2e.sh（shell 境界）。
 * 禁止: e2e/** 内の旧ヘルパ名・SQL truncate 呼び出し。
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const e2eRoot = "e2e";

/** e2e ツリー内で禁止する識別子 / SQL（コメント・文字列・コードを問わず 0） */
const forbiddenInE2e = [
  "ensureAiQuotaForGeneration",
  "resetGlobalAiQuotaForE2e",
  "truncate private.ai_global_daily_usage",
];

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listTsFilesRecursive(dir) {
  /** @type {string[]} */
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 生成 artifact や auth storage は対象外
      if (
        entry.name === "node_modules" ||
        entry.name === ".auth" ||
        entry.name === "test-results"
      ) {
        continue;
      }
      out.push(...(await listTsFilesRecursive(full)));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx|mjs|js)$/u.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

test("e2e tree has zero per-test global AI truncate call sites", async () => {
  const files = await listTsFilesRecursive(e2eRoot);
  assert.ok(files.length > 0, "expected e2e TypeScript files");

  /** @type {string[]} */
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const needle of forbiddenInE2e) {
      if (source.includes(needle)) {
        violations.push(`${file}: contains forbidden "${needle}"`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Phase 3: test/fixture must not truncate global AI usage (shell only).\n${violations.join("\n")}`,
  );
});

test("shell boundary still resets global AI quota for suite/project edges", async () => {
  const resetScript = await readFile("scripts/reset-e2e-ai-quota.sh", "utf8");
  const runE2e = await readFile("scripts/run-e2e.sh", "utf8");

  // shell 境界だけが truncate を保持する（製品 limit は触らない）
  assert.match(
    resetScript,
    /truncate private\.ai_global_daily_usage/u,
    "reset-e2e-ai-quota.sh must truncate the shared daily usage table",
  );
  assert.match(
    runE2e,
    /reset-e2e-ai-quota\.sh/u,
    "run-e2e.sh must invoke the AI quota reset at suite/project boundaries",
  );
});

test("playwright workers are constant 2 with fullyParallel (no CI workers ternary)", async () => {
  const config = await readFile("playwright.config.ts", "utf8");
  assert.match(config, /workers:\s*2/u);
  assert.match(config, /fullyParallel:\s*true/u);
  // 過去の process.env.CI ? { workers: 1 } 退行を二重に拒否
  assert.doesNotMatch(config, /process\.env\.CI \? \{ workers: 1 \}/u);
  assert.doesNotMatch(config, /workers:\s*1\b/u);
});
