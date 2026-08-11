import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
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
    [
      "compose-project-name.sh",
      "ensure-compose-project-env.sh",
      ...(scriptName === "run-e2e.sh" ? ["reset-e2e-ai-quota.sh"] : []),
      ...dependencies,
    ],
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
      'import { mkdirSync, writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'const ignore = process.env.DOCKER_IGNORE_SIGNAL === "1";',
      'process.on("SIGHUP", () => { if (!ignore) process.exit(129); });',
      'process.on("SIGINT", () => { if (!ignore) process.exit(130); });',
      'process.on("SIGTERM", () => { if (!ignore) process.exit(143); });',
      // dual body 待機: 各 waiter が自分の pid ファイルをディレクトリへ書く
      "if (process.env.E2E_BODY_READY_DIR) {",
      "  mkdirSync(process.env.E2E_BODY_READY_DIR, { recursive: true });",
      "  writeFileSync(join(process.env.E2E_BODY_READY_DIR, String(process.pid)), `${process.pid}\\n`);",
      "}",
      "if (process.env.DOCKER_READY_FILE) writeFileSync(process.env.DOCKER_READY_FILE, `${process.pid}\\n`);",
      "if (process.env.DOCKER_SIGNAL_PARENT_ON_START) {",
      "  process.kill(process.ppid, process.env.DOCKER_SIGNAL_PARENT_ON_START);",
      "}",
      "setInterval(() => {}, 1_000);",
    ].join("\n"),
  );
  await writeFile(
    join(bin, "docker-daemon-child.mjs"),
    [
      'import { writeFileSync } from "node:fs";',
      "writeFileSync(process.env.DOCKER_DAEMON_CHILD_FILE, `${process.pid}\\n`);",
      'process.on("SIGTERM", () => {});',
      "setInterval(() => {}, 1_000);",
    ].join("\n"),
  );
  await writeFile(
    join(bin, "docker-e2e-cli.mjs"),
    [
      'import { spawn } from "node:child_process";',
      'import { writeFileSync } from "node:fs";',
      "const child = spawn(process.execPath, [`${import.meta.dirname}/docker-daemon-child.mjs`], {",
      "  env: process.env,",
      '  stdio: "ignore",',
      "});",
      "child.unref();",
      "writeFileSync(process.env.DOCKER_READY_FILE, `${process.pid}\\n`);",
      'process.on("SIGHUP", () => {});',
      'process.on("SIGINT", () => {});',
      'process.on("SIGTERM", () => {});',
      "setInterval(() => {}, 1_000);",
    ].join("\n"),
  );
  await writeFile(
    join(bin, "docker"),
    [
      "#!/bin/sh",
      "set -eu",
      "index=1",
      // mobile||desktop 並列で index 競合を mkdir で防ぐ
      "# allocate log index atomically (parallel mobile/desktop docker)",
      'while ! mkdir "$DOCKER_LOG_DIR/$index.lock" 2>/dev/null; do index=$((index + 1)); done',
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
      '    if [ -n "${DOCKER_DAEMON_CHILD_FILE:-}" ]; then',
      '      exec node "$(dirname "$0")/docker-e2e-cli.mjs"',
      "    fi",
      // E2E_WAIT_SKIP_FIRST=1: 先頭 e2e（setup）は即成功、2 本目以降だけ signal 待機
      // （案 B dual body の signal 配送テスト用）
      '    if [ "${E2E_WAIT_FOR_SIGNAL:-}" = "1" ]; then',
      '      if [ "${E2E_WAIT_SKIP_FIRST:-}" = "1" ] && [ ! -f "$DOCKER_LOG_DIR/.e2e-wait-skip-first" ]; then',
      '        : > "$DOCKER_LOG_DIR/.e2e-wait-skip-first"',
      "      else",
      '        exec node "$(dirname "$0")/docker-signal-waiter.mjs"',
      "      fi",
      "    fi",
      '    if [ -n "${E2E_SUCCESS_READY_FILE:-}" ]; then',
      '      printf "%s\\n" "$$" > "$E2E_SUCCESS_READY_FILE"',
      "    fi",
      '    if [ -n "${E2E_SUCCESS_DELAY:-}" ]; then',
      '      sleep "$E2E_SUCCESS_DELAY"',
      "    fi",
      // project 別 exit（mobile 優先集約の回帰用。未設定時は E2E_STATUS）
      "    e2e_project=",
      "    for e2e_arg do",
      '      case "$e2e_arg" in',
      "        --project=*) e2e_project=${e2e_arg#--project=} ;;",
      "      esac",
      "    done",
      '    case "$e2e_project" in',
      '      mobile-chromium) exit "${E2E_STATUS_MOBILE:-${E2E_STATUS:-0}}" ;;',
      '      desktop-chromium) exit "${E2E_STATUS_DESKTOP:-${E2E_STATUS:-0}}" ;;',
      '      setup) exit "${E2E_STATUS_SETUP:-${E2E_STATUS:-0}}" ;;',
      '      *) exit "${E2E_STATUS:-0}" ;;',
      "    esac",
      "    ;;",
      '  *"kill --signal SIGKILL e2e"*)',
      '    if [ "${E2E_KILL_STATUS:-0}" -ne 0 ]; then exit "$E2E_KILL_STATUS"; fi',
      '    if [ -n "${DOCKER_DAEMON_CHILD_FILE:-}" ] && [ -f "$DOCKER_DAEMON_CHILD_FILE" ]; then',
      '      kill -s KILL "$(cat "$DOCKER_DAEMON_CHILD_FILE")"',
      "    fi",
      "    exit 0",
      "    ;;",
      '  *"rm --force e2e"*)',
      '    if [ -n "${E2E_RM_READY_FILE:-}" ]; then',
      '      printf "%s\\n" "$$" > "$E2E_RM_READY_FILE"',
      "    fi",
      '    if [ -n "${E2E_RM_SIGNAL_PARENT:-}" ]; then',
      '      kill -s "$E2E_RM_SIGNAL_PARENT" "$PPID"',
      "    fi",
      '    if [ -n "${E2E_RM_SUCCESS_DELAY:-}" ]; then',
      '      sleep "$E2E_RM_SUCCESS_DELAY"',
      "    fi",
      '    if [ -n "${E2E_RM_SUCCESS_MARKER:-}" ]; then',
      '      printf "%s\\n" removed > "$E2E_RM_SUCCESS_MARKER"',
      "    fi",
      '    if [ -n "${DOCKER_DAEMON_REMOVED_FILE:-}" ]; then',
      '      printf "%s\\n" removed > "$DOCKER_DAEMON_REMOVED_FILE"',
      "    fi",
      '    exit "${E2E_RM_STATUS:-0}"',
      "    ;;",
      '  *"up -d --wait --force-recreate --no-deps auth app"*)',
      '    if [ -n "${E2E_CLEANUP_SIGNAL_PARENT:-}" ]; then',
      '      kill -s "$E2E_CLEANUP_SIGNAL_PARENT" "$PPID"',
      "    fi",
      '    if [ -n "${E2E_CLEANUP_SUCCESS_DELAY:-}" ]; then',
      '      sleep "$E2E_CLEANUP_SUCCESS_DELAY"',
      "    fi",
      '    if [ -n "${E2E_CLEANUP_SUCCESS_MARKER:-}" ]; then',
      '      printf "%s\\n" restored > "$E2E_CLEANUP_SUCCESS_MARKER"',
      "    fi",
      '    if [ "${E2E_CLEANUP_WAIT_FOR_SIGNAL:-}" = "1" ]; then',
      '      if [ -n "${E2E_CLEANUP_READY_FILE:-}" ]; then',
      "        DOCKER_READY_FILE=$E2E_CLEANUP_READY_FILE",
      "        export DOCKER_READY_FILE",
      "      fi",
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
  // 並列 docker が残す index.lock ディレクトリは invocation ではない
  const logFiles = files.filter((name) => /^\d+$/u.test(name));
  logFiles.sort((left, right) => Number(left) - Number(right));
  return Promise.all(
    logFiles.map(async (file) => {
      const encoded = await readFile(join(logDir, file), "utf8");
      assert.equal(encoded.endsWith("\0"), true);
      return encoded.slice(0, -1).split("\0");
    }),
  );
}

/** full の mobile||desktop 並列で body run のログ順が入れ替わっても比較できるよう正規化する */
function canonicalizeE2EInvocations(invocations) {
  const isMobileOrDesktopBodyRun = (args) => {
    if (!args.includes("run") || !args.includes("e2e")) return false;
    if (!args.includes("--rm") || !args.includes("--no-deps")) return false;
    return (
      args.includes("--project=mobile-chromium") || args.includes("--project=desktop-chromium")
    );
  };
  const bodyIndexes = [];
  for (let index = 0; index < invocations.length; index += 1) {
    if (isMobileOrDesktopBodyRun(invocations[index])) bodyIndexes.push(index);
  }
  if (bodyIndexes.length < 2) return invocations;
  const sortedBodies = bodyIndexes
    .map((index) => invocations[index])
    .sort((left, right) => {
      const leftKey = left.includes("--project=mobile-chromium") ? 0 : 1;
      const rightKey = right.includes("--project=mobile-chromium") ? 0 : 1;
      return leftKey - rightKey;
    });
  const next = invocations.map((args) => [...args]);
  bodyIndexes.forEach((index, order) => {
    next[index] = sortedBodies[order];
  });
  return next;
}

function assertE2EInvocationsEqual(actual, expected) {
  assert.deepEqual(canonicalizeE2EInvocations(actual), canonicalizeE2EInvocations(expected));
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

function expectedE2EInvocations(
  root,
  projectName,
  arguments_ = [],
  cleanupE2EContainers = true,
  suite = "full",
  options = {},
) {
  // scripts/run-e2e.sh の現行シーケンスに合わせる:
  // base up → force-recreate auth（SKIP_RECREATE 時は up のみ）→ AI 枠リセット →
  // E2E app 群 recreate（SKIP 時は force-recreate なし）→
  // full: setup（storageState）1 回 →（--project 未指定なら mobile || desktop 並列。中間枠 reset なし）
  // smoke: setup 省略（reused が smoke に載るまで）→ mobile-chromium 1 段 + --grep=@smoke
  // --project=setup のみのときは setup を二重起動しない
  // → cleanup で app ログ採取 → 失敗時のみ e2e kill/rm →
  //   ローカルは auth/app 復元、CI=true は restore 省略（GHA / ci.sh が volumes down）
  // 先頭の裸 `--` は run-e2e.sh が shift して捨てる（docs の `./scripts/run-e2e.sh -- path` 慣習）。
  // bodyRan: setup 成功後に mobile||desktop body まで到達した失敗（signal 中断・body exit 非 0）
  const { skipRecreate = false, ci = false, bodyRan = false } = options;
  const normalizedArguments =
    arguments_.length > 0 && arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
  arguments_ = normalizedArguments;
  const compose = ["compose", "--project-directory", root, "--project-name", projectName];
  const baseComposeFile = ["-f", join(root, "compose.yaml")];
  const e2eComposeFiles = [
    "-f",
    join(root, "compose.yaml"),
    "-f",
    join(root, "compose.e2e.yaml"),
    "--profile",
    "e2e",
  ];
  const quotaReset = [
    ...compose,
    ...baseComposeFile,
    "run",
    "--rm",
    "--no-deps",
    "--entrypoint",
    "sh",
    "migrate",
    "-c",
    'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "truncate private.ai_global_daily_usage"',
  ];
  const hasProject = arguments_.some(
    (arg) => arg === "--project" || String(arg).startsWith("--project="),
  );
  const hasGrep = arguments_.some(
    (arg) => arg === "--grep" || arg === "-g" || String(arg).startsWith("--grep="),
  );

  // shell の e2e_args_only_setup_project と同じ判定: 指定 project が setup のみ
  const projectNames = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const arg = String(arguments_[index]);
    if (arg === "--project") {
      projectNames.push(String(arguments_[index + 1] ?? ""));
      index += 1;
      continue;
    }
    if (arg.startsWith("--project=")) {
      projectNames.push(arg.slice("--project=".length));
    }
  }
  const onlySetupProject =
    projectNames.length > 0 && projectNames.every((name) => name === "setup");

  const setupRun = [
    ...compose,
    ...e2eComposeFiles,
    "run",
    "--rm",
    "--no-deps",
    "e2e",
    "--project=setup",
  ];

  let playwrightRuns;
  if (onlySetupProject) {
    // デバッグ用: setup だけを 1 回（前置 setup なし）
    playwrightRuns = [
      [...compose, ...e2eComposeFiles, "run", "--rm", "--no-deps", "e2e", ...arguments_],
    ];
  } else if (suite === "smoke") {
    // smoke: setup 省略。本体 1 回のみ（失敗時も先頭 e2e が mock に効く）。
    const smokeArgs = [...arguments_];
    if (!hasProject) smokeArgs.unshift("--project=mobile-chromium");
    if (!hasGrep) smokeArgs.push("--grep=@smoke");
    playwrightRuns = [
      [...compose, ...e2eComposeFiles, "run", "--rm", "--no-deps", "e2e", ...smokeArgs],
    ];
  } else if (cleanupE2EContainers && bodyRan) {
    // setup 成功後に dual body まで到達してから失敗（signal 中断・body 非 0）
    playwrightRuns = [
      setupRun,
      [
        ...compose,
        ...e2eComposeFiles,
        "run",
        "--rm",
        "--no-deps",
        "e2e",
        "--project=mobile-chromium",
        ...arguments_,
      ],
      [
        ...compose,
        ...e2eComposeFiles,
        "run",
        "--rm",
        "--no-deps",
        "e2e",
        "--project=desktop-chromium",
        ...arguments_,
      ],
    ];
  } else if (cleanupE2EContainers) {
    // full 失敗・signal: setup が fail-closed（`|| return`）なので後続は走らない。
    // mock の E2E_STATUS / E2E_WAIT_FOR_SIGNAL（SKIP_FIRST なし）は先頭 e2e（setup）に効く。
    playwrightRuns = [setupRun];
  } else if (hasProject) {
    playwrightRuns = [
      setupRun,
      [...compose, ...e2eComposeFiles, "run", "--rm", "--no-deps", "e2e", ...arguments_],
    ];
  } else {
    // mobile || desktop 並列（中間 quota reset なし）。ログ順は非決定のため
    // assertE2EInvocations 側で body run を project 名で正規化する。
    playwrightRuns = [
      setupRun,
      [
        ...compose,
        ...e2eComposeFiles,
        "run",
        "--rm",
        "--no-deps",
        "e2e",
        "--project=mobile-chromium",
        ...arguments_,
      ],
      [
        ...compose,
        ...e2eComposeFiles,
        "run",
        "--rm",
        "--no-deps",
        "e2e",
        "--project=desktop-chromium",
        ...arguments_,
      ],
    ];
  }

  const authUp = skipRecreate
    ? [...compose, ...e2eComposeFiles, "up", "-d", "--wait", "auth"]
    : [...compose, ...e2eComposeFiles, "up", "-d", "--wait", "--force-recreate", "auth"];
  const appGroupUp = skipRecreate
    ? [
        ...compose,
        ...e2eComposeFiles,
        "up",
        "-d",
        "--wait",
        "--no-deps",
        "openrouter-mock",
        "kong",
        "oauth-mock",
        "app",
      ]
    : [
        ...compose,
        ...e2eComposeFiles,
        "up",
        "-d",
        "--wait",
        "--force-recreate",
        "--no-deps",
        "openrouter-mock",
        "kong",
        "oauth-mock",
        "app",
      ];
  // CI は restore 省略。ローカルは通常構成へ force-recreate 復元。
  const restore = ci
    ? []
    : [
        [
          ...compose,
          ...baseComposeFile,
          "up",
          "-d",
          "--wait",
          "--force-recreate",
          "--no-deps",
          "auth",
          "app",
        ],
      ];

  return [
    [...compose, ...baseComposeFile, "up", "-d", "--wait"],
    authUp,
    quotaReset,
    appGroupUp,
    ...playwrightRuns,
    // cleanup は成否に関わらず Function ログを host へ採取する
    [...compose, ...baseComposeFile, "logs", "--no-color", "app"],
    ...(cleanupE2EContainers
      ? [
          [...compose, ...e2eComposeFiles, "kill", "--signal", "SIGKILL", "e2e"],
          [...compose, ...e2eComposeFiles, "rm", "--force", "e2e"],
        ]
      : []),
    ...restore,
  ];
}

async function expectedProjectName(root) {
  const canonicalRoot = await realpath(root);
  const digest = createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 32);
  return `kondate-${digest}`;
}

