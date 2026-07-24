import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const extractLocalEnvValidationBody = (guide) => {
  const match = guide.match(/-c 'sh -eu -c '\\''(?<body>[^\n]+)'\\'''/u);
  assert.ok(match?.groups?.body, "documented local .env validation body is missing");
  return match.groups.body;
};

const runLocalEnvValidation = async ({ body, composeFile, mode }) => {
  const cwd = await mkdtemp(join(tmpdir(), "kondate-local-env-validation-"));
  const lines = [
    "API_EXTERNAL_URL=http://127.0.0.1:8000/auth/v1",
    "KONDATE_COMPOSE_PROJECT_NAME=kondate-0123456789abcdef0123456789abcdef",
    "LOCAL_UID=1234",
    "LOCAL_GID=5678",
  ];
  if (composeFile) lines.push("COMPOSE_FILE=docker-compose.yml");
  await writeFile(join(cwd, ".env"), `${lines.join("\n")}\n`);
  await chmod(join(cwd, ".env"), mode);

  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn("sh", ["-eu", "-c", body], { cwd, stdio: "ignore" });
    child.once("error", rejectRun);
    child.once("exit", resolveRun);
  });
};

test("root compose owns every local entry-point service", async () => {
  const compose = await readFile("compose.yaml", "utf8");
  for (const name of [
    "app:",
    "mailpit:",
    "openrouter-mock:",
    "oauth-mock:",
    "migrate:",
    "db-test:",
  ]) {
    assert.match(compose, new RegExp(`^  ${name}`, "m"));
  }
  assert.match(compose, /infra\/supabase\/docker-compose\.yml/);
});

test("root compose does not redeclare include-owned supabase services", async () => {
  // Compose v5: redefining services from include fails with
  // "services.<name> conflicts with imported resource" (CI docker compose config --quiet).
  const [compose, override] = await Promise.all([
    readFile("compose.yaml", "utf8"),
    readFile("infra/supabase.override.yaml", "utf8"),
  ]);
  for (const name of ["kong:", "supavisor:", "db:", "auth:"]) {
    assert.doesNotMatch(
      compose,
      new RegExp(`^  ${name}`, "m"),
      `root compose must not redeclare include-owned service ${name}`,
    );
  }
  // 127.0.0.1 固定は override 側の契約
  assert.match(override, /^ {2}kong:\n {4}ports: !override/mu);
  assert.match(override, /^ {2}supavisor:\n {4}ports: !override/mu);
  assert.match(override, /127\.0\.0\.1:8000:8000/);
  assert.match(override, /127\.0\.0\.1:5432:5432/);
});

test("serializes project migrations after GoTrue migrations", async () => {
  const compose = await readFile("compose.yaml", "utf8");
  const migrate = compose.match(/^ {2}migrate:\n([\s\S]*?)(?=^ {2}[\w-]+:|^volumes:)/mu)?.[1];
  assert.ok(migrate, "migrate service is missing");
  const dependsOn = migrate.match(
    /^ {4}depends_on:\n(?<body>(?: {6}[\w-]+:\n {8}condition: service_healthy\n)+)/mu,
  )?.groups?.body;
  assert.ok(dependsOn, "migrate depends_on mapping is missing");
  assert.match(dependsOn, /^ {6}db:\n {8}condition: service_healthy$/mu);
  assert.match(dependsOn, /^ {6}auth:\n {8}condition: service_healthy$/mu);
});

test("derives the Compose project name from the checkout directory", async () => {
  const [compose, tooling] = await Promise.all([
    readFile("compose.yaml", "utf8"),
    readFile("compose.tooling.yaml", "utf8"),
  ]);
  for (const source of [compose, tooling])
    assert.match(
      source,
      /^name: "\$\{KONDATE_COMPOSE_PROJECT_NAME:\?KONDATE_COMPOSE_PROJECT_NAME is required\}"$/mu,
    );
});

test("uses one canonical loopback hostname for public browser services", async () => {
  const [compose, example, config] = await Promise.all([
    readFile("compose.yaml", "utf8"),
    readFile(".env.example", "utf8"),
    readFile("supabase/config.toml", "utf8"),
  ]);
  for (const source of [compose, example, config])
    assert.doesNotMatch(source, /http:\/\/local(?:host)/u);
  assert.match(example, /^SERVER_SITE_ORIGIN=http:\/\/127\.0\.0\.1:5173$/mu);
  assert.match(example, /^API_EXTERNAL_URL=http:\/\/127\.0\.0\.1:8000\/auth\/v1$/mu);
  assert.match(example, /^VITE_AUTH_PROVIDER_MODE=oauth_mock$/mu);
  assert.match(example, /^VITE_OAUTH_MOCK_ORIGIN=http:\/\/127\.0\.0\.1:8788$/mu);
  assert.match(config, /site_url = "http:\/\/127\.0\.0\.1:5173"/u);
});

