import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { main, verifyAcceptanceMatrix } from "./verify-acceptance-matrix.mjs";

test("repository acceptance matrix has 22+8 rows with existing file+title ownership", () => {
  const result = verifyAcceptanceMatrix();
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.mvp, 22);
  assert.equal(result.guided, 8);
});

test("main prints pass for the repository matrix", () => {
  const lines = [];
  const code = main((line) => lines.push(line));
  assert.equal(code, 0);
  assert.ok(lines.some((line) => /acceptance_matrix: pass/u.test(line)));
});

test("rejects file-only rows and missing titles", () => {
  const root = mkdtempSync(join(tmpdir(), "matrix-"));
  try {
    mkdirSync(join(root, "docs", "testing"), { recursive: true });
    mkdirSync(join(root, "tests"), { recursive: true });
    writeFileSync(join(root, "tests", "sample.test.ts"), 'it("real title here", () => {});\n');
    const body = `# x

## MVP (22)

| # | Behavior (short) | Owning automated test | Layer |
| --- | --- | --- | --- |
| 1 | a | \`tests/sample.test.ts\` — real title here | unit |
| 2 | b | \`tests/sample.test.ts\` | unit |
| 3 | c | \`tests/missing.test.ts\` — ghost title | unit |
| 4 | d | \`tests/sample.test.ts\` — not a real title | unit |
${Array.from({ length: 18 }, (_, i) => `| ${i + 5} | x | \`tests/sample.test.ts\` — real title here | unit |`).join("\n")}

## Guided planner §3.2 (8)

| # | Success condition | Owning automated test | Layer |
| --- | --- | --- | --- |
${Array.from({ length: 8 }, (_, i) => `| G${i + 1} | x | \`tests/sample.test.ts\` — real title here | unit |`).join("\n")}
`;
    writeFileSync(join(root, "docs", "testing", "acceptance-matrix.md"), body);
    const result = verifyAcceptanceMatrix({
      root,
      matrixPath: join(root, "docs", "testing", "acceptance-matrix.md"),
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /file-only/u.test(e)));
    assert.ok(result.errors.some((e) => /missing file/u.test(e)));
    assert.ok(result.errors.some((e) => /title not found/u.test(e)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