function expectedE2ELockDir(root) {
  return join(root, ".run-e2e.lock");
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    const statFields = readFileSync(`/proc/${pid}/stat`, "utf8").split(" ");
    return statFields[2] !== "Z";
  } catch (error) {
    if (error && typeof error === "object" && (error.code === "ENOENT" || error.code === "ESRCH"))
      return false;
    throw error;
  }
}

async function readProcessChildren(pid) {
  return readFile(`/proc/${pid}/task/${pid}/children`, "utf8").then(
    (children) => children.trim().split(/\s+/u).filter(Boolean).map(Number),
    (error) => {
      if (error && typeof error === "object" && error.code === "ENOENT") return [];
      throw error;
    },
  );
}

async function waitForAdditionalChild(parentPid, excludedPid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const childPid = (await readProcessChildren(parentPid)).find((pid) => pid !== excludedPid);
    if (childPid) return childPid;
    await delay(5);
  }
  assert.fail(`timed out waiting for watchdog child of ${parentPid}`);
}

// watchdog サブシェルが sleep を fork する前に children を読むと空になる。
// CI でファイルを並列実行するとスケジューリングのレースが開きやすい。
async function waitForProcessChild(parentPid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [childPid] = await readProcessChildren(parentPid);
    if (Number.isSafeInteger(childPid)) return childPid;
    await delay(5);
  }
  assert.fail(`timed out waiting for child of ${parentPid}`);
}

