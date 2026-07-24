import assert from "node:assert/strict";
import test from "node:test";
import { main, verifyProductionDeploy } from "./verify-production-deploy.mjs";

const sha = "a".repeat(40);
const deployId = "b".repeat(24);
const origin = "https://kondate.example.com";

function successFixture(overrides = {}) {
  return {
    headSha: sha,
    candidateSha: sha,
    tagSha: sha,
    productionDeployId: deployId,
    productionOrigin: origin,
    deploy: {
      id: deployId,
      commit_ref: sha,
      context: "production",
      state: "ready",
      ssl_url: origin,
      site_id: "site123",
    },
    site: {
      published_deploy: { id: deployId },
    },
    ...overrides,
  };
}

test("accepts matching HEAD/candidate/tag/deploy/published origin", () => {
  assert.equal(verifyProductionDeploy(successFixture()), true);
});

const rejections = [
  ["wrong HEAD", { headSha: "c".repeat(40) }, /head_candidate_mismatch/],
  [
    "wrong candidate",
    { candidateSha: "c".repeat(40) },
    /head_candidate_mismatch|candidate_tag_mismatch/,
  ],
  ["wrong tag", { tagSha: "c".repeat(40) }, /candidate_tag_mismatch/],
  [
    "wrong deploy sha",
    { deploy: { ...successFixture().deploy, commit_ref: "c".repeat(40) } },
    /deploy_sha_mismatch/,
  ],
  [
    "wrong deploy id",
    { deploy: { ...successFixture().deploy, id: "c".repeat(24) } },
    /deploy_id_mismatch/,
  ],
  [
    "wrong context",
    { deploy: { ...successFixture().deploy, context: "deploy-preview" } },
    /deploy_context_invalid/,
  ],
  [
    "wrong state",
    { deploy: { ...successFixture().deploy, state: "building" } },
    /deploy_state_invalid/,
  ],
  [
    "wrong origin",
    {
      deploy: {
        ...successFixture().deploy,
        ssl_url: "https://other.example.com",
      },
    },
    /deploy_origin_mismatch/,
  ],
  [
    "stale published",
    { site: { published_deploy: { id: "c".repeat(24) } } },
    /published_deploy_mismatch/,
  ],
  [
    "origin with path",
    { productionOrigin: "https://kondate.example.com/path" },
    /production_origin_invalid/,
  ],
  [
    "origin with credentials",
    { productionOrigin: "https://user:pass@kondate.example.com" },
    /production_origin_invalid/,
  ],
  ["missing deploy", { deploy: null }, /deploy_metadata_missing/],
  ["missing site", { site: null }, /site_metadata_missing/],
];

for (const [label, overrides, pattern] of rejections) {
  test(`rejects ${label}`, () => {
    assert.throws(() => verifyProductionDeploy(successFixture(overrides)), pattern);
  });
}

test("CLI prints only closed pass/error and never token/origin/metadata", async () => {
  const lines = [];
  const fetchImpl = async (url) => {
    if (url.includes("/deploys/")) {
      return {
        ok: true,
        json: async () => successFixture().deploy,
      };
    }
    return {
      ok: true,
      json: async () => successFixture().site,
    };
  };
  const code = await main({
    env: {
      CANDIDATE_SHA: sha,
      RELEASE_TAG: "v0.0.0-test",
      PRODUCTION_DEPLOY_ID: deployId,
      PRODUCTION_ORIGIN: origin,
      NETLIFY_AUTH_TOKEN: "super-secret-token",
    },
    fetchImpl,
    execFile: (_cmd, args) => {
      if (args[0] === "rev-parse") return `${sha}\n`;
      if (args[0] === "rev-list") return `${sha}\n`;
      throw new Error("unexpected git");
    },
    write: (line) => lines.push(line),
  });
  assert.equal(code, 0);
  assert.deepEqual(lines, ["production_deploy: pass"]);
  assert.doesNotMatch(lines.join("\n"), /super-secret-token/);
  assert.doesNotMatch(lines.join("\n"), /kondate\.example\.com/);
});
