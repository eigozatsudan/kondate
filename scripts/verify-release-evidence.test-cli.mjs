// test-only wrapper — inject mock fetch for spawn coverage
// Never referenced by package.json production scripts or Task 9 release commands.
import { readFileSync } from "node:fs";
import { runVerifyReleaseEvidence } from "./verify-release-evidence.mjs";

if (process.env.CONTEXT === "production") {
  process.stderr.write("test_cli_forbidden_in_production\n");
  process.exitCode = 1;
  process.exit();
}

const path = process.argv[2];
let deployMetadata = {
  id: "b".repeat(24),
  commit_ref: "a".repeat(40),
  ssl_url: "https://staging.example.com",
};

// 証跡 JSON から deploy メタを合わせる（spawn 成功パス用）
try {
  const evidence = JSON.parse(readFileSync(path, "utf8"));
  deployMetadata = {
    id: evidence.stagingDeployId,
    commit_ref: evidence.candidateSha,
    ssl_url: evidence.stagingOrigin,
  };
} catch {
  // path 不正は runner 側で閉じたコードにする
}

const mockFetch = async () =>
  new Response(JSON.stringify(deployMetadata), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

await runVerifyReleaseEvidence(path, process.env, {
  fetchImpl: mockFetch,
  now: () => new Date("2026-07-11T12:00:00.000Z"),
}).catch((error) => {
  const code =
    error instanceof Error && /^[a-z_]+$/u.test(error.message)
      ? error.message
      : "release_evidence_invalid";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