async function waitForProcessExit(pid) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!isProcessAlive(pid)) return;
    await delay(5);
  }
  assert.fail(`timed out waiting for process ${pid} to exit`);
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
      // ホスト環境の suite 指定で full 期待が崩れないよう既定を固定する
      KONDATE_E2E_SUITE: "full",
      // ホスト CI=true で restore 省略期待が壊れないよう既定は非 CI。
      // CI 経路テストは extraEnv で CI: "true" を渡す。
      CI: "",
      // 開発用 SKIP もホストから漏れないよう既定オフ（CI 同時拒否テストは extraEnv で付与）
      KONDATE_E2E_SKIP_RECREATE: "",
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

/** dual body 待機: E2E_BODY_READY_DIR に count 本の pid ファイルが揃うまで待つ */
async function waitForReadyPids(readyDir, count = 2) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const names = await readdir(readyDir).catch(() => []);
    if (names.length >= count) {
      const pids = await Promise.all(
        names.map(async (name) => Number((await readFile(join(readyDir, name), "utf8")).trim())),
      );
      assert.equal(
        pids.every((pid) => Number.isSafeInteger(pid) && pid > 0),
        true,
        `invalid ready pids: ${pids.join(",")}`,
      );
      return pids;
    }
    await delay(10);
  }
  assert.fail(`timed out waiting for ${String(count)} ready pids in ${readyDir}`);
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
        TMPDIR: root,
      });

      if (fixture.e2eStatus === 0) await run;
      else
        await assert.rejects(
          run,
          (error) => error && typeof error === "object" && error.code === fixture.e2eStatus,
        );

      assertE2EInvocationsEqual(
        await readDockerInvocations(logDir),
        expectedE2EInvocations(
          root,
          await expectedProjectName(root),
          ["--grep", "space value"],
          fixture.e2eStatus !== 0,
        ),
      );
      await assert.rejects(access(await expectedE2ELockDir(root)));
    });
  }
});

// smoke: mobile 本体 1 回のみ（setup 省略・desktop 段・中間 quota reset なし）。@smoke を自動付与する。
test("E2E runner smoke suite runs a single mobile project with @smoke grep", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "smoke suite log");

  await runE2E(root, bin, logDir, [], {
    E2E_STATUS: "0",
    KONDATE_E2E_SUITE: "smoke",
    TMPDIR: root,
  });

  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root), [], false, "smoke"),
  );
  await assert.rejects(access(await expectedE2ELockDir(root)));
});

