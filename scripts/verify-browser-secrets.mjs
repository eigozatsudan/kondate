/**
 * ブラウザソースとビルド成果物にサーバ秘密が混入していないことを検査する。
 * 診断は変数名と相対パスのみ。秘密値・一致行・URL は出さない。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const FORBIDDEN_NAMES = [
  "OPENROUTER_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GENERATION_REQUEST_HMAC_KEY",
  "SUPABASE_MAINTENANCE_DB_URL",
  "MAINTENANCE_DB_PASSWORD",
  "NETLIFY_AUTH_TOKEN",
  "AUTH_CONTINUATION_ENCRYPTION_KEY",
];

const SECRET_VALUE_KEYS = [
  "OPENROUTER_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GENERATION_REQUEST_HMAC_KEY",
  "SUPABASE_MAINTENANCE_DB_URL",
  "MAINTENANCE_DB_PASSWORD",
  "NETLIFY_AUTH_TOKEN",
  // 名前スキャンに加え、値だけの dist 漏洩も検知する
  "AUTH_CONTINUATION_ENCRYPTION_KEY",
];

const SCAN_ROOTS = ["src", "shared", "dist"];

function walkFiles(root, files = []) {
  if (!existsSync(root)) return files;
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkFiles(full, files);
    } else if (st.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/**
 * @param {{ root: string, env: Record<string, string | undefined>, requireDist?: boolean }} options
 */
export function verifyBrowserSecrets({ root, env, requireDist = false }) {
  const findings = [];
  if (requireDist && !existsSync(join(root, "dist"))) {
    throw new Error("dist_missing");
  }

  const valueMatchers = [];
  for (const key of SECRET_VALUE_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) {
      valueMatchers.push({ key, value });
    }
  }

  for (const scanRoot of SCAN_ROOTS) {
    const absRoot = join(root, scanRoot);
    if (!existsSync(absRoot)) continue;
    for (const file of walkFiles(absRoot)) {
      const rel = relative(root, file).split(sep).join("/");
      let content;
      try {
        content = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const name of FORBIDDEN_NAMES) {
        if (content.includes(name)) {
          findings.push({ variable: name, file: rel });
        }
      }
      for (const { key, value } of valueMatchers) {
        if (content.includes(value)) {
          findings.push({ variable: key, file: rel });
        }
      }
    }
  }

  return findings;
}

export function main({
  root = process.cwd(),
  env = process.env,
  requireDist = process.argv.includes("--require-dist"),
  write = console.error,
} = {}) {
  try {
    const findings = verifyBrowserSecrets({ root, env, requireDist });
    if (findings.length > 0) {
      for (const finding of findings) {
        // 秘密値や行内容は出さない
        write(`browser_secrets: ${finding.variable} in ${finding.file}`);
      }
      return 1;
    }
    return 0;
  } catch (error) {
    const code = error instanceof Error ? error.message : "browser_secrets_failed";
    write(`browser_secrets: ${code}`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main();
}
