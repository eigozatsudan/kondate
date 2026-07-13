import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

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

  const upstreamImage = upstream.match(/^\s{4}image: (supabase\/postgres:[^\s]+)$/mu)?.[1];
  const migrateBlock = compose.match(/^ {2}migrate:\n([\s\S]*?)(?=^ {2}[\w-]+:|^volumes:)/mu)?.[1];
  const migrateImage = migrateBlock?.match(/^\s{4}image: (supabase\/postgres:[^\s]+)$/mu)?.[1];
  const testImage = dbTest.match(/^FROM (supabase\/postgres:[^\s]+)$/mu)?.[1];

  assert.ok(upstreamImage, "official db image is missing");
  assert.equal(migrateImage, upstreamImage);
  assert.equal(testImage, upstreamImage);
  assert.match(upstreamImage, /^supabase\/postgres:17\./u);
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

test("uses the internal database address for containerized type generation", async () => {
  const [compose, generator] = await Promise.all([
    readFile("compose.yaml", "utf8"),
    readFile("scripts/generate-database-types.sh", "utf8"),
  ]);
  const app = compose.match(/^ {2}app:\n([\s\S]*?)(?=^ {2}[\w-]+:|^volumes:)/mu)?.[1];
  assert.ok(app, "app service is missing");
  assert.match(
    app,
    /LOCAL_DB_URL: postgresql:\/\/postgres:\$\{POSTGRES_PASSWORD\}@db:5432\/postgres/u,
  );
  assert.match(generator, /http:\/\/meta:8080\/generators\/typescript/u);
  assert.match(generator, /included_schemas=public,private/u);
  assert.doesNotMatch(generator, /supabase gen types/u);
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
  assert.doesNotMatch(openrouter, /\.:\/workspace/u);
  assert.doesNotMatch(openrouter, /working_dir:/u);
  assert.match(oauth, /tools\/oauth-mock\/server\.mjs:\/app\/server\.mjs:ro/u);
  assert.match(oauth, /tools\/oauth-mock\/fixtures:\/app\/fixtures:ro/u);
  assert.doesNotMatch(oauth, /\.:\/workspace/u);
  assert.doesNotMatch(oauth, /working_dir:/u);
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
  assert.match(
    runner,
    /exec docker compose -f compose\.yaml -f compose\.e2e\.yaml --profile e2e run --rm e2e "\$@"/u,
  );
});

test("documents the Docker-only clean initialization and verification workflow", async () => {
  const [guide, packageJson, reset] = await Promise.all([
    readFile("docs/local-development.md", "utf8"),
    readFile("package.json", "utf8"),
    readFile("scripts/reset-local-db.sh", "utf8"),
  ]);

  assert.match(
    guide,
    /Node、npm、Git、Supabase CLI、Postgresクライアント、Playwrightはコンテナ内で実行/u,
  );
  assert.match(guide, /local-secrets --force/u);
  assert.match(guide, /stat -c %a \.env/u);
  assert.match(guide, /docker compose pull --quiet --ignore-buildable/u);
  assert.match(guide, /docker compose build/u);
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
  assert.match(guide, /PG15データの移行とロールバックはサポートしません/u);
});