// 呼び出し側が --project / --grep を既に付けていれば smoke でも二重付与しない
test("E2E runner smoke suite respects caller --project and --grep", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "smoke suite override log");
  const args = ["--project=desktop-chromium", "--grep=custom"];

  await runE2E(root, bin, logDir, args, {
    E2E_STATUS: "0",
    KONDATE_E2E_SUITE: "smoke",
    TMPDIR: root,
  });

  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root), args, false, "smoke"),
  );
});

// docs 慣習の先頭裸 `--` は playwright に渡さず捨て、パスを位置引数として残す
test("E2E runner strips a leading bare -- before playwright args", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "leading dashdash log");
  const args = ["--", "e2e/specs/foundation.spec.ts", "--project=mobile-chromium"];

  await runE2E(root, bin, logDir, args, {
    E2E_STATUS: "0",
    TMPDIR: root,
  });

  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root), args, false),
  );
  const invocations = await readDockerInvocations(logDir);
  // setup 前置のあと本体 run がある。パス付きの本体を拾う
  const playwright = invocations.find(
    (row) =>
      row.includes("e2e") && row.includes("run") && row.includes("e2e/specs/foundation.spec.ts"),
  );
  assert.ok(playwright, "playwright/e2e run invocation missing");
  // 先頭 `--` は破棄され、パスと --project が残る
  assert.ok(playwright.includes("e2e/specs/foundation.spec.ts"));
  assert.ok(playwright.includes("--project=mobile-chromium"));
  assert.equal(
    playwright.filter((part) => part === "--").length,
    0,
    "bare -- must not reach docker/playwright args",
  );
});

// 不正な KONDATE_E2E_SUITE は stack 起動後に exit 2（cleanup で restore する）
test("E2E runner rejects an invalid KONDATE_E2E_SUITE", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "invalid suite log");

  await assert.rejects(
    runE2E(root, bin, logDir, [], {
      KONDATE_E2E_SUITE: "bogus",
      TMPDIR: root,
    }),
    (error) => error && typeof error === "object" && error.code === 2,
  );

  // playwright を起動せず、開始時 reset 1 回のあと cleanup へ進む
  const invocations = await readDockerInvocations(logDir);
  const e2eRuns = invocations.filter((args) => args.includes("e2e") && args.includes("run"));
  assert.equal(e2eRuns.length, 0);
  assert.ok(invocations.some((args) => args.includes("logs") && args.includes("app")));
  assert.ok(
    invocations.some(
      (args) =>
        args.includes("up") &&
        args.includes("auth") &&
        args.includes("app") &&
        args.includes("--force-recreate"),
    ),
  );
});

// Spec §7.7: CI=true と KONDATE_E2E_SKIP_RECREATE=1 の同時指定は exit 2（Docker 未起動）
test("E2E runner rejects KONDATE_E2E_SKIP_RECREATE when CI=true", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "ci skip recreate reject log");

  await assert.rejects(
    runE2E(root, bin, logDir, [], {
      CI: "true",
      KONDATE_E2E_SKIP_RECREATE: "1",
      TMPDIR: root,
    }),
    (error) =>
      error &&
      typeof error === "object" &&
      error.code === 2 &&
      String(error.stderr ?? "").includes("development-only") &&
      String(error.stderr ?? "").includes("CI=true"),
  );

  // 早期 fail-closed: lock / docker を触らない
  assert.deepEqual(await readDockerInvocations(logDir), []);
  await assert.rejects(access(await expectedE2ELockDir(root)));
});

// CI=true では終了時 auth/app force-recreate 復元を省略する（GHA / ci.sh が volumes down）
test("E2E runner skips auth/app restore cleanup when CI=true", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "ci cleanup skip restore log");

  await runE2E(root, bin, logDir, ["--grep", "ci-path"], {
    CI: "true",
    E2E_STATUS: "0",
    TMPDIR: root,
  });

  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(
      root,
      await expectedProjectName(root),
      ["--grep", "ci-path"],
      false,
      "full",
      { ci: true },
    ),
  );
  // restore 用の force-recreate auth app が無いことを二重確認
  const invocations = await readDockerInvocations(logDir);
  const restore = invocations.filter(
    (args) =>
      args.includes("up") &&
      args.includes("--force-recreate") &&
      args.includes("auth") &&
      args.includes("app") &&
      !args.includes("compose.e2e.yaml"),
  );
  assert.equal(restore.length, 0);
});

// 開発反復用: 開始時 force-recreate を飛ばす（終了時 restore はローカルどおり維持）
test("E2E runner skips start force-recreate when KONDATE_E2E_SKIP_RECREATE=1", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "skip recreate start log");

  await runE2E(root, bin, logDir, ["--grep", "skip-recreate"], {
    KONDATE_E2E_SKIP_RECREATE: "1",
    E2E_STATUS: "0",
    TMPDIR: root,
  });

  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(
      root,
      await expectedProjectName(root),
      ["--grep", "skip-recreate"],
      false,
      "full",
      { skipRecreate: true },
    ),
  );
});

test("E2E runner serializes runs from the same checkout and releases its lock", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const firstLogDir = join(root, "first concurrent log");
  const secondLogDir = join(root, "second concurrent log");
  const thirdLogDir = join(root, "third concurrent log");
  const readyFile = join(root, "first concurrent ready");
  const firstTmpDir = join(root, "first tmp");
  const secondTmpDir = join(root, "second tmp");
  const thirdTmpDir = join(root, "third tmp");
  await Promise.all([
    mkdir(firstLogDir),
    mkdir(firstTmpDir),
    mkdir(secondTmpDir),
    mkdir(thirdTmpDir),
  ]);
  const first = spawn(join(root, "scripts", "run-e2e.sh"), {
    cwd: tmpdir(),
    env: {
      ...process.env,
      CI: "",
      KONDATE_E2E_SKIP_RECREATE: "",
      KONDATE_E2E_SUITE: "full",
      DOCKER_LOG_DIR: firstLogDir,
      DOCKER_READY_FILE: readyFile,
      E2E_WAIT_FOR_SIGNAL: "1",
      // 既定 grace=5s のままだと CI 負荷下で cancel_watchdog 待ちが
      // waitForCompletion(2s) を超え得る。本ケースは排他ロック挙動が対象。
      KONDATE_E2E_SIGNAL_GRACE_SECONDS: "0.2",
      PATH: `${bin}:${process.env.PATH}`,
      TMPDIR: firstTmpDir,
    },
    stdio: "ignore",
  });
  const firstCompletion = new Promise((resolveClose, rejectClose) => {
    first.once("error", rejectClose);
    first.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  t.after(() => {
    if (isProcessAlive(first.pid)) process.kill(first.pid, "SIGKILL");
  });

  await waitForFile(readyFile);
  await assert.rejects(runE2E(root, bin, secondLogDir, [], { TMPDIR: secondTmpDir }));
  assert.deepEqual(await readdir(secondLogDir), []);

  process.kill(first.pid, "SIGTERM");
  assert.deepEqual(await waitForCompletion(firstCompletion), { code: 143, signal: null });
  await assert.rejects(access(await expectedE2ELockDir(root)));

  await runE2E(root, bin, thirdLogDir, [], { TMPDIR: thirdTmpDir });
  assertE2EInvocationsEqual(
    await readDockerInvocations(thirdLogDir),
    expectedE2EInvocations(root, await expectedProjectName(root), [], false),
  );
});

// E2E11: 空の .run-e2e.lock（pid 無し・旧形式）は stale として回収し、Docker を起動する
test("E2E runner recovers a stale empty checkout lock before invoking Docker", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "stale E2E lock log");
  await mkdir(await expectedE2ELockDir(root));

  await runE2E(root, bin, logDir, [], { TMPDIR: root });

  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root), [], false),
  );
  await assert.rejects(access(await expectedE2ELockDir(root)));
});

