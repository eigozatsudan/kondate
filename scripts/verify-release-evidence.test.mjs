import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  httpsOriginOnly,
  runVerifyReleaseEvidence,
  verifyGoogleOauthEvidence,
} from "./verify-release-evidence.mjs";

const HEAD = "a".repeat(40);
const DEPLOY_ID = "b".repeat(24);

function validEvidence(overrides = {}) {
  const executedAt = "2026-07-11T00:00:00.000Z";
  const expiresAt = "2026-07-12T00:00:00.000Z";
  return {
    candidateSha: HEAD,
    stagingDeployId: DEPLOY_ID,
    stagingDeploySha: HEAD,
    executedAt,
    expiresAt,
    tester: "release-runner",
    stagingOrigin: "https://staging.example.com",
    startScreen: "login",
    stateMatched: true,
    originalBrowserCallbackCompleted: true,
    tokenFreeResult: true,
    passed: true,
    ...overrides,
  };
}

function validMetadata(overrides = {}) {
  return {
    id: DEPLOY_ID,
    commit_ref: HEAD,
    ssl_url: "https://staging.example.com/",
    ...overrides,
  };
}

describe("httpsOriginOnly", () => {
  it("strips trailing slash and rejects non-https", () => {
    assert.equal(httpsOriginOnly("https://staging.example.com/"), "https://staging.example.com");
    assert.throws(() => httpsOriginOnly("http://staging.example.com"), /staging_origin_invalid/);
    assert.throws(
      () => httpsOriginOnly("https://staging.example.com/path"),
      /staging_origin_invalid/,
    );
  });
});

describe("verifyGoogleOauthEvidence", () => {
  const now = new Date("2026-07-11T12:00:00.000Z");

  it("accepts matching SHA, deploy ID, origin, and 24h window", () => {
    const evidence = verifyGoogleOauthEvidence(validEvidence(), {
      head: HEAD,
      deployMetadata: validMetadata(),
      now,
    });
    assert.equal(evidence.passed, true);
  });

  it("rejects wrong local HEAD", () => {
    assert.throws(
      () =>
        verifyGoogleOauthEvidence(validEvidence(), {
          head: "c".repeat(40),
          deployMetadata: validMetadata(),
          now,
        }),
      /candidate_sha_mismatch/,
    );
  });

  it("rejects deploy ID mismatch", () => {
    assert.throws(
      () =>
        verifyGoogleOauthEvidence(validEvidence(), {
          head: HEAD,
          deployMetadata: validMetadata({ id: "d".repeat(24) }),
          now,
        }),
      /staging_deploy_id_mismatch/,
    );
  });

  it("rejects origin mismatch and path-bearing origin", () => {
    assert.throws(
      () =>
        verifyGoogleOauthEvidence(validEvidence(), {
          head: HEAD,
          deployMetadata: validMetadata({ ssl_url: "https://other.example.com" }),
          now,
        }),
      /staging_origin_mismatch/,
    );
    assert.throws(
      () => googleParse(validEvidence({ stagingOrigin: "https://staging.example.com/app" })),
      () => true,
    );
  });

  it("rejects false booleans and missing required fields", () => {
    assert.throws(
      () =>
        verifyGoogleOauthEvidence(validEvidence({ passed: false }), {
          head: HEAD,
          deployMetadata: validMetadata(),
          now,
        }),
      () => true,
    );
    assert.throws(
      () =>
        verifyGoogleOauthEvidence(validEvidence({ startScreen: "welcome" }), {
          head: HEAD,
          deployMetadata: validMetadata(),
          now,
        }),
      () => true,
    );
  });

  it("rejects non-24h expiry, future execution, and expired evidence", () => {
    assert.throws(
      () =>
        verifyGoogleOauthEvidence(validEvidence({ expiresAt: "2026-07-11T12:00:00.000Z" }), {
          head: HEAD,
          deployMetadata: validMetadata(),
          now,
        }),
      /evidence_expiry_invalid/,
    );
    assert.throws(
      () =>
        verifyGoogleOauthEvidence(
          validEvidence({
            executedAt: "2026-07-20T00:00:00.000Z",
            expiresAt: "2026-07-21T00:00:00.000Z",
          }),
          { head: HEAD, deployMetadata: validMetadata(), now },
        ),
      /evidence_time_invalid/,
    );
    assert.throws(
      () =>
        verifyGoogleOauthEvidence(validEvidence(), {
          head: HEAD,
          deployMetadata: validMetadata(),
          now: new Date("2026-07-13T00:00:00.000Z"),
        }),
      /evidence_expired/,
    );
  });

  it("rejects email-shaped tester and sensitive keys", () => {
    assert.throws(
      () =>
        verifyGoogleOauthEvidence(validEvidence({ tester: "user@example.com" }), {
          head: HEAD,
          deployMetadata: validMetadata(),
          now,
        }),
      () => true,
    );
    assert.throws(
      () =>
        verifyGoogleOauthEvidence(
          { ...validEvidence(), accessToken: "secret" },
          { head: HEAD, deployMetadata: validMetadata(), now },
        ),
      /sensitive_material|unrecognized_keys|strict/iu,
    );
  });
});

function googleParse(value) {
  return verifyGoogleOauthEvidence(value, {
    head: HEAD,
    deployMetadata: validMetadata(),
    now: new Date("2026-07-11T12:00:00.000Z"),
  });
}

describe("runVerifyReleaseEvidence", () => {
  it("writes pass for external evidence with injected fetch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kondate-evidence-"));
    const path = join(dir, "evidence.json");
    writeFileSync(path, JSON.stringify(validEvidence()));
    const chunks = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...rest) => {
      chunks.push(String(chunk));
      return originalWrite(chunk, ...rest);
    };
    try {
      await runVerifyReleaseEvidence(
        path,
        { NETLIFY_AUTH_TOKEN: "test-token" },
        {
          fetchImpl: async () => new Response(JSON.stringify(validMetadata()), { status: 200 }),
          now: () => new Date("2026-07-11T12:00:00.000Z"),
          revParseHead: () => HEAD,
          revParseTopLevel: () => process.cwd(),
        },
      );
      assert.match(chunks.join(""), /google_oauth_evidence: pass/);
    } finally {
      process.stdout.write = originalWrite;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects repo-local evidence paths", async () => {
    await assert.rejects(
      () =>
        runVerifyReleaseEvidence(
          join(process.cwd(), "package.json"),
          { NETLIFY_AUTH_TOKEN: "test-token" },
          {
            revParseHead: () => HEAD,
            revParseTopLevel: () => process.cwd(),
          },
        ),
      /evidence_must_be_external/,
    );
  });
});
