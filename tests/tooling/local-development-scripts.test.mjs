import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const execFileAsync = promisify(execFile);
const typescriptPath = resolve("node_modules/typescript");
const hasTypescript = await access(typescriptPath).then(
  () => true,
  () => false,
);

async function createScriptFixture(
  scriptName,
  dependencies = [],
  fixturePrefix = `${scriptName}-`,
) {
  const root = await mkdtemp(join(tmpdir(), fixturePrefix));
  await mkdir(join(root, "scripts"));
  for (const fixtureScript of [scriptName, ...dependencies]) {
    await copyFile(join("scripts", fixtureScript), join(root, "scripts", fixtureScript));
    await chmod(join(root, "scripts", fixtureScript), 0o755);
  }
  if (scriptName === "generate-database-types.sh" && hasTypescript) {
    await mkdir(join(root, "node_modules"));
    await symlink(typescriptPath, join(root, "node_modules/typescript"));
  }
  return root;
}

async function installDockerRecorder(root) {
  const bin = join(root, "bin");
  await mkdir(bin);
  await writeFile(
    join(bin, "docker"),
    [
      "#!/bin/sh",
      "set -eu",
      "index=1",
      'while [ -e "$DOCKER_LOG_DIR/$index" ]; do index=$((index + 1)); done',
      'for argument do printf "%s\\0" "$argument"; done > "$DOCKER_LOG_DIR/$index"',
      'if [ "${DOCKER_WAIT_AT:-}" = "$index" ]; then',
      '  : > "$DOCKER_READY_FILE"',
      '  trap "exit 143" TERM',
      '  trap "exit 130" INT',
      "  while :; do sleep 1; done",
      "fi",
      'if [ "${DOCKER_FAIL_AT:-}" = "$index" ]; then exit "$DOCKER_FAIL_STATUS"; fi',
    ].join("\n"),
    { mode: 0o755 },
  );
  return bin;
}

async function readDockerInvocations(logDir) {
  const files = await readdir(logDir);
  files.sort((left, right) => Number(left) - Number(right));
  return Promise.all(
    files.map(async (file) => {
      const encoded = await readFile(join(logDir, file), "utf8");
      assert.equal(encoded.endsWith("\0"), true);
      return encoded.slice(0, -1).split("\0");
    }),
  );
}

function expectedRefreshInvocations(root) {
  return [
    [
      "compose",
      "--project-directory",
      root,
      "-f",
      join(root, "compose.yaml"),
      "down",
      "--remove-orphans",
    ],
    [
      "compose",
      "--project-directory",
      root,
      "-f",
      join(root, "compose.tooling.yaml"),
      "run",
      "--rm",
      "--user",
      "0:0",
      "vendor-supabase",
      "--refresh",
    ],
    [
      "compose",
      "--project-directory",
      root,
      "-f",
      join(root, "compose.yaml"),
      "down",
      "--volumes",
      "--remove-orphans",
    ],
    [
      "compose",
      "--project-directory",
      root,
      "-f",
      join(root, "compose.tooling.yaml"),
      "run",
      "--rm",
      "--user",
      "0:0",
      "--entrypoint",
      "sh",
      "vendor-supabase",
      "-c",
      "rm -rf /workspace/infra/supabase/volumes/db/data",
    ],
    [
      "compose",
      "--project-directory",
      root,
      "-f",
      join(root, "compose.yaml"),
      "up",
      "-d",
      "--wait",
    ],
  ];
}

async function runRefresh(root, bin, logDir, extraEnv = {}) {
  await mkdir(logDir);
  return execFileAsync(join(root, "scripts", "refresh-supabase.sh"), {
    cwd: tmpdir(),
    env: {
      ...process.env,
      ...extraEnv,
      DOCKER_LOG_DIR: logDir,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });
}

async function waitForFile(path) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (
      await access(path).then(
        () => true,
        () => false,
      )
    )
      return;
    await delay(10);
  }
  assert.fail(`timed out waiting for ${path}`);
}