// 中身があり rmdir できない放棄ロックは fail-closed で Docker を呼ばない
test("E2E runner rejects a non-empty abandoned checkout lock before invoking Docker", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "abandoned E2E lock log");
  const lockDir = await expectedE2ELockDir(root);
  await mkdir(lockDir);
  await writeFile(join(lockDir, "blocker"), "stuck\n");

  await assert.rejects(runE2E(root, bin, logDir, [], { TMPDIR: root }));

  assert.deepEqual(await readdir(logDir), []);
});

test("E2E runner reports a lock release failure after a successful run", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "E2E lock release failure log");
  const readyFile = join(root, "E2E lock release failure ready");
  await mkdir(logDir);
  const child = spawn(join(root, "scripts", "run-e2e.sh"), {
    cwd: tmpdir(),
    env: {
      ...process.env,
      CI: "",
      KONDATE_E2E_SKIP_RECREATE: "",
      KONDATE_E2E_SUITE: "full",
      DOCKER_LOG_DIR: logDir,
      E2E_SUCCESS_DELAY: "0.3",
      E2E_SUCCESS_READY_FILE: readyFile,
      PATH: `${bin}:${process.env.PATH}`,
      TMPDIR: root,
    },
    stdio: "ignore",
  });
  const completion = new Promise((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  t.after(() => {
    if (isProcessAlive(child.pid)) process.kill(child.pid, "SIGKILL");
  });

  await waitForFile(readyFile);
  const lockDir = await expectedE2ELockDir(root);
  await mkdir(lockDir, { recursive: true });
  await writeFile(join(lockDir, "release blocker"), "blocked\n");

  const result = await waitForCompletion(completion);
  assert.equal(result.signal, null);
  assert.notEqual(result.code, 0);
  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root), [], false),
  );
});

test("E2E runner restores the base stack after every forwarded signal", async (t) => {
  // 単一 --project で e2e 待機に割り込み（setup なしの 1 body）。dual は別テスト。
  const e2eArgs = ["--project=mobile-chromium"];
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
      const child = spawn(join(root, "scripts", "run-e2e.sh"), e2eArgs, {
        cwd: tmpdir(),
        env: {
          ...process.env,
          CI: "",
          KONDATE_E2E_SKIP_RECREATE: "",
          KONDATE_E2E_SUITE: "full",
          COMPOSE_PROJECT_NAME: "shared",
          DOCKER_LOG_DIR: logDir,
          DOCKER_READY_FILE: readyFile,
          E2E_WAIT_FOR_SIGNAL: "1",
          // 既定 grace=5s だと cleanup 中の cancel_watchdog 待ちが
          // waitForCompletion(2s) を超え得る。signal 転送と restore が対象。
          KONDATE_E2E_SIGNAL_GRACE_SECONDS: "0.2",
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
      assertE2EInvocationsEqual(
        await readDockerInvocations(logDir),
        expectedE2EInvocations(root, await expectedProjectName(root), e2eArgs),
      );
    });
  }
});

// 案 B P1: full（--project 未指定）の mobile||desktop 並列中に親 signal が両 body へ届くこと
test("E2E runner forwards signal to both mobile and desktop body processes", async (t) => {
  for (const fixture of [
    { signal: "SIGHUP", status: 129 },
    { signal: "SIGINT", status: 130 },
    { signal: "SIGTERM", status: 143 },
  ]) {
    await t.test(fixture.signal, async (subtest) => {
      const root = await createDatabaseScriptFixture("run-e2e.sh");
      subtest.after(() => rm(root, { recursive: true, force: true }));
      const bin = await installDockerRecorder(root);
      const logDir = join(root, `dual ${fixture.signal} log`);
      const bodyReadyDir = join(root, `dual ${fixture.signal} body ready`);
      await mkdir(logDir);
      await mkdir(bodyReadyDir);
      // --project 未指定 → setup 後に mobile||desktop 並列
      const child = spawn(join(root, "scripts", "run-e2e.sh"), [], {
        cwd: tmpdir(),
        env: {
          ...process.env,
          CI: "",
          KONDATE_E2E_SKIP_RECREATE: "",
          KONDATE_E2E_SUITE: "full",
          COMPOSE_PROJECT_NAME: "shared",
          DOCKER_LOG_DIR: logDir,
          E2E_WAIT_FOR_SIGNAL: "1",
          // setup だけ即成功し、body 2 本が waiter になる
          E2E_WAIT_SKIP_FIRST: "1",
          E2E_BODY_READY_DIR: bodyReadyDir,
          KONDATE_E2E_SIGNAL_GRACE_SECONDS: "0.2",
          PATH: `${bin}:${process.env.PATH}`,
        },
        stdio: "ignore",
      });
      const completion = new Promise((resolveClose, rejectClose) => {
        child.once("error", rejectClose);
        child.once("close", (code, signal) => resolveClose({ code, signal }));
      });
      let bodyPids = [];
      subtest.after(() => {
        if (isProcessAlive(child.pid)) process.kill(child.pid, "SIGKILL");
        for (const pid of bodyPids) if (isProcessAlive(pid)) process.kill(pid, "SIGKILL");
      });

      bodyPids = await waitForReadyPids(bodyReadyDir, 2);
      process.kill(child.pid, fixture.signal);

      assert.deepEqual(await waitForCompletion(completion, 3_000), {
        code: fixture.status,
        signal: null,
      });
      for (const pid of bodyPids) assert.equal(isProcessAlive(pid), false);
      assertE2EInvocationsEqual(
        await readDockerInvocations(logDir),
        expectedE2EInvocations(root, await expectedProjectName(root), [], true, "full", {
          bodyRan: true,
        }),
      );
    });
  }
});

// 案 B P1: dual body の exit は mobile 非 0 を desktop より優先する
test("E2E runner prefers mobile non-zero status over desktop when both body runs finish", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "mobile prefer exit log");

  await assert.rejects(
    runE2E(root, bin, logDir, [], {
      E2E_STATUS_MOBILE: "23",
      E2E_STATUS_DESKTOP: "0",
      TMPDIR: root,
    }),
    (error) => error && typeof error === "object" && error.code === 23,
  );

  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root), [], true, "full", {
      bodyRan: true,
    }),
  );
});

