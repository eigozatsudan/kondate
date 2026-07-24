/**
 * docs/testing/acceptance-matrix.md の Owning test が
 * 「存在するファイル + 実在する exact title」を指すことを検査する。
 * 本文・秘密は出さず、行番号と相対パスのみ。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MATRIX_REL = "docs/testing/acceptance-matrix.md";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** バッククォート内の `path` — title 断片を1件に分解する */
function parseOwningCell(cell) {
  const citations = [];
  // `path` — title · `path` — title 形式（em dash / hyphen）
  const re = /`([^`]+)`\s*[—-]\s*([^`·|]+?)(?=\s*·\s*`|\s*$)/gu;
  let match;
  while ((match = re.exec(cell)) !== null) {
    const file = match[1].trim();
    // 同一ファイルに複数 title が ; や ; でつながる場合
    const titles = match[2]
      .split(/;\s*/u)
      .map((part) => part.trim())
      .filter(Boolean);
    for (const title of titles) {
      citations.push({ file, title });
    }
  }
  // タイトル無しの file-only も検出（失敗扱い）
  const bareFiles = cell.matchAll(/`([^`]+)`/gu);
  for (const bare of bareFiles) {
    const file = bare[1].trim();
    if (!citations.some((c) => c.file === file)) {
      citations.push({ file, title: null });
    }
  }
  return citations;
}

function extractTableRows(markdown, heading) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return [];
  const rows = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("## ") && i > start + 1) break;
    if (!line.startsWith("|")) continue;
    if (/^\|\s*-+/u.test(line)) continue;
    if (/^\|\s*#\s*\|/u.test(line)) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 3) continue;
    rows.push({ line: i + 1, id: cells[0], owning: cells[2] });
  }
  return rows;
}

/**
 * @param {{ root?: string, matrixPath?: string }} [options]
 * @returns {{ ok: boolean, errors: string[], mvp: number, guided: number }}
 */
export function verifyAcceptanceMatrix(options = {}) {
  const root = options.root ?? ROOT;
  const matrixPath = options.matrixPath ?? join(root, MATRIX_REL);
  const errors = [];

  if (!existsSync(matrixPath)) {
    return { ok: false, errors: [`missing ${MATRIX_REL}`], mvp: 0, guided: 0 };
  }

  const markdown = readFileSync(matrixPath, "utf8");
  const mvp = extractTableRows(markdown, "## MVP (22)");
  const guided = extractTableRows(markdown, "## Guided planner §3.2 (8)");

  if (mvp.length !== 22) {
    errors.push(`MVP rows: expected 22, got ${mvp.length}`);
  }
  if (guided.length !== 8) {
    errors.push(`Guided rows: expected 8, got ${guided.length}`);
  }

  for (const row of [...mvp, ...guided]) {
    const citations = parseOwningCell(row.owning);
    if (citations.length === 0) {
      errors.push(`L${row.line} row ${row.id}: no owning file/title citations`);
      continue;
    }
    for (const { file, title } of citations) {
      if (file.includes(" ") || file.startsWith("http")) {
        errors.push(`L${row.line} row ${row.id}: invalid file token ${file}`);
        continue;
      }
      const abs = join(root, file);
      if (!existsSync(abs)) {
        errors.push(`L${row.line} row ${row.id}: missing file ${file}`);
        continue;
      }
      if (title === null || title.length === 0) {
        errors.push(`L${row.line} row ${row.id}: file-only citation without exact title (${file})`);
        continue;
      }
      const source = readFileSync(abs, "utf8");
      // test("title" / it("title" / pgTAP 第3引数 'title' のいずれかに部分一致
      if (!source.includes(title)) {
        errors.push(
          `L${row.line} row ${row.id}: title not found in ${file}: ${title.slice(0, 80)}`,
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    mvp: mvp.length,
    guided: guided.length,
  };
}

export function main(write = console.error) {
  const result = verifyAcceptanceMatrix();
  if (result.ok) {
    write(`acceptance_matrix: pass (${result.mvp}/22 mvp, ${result.guided}/8 guided)`);
    return 0;
  }
  for (const error of result.errors) {
    write(`acceptance_matrix: ${error}`);
  }
  return 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main();
}
