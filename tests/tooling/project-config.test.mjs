import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("derives distinct Compose project names for same-basename checkouts", async () => {
  const firstParent = await mkdtemp(join(tmpdir(), "kondate-project-first-"));
  const secondParent = await mkdtemp(join(tmpdir(), "kondate-project-second-"));
  const firstRoot = join(firstParent, "checkout");
  const secondRoot = join(secondParent, "checkout");
  await Promise.all([mkdir(firstRoot), mkdir(secondRoot)]);
  const helper = resolve("scripts/compose-project-name.sh");

  const [{ stdout: first }, { stdout: second }] = await Promise.all([
    execFileAsync(helper, [firstRoot]),
    execFileAsync(helper, [secondRoot]),
  ]);

  assert.match(first.trim(), /^kondate-[0-9a-f]{32}$/u);
  assert.match(second.trim(), /^kondate-[0-9a-f]{32}$/u);
  assert.notEqual(first, second);
  assert.equal((await execFileAsync(helper, [firstRoot])).stdout, first);
});

test("uses a truncated SHA-256 instead of the colliding POSIX cksum identity", async () => {
  const helper = await readFile("scripts/compose-project-name.sh", "utf8");

  assert.match(helper, /sha256sum/u);
  assert.doesNotMatch(helper, /\bcksum\b/u);
  assert.match(helper, /project_name=\$\(printf 'kondate-%\.32s' "\$digest"\)/u);
});

test("pins Node 24 and exposes every verification script", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(manifest.type, "module");
  assert.equal(manifest.engines.node, ">=24 <25");
  assert.match(manifest.devDependencies["@netlify/functions"], /^\^5\./u);
  for (const name of [
    "build",
    "format:check",
    "lint",
    "typecheck",
    "test",
    "db:test",
    "db:types",
    "e2e",
  ]) {
    assert.equal(typeof manifest.scripts[name], "string", `missing ${name}`);
  }
  assert.equal(await readFile(".nvmrc", "utf8"), "24\n");
});

test("README provides the supported development and Supabase workflows", async () => {
  const readme = await readFile("README.md", "utf8");

  for (const heading of [
    "# こんだて日和",
    "## 技術構成",
    "## ローカル開発",
    "## 開発と検証",
    "## Supabase公式Docker構成の更新",
    "## 安全上の注意",
  ]) {
    assert.ok(readme.includes(heading), `missing README heading: ${heading}`);
  }

  for (const command of [
    "./scripts/generate-local-secrets.sh --force",
    "./scripts/reset-local-db.sh",
    "./scripts/run-e2e.sh",
    "./scripts/refresh-supabase.sh",
  ]) {
    assert.ok(readme.includes(command), `missing README command: ${command}`);
  }

  assert.match(readme, /docs\/local-development\.md/u);
  assert.match(readme, /Postgres 17/u);
  assert.match(readme, /ローカルDBを破棄/u);
});

test("ignores local temporary and refresh files from Git and Docker contexts", async () => {
  const [gitignore, dockerignore] = await Promise.all([
    readFile(".gitignore", "utf8"),
    readFile(".dockerignore", "utf8"),
  ]);
  for (const ignore of [gitignore, dockerignore]) {
    for (const pattern of [
      ".run-e2e.lock",
      ".env.tmp-*",
      "infra/.supabase-refresh.*",
      "infra/.supabase-refresh.lock",
    ]) {
      assert.ok(ignore.split(/\r?\n/u).includes(pattern));
    }
  }
});