test("E2E runner returns desktop status when mobile body succeeds and desktop fails", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "desktop fail exit log");

  await assert.rejects(
    runE2E(root, bin, logDir, [], {
      E2E_STATUS_MOBILE: "0",
      E2E_STATUS_DESKTOP: "42",
      TMPDIR: root,
    }),
    (error) => error && typeof error === "object" && error.code === 42,
  );

  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root), [], true, "full", {
      bodyRan: true,
    }),
  );
});

test("E2E runner force-kills a child that ignores two forwarded signals", async (t) => {
  const e2eArgs = ["--project=mobile-chromium"];
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
      const child = spawn(join(root, "scripts", "run-e2e.sh"), e2eArgs, {
        cwd: tmpdir(),
        env: {
          ...process.env,
          CI: "",
          KONDATE_E2E_SKIP_RECREATE: "",
          KONDATE_E2E_SUITE: "full",
          DOCKER_IGNORE_SIGNAL: "1",
          DOCKER_LOG_DIR: logDir,
          DOCKER_READY_FILE: readyFile,
          E2E_WAIT_FOR_SIGNAL: "1",
          // 2回目 signal の force-kill が対象。既定 grace=5s は CI 負荷下で
          // cleanup の watchdog 再武装と合わせ waitForCompletion(2s) を超え得る。
          KONDATE_E2E_SIGNAL_GRACE_SECONDS: "0.2",
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
      assertE2EInvocationsEqual(
        await readDockerInvocations(logDir),
        expectedE2EInvocations(root, await expectedProjectName(root), e2eArgs),
      );
    });
  }
});

test("E2E runner watchdog kills a child that ignores one forwarded signal", async (t) => {
  const e2eArgs = ["--project=mobile-chromium"];
  for (const fixture of [
    { signal: "SIGHUP", status: 129 },
    { signal: "SIGINT", status: 130 },
    { signal: "SIGTERM", status: 143 },
  ]) {
    await t.test(fixture.signal, async (subtest) => {
      const root = await createDatabaseScriptFixture("run-e2e.sh");
      subtest.after(() => rm(root, { recursive: true, force: true }));
      const bin = await installDockerRecorder(root);
      const logDir = join(root, `${fixture.signal} watchdog log`);
      const readyFile = join(root, `${fixture.signal} watchdog ready`);
      await mkdir(logDir);
      const child = spawn(join(root, "scripts", "run-e2e.sh"), e2eArgs, {
        cwd: tmpdir(),
        env: {
          ...process.env,
          CI: "",
          KONDATE_E2E_SKIP_RECREATE: "",
          KONDATE_E2E_SUITE: "full",
          DOCKER_IGNORE_SIGNAL: "1",
          DOCKER_LOG_DIR: logDir,
          DOCKER_READY_FILE: readyFile,
          E2E_WAIT_FOR_SIGNAL: "1",
          KONDATE_E2E_SIGNAL_GRACE_SECONDS: "0.2",
          PATH: `${bin}:${process.env.PATH}`,
        },
        stdio: "ignore",
      });
      const completion = new Promise((resolveClose, rejectClose) => {
        child.once("error", rejectClose);
        child.once("close", (code, signal) => resolveClose({ code, signal }));
      });
      let fakeDockerPid;
      let watchdogPid;
      let timerPid;
      subtest.after(() => {
        for (const pid of [child.pid, fakeDockerPid, watchdogPid, timerPid])
          if (pid && isProcessAlive(pid)) process.kill(pid, "SIGKILL");
      });

      await waitForFile(readyFile);
      fakeDockerPid = Number((await readFile(readyFile, "utf8")).trim());
      process.kill(child.pid, fixture.signal);
      watchdogPid = await waitForAdditionalChild(child.pid, fakeDockerPid);
      timerPid = await waitForProcessChild(watchdogPid);

      assert.deepEqual(await waitForCompletion(completion), {
        code: fixture.status,
        signal: null,
      });
      for (const pid of [fakeDockerPid, watchdogPid, timerPid])
        assert.equal(isProcessAlive(pid), false);
      assertE2EInvocationsEqual(
        await readDockerInvocations(logDir),
        expectedE2EInvocations(root, await expectedProjectName(root), e2eArgs),
      );
    });
  }
});

test("E2E runner reaps a child that signals during launch", async (t) => {
  const e2eArgs = ["--project=mobile-chromium"];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await t.test(`attempt ${attempt + 1}`, async (subtest) => {
      const root = await createDatabaseScriptFixture("run-e2e.sh");
      subtest.after(() => rm(root, { recursive: true, force: true }));
      const bin = await installDockerRecorder(root);
      const logDir = join(root, `launch race ${attempt + 1}`);
      const readyFile = join(root, `launch race ready ${attempt + 1}`);

      await assert.rejects(
        runE2E(root, bin, logDir, e2eArgs, {
          DOCKER_READY_FILE: readyFile,
          DOCKER_SIGNAL_PARENT_ON_START: "SIGTERM",
          E2E_WAIT_FOR_SIGNAL: "1",
          // 起動直後 SIGTERM の reap が対象。既定 grace=5s は runE2E の
          // timeout(3s) と衝突し、cleanup の auth/app 復元が欠落し得る。
          KONDATE_E2E_SIGNAL_GRACE_SECONDS: "0.2",
        }),
        (error) => error && typeof error === "object" && error.code === 143,
      );

      const fakeDockerPid = Number((await readFile(readyFile, "utf8")).trim());
      assert.equal(isProcessAlive(fakeDockerPid), false);
      assertE2EInvocationsEqual(
        await readDockerInvocations(logDir),
        expectedE2EInvocations(root, await expectedProjectName(root), e2eArgs),
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
      CI: "",
      KONDATE_E2E_SKIP_RECREATE: "",
      KONDATE_E2E_SUITE: "full",
      DOCKER_IGNORE_SIGNAL: "1",
      DOCKER_LOG_DIR: logDir,
      DOCKER_READY_FILE: readyFile,
      E2E_CLEANUP_WAIT_FOR_SIGNAL: "1",
      // restore 中の 2 回目 signal が対象。既定 grace=5s は
      // waitForCompletion(2s) と衝突し得る。
      KONDATE_E2E_SIGNAL_GRACE_SECONDS: "0.2",
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
  assert.equal(isProcessAlive(fakeDockerPid), true);
  process.kill(child.pid, "SIGTERM");

  assert.deepEqual(await waitForCompletion(completion), { code: 143, signal: null });
  assert.equal(isProcessAlive(fakeDockerPid), false);
  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root), [], false),
  );
});