async function startResponseServer(status, body) {
  const server = createServer((_request, response) => {
    response.writeHead(status, { "content-type": "text/plain" });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    server,
    url: `http://127.0.0.1:${address.port}/types`,
  };
}

async function runTypeGenerator(root, url, extraEnv = {}) {
  return execFileAsync(join(root, "scripts", "generate-database-types.sh"), {
    cwd: root,
    env: {
      ...process.env,
      ...extraEnv,
      PG_META_TYPES_URL: url,
    },
  });
}

test("E2E runner is POSIX-compatible and forwards arguments and exit status", async (t) => {
  const root = await createScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const log = join(root, "docker.log");
  await mkdir(bin);
  await writeFile(
    join(bin, "docker"),
    [
      "#!/bin/sh",
      'for argument do printf "%s|" "$argument"; done >> "$DOCKER_LOG"',
      'printf "\\n" >> "$DOCKER_LOG"',
      'case "$*" in *"run --rm --no-deps e2e"*) exit 23 ;; esac',
    ].join("\n"),
    { mode: 0o755 },
  );

  await assert.rejects(
    execFileAsync("sh", [join(root, "scripts", "run-e2e.sh"), "--grep", "space value"], {
      cwd: tmpdir(),
      env: { ...process.env, DOCKER_LOG: log, PATH: `${bin}:${process.env.PATH}` },
    }),
    (error) => error && typeof error === "object" && error.code === 23,
  );

  assert.deepEqual((await readFile(log, "utf8")).trim().split("\n"), [
    "compose|-f|compose.yaml|up|-d|--wait|",
    "compose|-f|compose.yaml|-f|compose.e2e.yaml|--profile|e2e|up|-d|--wait|auth|",
    "compose|-f|compose.yaml|-f|compose.e2e.yaml|--profile|e2e|up|-d|--wait|--force-recreate|--no-deps|kong|oauth-mock|app|",
    "compose|-f|compose.yaml|-f|compose.e2e.yaml|--profile|e2e|run|--rm|--no-deps|e2e|--grep|space value|",
  ]);
});

test("reset fixes Compose to its repository when invoked from another directory", async (t) => {
  const root = await createScriptFixture("reset-local-db.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const log = join(root, "docker.log");
  await mkdir(bin);
  await writeFile(
    join(bin, "docker"),
    '#!/bin/sh\nprintf "%s|%s\\n" "$PWD" "$*" >> "$DOCKER_LOG"\n',
  );
  await chmod(join(bin, "docker"), 0o755);

  await execFileAsync(join(root, "scripts", "reset-local-db.sh"), {
    cwd: tmpdir(),
    env: {
      ...process.env,
      DOCKER_LOG: log,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.deepEqual((await readFile(log, "utf8")).trim().split("\n"), [
    `${root}|compose --project-directory ${root} -f ${root}/compose.yaml down --volumes --remove-orphans`,
    `${root}|compose --project-directory ${root} -f ${root}/compose.tooling.yaml run --rm --user 0:0 --entrypoint sh vendor-supabase -c rm -rf /workspace/infra/supabase/volumes/db/data`,
    `${root}|compose --project-directory ${root} -f ${root}/compose.yaml up -d --wait`,
  ]);
});

test("refresh preserves every argument from a path containing spaces", async (t) => {
  const root = await createScriptFixture(
    "refresh-supabase.sh",
    ["reset-local-db.sh"],
    "refresh supabase-",
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "success log");

  await runRefresh(root, bin, logDir);

  assert.deepEqual(await readDockerInvocations(logDir), expectedRefreshInvocations(root));
});

test("refresh preserves every failure and converges when rerun", async (t) => {
  for (let failureStage = 1; failureStage <= 5; failureStage += 1) {
    await t.test(`stage ${failureStage}`, async (subtest) => {
      const root = await createScriptFixture(
        "refresh-supabase.sh",
        ["reset-local-db.sh"],
        "refresh supabase-",
      );
      subtest.after(() => rm(root, { recursive: true, force: true }));
      const bin = await installDockerRecorder(root);
      const expected = expectedRefreshInvocations(root);
      const failureStatus = 40 + failureStage;
      const failureLog = join(root, "failure log");

      await assert.rejects(
        runRefresh(root, bin, failureLog, {
          DOCKER_FAIL_AT: String(failureStage),
          DOCKER_FAIL_STATUS: String(failureStatus),
        }),
        (error) => error && typeof error === "object" && error.code === failureStatus,
      );
      assert.deepEqual(await readDockerInvocations(failureLog), expected.slice(0, failureStage));

      const retryLog = join(root, "retry log");
      await runRefresh(root, bin, retryLog);
      assert.deepEqual(await readDockerInvocations(retryLog), expected);
    });
  }
});

test("refresh terminates during vendor wait without starting reset", async (t) => {
  const root = await createScriptFixture(
    "refresh-supabase.sh",
    ["reset-local-db.sh"],
    "refresh supabase-",
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "term log");
  const readyFile = join(root, "vendor ready");
  await mkdir(logDir);
  const child = spawn(join(root, "scripts", "refresh-supabase.sh"), {
    cwd: tmpdir(),
    detached: true,
    env: {
      ...process.env,
      DOCKER_LOG_DIR: logDir,
      DOCKER_READY_FILE: readyFile,
      DOCKER_WAIT_AT: "2",
      PATH: `${bin}:${process.env.PATH}`,
    },
    stdio: "ignore",
  });
  const completion = new Promise((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  t.after(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ESRCH") throw error;
    }
  });

  await waitForFile(readyFile);
  process.kill(-child.pid, "SIGTERM");
  const result = await completion;

  assert.deepEqual(result, { code: null, signal: "SIGTERM" });
  assert.deepEqual(
    await readDockerInvocations(logDir),
    expectedRefreshInvocations(root).slice(0, 2),
  );
});

test("type generation validates output and atomically renames from the destination directory", async (t) => {
  if (!hasTypescript) return t.skip("TypeScriptを含むappコンテナで検証する");
  const root = await createScriptFixture("generate-database-types.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const destinationDir = join(root, "src", "shared", "types");
  const destination = join(destinationDir, "database.generated.ts");
  const bin = join(root, "bin");
  const moveLog = join(root, "move.log");
  await mkdir(destinationDir, { recursive: true });
  await mkdir(bin);
  await writeFile(destination, "existing types\n");
  await writeFile(
    join(bin, "mv"),
    '#!/bin/sh\nprintf "%s|%s\\n" "$1" "$2" > "$MV_LOG"\n/bin/mv "$@"\n',
  );
  await chmod(join(bin, "mv"), 0o755);
  const types = "export type Json = string;\nexport type Database = {};\n";
  const { server, url } = await startResponseServer(200, types);
  t.after(() => server.close());

  await runTypeGenerator(root, url, {
    MV_LOG: moveLog,
    PATH: `${bin}:${process.env.PATH}`,
  });

  assert.equal(await readFile(destination, "utf8"), types);
  assert.equal((await stat(destination)).mode & 0o777, 0o644);
  const [source, target] = (await readFile(moveLog, "utf8")).trim().split("|");
  assert.equal(resolve(root, dirname(source)), destinationDir);
  assert.equal(resolve(root, target), destination);
});

test("type generation preserves the existing file on every invalid response", async (t) => {
  if (!hasTypescript) return t.skip("TypeScriptを含むappコンテナで検証する");
  const cases = [
    { name: "non-2xx", status: 500, body: "server error" },
    { name: "empty 200", status: 200, body: "" },
    { name: "HTML 200", status: 200, body: "<html>error</html>" },
    { name: "JSON 200", status: 200, body: '{"error":"bad"}' },
    {
      name: "HTML containing contract tokens 200",
      status: 200,
      body: "<html>export type Json = string; export type Database = {};</html>",
    },
    {
      name: "JSON containing contract tokens 200",
      status: 200,
      body: '{"message":"export type Json = string; export type Database = {};"}',
    },
    { name: "incomplete TypeScript 200", status: 200, body: "export type Json = string;\n" },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async (subtest) => {
      const root = await createScriptFixture("generate-database-types.sh");
      subtest.after(() => rm(root, { recursive: true, force: true }));
      const destinationDir = join(root, "src", "shared", "types");
      const destination = join(destinationDir, "database.generated.ts");
      await mkdir(destinationDir, { recursive: true });
      await writeFile(destination, "existing types\n");
      await chmod(destination, 0o640);
      const { server, url } = await startResponseServer(fixture.status, fixture.body);
      subtest.after(() => server.close());

      await assert.rejects(runTypeGenerator(root, url));
      assert.equal(await readFile(destination, "utf8"), "existing types\n");
      assert.equal((await stat(destination)).mode & 0o777, 0o640);
    });
  }

  await t.test("network failure", async (subtest) => {
    const root = await createScriptFixture("generate-database-types.sh");
    subtest.after(() => rm(root, { recursive: true, force: true }));
    const destinationDir = join(root, "src", "shared", "types");
    const destination = join(destinationDir, "database.generated.ts");
    await mkdir(destinationDir, { recursive: true });
    await writeFile(destination, "existing types\n");
    await chmod(destination, 0o640);
    const { server, url } = await startResponseServer(200, "unused");
    await new Promise((resolve) => server.close(resolve));

    await assert.rejects(runTypeGenerator(root, url));
    assert.equal(await readFile(destination, "utf8"), "existing types\n");
    assert.equal((await stat(destination)).mode & 0o777, 0o640);
  });
});