test("local secret wrapper uses the repository Compose file from any working directory", async () => {
  const root = resolve();
  const cwd = await mkdtemp(join(tmpdir(), "kondate-local-secrets-wrapper-"));
  const bin = join(cwd, "bin");
  const capture = join(cwd, "docker-args");
  await mkdir(bin);
  await writeFile(
    join(bin, "docker"),
    ["#!/bin/sh", 'for argument do printf "%s\\0" "$argument"; done > "$CAPTURE"'].join("\n"),
    { mode: 0o755 },
  );

  const status = await new Promise((resolveRun, rejectRun) => {
    const child = spawn("sh", [join(root, "scripts/generate-local-secrets.sh"), "--force"], {
      cwd,
      env: { ...process.env, CAPTURE: capture, PATH: `${bin}:${process.env.PATH}` },
      stdio: "ignore",
    });
    child.once("error", rejectRun);
    child.once("exit", resolveRun);
  });

  assert.equal(status, 0);
  const projectName = (
    await execFileAsync(join(root, "scripts/compose-project-name.sh"), [root])
  ).stdout.trim();
  const args = (await readFile(capture, "utf8")).split("\0").slice(0, -1);
  assert.deepEqual(args, [
    "compose",
    "--project-directory",
    root,
    "--project-name",
    projectName,
    "-f",
    join(root, "compose.tooling.yaml"),
    "run",
    "--rm",
    "local-secrets",
    "--force",
  ]);
});

test("E2E mobile project uses Chromium while preserving the iPhone viewport", async () => {
  const config = await readFile("playwright.config.ts", "utf8");
  assert.match(
    config,
    /name: "mobile-chromium", use: \{ \.\.\.devices\["iPhone SE"\], browserName: "chromium" \}/u,
  );
});

test("E2E uses one worker for the shared local auth stack", async () => {
  const config = await readFile("playwright.config.ts", "utf8");
  assert.match(config, /workers: 1/u);
  assert.doesNotMatch(config, /process\.env\.CI \? \{ workers: 1 \}/u);
});

test("E2E retains traces video and failure screenshots only", async () => {
  const config = await readFile("playwright.config.ts", "utf8");
  // CI は Playwright レポートのみ失敗時アップロードし、痕跡は retain-on-failure に限定する。
  assert.match(config, /trace:\s*"retain-on-failure"/u);
  assert.match(config, /video:\s*"retain-on-failure"/u);
  // screenshot は Playwright が retain-on-failure を持たないため only-on-failure が相当。
  assert.match(config, /screenshot:\s*"only-on-failure"/u);
});

/**
 * CI 集約スクリプトと GitHub Actions ワークフローが共有する検証ゲートの出現順を抽出する。
 * ワークフロー固有の checkout / secrets / health / artifact / teardown は対象外。
 * 戻り値はソース内の実際の出現位置順（ゲート定義順ではない）。
 */
function extractSharedCiGateOrder(source) {
  const gatePatterns = [
    { label: "compose-config", pattern: /docker compose config --quiet/u },
    { label: "compose-up", pattern: /docker compose up -d --wait/u },
    { label: "format:check", pattern: /npm run format:check/u },
    { label: "lint", pattern: /npm run lint/u },
    { label: "typecheck", pattern: /npm run typecheck/u },
    { label: "vitest", pattern: /npx vitest run/u },
    { label: "db-test", pattern: /docker compose --profile test run --rm db-test/u },
    { label: "db:types", pattern: /npm run db:types/u },
    {
      label: "types-diff",
      pattern: /git diff --exit-code -- src\/shared\/types\/database\.generated\.ts/u,
    },
    { label: "e2e", pattern: /\.\/scripts\/run-e2e\.sh/u },
    { label: "audit", pattern: /npm audit --omit=dev --audit-level=high/u },
    { label: "build", pattern: /npm run build/u },
    {
      label: "netlify-offline",
      pattern: /netlify -- build --offline --context deploy-preview/u,
    },
  ];
  const positions = [];
  for (const { label, pattern } of gatePatterns) {
    const match = pattern.exec(source);
    assert.ok(match, `missing CI gate: ${label}`);
    positions.push({ index: match.index, label });
  }
  positions.sort((a, b) => a.index - b.index);
  return positions.map((entry) => entry.label);
}