test("E2E runner bounds one signal while a base restoration is stuck", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "cleanup watchdog log");
  const readyFile = join(root, "cleanup watchdog ready");
  await mkdir(logDir);
  const child = spawn(join(root, "scripts", "run-e2e.sh"), {
    cwd: tmpdir(),
    env: {
      ...process.env,
      CI: "",
      KONDATE_E2E_SKIP_RECREATE: "",
      KONDATE_E2E_SUITE: "full",
      DOCKER_IGNORE_SIGNAL: "1",
      DOCKER_LOG_DIR: logDir,
      DOCKER_READY_FILE: readyFile,
      E2E_CLEANUP_WAIT_FOR_SIGNAL: "1",
      KONDATE_E2E_SIGNAL_GRACE_SECONDS: "0.2",
      PATH: `${bin}:${process.env.PATH}`,
    },
    stdio: "ignore",
  });
  const completion = new Promise((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  let fakeDockerPid;
  let watchdogPid;
  let timerPid;
  t.after(() => {
    for (const pid of [child.pid, fakeDockerPid, watchdogPid, timerPid])
      if (pid && isProcessAlive(pid)) process.kill(pid, "SIGKILL");
  });

  await waitForFile(readyFile);
  fakeDockerPid = Number((await readFile(readyFile, "utf8")).trim());
  process.kill(child.pid, "SIGTERM");
  watchdogPid = await waitForAdditionalChild(child.pid, fakeDockerPid);
  timerPid = await waitForProcessChild(watchdogPid);
  await delay(20);
  assert.equal(isProcessAlive(fakeDockerPid), true);

  assert.deepEqual(await waitForCompletion(completion), { code: 143, signal: null });
  for (const pid of [fakeDockerPid, watchdogPid, timerPid])
    assert.equal(isProcessAlive(pid), false);
  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root), [], false),
  );
});

test("E2E runner preserves every early failure when cleanup also fails", async (t) => {
  // 単一 project で期待列を短くし、cleanup 末尾は logs + kill + rm + restore
  const e2eArgs = ["--project=mobile-chromium"];
  for (let failureStage = 1; failureStage <= 4; failureStage += 1) {
    await t.test(`stage ${failureStage}`, async (subtest) => {
      const root = await createDatabaseScriptFixture("run-e2e.sh");
      subtest.after(() => rm(root, { recursive: true, force: true }));
      const bin = await installDockerRecorder(root);
      const logDir = join(root, `early failure ${failureStage}`);
      const failureStatus = 50 + failureStage;

      await assert.rejects(
        runE2E(root, bin, logDir, e2eArgs, {
          DOCKER_FAIL_AT: String(failureStage),
          DOCKER_FAIL_STATUS: String(failureStatus),
          E2E_CLEANUP_STATUS: "79",
          E2E_KILL_STATUS: "77",
          E2E_RM_STATUS: "78",
        }),
        (error) => error && typeof error === "object" && error.code === failureStatus,
      );

      const expected = expectedE2EInvocations(root, await expectedProjectName(root), e2eArgs);
      // cleanup は成否に関わらず logs を先に採取し、失敗時は kill/rm 後に restore
      assert.deepEqual(await readDockerInvocations(logDir), [
        ...expected.slice(0, failureStage),
        ...expected.slice(-4),
      ]);
    });
  }
});

test("E2E runner skips removed E2E container cleanup after a successful run", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "successful E2E cleanup log");

  await runE2E(root, bin, logDir, [], { E2E_KILL_STATUS: "45", E2E_RM_STATUS: "46" });

  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root), [], false),
  );
  await assert.rejects(access(await expectedE2ELockDir(root)));
});

test("E2E runner reports a base stack restoration failure after a successful run", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "base restoration failure log");

  await assert.rejects(
    runE2E(root, bin, logDir, [], { E2E_CLEANUP_STATUS: "47" }),
    (error) => error && typeof error === "object" && error.code === 47,
  );

  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root), [], false),
  );
});

test("E2E runner kills and removes a daemon-side E2E child before restoring", async (t) => {
  const e2eArgs = ["--project=mobile-chromium"];
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "daemon child log");
  const readyFile = join(root, "E2E CLI ready");
  const daemonChildFile = join(root, "daemon child pid");
  const removedFile = join(root, "daemon child removed");
  await mkdir(logDir);
  const child = spawn(join(root, "scripts", "run-e2e.sh"), e2eArgs, {
    cwd: tmpdir(),
    env: {
      ...process.env,
      CI: "",
      KONDATE_E2E_SKIP_RECREATE: "",
      KONDATE_E2E_SUITE: "full",
      DOCKER_DAEMON_CHILD_FILE: daemonChildFile,
      DOCKER_DAEMON_REMOVED_FILE: removedFile,
      DOCKER_LOG_DIR: logDir,
      DOCKER_READY_FILE: readyFile,
      KONDATE_E2E_SIGNAL_GRACE_SECONDS: "0.2",
      PATH: `${bin}:${process.env.PATH}`,
    },
    stdio: "ignore",
  });
  const completion = new Promise((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  let dockerCliPid;
  let daemonChildPid;
  t.after(() => {
    for (const pid of [child.pid, dockerCliPid, daemonChildPid])
      if (pid && isProcessAlive(pid)) process.kill(pid, "SIGKILL");
  });

  await Promise.all([waitForFile(readyFile), waitForFile(daemonChildFile)]);
  dockerCliPid = Number((await readFile(readyFile, "utf8")).trim());
  daemonChildPid = Number((await readFile(daemonChildFile, "utf8")).trim());
  process.kill(child.pid, "SIGTERM");

  assert.deepEqual(await waitForCompletion(completion), { code: 143, signal: null });
  await waitForProcessExit(daemonChildPid);
  assert.equal(isProcessAlive(dockerCliPid), false);
  assert.equal(await readFile(removedFile, "utf8"), "removed\n");
  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root), e2eArgs),
  );
});

test("E2E runner does not remove the completed E2E container", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "E2E removal failure log");

  await runE2E(root, bin, logDir, [], { E2E_RM_STATUS: "46" });

  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root), [], false),
  );
});

test("E2E runner escalates a second signal across the cleanup phase", async (t) => {
  const e2eArgs = ["--project=mobile-chromium"];
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "cross phase signal log");
  const e2eReadyFile = join(root, "E2E phase ready");
  const cleanupReadyFile = join(root, "cleanup phase ready");
  await mkdir(logDir);
  const child = spawn(join(root, "scripts", "run-e2e.sh"), e2eArgs, {
    cwd: tmpdir(),
    env: {
      ...process.env,
      CI: "",
      KONDATE_E2E_SKIP_RECREATE: "",
      KONDATE_E2E_SUITE: "full",
      DOCKER_LOG_DIR: logDir,
      DOCKER_READY_FILE: e2eReadyFile,
      E2E_CLEANUP_READY_FILE: cleanupReadyFile,
      E2E_CLEANUP_WAIT_FOR_SIGNAL: "1",
      E2E_STATUS: "23",
      E2E_WAIT_FOR_SIGNAL: "1",
      KONDATE_E2E_SIGNAL_GRACE_SECONDS: "1",
      PATH: `${bin}:${process.env.PATH}`,
    },
    stdio: "ignore",
  });
  const completion = new Promise((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  let cleanupPid;
  t.after(() => {
    if (isProcessAlive(child.pid)) process.kill(child.pid, "SIGKILL");
    if (cleanupPid && isProcessAlive(cleanupPid)) process.kill(cleanupPid, "SIGKILL");
  });

  await waitForFile(e2eReadyFile);
  process.kill(child.pid, "SIGTERM");
  await waitForFile(cleanupReadyFile);
  cleanupPid = Number((await readFile(cleanupReadyFile, "utf8")).trim());
  process.kill(child.pid, "SIGTERM");

  assert.deepEqual(await waitForCompletion(completion, 500), { code: 143, signal: null });
  assert.equal(isProcessAlive(cleanupPid), false);
  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root), e2eArgs),
  );
});

