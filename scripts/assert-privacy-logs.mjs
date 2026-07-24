/**
 * Function ログのプライバシー境界を host 側で検証する。
 * Playwright 中の読み取りは禁止 — run-e2e.sh が Playwright 終了後に渡すログだけを見る。
 */
import { readFileSync } from "node:fs";

const generationCodes = new Set([
  "generation_started",
  "generation_succeeded",
  "generation_failed",
  "generation_conflict",
  "invalid_ai_response",
  "current_safety_changed",
  "constraint_conflict",
  "source_menu_changed",
  "quota_exhausted",
  "external_attempt_exhausted",
  "maintenance_cleanup",
]);

const absencePatterns = [
  /@example\.invalid/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /BEGIN_PROMPT|END_PROMPT|SYSTEM_PROMPT/iu,
  /"prompt"\s*:/iu,
  /raw mock|openrouter response body/iu,
];

/**
 * @param {string} logText
 * @param {{ requireGeneration?: boolean }} [options]
 */
export function assertPrivacyLogs(logText, options = {}) {
  const requireGeneration = options.requireGeneration !== false;
  if (logText.trim().length === 0) {
    throw new Error("privacy_log_empty");
  }
  for (const pattern of absencePatterns) {
    if (pattern.test(logText)) {
      throw new Error("privacy_log_sensitive_present");
    }
  }

  const lines = logText.split("\n");
  let generationLines = 0;
  for (const line of lines) {
    const jsonStart = line.indexOf("{");
    if (jsonStart < 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(line.slice(jsonStart));
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const code = parsed.code;
    if (typeof code !== "string") continue;
    if (!generationCodes.has(code) && !/generation|cleanup|quota|ai_/u.test(code)) {
      continue;
    }
    generationLines += 1;
    // snake_case 必須フィールド
    for (const key of ["request_id", "code", "duration_ms", "level"]) {
      if (!(key in parsed)) {
        throw new Error(`privacy_log_missing_${key}`);
      }
    }
    // camelCase 旧形が混入していないこと
    if ("requestId" in parsed || "errorCode" in parsed || "durationMs" in parsed) {
      throw new Error("privacy_log_camel_case");
    }
  }
  if (requireGeneration && generationLines === 0) {
    throw new Error("privacy_log_no_generation");
  }
  return { generationLines };
}

export function main(path = process.argv[2]) {
  if (!path) {
    process.stderr.write("privacy_log_path_required\n");
    process.exitCode = 1;
    return;
  }
  try {
    const text = readFileSync(path, "utf8");
    assertPrivacyLogs(text, { requireGeneration: true });
    process.stdout.write("privacy_logs: pass\n");
  } catch (error) {
    const code =
      error instanceof Error && /^[a-z_]+$/u.test(error.message)
        ? error.message
        : "privacy_log_invalid";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}
