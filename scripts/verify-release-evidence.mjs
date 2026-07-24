// Use Zod 4 APIs already used in shared/contracts (z.iso.datetime, z.url).
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { sep } from "node:path";
import { z } from "zod";

/** Normalize Netlify deploy_ssl_url / artifact origin to bare HTTPS origin (no trailing slash/path). */
export function httpsOriginOnly(value) {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new Error("staging_origin_invalid");
  }
  return parsed.origin; // never ends with /
}

const origin = z.string().refine((value) => {
  try {
    return httpsOriginOnly(value) === new URL(value).origin && !value.endsWith("/");
  } catch {
    return false;
  }
}, "staging_origin_invalid");

export const googleOauthEvidenceSchema = z
  .object({
    candidateSha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u),
    stagingDeployId: z.string().regex(/^[0-9a-f]{24}$/u),
    stagingDeploySha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u),
    executedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    tester: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine(
        (value) => !/(?:@|token|code|verifier|secret|bearer)/iu.test(value),
        "tester_identifier_invalid",
      ),
    stagingOrigin: origin,
    startScreen: z.literal("login"),
    stateMatched: z.literal(true),
    originalBrowserCallbackCompleted: z.literal(true),
    tokenFreeResult: z.literal(true),
    passed: z.literal(true),
  })
  .strict();

// Netlify field is ssl_url on some payloads and deploy_ssl_url on others — accept either, compare origins.
const deployMetadataSchema = z
  .object({
    id: z.string(),
    commit_ref: z.string(),
    ssl_url: z.string().optional(),
    deploy_ssl_url: z.string().optional(),
  })
  .passthrough()
  .refine((m) => Boolean(m.ssl_url || m.deploy_ssl_url), "staging_url_missing");

/** 許可された evidence トップレベルキー（strict schema と一致） */
const allowedEvidenceKeys = new Set([
  "candidateSha",
  "stagingDeployId",
  "stagingDeploySha",
  "executedAt",
  "expiresAt",
  "tester",
  "stagingOrigin",
  "startScreen",
  "stateMatched",
  "originalBrowserCallbackCompleted",
  "tokenFreeResult",
  "passed",
]);

/** 再帰的に禁止キー・メール/token 形の値を拒否する */
function rejectSensitiveMaterial(value, path = "", depth = 0) {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    // 許可フィールドの値は schema が型・形を閉じる。追加文字列だけ機微検査する。
    if (depth > 0 || !allowedEvidenceKeys.has(path)) {
      if (/(?:@|\btoken\b|\bcode\b|\bverifier\b|\bsecret\b|\bbearer\b)/iu.test(value)) {
        throw new Error("sensitive_material");
      }
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) throw new Error("sensitive_material");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      rejectSensitiveMaterial(item, `${path}[${String(index)}]`, depth + 1);
    }
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      // トップレベルは allowlist 外を即拒否（strict と二重）
      if (depth === 0 && !allowedEvidenceKeys.has(key)) {
        throw new Error("sensitive_material");
      }
      if (
        depth > 0 &&
        /^(?:email|token|code|verifier|secret|password|refresh_token|access_token)$/iu.test(key)
      ) {
        throw new Error("sensitive_material");
      }
      rejectSensitiveMaterial(child, path ? `${path}.${key}` : key, depth + 1);
    }
  }
}

export function verifyGoogleOauthEvidence(value, { head, deployMetadata, now }) {
  rejectSensitiveMaterial(value);
  const evidence = googleOauthEvidenceSchema.parse(value);
  const metadata = deployMetadataSchema.parse(deployMetadata);
  if (metadata.id !== evidence.stagingDeployId) throw new Error("staging_deploy_id_mismatch");
  const metaOrigin = httpsOriginOnly(metadata.ssl_url ?? metadata.deploy_ssl_url);
  if (metaOrigin !== httpsOriginOnly(evidence.stagingOrigin)) {
    throw new Error("staging_origin_mismatch");
  }
  if (
    evidence.candidateSha !== head.trim() ||
    evidence.stagingDeploySha !== head.trim() ||
    metadata.commit_ref !== head.trim()
  ) {
    throw new Error("candidate_sha_mismatch");
  }
  const executed = Date.parse(evidence.executedAt);
  const expires = Date.parse(evidence.expiresAt);
  if (expires - executed !== 86_400_000) throw new Error("evidence_expiry_invalid");
  if (executed > now.getTime() + 300_000) throw new Error("evidence_time_invalid");
  if (now.getTime() > expires) throw new Error("evidence_expired");
  return evidence;
}

/**
 * Production CLI path: `main()` uses only real `fetch` + real `process.env`.
 * **Never** honor transport swap env/flags on the production entrypoint.
 */
export async function runVerifyReleaseEvidence(
  path,
  env = process.env,
  {
    fetchImpl = fetch,
    now = () => new Date(),
    revParseHead = () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }),
    revParseTopLevel = () =>
      execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }),
    readEvidence = (p) => readFileSync(p, "utf8"),
  } = {},
) {
  if (path === undefined) throw new Error("evidence_path_required");
  const root = realpathSync(revParseTopLevel().trim());
  const evidencePath = realpathSync(path);
  if (evidencePath === root || evidencePath.startsWith(`${root}${sep}`)) {
    throw new Error("evidence_must_be_external");
  }
  const value = JSON.parse(readEvidence(evidencePath));
  const head = revParseHead();
  const parsed = googleOauthEvidenceSchema.parse(value);
  if (!env.NETLIFY_AUTH_TOKEN) throw new Error("netlify_auth_required");
  const response = await fetchImpl(
    `https://api.netlify.com/api/v1/deploys/${encodeURIComponent(parsed.stagingDeployId)}`,
    {
      headers: { authorization: `Bearer ${env.NETLIFY_AUTH_TOKEN}` },
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) throw new Error("staging_metadata_unavailable");
  verifyGoogleOauthEvidence(parsed, {
    head,
    deployMetadata: await response.json(),
    now: now(),
  });
  process.stdout.write("google_oauth_evidence: pass\n");
}

/** Production entry — no transport swap hooks. */
export async function main(path = process.argv[2], env = process.env) {
  return runVerifyReleaseEvidence(path, env, {}); // always default fetch
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    const code =
      error instanceof Error && /^[a-z_]+$/u.test(error.message)
        ? error.message
        : "release_evidence_invalid";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