test("Dockerfile uses Node 24", async () => {
  assert.match(await readFile("Dockerfile", "utf8"), /^FROM node:24-/m);
});

test("uses one Postgres 17 image across database tooling", async () => {
  const [upstream, compose, dbTest, config, version] = await Promise.all([
    readFile("infra/supabase/docker-compose.yml", "utf8"),
    readFile("compose.yaml", "utf8"),
    readFile("Dockerfile.db-test", "utf8"),
    readFile("supabase/config.toml", "utf8"),
    readFile("infra/supabase.version", "utf8"),
  ]);

  const servicesStart = upstream.split("\n").findIndex((line) => line === "services:");
  assert.notEqual(servicesStart, -1, "official services mapping is missing");
  const serviceLines = upstream.split("\n").slice(servicesStart + 1);
  const dbStart = serviceLines.findIndex((line) => line === "  db:");
  assert.notEqual(dbStart, -1, "official db service is missing");
  const dbLines = serviceLines.slice(dbStart + 1).filter((line, index, lines) => {
    const nextService = lines.findIndex((candidate) => /^ {2}[^ ](?:.*):$/u.test(candidate));
    return nextService === -1 || index < nextService;
  });
  const upstreamImages = dbLines
    .map((line) => line.match(/^ {4}image: (\S+)$/u)?.[1])
    .filter(Boolean);
  const migrateBlock = compose.match(/^ {2}migrate:\n([\s\S]*?)(?=^ {2}[\w-]+:|^volumes:)/mu)?.[1];
  const migrateImage = migrateBlock?.match(/^\s{4}image: (supabase\/postgres:[^\s]+)$/mu)?.[1];
  const testImage = dbTest.match(/^FROM (supabase\/postgres:[^\s]+)$/mu)?.[1];

  assert.equal(upstreamImages.length, 1, "official db service must define exactly one image");
  const [upstreamImage] = upstreamImages;
  assert.equal(migrateImage, upstreamImage);
  assert.equal(testImage, upstreamImage);
  assert.match(upstreamImage, /^supabase\/postgres:17\.[0-9]+(?:\.[0-9]+)+$/u);
  assert.match(config, /^major_version = 17$/mu);
  assert.match(version.trim(), /^[0-9a-f]{40}$/u);
});

test("removes Postgres 15 compatibility and upgrade assets", async () => {
  for (const path of [
    "infra/supabase/docker-compose.pg15.yml",
    "infra/supabase/docker-compose.pg17.yml",
    "infra/supabase/utils/upgrade-pg17.sh",
    "infra/supabase/tests/test-pg17-upgrade.sh",
  ]) {
    await assert.rejects(access(path));
  }
});

test("uses Postgres Meta for containerized type generation", async () => {
  const [compose, example, generator] = await Promise.all([
    readFile("compose.yaml", "utf8"),
    readFile(".env.example", "utf8"),
    readFile("scripts/generate-database-types.sh", "utf8"),
  ]);
  const app = compose.match(/^ {2}app:\n([\s\S]*?)(?=^ {2}[\w-]+:|^volumes:)/mu)?.[1];
  assert.ok(app, "app service is missing");
  assert.doesNotMatch(app, /LOCAL_DB_URL/u);
  assert.doesNotMatch(example, /^LOCAL_DB_URL=/mu);
  assert.match(app, /^ {6}meta:\n {8}condition: service_healthy$/mu);
  assert.match(generator, /http:\/\/meta:8080\/generators\/typescript/u);
  assert.match(generator, /included_schemas=public,private/u);
  assert.doesNotMatch(generator, /supabase gen types/u);
  assert.match(generator, /mktemp "\$destination_dir\/\.database\.generated\.XXXXXX"/u);
  assert.match(generator, /mv "\$tmp_file" "\$destination"/u);
});

test("verifies the pinned pgTAP source archive before installation", async () => {
  const dockerfile = await readFile("Dockerfile.db-test", "utf8");
  assert.match(
    dockerfile,
    /https:\/\/cpan\.metacpan\.org\/authors\/id\/D\/DW\/DWHEELER\/TAP-Parser-SourceHandler-pgTAP-3\.37\.tar\.gz/u,
  );
  assert.match(dockerfile, /6e928581442a1e687131f7b5d6f4ff44b7f8dcdf798d2d076bdcd07d8b7a597d/u);
  assert.match(dockerfile, /sha256sum -c/u);
  assert.match(dockerfile, /cpanm --notest \/tmp\/TAP-Parser-SourceHandler-pgTAP-3\.37\.tar\.gz/u);
});

