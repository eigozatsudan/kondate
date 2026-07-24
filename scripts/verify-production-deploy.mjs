/**
 * 現在の production publish が candidate / tag / HEAD と一致することを
 * Netlify メタデータだけで検証する。token・origin・生レスポンスは出さない。
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { httpsOriginOnly } from "./verify-release-evidence.mjs";

const shaPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const deployIdPattern = /^[0-9a-f]{24}$/u;

/**
 * 純粋検証。ネットワークなし。
 */
export function verifyProductionDeploy({
  headSha,
  candidateSha,
  tagSha,
  productionDeployId,
  productionOrigin,
  deploy,
  site,
}) {
  if (!shaPattern.test(headSha)) throw new Error("head_sha_invalid");
  if (!shaPattern.test(candidateSha)) throw new Error("candidate_sha_invalid");
  if (!shaPattern.test(tagSha)) throw new Error("tag_sha_invalid");
  if (!deployIdPattern.test(productionDeployId)) {
    throw new Error("production_deploy_id_invalid");
  }
  if (deploy === null || typeof deploy !== "object") {
    throw new Error("deploy_metadata_missing");
  }
  if (site === null || typeof site !== "object") {
    throw new Error("site_metadata_missing");
  }

  let expectedOrigin;
  try {
    expectedOrigin = httpsOriginOnly(productionOrigin);
  } catch {
    throw new Error("production_origin_invalid");
  }
  if (productionOrigin !== expectedOrigin) {
    throw new Error("production_origin_invalid");
  }

  if (headSha !== candidateSha) throw new Error("head_candidate_mismatch");
  if (candidateSha !== tagSha) throw new Error("candidate_tag_mismatch");
  if (deploy.commit_ref !== candidateSha) throw new Error("deploy_sha_mismatch");
  if (deploy.id !== productionDeployId) throw new Error("deploy_id_mismatch");
  if (deploy.context !== "production") throw new Error("deploy_context_invalid");
  if (deploy.state !== "ready") throw new Error("deploy_state_invalid");

  const deployOrigin = httpsOriginOnly(deploy.ssl_url ?? deploy.deploy_ssl_url ?? "");
  if (deployOrigin !== expectedOrigin) throw new Error("deploy_origin_mismatch");

  const publishedId = site.published_deploy?.id;
  if (publishedId !== productionDeployId) {
    throw new Error("published_deploy_mismatch");
  }
  return true;
}

async function fetchJson(url, token, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("netlify_metadata_failed");
  return response.json();
}

export async function main({
  env = process.env,
  fetchImpl = fetch,
  execFile = execFileSync,
  write = console.error,
} = {}) {
  try {
    const candidateSha = env.CANDIDATE_SHA;
    const releaseTag = env.RELEASE_TAG;
    const productionDeployId = env.PRODUCTION_DEPLOY_ID;
    const productionOrigin = env.PRODUCTION_ORIGIN;
    const token = env.NETLIFY_AUTH_TOKEN;
    if (!candidateSha) throw new Error("CANDIDATE_SHA");
    if (!releaseTag) throw new Error("RELEASE_TAG");
    if (!productionDeployId) throw new Error("PRODUCTION_DEPLOY_ID");
    if (!productionOrigin) throw new Error("PRODUCTION_ORIGIN");
    if (!token) throw new Error("NETLIFY_AUTH_TOKEN");

    const headSha = String(execFile("git", ["rev-parse", "HEAD"], { encoding: "utf8" })).trim();
    const tagSha = String(
      execFile("git", ["rev-list", "-n", "1", releaseTag], { encoding: "utf8" }),
    ).trim();

    const deploy = await fetchJson(
      `https://api.netlify.com/api/v1/deploys/${encodeURIComponent(productionDeployId)}`,
      token,
      fetchImpl,
    );
    const siteId = deploy.site_id;
    if (typeof siteId !== "string" || siteId.length === 0) {
      throw new Error("site_id_missing");
    }
    const site = await fetchJson(
      `https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}`,
      token,
      fetchImpl,
    );

    verifyProductionDeploy({
      headSha,
      candidateSha,
      tagSha,
      productionDeployId,
      productionOrigin,
      deploy,
      site,
    });
    write("production_deploy: pass");
    return 0;
  } catch (error) {
    const code = error instanceof Error ? error.message : "production_deploy_failed";
    // 閉じたコードのみ。token / origin / メタデータ本文は出さない
    if (code === "production_deploy: pass") {
      write(code);
      return 0;
    }
    write(`production_deploy: ${code}`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main();
}
