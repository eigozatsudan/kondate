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

async function createDatabaseScriptFixture(scriptName, dependencies = []) {
  const root = await createScriptFixture(
    scriptName,
    ["compose-project-name.sh", "ensure-compose-project-env.sh", ...dependencies],
    "database scripts-",
  );
  await writeFile(join(root, ".env"), "EXISTING_VALUE=keep\n", { mode: 0o600 });
  return root;
}

async function installDockerRecorder(root) {
  const bin = join(root, "bin");
  await mkdir(bin);
  await writeFile(
    join(bin, "docker-signal-waiter.mjs"),
    [
      'import { writeFileSync } from "node:fs";',
      'const ignore = process.env.DOCKER_IGNORE_SIGNAL === "1";',
      'process.on("SIGHUP", () => { if (!ignore) process.exit(129); });',
      'process.on("SIGINT", () => { if (!ignore) process.exit(130); });',
      'process.on("SIGTERM", () => { if (!ignore) process.exit(143); });',
      "if (process.env.DOCKER_READY_FILE) writeFileSync(process.env.DOCKER_READY_FILE, `${process.pid}\\n`);",
      "if (process.env.DOCKER_SIGNAL_PARENT_ON_START) {",
      "  process.kill(process.ppid, process.env.DOCKER_SIGNAL_PARENT_ON_START);",
      "}",
      "setInterval(() => {}, 1_000);",
    ].join("\n"),
  );
  await writeFile(
    join(bin, "docker"),
    [
      "#!/bin/sh",
      "set -eu",
      "index=1",
      'while [ -e "$DOCKER_LOG_DIR/$index" ]; do index=$((index + 1)); done',
      'for argument do printf "%s\\0" "$argument"; done > "$DOCKER_LOG_DIR/$index"',
      'if [ "${DOCKER_WAIT_AT:-}" = "$index" ]; then',
      '  printf "%s\\n" "$$" > "$DOCKER_READY_FILE"',
      '  trap \'trap "" TERM; sleep "${DOCKER_TERM_DELAY:-0}"; exit 143\' TERM',
      '  trap "exit 130" INT',
      "  while :; do sleep 1; done",
      "fi",
      'if [ "${DOCKER_FAIL_AT:-}" = "$index" ]; then exit "$DOCKER_FAIL_STATUS"; fi',
      'case "$*" in',
      '  *"run --rm --no-deps e2e"*)',
      '    if [ "${E2E_WAIT_FOR_SIGNAL:-}" = "1" ]; then',
      '      exec node "$(dirname "$0")/docker-signal-waiter.mjs"',
      "    fi",
      '    exit "${E2E_STATUS:-0}"',
      "    ;;",
      '  *"up -d --wait --force-recreate --no-deps auth app"*)',
      '    if [ "${E2E_CLEANUP_WAIT_FOR_SIGNAL:-}" = "1" ]; then',
      '      exec node "$(dirname "$0")/docker-signal-waiter.mjs"',
      "    fi",
      '    exit "${E2E_CLEANUP_STATUS:-0}"',
      "    ;;",
      "esac",
      'if [ "$*" = "container ls --all --quiet --filter name=^/supabase-db$" ]; then',
      '  if [ "${DOCKER_QUERY_ERROR:-}" = "1" ]; then exit 57; fi',
      '  if [ "${DOCKER_FOREIGN_CONTAINER:-}" = "1" ]; then printf "%s\\n" "foreign-container-id"; fi',
      "  exit 0",
      "fi",
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

function expectedRefreshInvocations(root, projectName) {
  return [
    [
      "compose",
      "--project-directory",
      root,
      "--project-name",
      projectName,
      "-f",
      join(root, "compose.yaml"),
      "down",
      "--remove-orphans",
    ],
    [
      "compose",
      "--project-directory",
      root,
      "--project-name",
      projectName,
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
      "--project-name",
      projectName,
      "-f",
      join(root, "compose.yaml"),
      "down",
      "--volumes",
      "--remove-orphans",
    ],
    ["container", "ls", "--all", "--quiet", "--filter", "name=^/supabase-db$"],
    [
      "compose",
      "--project-directory",
      root,
      "--project-name",
      projectName,
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
      'if [ -e /workspace/infra/supabase/volumes/db/data/postmaster.pid ]; then echo "PGDATA is still active; stop the owning database before retrying" >&2; exit 1; fi; rm -rf /workspace/infra/supabase/volumes/db/data',
    ],
    [
      "compose",
      "--project-directory",
      root,
      "--project-name",
      projectName,
      "-f",
      join(root, "compose.yaml"),
      "up",
      "-d",
      "--wait",
    ],
  ];
}

function expectedResetInvocations(root, projectName) {
  return expectedRefreshInvocations(root, projectName).slice(2);
}

function expectedE2EInvocations(root, projectName, arguments_ = []) {
  const compose = ["compose", "--project-directory", root, "--project-name", projectName];
  return [
    [...compose, "-f", join(root, "compose.yaml"), "up", "-d", "--wait"],
    [
      ...compose,
      "-f",
      join(root, "compose.yaml"),
      "-f",
      join(root, "compose.e2e.yaml"),
      "--profile",
      "e2e",
      "up",
      "-d",
      "--wait",
      "auth",
    ],
    [
      ...compose,
      "-f",
      join(root, "compose.yaml"),
      "-f",
      join(root, "compose.e2e.yaml"),
      "--profile",
      "e2e",
      "up",
      "-d",
      "--wait",
      "--force-recreate",
      "--no-deps",
      "kong",
      "oauth-mock",
      "app",
    ],
    [
      ...compose,
      "-f",
      join(root, "compose.yaml"),
      "-f",
      join(root, "compose.e2e.yaml"),
      "--profile",
      "e2e",
      "run",
      "--rm",
      "--no-deps",
      "e2e",
      ...arguments_,
    ],
    [
      ...compose,
      "-f",
      join(root, "compose.yaml"),
      "up",
      "-d",
      "--wait",
      "--force-recreate",
      "--no-deps",
      "auth",
      "app",
    ],
  ];
}

async function expectedProjectName(root) {
  const child = spawn("cksum", { stdio: ["pipe", "pipe", "ignore"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stdin.end(root);
  const status = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", resolveExit);
  });
  assert.equal(status, 0);
  const [crc, bytes] = output.trim().split(/\s+/u);
  assert.match(crc, /^\d+$/u);
  assert.match(bytes, /^\d+$/u);
  return `kondate-${crc}-${bytes}`;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") return false;
    throw error;
  }
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

async function runE2E(root, bin, logDir, arguments_ = [], extraEnv = {}) {
  await mkdir(logDir);
  return execFileAsync(join(root, "scripts", "run-e2e.sh"), arguments_, {
    cwd: tmpdir(),
    timeout: 3_000,
    env: {
      ...process.env,
      ...extraEnv,
      COMPOSE_PROJECT_NAME: "shared",
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

async function waitForCompletion(completion, timeout = 2_000) {
  return new Promise((resolveCompletion, rejectCompletion) => {
    const timeoutId = setTimeout(
      () => rejectCompletion(new Error("timed out waiting for child completion")),
      timeout,
    );
    completion.then(
      (result) => {
        clearTimeout(timeoutId);
        resolveCompletion(result);
      },
      (error) => {
        clearTimeout(timeoutId);
        rejectCompletion(error);
      },
    );
  });
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

test("E2E runner restores the base stack and preserves success or failure", async (t) => {
  for (const fixture of [
    { name: "success", e2eStatus: 0 },
    { name: "failure", e2eStatus: 23 },
  ]) {
    await t.test(fixture.name, async (subtest) => {
      const root = await createDatabaseScriptFixture("run-e2e.sh");
      subtest.after(() => rm(root, { recursive: true, force: true }));
      const bin = await installDockerRecorder(root);
      const logDir = join(root, `${fixture.name} log`);
      const run = runE2E(root, bin, logDir, ["--grep", "space value"], {
        E2E_STATUS: String(fixture.e2eStatus),
      });

      if (fixture.e2eStatus === 0) await run;
      else
        await assert.rejects(
          run,
          (error) => error && typeof error === "object" && error.code === fixture.e2eStatus,
        );

      assert.deepEqual(
        await readDockerInvocations(logDir),
        expectedE2EInvocations(root, await expectedProjectName(root), ["--grep", "space value"]),
      );
    });
  }
});

test("E2E runner restores the base stack after every forwarded signal", async (t) => {
  for (const fixture of [
    { signal: "SIGHUP", status: 129 },
    { signal: "SIGINT", status: 130 },
    { signal: "SIGTERM", status: 143 },
  ]) {
    await t.test(fixture.signal, async (subtest) => {
      const root = await createDatabaseScriptFixture("run-e2e.sh");
      subtest.after(() => rm(root, { recursive: true, force: true }));
      const bin = await installDockerRecorder(root);
      const logDir = join(root, `${fixture.signal} log`);
      const readyFile = join(root, `${fixture.signal} ready`);
      await mkdir(logDir);
      const child = spawn(join(root, "scripts", "run-e2e.sh"), {
        cwd: tmpdir(),
        env: {
          ...process.env,
          COMPOSE_PROJECT_NAME: "shared",
          DOCKER_LOG_DIR: logDir,
          DOCKER_READY_FILE: readyFile,
          E2E_WAIT_FOR_SIGNAL: "1",
          PATH: `${bin}:${process.env.PATH}`,
        },
        stdio: "ignore",
      });
      const completion = new Promise((resolveClose, rejectClose) => {
        child.once("error", rejectClose);
        child.once("close", (code, signal) => resolveClose({ code, signal }));
      });
      let fakeDockerPid;
      subtest.after(() => {
        if (isProcessAlive(child.pid)) process.kill(child.pid, "SIGKILL");
        if (fakeDockerPid && isProcessAlive(fakeDockerPid)) process.kill(fakeDockerPid, "SIGKILL");
      });

      await waitForFile(readyFile);
      fakeDockerPid = Number((await readFile(readyFile, "utf8")).trim());
      process.kill(child.pid, fixture.signal);

      assert.deepEqual(await waitForCompletion(completion), {
        code: fixture.status,
        signal: null,
      });
      assert.equal(isProcessAlive(fakeDockerPid), false);
      assert.deepEqual(
        await readDockerInvocations(logDir),
        expectedE2EInvocations(root, await expectedProjectName(root)),
      );
    });
  }
});

test("E2E runner force-kills a child that ignores two forwarded signals", async (t) => {
  for (const fixture of [
    { signal: "SIGHUP", status: 129 },
    { signal: "SIGINT", status: 130 },
    { signal: "SIGTERM", status: 143 },
  ]) {
    await t.test(fixture.signal, async (subtest) => {
      const root = await createDatabaseScriptFixture("run-e2e.sh");
      subtest.after(() => rm(root, { recursive: true, force: true }));
      const bin = await installDockerRecorder(root);
      const logDir = join(root, `${fixture.signal} ignored log`);
      const readyFile = join(root, `${fixture.signal} ignored ready`);
      await mkdir(logDir);
      const child = spawn(join(root, "scripts", "run-e2e.sh"), {
        cwd: tmpdir(),
        env: {
          ...process.env,
          DOCKER_IGNORE_SIGNAL: "1",
          DOCKER_LOG_DIR: logDir,
          DOCKER_READY_FILE: readyFile,
          E2E_WAIT_FOR_SIGNAL: "1",
          PATH: `${bin}:${process.env.PATH}`,
        },
        stdio: "ignore",
      });
      const completion = new Promise((resolveClose, rejectClose) => {
        child.once("error", rejectClose);
        child.once("close", (code, signal) => resolveClose({ code, signal }));
      });
      let fakeDockerPid;
      subtest.after(() => {
        if (isProcessAlive(child.pid)) process.kill(child.pid, "SIGKILL");
        if (fakeDockerPid && isProcessAlive(fakeDockerPid)) process.kill(fakeDockerPid, "SIGKILL");
      });

      await waitForFile(readyFile);
      fakeDockerPid = Number((await readFile(readyFile, "utf8")).trim());
      process.kill(child.pid, fixture.signal);
      await delay(20);
      assert.equal(isProcessAlive(fakeDockerPid), true);
      process.kill(child.pid, fixture.signal);

      assert.deepEqual(await waitForCompletion(completion), {
        code: fixture.status,
        signal: null,
      });
      assert.equal(isProcessAlive(fakeDockerPid), false);
      assert.deepEqual(
        await readDockerInvocations(logDir),
        expectedE2EInvocations(root, await expectedProjectName(root)),
      );
    });
  }
});

test("E2E runner reaps a child that signals during launch", async (t) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await t.test(`attempt ${attempt + 1}`, async (subtest) => {
      const root = await createDatabaseScriptFixture("run-e2e.sh");
      subtest.after(() => rm(root, { recursive: true, force: true }));
      const bin = await installDockerRecorder(root);
      const logDir = join(root, `launch race ${attempt + 1}`);
      const readyFile = join(root, `launch race ready ${attempt + 1}`);

      await assert.rejects(
        runE2E(root, bin, logDir, [], {
          DOCKER_READY_FILE: readyFile,
          DOCKER_SIGNAL_PARENT_ON_START: "SIGTERM",
          E2E_WAIT_FOR_SIGNAL: "1",
        }),
        (error) => error && typeof error === "object" && error.code === 143,
      );

      const fakeDockerPid = Number((await readFile(readyFile, "utf8")).trim());
      assert.equal(isProcessAlive(fakeDockerPid), false);
      assert.deepEqual(
        await readDockerInvocations(logDir),
        expectedE2EInvocations(root, await expectedProjectName(root)),
      );
    });
  }
});

test("E2E runner bounds repeated signals while restoring the base stack", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "cleanup signal log");
  const readyFile = join(root, "cleanup signal ready");
  await mkdir(logDir);
  const child = spawn(join(root, "scripts", "run-e2e.sh"), {
    cwd: tmpdir(),
    env: {
      ...process.env,
      DOCKER_IGNORE_SIGNAL: "1",
      DOCKER_LOG_DIR: logDir,
      DOCKER_READY_FILE: readyFile,
      E2E_CLEANUP_WAIT_FOR_SIGNAL: "1",
      PATH: `${bin}:${process.env.PATH}`,
    },
    stdio: "ignore",
  });
  const completion = new Promise((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  let fakeDockerPid;
  t.after(() => {
    if (isProcessAlive(child.pid)) process.kill(child.pid, "SIGKILL");
    if (fakeDockerPid && isProcessAlive(fakeDockerPid)) process.kill(fakeDockerPid, "SIGKILL");
  });

  await waitForFile(readyFile);
  fakeDockerPid = Number((await readFile(readyFile, "utf8")).trim());
  process.kill(child.pid, "SIGTERM");
  await delay(20);
  if (isProcessAlive(child.pid)) process.kill(child.pid, "SIGTERM");

  assert.deepEqual(await waitForCompletion(completion), { code: 143, signal: null });
  assert.equal(isProcessAlive(fakeDockerPid), false);
  assert.deepEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root)),
  );
});

test("E2E runner preserves every early failure when cleanup also fails", async (t) => {
  for (let failureStage = 1; failureStage <= 4; failureStage += 1) {
    await t.test(`stage ${failureStage}`, async (subtest) => {
      const root = await createDatabaseScriptFixture("run-e2e.sh");
      subtest.after(() => rm(root, { recursive: true, force: true }));
      const bin = await installDockerRecorder(root);
      const logDir = join(root, `early failure ${failureStage}`);
      const failureStatus = 50 + failureStage;

      await assert.rejects(
        runE2E(root, bin, logDir, [], {
          DOCKER_FAIL_AT: String(failureStage),
          DOCKER_FAIL_STATUS: String(failureStatus),
          E2E_CLEANUP_STATUS: "77",
        }),
        (error) => error && typeof error === "object" && error.code === failureStatus,
      );

      const expected = expectedE2EInvocations(root, await expectedProjectName(root));
      assert.deepEqual(await readDockerInvocations(logDir), [
        ...expected.slice(0, failureStage),
        expected.at(-1),
      ]);
    });
  }
});

test("E2E runner returns cleanup failure only after a successful run", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "cleanup failure log");

  await assert.rejects(
    runE2E(root, bin, logDir, [], { E2E_CLEANUP_STATUS: "47" }),
    (error) => error && typeof error === "object" && error.code === 47,
  );

  assert.deepEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root)),
  );
});

