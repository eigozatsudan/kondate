// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ValidatedMenu } from "../../../shared/contracts/generation.js";
import { makeValidatedMenu } from "../../../shared/testing/factories.js";
import type { ShareClaimedJob } from "../_shared/share-claim.js";
import { HttpError } from "../_shared/http.js";
import type { ShareFreeTextPatch } from "../_shared/share-openrouter.js";
import { extractShareFreeTextForPrompt } from "../_shared/share-openrouter.js";
import type { ProcessShareGeneralizationJobDeps } from "../share-generalize-worker.js";

const claimShareGeneralizationJobs = vi.fn();
const getSupabaseAdmin = vi.fn(() => ({ rpc: vi.fn(), from: vi.fn() }));
const loadStoredMenu = vi.fn();
const logLines: string[] = [];

vi.mock("../_shared/share-claim.js", () => ({ claimShareGeneralizationJobs }));
vi.mock("../_shared/supabase-admin.js", () => ({ getSupabaseAdmin }));
vi.mock("../_shared/stored-menu-loader.js", async () => {
  const actual = await vi.importActual<typeof import("../_shared/stored-menu-loader.js")>(
    "../_shared/stored-menu-loader.js",
  );
  return {
    ...actual,
    loadStoredMenu: (...args: unknown[]) => loadStoredMenu(...args),
  };
});
vi.mock("../_shared/logger.js", async () => {
  const actual =
    await vi.importActual<typeof import("../_shared/logger.js")>("../_shared/logger.js");
  return {
    ...actual,
    safeLog: actual.createSafeLogger((line) => {
      logLines.push(line);
    }),
  };
});

// OpenRouter は processShare に inject するため、ハンドラ既定経路だけモック
vi.mock("../_shared/share-openrouter.js", async () => {
  const actual = await vi.importActual<typeof import("../_shared/share-openrouter.js")>(
    "../_shared/share-openrouter.js",
  );
  return {
    ...actual,
    sendShareGeneralizationPassFromEnv: vi.fn(() =>
      Promise.reject(
        new Error("sendShareGeneralizationPassFromEnv must be mocked in handler tests"),
      ),
    ),
  };
});

const {
  default: shareGeneralizeWorker,
  config,
  SHARE_WORKER_CRON_SECRET_ENV,
  SHARE_WORKER_CRON_SECRET_HEADER,
  authorizeShareGeneralizeWorker,
  processShareGeneralizationJob,
  buildSharePublishAllergenCatalog,
  defaultLoadSourceMenu,
} = await import("../share-generalize-worker.js");

const VALID_SECRET = "share-worker-cron-secret-32ch!!";

const JOB_ID = "d1000000-0000-4000-8000-000000000001";
const SOURCE_MENU_ID = "b1000000-0000-4000-8000-0000000000b1";
const CONTRIBUTOR_ID = "a1000000-0000-4000-8000-0000000000a1";

function authorizedRequest(overrides: HeadersInit = {}): Request {
  const headers = new Headers({
    [SHARE_WORKER_CRON_SECRET_HEADER]: VALID_SECRET,
  });
  new Headers(overrides).forEach((value, key) => {
    headers.set(key, value);
  });
  return new Request("http://127.0.0.1/.netlify/functions/share-generalize-worker", {
    method: "POST",
    headers,
  });
}

function makeClaimedJob(overrides: Partial<ShareClaimedJob> = {}): ShareClaimedJob {
  return {
    id: JOB_ID,
    source_menu_id: SOURCE_MENU_ID,
    contributor_user_id: CONTRIBUTOR_ID,
    status: "running",
    claimed_at: "2026-08-01T12:00:00.000Z",
    heartbeat_at: "2026-08-01T12:00:00.000Z",
    created_at: "2026-08-01T11:00:00.000Z",
    ...overrides,
  };
}

/** source 帯と衝突しない 7x UUID を採番 */
function createIdFactory(start = 1): () => string {
  let n = start;
  return () => {
    const suffix = String(n++).padStart(12, "0");
    return `70000000-0000-4000-8000-${suffix}`;
  };
}

function identityPatch(menu: ValidatedMenu): ShareFreeTextPatch {
  return extractShareFreeTextForPrompt(menu);
}

function denylistPatch(menu: ValidatedMenu): ShareFreeTextPatch {
  const base = identityPatch(menu);
  return {
    ...base,
    dishes: base.dishes.map((dish, index) =>
      index === 0 ? { ...dish, description: "アレルギーでも安心の一品" } : dish,
    ),
  };
}