test("ci.sh and GitHub Actions CI keep the same verification gate order", async () => {
  const [script, workflow] = await Promise.all([
    readFile("scripts/ci.sh", "utf8"),
    readFile(".github/workflows/ci.yml", "utf8"),
  ]);

  assert.match(script, /^set -euo pipefail$/mu);
  // EXIT トラップによる teardown は Task 8 拡張まで入れない（コメント内の語は除外）。
  assert.doesNotMatch(script, /^[^#]*\btrap\b/mu);

  const scriptOrder = extractSharedCiGateOrder(script);
  const workflowOrder = extractSharedCiGateOrder(workflow);
  assert.deepEqual(scriptOrder, workflowOrder);

  // E2E は free mock モデルとプライバシーログ検証を必須にする。
  for (const source of [script, workflow]) {
    assert.match(source, /LOCAL_MOCK_MODELS/u);
    assert.match(source, /mock\/kondate-primary:free,mock\/kondate-repair:free/u);
    assert.match(source, /KONDATE_ASSERT_PRIVACY_LOGS/u);
  }

  // ジョブ env は CI のみ。シークレットや origin を job-level env に載せない。
  assert.match(workflow, /env:\n {6}CI: "true"/u);
  assert.doesNotMatch(workflow, /AUTH_CONTINUATION_ENCRYPTION_KEY/u);
  assert.doesNotMatch(workflow, /GENERATION_REQUEST_HMAC_KEY/u);
  assert.doesNotMatch(workflow, /actions\/setup-node/u);
  assert.doesNotMatch(workflow, /playwright install/u);
  // 実 OpenRouter への到達を避けるため e2e はラッパー経由のみ。
  assert.doesNotMatch(workflow, /npm run e2e\b/u);
  assert.doesNotMatch(workflow, /npx playwright test/u);
});

test("Vite ignores Playwright output directories", async () => {
  const config = await readFile("vite.config.ts", "utf8");
  assert.match(config, /"\*\*\/playwright-report\/\*\*"/u);
  assert.match(config, /"\*\*\/test-results\/\*\*"/u);
});

test("Vitest excludes the plan-mandated node:test Function server suite", async () => {
  const config = await readFile("vitest.config.ts", "utf8");
  assert.match(config, /exclude: \["tools\/e2e-function-server\.test\.mjs"\]/u);
  assert.match(config, /"tools\/\*\*\/\*\.test\.mjs"/u);
});

test("local secret generator emits unquoted Supabase verification paths", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "kondate-local-secrets-"));
  await mkdir(join(cwd, "infra/supabase"), { recursive: true });
  await writeFile(
    join(cwd, "infra/supabase/.env.example"),
    [
      "COMPOSE_FILE=docker-compose.yml",
      "REALTIME_DB_ENC_KEY=supabaserealtime",
      "PG_META_CRYPTO_KEY=replace-me",
      "LOGFLARE_PUBLIC_ACCESS_TOKEN=replace-me",
      "LOGFLARE_PRIVATE_ACCESS_TOKEN=replace-me",
      "S3_PROTOCOL_ACCESS_KEY_ID=replace-me",
      "S3_PROTOCOL_ACCESS_KEY_SECRET=replace-me",
      'MAILER_URLPATHS_CONFIRMATION="/quoted/confirmation"',
      'MAILER_URLPATHS_INVITE="/quoted/invite"',
      'MAILER_URLPATHS_RECOVERY="/quoted/recovery"',
      'MAILER_URLPATHS_EMAIL_CHANGE="/quoted/email-change"',
    ].join("\n"),
  );
  await writeFile(join(cwd, ".env"), "OAUTH_MOCK_USER_PASSWORD=keep-existing-password\n");
  await chmod(join(cwd, ".env"), 0o644);

  const script = resolve("scripts/generate-local-secrets.mjs");
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [script, "--force"], {
      cwd,
      env: {
        ...process.env,
        KONDATE_COMPOSE_PROJECT_NAME: "kondate-0123456789abcdef0123456789abcdef",
        LOCAL_UID: "1234",
        LOCAL_GID: "5678",
      },
      stdio: "ignore",
    });
    child.once("error", rejectRun);
    child.once("exit", (code) =>
      code === 0 ? resolveRun() : rejectRun(new Error(`generator exited with ${String(code)}`)),
    );
  });

  const generated = await readFile(join(cwd, ".env"), "utf8");
  assert.equal((await stat(join(cwd, ".env"))).mode & 0o777, 0o600);
  assert.match(generated, /^OAUTH_MOCK_USER_PASSWORD=keep-existing-password$/mu);
  assert.doesNotMatch(generated, /^COMPOSE_FILE=/mu);
  assert.match(generated, /^LOCAL_UID=1234$/mu);
  assert.match(generated, /^LOCAL_GID=5678$/mu);
  assert.match(
    generated,
    /^KONDATE_COMPOSE_PROJECT_NAME=kondate-0123456789abcdef0123456789abcdef$/mu,
  );
  assert.match(generated, /^API_EXTERNAL_URL=http:\/\/127\.0\.0\.1:8000\/auth\/v1$/mu);
  assert.match(generated, /^REALTIME_DB_ENC_KEY=[a-f0-9]{16}$/mu);
  assert.match(generated, /^PG_META_CRYPTO_KEY=[A-Za-z0-9_-]{32}$/mu);
  assert.match(generated, /^LOGFLARE_PUBLIC_ACCESS_TOKEN=[A-Za-z0-9_-]{32}$/mu);
  assert.match(generated, /^LOGFLARE_PRIVATE_ACCESS_TOKEN=[A-Za-z0-9_-]{32}$/mu);
  assert.match(generated, /^S3_PROTOCOL_ACCESS_KEY_ID=[a-f0-9]{32}$/mu);
  assert.match(generated, /^S3_PROTOCOL_ACCESS_KEY_SECRET=[a-f0-9]{64}$/mu);
  for (const key of [
    "MAILER_URLPATHS_CONFIRMATION",
    "MAILER_URLPATHS_INVITE",
    "MAILER_URLPATHS_RECOVERY",
    "MAILER_URLPATHS_EMAIL_CHANGE",
  ]) {
    assert.match(generated, new RegExp(`^${key}=/auth/v1/verify$`, "mu"));
  }
  assert.deepEqual(
    (await readdir(cwd)).filter((entry) => entry.startsWith(".env.tmp-")),
    [],
  );
});