test("E2E runner rejects another checkout identity before starting Docker", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, ".env"), "KONDATE_COMPOSE_PROJECT_NAME=kondate-1-1\n", {
    mode: 0o600,
  });
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "identity mismatch log");

  await assert.rejects(runE2E(root, bin, logDir));

  assert.deepEqual(await readdir(logDir), []);
});

test("reset fixes Compose to its repository when invoked from another directory", async (t) => {
  const root = await createDatabaseScriptFixture("reset-local-db.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "reset log");
  await mkdir(logDir);

  await execFileAsync(join(root, "scripts", "reset-local-db.sh"), {
    cwd: tmpdir(),
    env: {
      ...process.env,
      COMPOSE_PROJECT_NAME: "shared",
      DOCKER_LOG_DIR: logDir,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  const projectName = await expectedProjectName(root);
  assert.deepEqual(
    await readDockerInvocations(logDir),
    expectedResetInvocations(root, projectName),
  );
  assert.match(
    await readFile(join(root, ".env"), "utf8"),
    new RegExp(`^KONDATE_COMPOSE_PROJECT_NAME=${projectName}$`, "mu"),
  );
  assert.equal((await stat(join(root, ".env"))).mode & 0o777, 0o600);
  assert.match(
    await readFile(join(root, "scripts", "reset-local-db.sh"), "utf8"),
    /postmaster\.pid[\s\S]*exit 1[\s\S]*rm -rf \/workspace\/infra\/supabase\/volumes\/db\/data/u,
  );
});

test("refresh preserves every argument from a path containing spaces", async (t) => {
  const root = await createDatabaseScriptFixture("refresh-supabase.sh", ["reset-local-db.sh"]);
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "success log");

  await runRefresh(root, bin, logDir, { COMPOSE_PROJECT_NAME: "shared" });

  assert.deepEqual(
    await readDockerInvocations(logDir),
    expectedRefreshInvocations(root, await expectedProjectName(root)),
  );
});

test("refresh preserves every failure and converges when rerun", async (t) => {
  for (let failureStage = 1; failureStage <= 6; failureStage += 1) {
    await t.test(`stage ${failureStage}`, async (subtest) => {
      const root = await createDatabaseScriptFixture("refresh-supabase.sh", ["reset-local-db.sh"]);
      subtest.after(() => rm(root, { recursive: true, force: true }));
      const bin = await installDockerRecorder(root);
      const expected = expectedRefreshInvocations(root, await expectedProjectName(root));
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
  const root = await createDatabaseScriptFixture("refresh-supabase.sh", ["reset-local-db.sh"]);
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "term log");
  const readyFile = join(root, "vendor ready");
  await mkdir(logDir);
  const child = spawn(join(root, "scripts", "refresh-supabase.sh"), {
    cwd: tmpdir(),
    env: {
      ...process.env,
      DOCKER_LOG_DIR: logDir,
      DOCKER_READY_FILE: readyFile,
      DOCKER_TERM_DELAY: "0.2",
      DOCKER_WAIT_AT: "2",
      PATH: `${bin}:${process.env.PATH}`,
    },
    stdio: "ignore",
  });
  const completion = new Promise((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  let fakeDockerPid;
  t.after(() => {
    if (isProcessAlive(child.pid)) process.kill(child.pid, "SIGKILL");
    if (fakeDockerPid && isProcessAlive(fakeDockerPid)) process.kill(fakeDockerPid, "SIGKILL");
  });

  await waitForFile(readyFile);
  fakeDockerPid = Number((await readFile(readyFile, "utf8")).trim());
  assert.equal(Number.isSafeInteger(fakeDockerPid), true);
  process.kill(child.pid, "SIGTERM");
  await delay(20);
  process.kill(child.pid, "SIGTERM");
  const result = await completion;

  assert.deepEqual(result, { code: 143, signal: null });
  assert.equal(isProcessAlive(fakeDockerPid), false);
  assert.deepEqual(
    await readDockerInvocations(logDir),
    expectedRefreshInvocations(root, await expectedProjectName(root)).slice(0, 2),
  );
});

test("refresh rejects a foreign fixed-name database before deleting PGDATA", async (t) => {
  const root = await createDatabaseScriptFixture("refresh-supabase.sh", ["reset-local-db.sh"]);
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "foreign log");
  const projectName = await expectedProjectName(root);

  await assert.rejects(
    runRefresh(root, bin, logDir, {
      COMPOSE_PROJECT_NAME: "kondate",
      DOCKER_FOREIGN_CONTAINER: "1",
    }),
    (error) =>
      error && typeof error === "object" && error.code === 1 && /supabase-db/u.test(error.stderr),
  );

  assert.deepEqual(
    await readDockerInvocations(logDir),
    expectedRefreshInvocations(root, projectName).slice(0, 4),
  );
});

test("refresh fails closed when the Docker container query fails", async (t) => {
  const root = await createDatabaseScriptFixture("refresh-supabase.sh", ["reset-local-db.sh"]);
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "query error log");
  const temporaryDir = join(root, "temporary");
  await mkdir(temporaryDir);
  const projectName = await expectedProjectName(root);

  await assert.rejects(
    runRefresh(root, bin, logDir, {
      DOCKER_QUERY_ERROR: "1",
      TMPDIR: temporaryDir,
    }),
    (error) => error && typeof error === "object" && error.code === 57,
  );

  assert.deepEqual(
    await readDockerInvocations(logDir),
    expectedRefreshInvocations(root, projectName).slice(0, 4),
  );
  assert.deepEqual(await readdir(temporaryDir), []);
});

test("refresh rejects a copied checkout identity before destructive commands", async (t) => {
  const root = await createDatabaseScriptFixture("refresh-supabase.sh", ["reset-local-db.sh"]);
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, ".env"),
    "EXISTING_VALUE=keep\nKONDATE_COMPOSE_PROJECT_NAME=kondate-1-1\n",
    { mode: 0o600 },
  );
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "mismatch log");

  await assert.rejects(runRefresh(root, bin, logDir));

  assert.deepEqual(await readdir(logDir), []);
  assert.equal(
    await readFile(join(root, ".env"), "utf8"),
    "EXISTING_VALUE=keep\nKONDATE_COMPOSE_PROJECT_NAME=kondate-1-1\n",
  );
  assert.equal((await stat(join(root, ".env"))).mode & 0o777, 0o600);
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