test("E2E runner rearms its watchdog for a stuck restore after an E2E signal", async (t) => {
  const e2eArgs = ["--project=mobile-chromium"];
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "E2E signal restore watchdog log");
  const e2eReadyFile = join(root, "E2E signal ready");
  const cleanupReadyFile = join(root, "E2E signal restore ready");
  await mkdir(logDir);
  const child = spawn(join(root, "scripts", "run-e2e.sh"), e2eArgs, {
    cwd: tmpdir(),
    env: {
      ...process.env,
      CI: "",
      KONDATE_E2E_SKIP_RECREATE: "",
      KONDATE_E2E_SUITE: "full",
      DOCKER_LOG_DIR: logDir,
      DOCKER_READY_FILE: e2eReadyFile,
      E2E_CLEANUP_READY_FILE: cleanupReadyFile,
      E2E_CLEANUP_WAIT_FOR_SIGNAL: "1",
      E2E_WAIT_FOR_SIGNAL: "1",
      KONDATE_E2E_SIGNAL_GRACE_SECONDS: "0.2",
      PATH: `${bin}:${process.env.PATH}`,
    },
    stdio: "ignore",
  });
  const completion = new Promise((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  let e2ePid;
  let restorePid;
  let watchdogPid;
  let timerPid;
  t.after(() => {
    for (const pid of [child.pid, e2ePid, restorePid, watchdogPid, timerPid])
      if (pid && isProcessAlive(pid)) process.kill(pid, "SIGKILL");
  });

  await waitForFile(e2eReadyFile);
  e2ePid = Number((await readFile(e2eReadyFile, "utf8")).trim());
  process.kill(child.pid, "SIGTERM");
  await waitForFile(cleanupReadyFile);
  restorePid = Number((await readFile(cleanupReadyFile, "utf8")).trim());
  watchdogPid = await waitForAdditionalChild(child.pid, restorePid);
  timerPid = await waitForProcessChild(watchdogPid);

  assert.deepEqual(await waitForCompletion(completion, 500), { code: 143, signal: null });
  for (const pid of [e2ePid, restorePid, watchdogPid, timerPid])
    assert.equal(isProcessAlive(pid), false);
  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root), e2eArgs),
  );
});

test("E2E runner rearms its watchdog for a stuck restore after an rm signal", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "rm signal restore watchdog log");
  const cleanupReadyFile = join(root, "rm signal restore ready");
  const removalReadyFile = join(root, "rm signal ready");
  const removalMarker = join(root, "rm signal completed");
  await mkdir(logDir);
  const child = spawn(join(root, "scripts", "run-e2e.sh"), {
    cwd: tmpdir(),
    env: {
      ...process.env,
      CI: "",
      KONDATE_E2E_SKIP_RECREATE: "",
      KONDATE_E2E_SUITE: "full",
      DOCKER_LOG_DIR: logDir,
      E2E_CLEANUP_READY_FILE: cleanupReadyFile,
      E2E_CLEANUP_WAIT_FOR_SIGNAL: "1",
      E2E_STATUS: "23",
      E2E_RM_READY_FILE: removalReadyFile,
      E2E_RM_SIGNAL_PARENT: "TERM",
      E2E_RM_SUCCESS_DELAY: "0.05",
      E2E_RM_SUCCESS_MARKER: removalMarker,
      KONDATE_E2E_SIGNAL_GRACE_SECONDS: "0.2",
      PATH: `${bin}:${process.env.PATH}`,
    },
    stdio: "ignore",
  });
  const completion = new Promise((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  let removalPid;
  let restorePid;
  let watchdogPid;
  let timerPid;
  t.after(() => {
    for (const pid of [child.pid, removalPid, restorePid, watchdogPid, timerPid])
      if (pid && isProcessAlive(pid)) process.kill(pid, "SIGKILL");
  });

  await waitForFile(removalReadyFile);
  removalPid = Number((await readFile(removalReadyFile, "utf8")).trim());
  await waitForFile(cleanupReadyFile);
  restorePid = Number((await readFile(cleanupReadyFile, "utf8")).trim());
  watchdogPid = await waitForAdditionalChild(child.pid, restorePid);
  timerPid = await waitForProcessChild(watchdogPid);

  assert.deepEqual(await waitForCompletion(completion, 500), { code: 143, signal: null });
  assert.equal(await readFile(removalMarker, "utf8"), "removed\n");
  for (const pid of [removalPid, restorePid, watchdogPid, timerPid])
    assert.equal(isProcessAlive(pid), false);
  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root)),
  );
});

test("E2E runner prioritizes cleanup signal over an E2E failure", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "signal precedence log");
  const successMarker = join(root, "signal precedence marker");

  await assert.rejects(
    runE2E(root, bin, logDir, [], {
      E2E_CLEANUP_SIGNAL_PARENT: "TERM",
      E2E_CLEANUP_SUCCESS_MARKER: successMarker,
      E2E_STATUS: "23",
      KONDATE_E2E_SIGNAL_GRACE_SECONDS: "0.2",
    }),
    (error) => error && typeof error === "object" && error.code === 143,
  );

  assert.equal(await readFile(successMarker, "utf8"), "restored\n");
  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root)),
  );
});

test("E2E runner preserves a signal delivered as cleanup completes", async (t) => {
  const root = await createDatabaseScriptFixture("run-e2e.sh");
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = await installDockerRecorder(root);
  const logDir = join(root, "cleanup completion signal log");
  const successMarker = join(root, "cleanup success marker");

  await assert.rejects(
    runE2E(root, bin, logDir, [], {
      E2E_CLEANUP_SIGNAL_PARENT: "TERM",
      E2E_CLEANUP_SUCCESS_DELAY: "0.05",
      E2E_CLEANUP_SUCCESS_MARKER: successMarker,
      KONDATE_E2E_SIGNAL_GRACE_SECONDS: "0.2",
    }),
    (error) => error && typeof error === "object" && error.code === 143,
  );

  assert.equal(await readFile(successMarker, "utf8"), "restored\n");
  assertE2EInvocationsEqual(
    await readDockerInvocations(logDir),
    expectedE2EInvocations(root, await expectedProjectName(root), [], false),
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