test("runs local-only tooling inside pinned containers", async () => {
  const [compose, wrapper, gitWrapper] = await Promise.all([
    readFile("compose.tooling.yaml", "utf8"),
    readFile("scripts/generate-local-secrets.sh", "utf8"),
    readFile("scripts/run-tooling-git.sh", "utf8"),
  ]);
  assert.match(compose, /image: node:24-bookworm-slim/u);
  assert.match(compose, /image: alpine\/git:v2\.54\.0/u);
  for (const serviceName of ["local-secrets", "vendor-supabase"]) {
    const lines = compose.split("\n");
    const start = lines.findIndex((line) => line === `  ${serviceName}:`);
    assert.notEqual(start, -1, `${serviceName} service is missing`);
    const relativeEnd = lines.slice(start + 1).findIndex((line) => /^ {2}[^ ]/u.test(line));
    const end = relativeEnd === -1 ? lines.length : start + 1 + relativeEnd;
    const service = lines.slice(start + 1, end).join("\n");
    assert.match(service, /^ {4}user: "\$\{LOCAL_UID:-1000\}:\$\{LOCAL_GID:-1000\}"$/mu);
    assert.match(service, /^ {6}LOCAL_UID: "\$\{LOCAL_UID:-1000\}"$/mu);
    assert.match(service, /^ {6}LOCAL_GID: "\$\{LOCAL_GID:-1000\}"$/mu);
  }
  assert.match(
    compose,
    /^ {6}KONDATE_COMPOSE_PROJECT_NAME: "\$\{KONDATE_COMPOSE_PROJECT_NAME:\?[^}]+\}"$/mu,
  );
  assert.match(compose, /entrypoint: \["node", "scripts\/generate-local-secrets\.mjs"\]/u);
  assert.match(compose, /entrypoint: \["\/workspace\/scripts\/vendor-supabase\.sh"\]/u);
  assert.equal((compose.match(/LOCAL_UID: "\$\{LOCAL_UID:-1000\}"/gu) ?? []).length, 2);
  assert.equal((compose.match(/LOCAL_GID: "\$\{LOCAL_GID:-1000\}"/gu) ?? []).length, 2);
  assert.match(wrapper, /docker compose --project-directory/u);
  assert.match(gitWrapper, /docker compose --project-directory/u);
  assert.match(gitWrapper, /--project-name/u);
  assert.match(gitWrapper, /--entrypoint git/u);
  assert.match(gitWrapper, /vendor-supabase/u);
});

