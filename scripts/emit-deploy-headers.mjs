/**
 * ビルド後に dist/_headers を書き、deploy context 別 CSP を載せる。
 * Netlify は [[headers]] を context 分割できないため、公式の per-deploy
 * _headers ワークアラウンドを使う。
 *
 * 使い方:
 *   node scripts/emit-deploy-headers.mjs
 *   node scripts/emit-deploy-headers.mjs --context production
 *
 * context 解決順: --context 引数 → Netlify の CONTEXT 環境変数 → deploy-preview
 * production では VITE_SUPABASE_URL が必須（exact managed origin）。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildDeployHeadersFile } from "./csp-headers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultPublishDir = join(root, "dist");

/**
 * @param {string[]} argv
 * @returns {string | undefined}
 */
export function parseContextArg(argv) {
  const index = argv.indexOf("--context");
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error("csp_context_missing");
  }
  return value;
}

/**
 * @param {{ context?: string, env?: NodeJS.ProcessEnv, publishDir?: string }} options
 */
export async function emitDeployHeaders({
  context: contextOption,
  env = process.env,
  publishDir = defaultPublishDir,
} = {}) {
  const context = contextOption || env.CONTEXT || "deploy-preview";
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const content = buildDeployHeadersFile({
    context,
    supabaseUrl: typeof supabaseUrl === "string" ? supabaseUrl : undefined,
  });
  await mkdir(publishDir, { recursive: true });
  const target = join(publishDir, "_headers");
  await writeFile(target, content, "utf8");
  return { context, target, content };
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  publishDir = defaultPublishDir,
  write = console.error,
} = {}) {
  try {
    const context = parseContextArg(argv);
    await emitDeployHeaders({ context, env, publishDir });
    return 0;
  } catch (error) {
    const code = error instanceof Error ? error.message : "emit_headers_failed";
    write(`emit-deploy-headers: ${code}`);
    return 1;
  }
}

const isDirect = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirect) {
  process.exitCode = await main();
}