test("keeps the one-shot database test out of the default stack", async () => {
  const compose = await readFile("compose.yaml", "utf8");
  const dbTest = compose.match(/^ {2}db-test:\n([\s\S]*?)(?=^ {2}[\w-]+:|^volumes:)/mu)?.[1];
  assert.ok(dbTest, "db-test service is missing");
  assert.match(dbTest, /^ {4}profiles: \["test"\]$/mu);
});

test("keeps host development on loopback while the container can accept published traffic", async () => {
  const [compose, dockerfile, viteConfig] = await Promise.all([
    readFile("compose.yaml", "utf8"),
    readFile("Dockerfile", "utf8"),
    readFile("vite.config.ts", "utf8"),
  ]);
  assert.match(viteConfig, /host: "127\.0\.0\.1"/u);
  assert.match(dockerfile, /"--host", "0\.0\.0\.0"/u);
  assert.match(compose, /\sapp:\n(?:.*\n)*?\s{4}healthcheck:/u);
});

test("runs mock services with only their required read-only files and environment", async () => {
  const compose = await readFile("compose.yaml", "utf8");
  const openrouter = compose.match(
    /\s{2}openrouter-mock:\n([\s\S]*?)(?=\n\s{2}[\w-]+:|\nvolumes:)/u,
  )?.[1];
  const oauth = compose.match(/\s{2}oauth-mock:\n([\s\S]*?)(?=\n\s{2}[\w-]+:|\nvolumes:)/u)?.[1];
  assert.ok(openrouter, "openrouter mock service is missing");
  assert.ok(oauth, "OAuth mock service is missing");
  assert.match(openrouter, /tools\/openrouter-mock\/server\.mjs:\/app\/server\.mjs:ro/u);
  assert.match(openrouter, /tools\/openrouter-mock\/fixtures:\/app\/fixtures:ro/u);
  assert.doesNotMatch(openrouter, /\.:\/workspace/u);
  assert.doesNotMatch(openrouter, /working_dir:/u);
  assert.match(oauth, /tools\/oauth-mock\/server\.mjs:\/app\/server\.mjs:ro/u);
  assert.match(oauth, /tools\/oauth-mock\/fixtures:\/app\/fixtures:ro/u);
  assert.doesNotMatch(oauth, /\.:\/workspace/u);
  assert.doesNotMatch(oauth, /working_dir:/u);
});