test("tooling Git wrapper supports regular checkouts and linked worktrees", async () => {
  const [wrapper, projectNameHelper] = await Promise.all([
    readFile("scripts/run-tooling-git.sh", "utf8"),
    readFile("scripts/compose-project-name.sh", "utf8"),
  ]);

  const runFixture = async ({ linked, exitCode }) => {
    const cwd = await mkdtemp(join(tmpdir(), "kondate-tooling-git-"));
    await mkdir(join(cwd, "scripts"), { recursive: true });
    await writeFile(join(cwd, "scripts/run-tooling-git.sh"), wrapper);
    await writeFile(join(cwd, "scripts/compose-project-name.sh"), projectNameHelper, {
      mode: 0o755,
    });

    let commonDir;
    if (linked) {
      commonDir = join(cwd, "git-common");
      const gitDir = join(commonDir, "worktrees/fixture");
      await mkdir(gitDir, { recursive: true });
      await writeFile(join(cwd, ".git"), `gitdir: ${gitDir}\n`);
      await writeFile(join(gitDir, "commondir"), "../..\n");
    } else {
      await mkdir(join(cwd, ".git"));
    }
    await assert.rejects(stat(join(cwd, ".env")), { code: "ENOENT" });
    const { stdout } = await execFileAsync(join(cwd, "scripts/compose-project-name.sh"), [cwd]);
    const projectName = stdout.trim();

    const bin = join(cwd, "bin");
    const capture = join(cwd, "docker-args");
    await mkdir(bin);
    await writeFile(
      join(bin, "docker"),
      [
        "#!/bin/sh",
        'for argument do printf "%s\\0" "$argument"; done > "$CAPTURE"',
        'exit "$DOCKER_EXIT_CODE"',
      ].join("\n"),
      { mode: 0o755 },
    );

    const status = await new Promise((resolveRun, rejectRun) => {
      const child = spawn(
        "sh",
        [join(cwd, "scripts/run-tooling-git.sh"), "status", "--short", "space arg"],
        {
          cwd,
          env: {
            ...process.env,
            CAPTURE: capture,
            COMPOSE_PROJECT_NAME: "caller-compose-project",
            DOCKER_EXIT_CODE: String(exitCode),
            KONDATE_COMPOSE_PROJECT_NAME: "caller-kondate-project",
            PATH: `${bin}:${process.env.PATH}`,
          },
          stdio: "ignore",
        },
      );
      child.once("error", rejectRun);
      child.once("exit", resolveRun);
    });

    const args = (await readFile(capture, "utf8")).split("\0").slice(0, -1);
    return { args, commonDir, cwd, projectName, status };
  };

  const regular = await runFixture({ linked: false, exitCode: 23 });
  assert.equal(regular.status, 23);
  assert.deepEqual(regular.args, [
    "compose",
    "--project-directory",
    regular.cwd,
    "--project-name",
    regular.projectName,
    "-f",
    join(regular.cwd, "compose.tooling.yaml"),
    "run",
    "--rm",
    "--entrypoint",
    "git",
    "vendor-supabase",
    "status",
    "--short",
    "space arg",
  ]);

  const linked = await runFixture({ linked: true, exitCode: 0 });
  assert.equal(linked.status, 0);
  assert.deepEqual(linked.args, [
    "compose",
    "--project-directory",
    linked.cwd,
    "--project-name",
    linked.projectName,
    "-f",
    join(linked.cwd, "compose.tooling.yaml"),
    "run",
    "--rm",
    "--volume",
    `${linked.commonDir}:${linked.commonDir}`,
    "--entrypoint",
    "git",
    "vendor-supabase",
    "status",
    "--short",
    "space arg",
  ]);
});
