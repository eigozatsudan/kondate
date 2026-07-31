/**
 * Function ログのプライバシー境界を host 側で検証する。
 * Playwright 中の読み取りは禁止 — run-e2e.sh が Playwright 終了後に渡すログだけを見る。
 */
import { readFileSync } from "node:fs";

/** generation 経路の存在証明に数える closed code のみ（maintenance や未知 code は不可） */
const generationCodes = new Set([
  // generation-service 終端が実際に出す code（errorCode を code としてログ）
  "succeeded",
  "generation_timeout",
  "model_unavailable",
  "invalid_ai_response",
  "current_safety_changed",
  "constraint_conflict",
  "source_menu_changed",
  "quota_exhausted",
  "external_attempt_exhausted",
  // 旧称・互換（合成フィクスチャ用）
  "generation_started",
  "generation_succeeded",
  "generation_failed",
  "generation_conflict",
]);

const absencePatterns = [
  // 合成 E2E メール・一般メール
  /@example\.invalid/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  // UUID（所有 ID のログ流出）
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu,
  // prompt / AI 生出力マーカー
  /BEGIN_PROMPT|END_PROMPT|SYSTEM_PROMPT/iu,
  /"prompt"\s*:/iu,
  /raw mock|openrouter response body|choices\s*\[/iu,
  // 日本語氏名・メモ・アレルギー自由文の典型キー
  /"display_name"\s*:/iu,
  /"displayName"\s*:/iu,
  /"memo"\s*:/iu,
  /"custom_name"\s*:/iu,
  /"customName"\s*:/iu,
  /"allergy_note"\s*:/iu,
  /"free_form"/iu,
  // 構造化 user id / email キー（値 redact 対象外の漏れ検知）
  /"user_id"\s*:/iu,
  /"userId"\s*:/iu,
  /"email"\s*:/iu,
  // 典型的な日本語氏名パターン（姓＋名、2〜8文字の漢字連続など）
  /[\u4e00-\u9fff]{1,4}\s*[\u4e00-\u9fff]{1,4}(?:さん|様)?/u,
  // アクセストークン断片
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/u,
];

/**
 * @param {string} logText
 * @param {{ requireGeneration?: boolean }} [options]
 */
/**
 * 許可された opaque id キーの値は検査前に伏せる。
 * request_id は correlation 用 UUID を載せてよい契約。
 * stripe_customer_id / stripe_subscription_id は opaque Stripe id 契約。
 * 構造化 user_id 等の非許可キーに UUID が載った場合は bare UUID 検査で落とす。
 * residual: 非 generation 行は field allowlist 対象外（absencePatterns 依存）。
 * @param {string} logText
 */
function redactAllowedOpaqueIds(logText) {
  return logText
    .replace(/"request_id"\s*:\s*"[^"]*"/gu, '"request_id":"<redacted>"')
    .replace(/"stripe_customer_id"\s*:\s*"[^"]*"/gu, '"stripe_customer_id":"<redacted>"')
    .replace(/"stripe_subscription_id"\s*:\s*"[^"]*"/gu, '"stripe_subscription_id":"<redacted>"');
}

export function assertPrivacyLogs(logText, options = {}) {
  const requireGeneration = options.requireGeneration !== false;
  if (logText.trim().length === 0) {
    throw new Error("privacy_log_empty");
  }
  const scanned = redactAllowedOpaqueIds(logText);
  for (const pattern of absencePatterns) {
    if (pattern.test(scanned)) {
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
    // generation presence は allowlist のみ（maintenance_cleanup / 未知 code は数えない）
    if (!generationCodes.has(code)) {
      continue;
    }
    generationLines += 1;
    for (const key of ["request_id", "code", "duration_ms", "level"]) {
      if (!(key in parsed)) {
        throw new Error(`privacy_log_missing_${key}`);
      }
    }
    if ("requestId" in parsed || "errorCode" in parsed || "durationMs" in parsed) {
      throw new Error("privacy_log_camel_case");
    }
    // 許可キー以外の自由文フィールドを拒否。
    // SafeLogEvent / createSafeLogger が出し得る snake_case キーと揃える（S2: generation_route 等の stale allowlist 修正）。
    for (const key of Object.keys(parsed)) {
      if (
        ![
          "level",
          "request_id",
          "code",
          "duration_ms",
          "model_id",
          "stale_reservations_finalized",
          "generation_ledgers_deleted",
          "shopping_mutations_deleted",
          "auth_continuations_deleted",
          "user_feedback_deleted",
          "draft_submissions_deleted",
          "identity_ledgers_deleted",
          "flyer_ledgers_deleted",
          "path",
          "match_mode",
          "empty_reason",
          "candidate_count",
          "meal_type",
          "main_ingredient_count",
          "plan",
          "billing_status",
          "price_interval",
          "quality_mode",
          "flyer",
          "stripe_customer_id",
          "stripe_subscription_id",
          "alert_metric",
          "generation_route",
          "http_status",
        ].includes(key)
      ) {
        throw new Error("privacy_log_unexpected_field");
      }
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