function makePassSender(
  impl: (pass: "pass1" | "pass2", menu: ValidatedMenu) => ShareFreeTextPatch,
): ProcessShareGeneralizationJobDeps["sendPass"] {
  return ({ pass, menu }) =>
    Promise.resolve({
      modelId: pass === "pass1" ? "share/model-p1" : "share/model-p2",
      patch: impl(pass, menu),
    });
}

type RpcArgs = Record<string, unknown>;

function createRpcAdmin(
  handlers: {
    finish?: (args: RpcArgs) => Promise<{ data: unknown; error: null }>;
    publish?: (args: RpcArgs) => Promise<{ data: unknown; error: null }>;
  } = {},
) {
  const finish = vi.fn(
    handlers.finish ??
      (() => Promise.resolve({ data: { ok: true, status: "failed" }, error: null })),
  );
  const publish = vi.fn(
    handlers.publish ??
      (() =>
        Promise.resolve({
          data: {
            ok: true,
            published: true,
            recipe_id: "e1000000-0000-4000-8000-0000000000e1",
            job_id: JOB_ID,
          },
          error: null,
        })),
  );
  const from = vi.fn();
  const rpc = vi.fn((name: string, args?: RpcArgs) => {
    const payload = args ?? {};
    if (name === "finish_share_generalization_job") return finish(payload);
    if (name === "publish_shared_emergency_recipe") return publish(payload);
    return Promise.reject(new Error(`unexpected rpc ${name}`));
  });
  // 本番 Admin 型との差分はテスト stub として閉じる
  const admin = { rpc, from } as unknown as ProcessShareGeneralizationJobDeps["admin"];
  return { admin, rpc, finish, publish, from };
}

afterEach(() => {
  vi.clearAllMocks();
  loadStoredMenu.mockReset();
  logLines.length = 0;
  delete process.env.SHARE_WORKER_CRON_SECRET;
});

describe("share-generalize-worker auth / schedule", () => {
  it("returns 401 without secret or schedule event", async () => {
    process.env[SHARE_WORKER_CRON_SECRET_ENV] = VALID_SECRET;
    const response = await shareGeneralizeWorker(
      new Request("http://127.0.0.1/.netlify/functions/share-generalize-worker", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(401);
    expect(claimShareGeneralizationJobs).not.toHaveBeenCalled();
  });

  it("accepts Netlify schedule event when env secret is set", async () => {
    process.env[SHARE_WORKER_CRON_SECRET_ENV] = VALID_SECRET;
    claimShareGeneralizationJobs.mockResolvedValue([]);
    const response = await shareGeneralizeWorker(
      new Request("http://127.0.0.1/.netlify/functions/share-generalize-worker", {
        method: "POST",
        headers: { "x-netlify-event": "schedule" },
      }),
    );
    expect(response.status).toBe(204);
    expect(claimShareGeneralizationJobs).toHaveBeenCalledTimes(1);
    // 2×24s OpenRouter が Netlify 60s 壁に収まるよう 1 件 claim
    expect(claimShareGeneralizationJobs).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1 }),
    );
  });

  it("exports schedule-only config without path", () => {
    expect(config).toEqual({ schedule: "@hourly" });
    expect(config).not.toHaveProperty("path");
  });

  it("authorizeShareGeneralizeWorker rejects short secrets", () => {
    expect(
      authorizeShareGeneralizeWorker(authorizedRequest(), {
        [SHARE_WORKER_CRON_SECRET_ENV]: "tooshort",
      }),
    ).toBe("forbidden");
  });

  it("returns 500 and closed failure log when claim throws", async () => {
    process.env[SHARE_WORKER_CRON_SECRET_ENV] = VALID_SECRET;
    claimShareGeneralizationJobs.mockRejectedValue(new Error("share_claim_failed"));
    const response = await shareGeneralizeWorker(authorizedRequest());
    expect(response.status).toBe(500);
    const parsed = JSON.parse(logLines[0]!) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: "error",
      code: "share_generalize_worker_failed",
    });
  });
});

