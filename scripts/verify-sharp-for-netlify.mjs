/**
 * Netlify Functions 向け sharp（native）同梱の fail-closed 検証。
 * - package.json に exact pin
 * - package-lock に linux-x64 optional がある（Netlify ランタイム）
 * - 現行 Node で import が成功する（ビルド環境）
 * 秘密やパスはログに出さない。
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(name) {
  return JSON.parse(readFileSync(join(root, name), "utf8"));
}

export function assertSharpPackageExact(pkg = readJson("package.json")) {
  const version = pkg.dependencies?.sharp;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("sharp_missing_dependency");
  }
  // exact pin: 先頭が数字（^ ~ 禁止）
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error("sharp_not_exact_pin");
  }
  return version;
}

export function assertSharpLinuxX64InLockfile(lock = readJson("package-lock.json"), version) {
  const entry = lock.packages?.["node_modules/@img/sharp-linux-x64"];
  if (entry === undefined || typeof entry !== "object") {
    throw new Error("sharp_linux_x64_lock_missing");
  }
  if (typeof version === "string" && entry.version !== version) {
    // optional 側の version は sharp 本体と揃う想定
    throw new Error("sharp_linux_x64_version_mismatch");
  }
  return true;
}

export async function assertSharpImportable() {
  try {
    const sharp = (await import("sharp")).default;
    // 最小 decode: 1x1 png
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const meta = await sharp(png).metadata();
    assert.equal(meta.width, 1);
    assert.equal(meta.height, 1);
  } catch {
    throw new Error("sharp_import_or_decode_failed");
  }
}

export async function verifySharpForNetlify() {
  const version = assertSharpPackageExact();
  assertSharpLinuxX64InLockfile(undefined, version);
  // lock の optional 解決確認（require.resolve は platform 依存で欠けることがある）
  try {
    const require = createRequire(import.meta.url);
    require.resolve("sharp");
  } catch {
    throw new Error("sharp_resolve_failed");
  }
  await assertSharpImportable();
  return { ok: true, version };
}

export async function main(write = console.error) {
  try {
    const result = await verifySharpForNetlify();
    write(`verify-sharp-for-netlify: ok sharp@${result.version}`);
    return 0;
  } catch (error) {
    const code = error instanceof Error ? error.message : "verify_sharp_failed";
    write(`verify-sharp-for-netlify: ${code}`);
    return 1;
  }
}

const isDirect = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirect) {
  process.exitCode = await main();
}