test("provides the complete locked generation environment to the app service", async () => {
  const compose = await readFile("compose.yaml", "utf8");
  const app = compose.match(/^ {2}app:\n([\s\S]*?)(?=^ {2}[\w-]+:|^volumes:)/mu)?.[1];
  assert.ok(app, "app service is missing");
  for (const line of [
    "SUPABASE_URL: http://kong:8000",
    "SUPABASE_PUBLISHABLE_KEY: ${ANON_KEY}",
    "SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}",
    "OPENROUTER_API_KEY: local-mock-key",
    "OPENROUTER_MODELS: mock/kondate-primary:free,mock/kondate-repair:free",
    "OPENROUTER_BASE_URL: http://openrouter-mock:8787/api/v1",
    'USER_DAILY_AI_LIMIT: "5"',
    'USER_DAILY_EXTERNAL_CALL_LIMIT: "12"',
    'USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT: "4"',
    'USER_SHORT_WINDOW_SECONDS: "600"',
    'GLOBAL_DAILY_AI_LIMIT: "45"',
    'OPENROUTER_TIMEOUT_MS: "20000"',
    'FUNCTION_TOTAL_BUDGET_MS: "50000"',
    'AI_PROCESSING_STALE_SECONDS: "180"',
  ]) {
    assert.match(app, new RegExp(`^ {6}${line.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "mu"));
  }
});

test("runs the development app as the node user and keeps generated Vite cache outside mounted dependencies", async () => {
  const [compose, dockerfile, viteConfig] = await Promise.all([
    readFile("compose.yaml", "utf8"),
    readFile("Dockerfile", "utf8"),
    readFile("vite.config.ts", "utf8"),
  ]);
  assert.match(
    compose,
    /\sapp:\n(?:.*\n)*?\s{4}user: "\$\{LOCAL_UID:-1000\}:\$\{LOCAL_GID:-1000\}"/u,
  );
  assert.match(dockerfile, /^USER node$/m);
  assert.match(viteConfig, /cacheDir: "\/tmp\/vite"/u);
});

test("uses the isolated E2E Function server without changing the public origin", async () => {
  const [compose, composeE2e, viteConfig, runner] = await Promise.all([
    readFile("compose.yaml", "utf8"),
    readFile("compose.e2e.yaml", "utf8"),
    readFile("vite.config.ts", "utf8"),
    readFile("tools/run-e2e-app.mjs", "utf8"),
  ]);
  assert.doesNotMatch(compose, /KONDATE_E2E_FUNCTION_SERVER/u);
  assert.doesNotMatch(compose, /GOTRUE_RATE_LIMIT_EMAIL_SENT/u);
  assert.match(composeE2e, /KONDATE_E2E_FUNCTION_SERVER: "1"/u);
  assert.match(composeE2e, /\s{2}auth:\n\s{4}environment:\n\s{6}GOTRUE_SMTP_MAX_FREQUENCY: "1s"/u);
  assert.match(composeE2e, /GOTRUE_RATE_LIMIT_EMAIL_SENT: "100"/u);
  assert.match(composeE2e, /command: \["node", "tools\/run-e2e-app\.mjs"\]/u);
  assert.match(viteConfig, /functions: \{ enabled: !isE2eFunctionServer \}/u);
  assert.match(viteConfig, /target: "http:\/\/127\.0\.0\.1:5174"/u);
  assert.match(runner, /SIGTERM/u);
  assert.match(runner, /SIGINT/u);
});

test("runs E2E through the base and E2E Compose files in override order", async () => {
  const runner = await readFile("scripts/run-e2e.sh", "utf8");
  assert.match(runner, /^#!\/bin\/sh\n(?:#[^\n]*\n)*set -eu$/mu);
  assert.doesNotMatch(runner, /\(docker compose|\[@\]|pipefail/u);
  assert.match(runner, /compose-project-name\.sh/u);
  assert.match(runner, /ensure-compose-project-env\.sh/u);
  assert.match(runner, /--project-directory "\$repo_root" --project-name "\$project_name"/u);
  assert.match(runner, /-f "\$repo_root\/compose\.yaml"[\s\\]*\n?\s*up -d --wait/u);
  assert.match(runner, /--profile e2e[\s\\]*up -d --wait auth/u);
  assert.match(
    runner,
    /--profile e2e[\s\\]*up -d --wait --force-recreate --no-deps kong oauth-mock app/u,
  );
  assert.match(runner, /run --rm --no-deps e2e/u);
  assert.match(runner, /run --rm --no-deps e2e "\$@"/u);
  assert.doesNotMatch(runner, /exec docker compose/u);
  assert.match(runner, /trap cleanup_on_exit EXIT/u);
  assert.match(runner, /--profile e2e[\s\\]*kill --signal SIGKILL e2e/u);
  assert.match(runner, /--profile e2e[\s\\]*rm --force e2e/u);
  assert.doesNotMatch(runner, /rm --force --stop e2e/u);
  assert.match(runner, /up -d --wait --force-recreate --no-deps auth app/u);
  assert.match(runner, /lock_dir=\$repo_root\/\.run-e2e\.lock/u);
  assert.match(runner, /if mkdir "\$lock_dir"/u);
  assert.match(
    runner,
    /launch_in_progress=1\s+"\$@" &\s+child_pid=\$!\s+launch_in_progress=0\s+if \[ "\$signal_pending" -eq 1 \]; then\s+signal_pending=0\s+deliver_signal/u,
  );
  assert.match(runner, /kill -s KILL/u);
  assert.match(runner, /KONDATE_E2E_SIGNAL_GRACE_SECONDS/u);
  assert.match(runner, /watchdog_pid/u);
  assert.match(runner, /trap '' HUP INT TERM ALRM[\s\S]*termination_status/u);
  assert.match(runner, /cleanup_on_exit[\s\S]*finish "\$final_status"/u);
  assert.match(
    runner,
    /stop_requested=1[\s\S]*sleep "\$signal_grace_seconds" &[\s\S]*timer_pid=\$![\s\S]*if \[ "\$stop_requested" -eq 1 \]/u,
  );
  assert.match(runner, /child_pid=\s+cancel_watchdog/u);
});

test("documents the Docker-only clean initialization and verification workflow", async () => {
  const [guide, packageJson, reset, refreshDesign, refreshPlan] = await Promise.all([
    readFile("docs/local-development.md", "utf8"),
    readFile("package.json", "utf8"),
    readFile("scripts/reset-local-db.sh", "utf8"),
    readFile("docs/superpowers/specs/2026-07-13-pg17-supabase-refresh-design.md", "utf8"),
    readFile("docs/superpowers/plans/2026-07-13-pg17-supabase-refresh.md", "utf8"),
  ]);

  assert.match(
    guide,
    /Node、npm、Git、Supabase CLI、Postgresクライアント、Playwrightはコンテナ内で実行/u,
  );
  assert.match(guide, /\.\/scripts\/generate-local-secrets\.sh --force/u);
  assert.match(guide, /stat -c %a \.env/u);
  assert.match(guide, /sh -eu -c/u);
  assert.match(guide, /if grep -q ['"]?\^COMPOSE_FILE=/u);
  assert.match(guide, /KONDATE_COMPOSE_PROJECT_NAME=kondate-\[0-9a-f\]\{32\}/u);
  assert.doesNotMatch(guide, /! grep -q ['"]?\^COMPOSE_FILE=/u);
  assert.match(guide, /docker compose pull --quiet --ignore-buildable/u);
  assert.match(guide, /docker compose build/u);
  assert.match(guide, /\.\/scripts\/refresh-supabase\.sh/u);
  assert.match(guide, /symbolic link経由の起動はサポートしません/u);
  assert.match(guide, /`COMPOSE_PROJECT_NAME`をdirect入口に設定しない/u);
  assert.match(guide, /supabase-db/u);
  assert.match(guide, /legacy\/foreign Compose project/u);
  assert.match(guide, /\.\/scripts\/reset-local-db\.sh/u);
  assert.match(packageJson, /"db:reset": "\.\/scripts\/reset-local-db\.sh"/u);
  assert.match(reset, /down --volumes --remove-orphans/u);
  assert.match(reset, /rm -rf \/workspace\/infra\/supabase\/volumes\/db\/data/u);
  assert.match(reset, /up -d --wait/u);
  assert.match(guide, /show server_version/u);
  assert.match(guide, /^docker compose ps --all$/mu);
  assert.match(guide, /docker compose run --rm db-test/u);
  assert.match(guide, /docker compose run --rm app npm run db:types/u);
  assert.match(
    guide,
    /\.\/scripts\/run-tooling-git\.sh diff --exit-code -- src\/shared\/types\/database\.generated\.ts/u,
  );
  assert.match(guide, /\.\/scripts\/run-e2e\.sh/u);
  assert.match(guide, /E2E終了後.*通常構成のAuthとappを復元/u);
  assert.match(guide, /E2Eの終了statusを保持/u);
  assert.match(guide, /同じcheckout.*並行実行.*拒否/u);
  assert.match(
    guide,
    /SIGKILL.*repository rootの`\.run-e2e\.lock`.*E2Eプロセスがないことを確認.*手動で削除/u,
  );
  assert.match(guide, /PG15データの移行とロールバックはサポートしません/u);
  assert.match(refreshDesign, /\.\/scripts\/refresh-supabase\.sh/u);
  assert.doesNotMatch(refreshDesign, /vendor-supabase --refresh/u);
  assert.match(
    refreshPlan,
    /このStepは実装履歴です。現行運用では直接実行せず、`\.\/scripts\/refresh-supabase\.sh` を使用/u,
  );
  assert.match(
    refreshPlan,
    /## Supabase公式Docker構成の更新[\s\S]*?\.\/scripts\/refresh-supabase\.sh/u,
  );

  assert.ok(extractLocalEnvValidationBody(guide));
});

test("documented local .env validation accepts a complete private file", async () => {
  const guide = await readFile("docs/local-development.md", "utf8");
  const status = await runLocalEnvValidation({
    body: extractLocalEnvValidationBody(guide),
    composeFile: false,
    mode: 0o600,
  });
  assert.equal(status, 0);
});

test("documented local .env validation rejects COMPOSE_FILE", async () => {
  const guide = await readFile("docs/local-development.md", "utf8");
  const status = await runLocalEnvValidation({
    body: extractLocalEnvValidationBody(guide),
    composeFile: true,
    mode: 0o600,
  });
  assert.notEqual(status, 0);
});

test("documented local .env validation rejects public permissions", async () => {
  const guide = await readFile("docs/local-development.md", "utf8");
  const status = await runLocalEnvValidation({
    body: extractLocalEnvValidationBody(guide),
    composeFile: false,
    mode: 0o644,
  });
  assert.notEqual(status, 0);
});