describe("processShareGeneralizationJob pipeline", () => {
  it("skips publish when consent revoked before publish RPC", async () => {
    const source = makeValidatedMenu({ menuId: SOURCE_MENU_ID });
    const { admin, publish, finish, from } = createRpcAdmin({
      publish: () =>
        Promise.resolve({
          data: {
            ok: true,
            published: false,
            reason: "consent_revoked",
            job_id: JOB_ID,
          },
          error: null,
        }),
    });

    await processShareGeneralizationJob(makeClaimedJob(), {
      admin,
      loadSourceMenu: () => Promise.resolve(source),
      sendPass: makePassSender((_pass, menu) => identityPatch(menu)),
      idFactory: createIdFactory(),
      allergenCatalog: buildSharePublishAllergenCatalog(),
    });

    expect(publish).toHaveBeenCalledTimes(1);
    // pool は publish RPC 内のみ。worker が from().insert しない
    expect(from).not.toHaveBeenCalled();
    // RPC が skipped 終端するため finish は呼ばない（二重終端禁止）
    expect(finish).not.toHaveBeenCalled();

    const logs = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logs.some((l) => l.code === "share_generalize_job_skipped")).toBe(true);
    expect(logs.some((l) => l.failure_code === "consent_revoked")).toBe(true);
    expect(logs.some((l) => l.code === "share_generalize_job_succeeded")).toBe(false);
  });

  it("never inserts pool when gate fails", async () => {
    const source = makeValidatedMenu({ menuId: SOURCE_MENU_ID });
    const { admin, publish, finish, from } = createRpcAdmin();

    await processShareGeneralizationJob(makeClaimedJob(), {
      admin,
      loadSourceMenu: () => Promise.resolve(source),
      // Pass 後 denylist ヒット → server_gate_failed
      sendPass: makePassSender((_pass, menu) => denylistPatch(menu)),
      idFactory: createIdFactory(),
      allergenCatalog: buildSharePublishAllergenCatalog(),
    });

    expect(publish).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0]![0]).toMatchObject({
      p_job_id: JOB_ID,
      p_status: "failed",
      p_code: "server_gate_failed",
      p_ai_call_count: 2,
    });

    const logs = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logs.some((l) => l.failure_code === "server_gate_failed")).toBe(true);
  });

  it("payload menuId !== source menu id", async () => {
    const source = makeValidatedMenu({ menuId: SOURCE_MENU_ID });
    const { admin, publish } = createRpcAdmin();

    await processShareGeneralizationJob(makeClaimedJob(), {
      admin,
      loadSourceMenu: () => Promise.resolve(source),
      sendPass: makePassSender((_pass, menu) => identityPatch(menu)),
      idFactory: createIdFactory(),
      allergenCatalog: buildSharePublishAllergenCatalog(),
    });

    expect(publish).toHaveBeenCalledTimes(1);
    const args = publish.mock.calls[0]![0] as {
      p_payload: ValidatedMenu;
      p_job_id: string;
    };
    expect(args.p_payload.menuId).not.toBe(SOURCE_MENU_ID);
    expect(args.p_payload.menuId).not.toBe(source.menuId);
    // dish id も再採番（source 帯と一致しない）
    for (const dish of args.p_payload.dishes) {
      expect(dish.id).not.toBe(source.dishes[0]?.id);
    }
  });

  it("safeLog payload does not include dish titles or prompts", async () => {
    const base = makeValidatedMenu();
    const source = makeValidatedMenu({
      menuId: SOURCE_MENU_ID,
      dishes: base.dishes.map((dish, index) =>
        index === 0 ? { ...dish, name: "肉じゃが特製" } : dish,
      ),
    });
    const { admin } = createRpcAdmin();

    await processShareGeneralizationJob(makeClaimedJob(), {
      admin,
      loadSourceMenu: () => Promise.resolve(source),
      sendPass: makePassSender((_pass, menu) => identityPatch(menu)),
      idFactory: createIdFactory(),
      allergenCatalog: buildSharePublishAllergenCatalog(),
    });

    const joined = logLines.join("\n");
    expect(joined).not.toContain("肉じゃが");
    expect(joined).not.toContain("塩おにぎり");
    expect(joined).not.toContain("共有用レシピ");
    expect(joined).not.toContain("PASS1_SYSTEM");
    expect(joined).not.toContain("prompt");
    // opaque job id は許可フィールドとして出る
    expect(joined).toContain(JOB_ID);
  });

  it("worker entry is not imported from generation-service", () => {
    const generationService = readFileSync(
      resolve(process.cwd(), "netlify/functions/_shared/generation-service.ts"),
      "utf8",
    );
    const genImportSpecifiers = [
      ...generationService.matchAll(/from\s+["']([^"']+)["']/gu),
      ...generationService.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/gu),
    ].map((match) => match[1]!);
    // generate 寿命から worker を起動しない（enqueue のみ）
    expect(genImportSpecifiers.some((s) => s.includes("share-generalize-worker"))).toBe(false);
    expect(generationService).not.toMatch(/share-generalize-worker/u);

    // worker 側も generation-service を import しない（独立 Function）
    const workerSource = readFileSync(
      resolve(process.cwd(), "netlify/functions/share-generalize-worker.ts"),
      "utf8",
    );
    const workerImportSpecifiers = [
      ...workerSource.matchAll(/from\s+["']([^"']+)["']/gu),
      ...workerSource.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/gu),
    ].map((match) => match[1]!);
    expect(workerImportSpecifiers.some((s) => s.includes("generation-service"))).toBe(false);
    expect(workerImportSpecifiers.some((s) => s.includes("share-generalize-pipeline"))).toBe(true);
    expect(workerSource).toMatch(/publish_shared_emergency_recipe/u);
  });

  it("finishes skipped with ineligible_structure when menu missing", async () => {
    const { admin, finish, publish } = createRpcAdmin();
    await processShareGeneralizationJob(makeClaimedJob(), {
      admin,
      loadSourceMenu: () => Promise.resolve(null),
      sendPass: makePassSender((_pass, menu) => identityPatch(menu)),
    });
    expect(publish).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        p_status: "skipped",
        p_code: "ineligible_structure",
        p_ai_call_count: 0,
      }),
    );
  });

  it("publishes with AI call count and succeeds", async () => {
    const source = makeValidatedMenu({ menuId: SOURCE_MENU_ID });
    const { admin, publish, finish } = createRpcAdmin();

    await processShareGeneralizationJob(makeClaimedJob(), {
      admin,
      loadSourceMenu: () => Promise.resolve(source),
      sendPass: makePassSender((_pass, menu) => identityPatch(menu)),
      idFactory: createIdFactory(),
      allergenCatalog: buildSharePublishAllergenCatalog(),
    });

    expect(finish).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        p_job_id: JOB_ID,
        p_ai_call_count: 2,
        p_pass1_model: "share/model-p1",
        p_pass2_model: "share/model-p2",
        p_meal_type: "breakfast",
      }),
    );
    const logs = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logs.some((l) => l.code === "share_generalize_job_succeeded")).toBe(true);
  });

  it("claims jobs and logs count without dish titles on handler path", async () => {
    process.env[SHARE_WORKER_CRON_SECRET_ENV] = VALID_SECRET;
    claimShareGeneralizationJobs.mockResolvedValue([]);

    const response = await shareGeneralizeWorker(authorizedRequest());
    expect(response.status).toBe(204);
    expect(claimShareGeneralizationJobs).toHaveBeenCalledTimes(1);
    expect(claimShareGeneralizationJobs).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1 }),
    );

    const parsed = JSON.parse(logLines[0]!) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: "info",
      request_id: "share-worker",
      code: "share_generalize_worker_claim",
      candidate_count: 0,
    });
    expect(JSON.stringify(parsed)).not.toContain("肉じゃが");
  });
});

describe("defaultLoadSourceMenu failure classification", () => {
  const loadInput = {
    admin: { from: vi.fn() } as unknown as ProcessShareGeneralizationJobDeps["admin"],
    userId: CONTRIBUTOR_ID,
    menuId: SOURCE_MENU_ID,
  };

  it("returns null on 404 menu_not_found so job can skip", async () => {
    loadStoredMenu.mockRejectedValue(
      new HttpError(404, "menu_not_found", "献立が見つかりません"),
    );
    await expect(defaultLoadSourceMenu(loadInput)).resolves.toBeNull();
  });

  it("rethrows 503 menu_load_failed so job stays running for reaper", async () => {
    const transient = new HttpError(503, "menu_load_failed", "献立を読み込めませんでした");
    loadStoredMenu.mockRejectedValue(transient);
    await expect(defaultLoadSourceMenu(loadInput)).rejects.toBe(transient);
  });

  it("rethrows non-HttpError failures without finishing as skip", async () => {
    const boom = new Error("network_blip");
    loadStoredMenu.mockRejectedValue(boom);
    await expect(defaultLoadSourceMenu(loadInput)).rejects.toBe(boom);
  });
});

