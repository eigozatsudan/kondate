// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ValidatedMenu } from "../../../shared/contracts/generation.js";
import { shareConsentVersion } from "../../../shared/contracts/share-consent.js";
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
    // vi.fn を直接差し替え（unknown[] 中継は no-unsafe-return になる）
    loadStoredMenu,
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

/** AP7: claim 直後 consent 再確認用の user_share_consents 行 */
type ConsentRow = {
  consent_version: string;
  revoked_at: string | null;
} | null;

function createConsentFrom(
  row: ConsentRow = {
    consent_version: shareConsentVersion,
    revoked_at: null,
  },
  error: unknown = null,
) {
  const maybeSingle = vi.fn(() => Promise.resolve({ data: row, error }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn((table: string) => {
    if (table !== "user_share_consents") {
      throw new Error(`unexpected from(${table})`);
    }
    return { select };
  });
  return { from, select, eq, maybeSingle };
}

function createRpcAdmin(
  handlers: {
    finish?: (args: RpcArgs) => Promise<{ data: unknown; error: unknown }>;
    publish?: (args: RpcArgs) => Promise<{ data: unknown; error: unknown }>;
    /** 当日 AI 残り枠。省略時は 500（cap 未到達） */
    aiBudgetRemaining?: number;
    /** AP7: 同意行。null で未同意 / revoked 相当 */
    consentRow?: ConsentRow;
    consentError?: unknown;
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
  const budgetRemaining = handlers.aiBudgetRemaining ?? 500;
  const consentFrom = createConsentFrom(
    handlers.consentRow === undefined
      ? { consent_version: shareConsentVersion, revoked_at: null }
      : handlers.consentRow,
    handlers.consentError ?? null,
  );
  const from = consentFrom.from;
  const rpc = vi.fn((name: string, args?: RpcArgs) => {
    const payload = args ?? {};
    if (name === "finish_share_generalization_job") return finish(payload);
    if (name === "publish_shared_emergency_recipe") return publish(payload);
    if (name === "share_app_ai_budget_remaining") {
      return Promise.resolve({ data: budgetRemaining, error: null });
    }
    return Promise.reject(new Error(`unexpected rpc ${name}`));
  });
  // 本番 Admin 型との差分はテスト stub として閉じる
  const admin = { rpc, from } as unknown as ProcessShareGeneralizationJobDeps["admin"];
  return { admin, rpc, finish, publish, from, consentFrom };
}

afterEach(() => {
  vi.clearAllMocks();
  loadStoredMenu.mockReset();
  logLines.length = 0;
  delete process.env.SHARE_WORKER_CRON_SECRET;
});

describe("share-generalize-worker auth / path", () => {
  it("returns 401 without secret (env 有無をオラクルにしない)", async () => {
    process.env[SHARE_WORKER_CRON_SECRET_ENV] = VALID_SECRET;
    const response = await shareGeneralizeWorker(
      new Request("http://127.0.0.1/.netlify/functions/share-generalize-worker", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(401);
    expect(claimShareGeneralizationJobs).not.toHaveBeenCalled();
  });

  it("returns 405 for non-POST before auth", async () => {
    process.env[SHARE_WORKER_CRON_SECRET_ENV] = VALID_SECRET;
    const response = await shareGeneralizeWorker(
      new Request("http://127.0.0.1/api/share-generalize-worker", {
        method: "GET",
        headers: { [SHARE_WORKER_CRON_SECRET_HEADER]: VALID_SECRET },
      }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(claimShareGeneralizationJobs).not.toHaveBeenCalled();
  });

  it("rejects Netlify schedule event without secret (fail-closed)", async () => {
    process.env[SHARE_WORKER_CRON_SECRET_ENV] = VALID_SECRET;
    const response = await shareGeneralizeWorker(
      new Request("http://127.0.0.1/.netlify/functions/share-generalize-worker", {
        method: "POST",
        headers: { "x-netlify-event": "schedule" },
      }),
    );
    expect(response.status).toBe(401);
    expect(claimShareGeneralizationJobs).not.toHaveBeenCalled();
  });

  it("accepts POST when Bearer secret matches", async () => {
    process.env[SHARE_WORKER_CRON_SECRET_ENV] = VALID_SECRET;
    claimShareGeneralizationJobs.mockResolvedValue([]);
    const response = await shareGeneralizeWorker(
      new Request("http://127.0.0.1/api/share-generalize-worker", {
        method: "POST",
        headers: {
          authorization: `Bearer ${VALID_SECRET}`,
        },
      }),
    );
    expect(response.status).toBe(204);
    expect(claimShareGeneralizationJobs).toHaveBeenCalledTimes(1);
    // 2×24s OpenRouter が Netlify 60s 壁に収まるよう 1 件 claim
    expect(claimShareGeneralizationJobs).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1 }),
    );
  });

  it("exports path+POST config without schedule (maintenance 同型)", () => {
    expect(config).toEqual({ path: "/api/share-generalize-worker", method: "POST" });
    expect(config).not.toHaveProperty("schedule");
  });

  it("authorizeShareGeneralizeWorker rejects short secrets", () => {
    expect(
      authorizeShareGeneralizeWorker(authorizedRequest(), {
        [SHARE_WORKER_CRON_SECRET_ENV]: "tooshort",
      }),
    ).toBe("forbidden");
  });

  it("authorizeShareGeneralizeWorker rejects schedule-only without presented secret", () => {
    expect(
      authorizeShareGeneralizeWorker(
        new Request("http://127.0.0.1/.netlify/functions/share-generalize-worker", {
          method: "POST",
          headers: { "x-netlify-event": "schedule" },
        }),
        { [SHARE_WORKER_CRON_SECRET_ENV]: VALID_SECRET },
      ),
    ).toBe("unauthorized");
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
  it("AP7: skips before AI when consent revoked after claim", async () => {
    const source = makeValidatedMenu({ menuId: SOURCE_MENU_ID });
    const sendPass = vi.fn(
      makePassSender((_pass, menu) => identityPatch(menu)),
    ) as ProcessShareGeneralizationJobDeps["sendPass"];
    const { admin, publish, finish, from } = createRpcAdmin({
      consentRow: {
        consent_version: shareConsentVersion,
        revoked_at: "2026-08-01T12:00:00.000Z",
      },
    });

    await processShareGeneralizationJob(makeClaimedJob(), {
      admin,
      loadSourceMenu: () => Promise.resolve(source),
      sendPass,
      idFactory: createIdFactory(),
      allergenCatalog: buildSharePublishAllergenCatalog(),
    });

    // revoke 後は Pass も publish も走らない（AI 台帳を消費しない）
    expect(sendPass).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith("user_share_consents");
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        p_status: "skipped",
        p_code: "consent_revoked",
        p_ai_call_count: 0,
      }),
    );
  });

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
    // AP7: consent 再確認で from は読む。pool insert はしない
    expect(from).toHaveBeenCalledWith("user_share_consents");
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
    // pool insert はしない（consent 再確認の select のみ）
    expect(from).toHaveBeenCalledWith("user_share_consents");
    expect(from).toHaveBeenCalledTimes(1);
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

  it("classifies publish RPC failure as server_gate_failed not openrouter_failed", async () => {
    const source = makeValidatedMenu({ menuId: SOURCE_MENU_ID });
    const { admin, finish, publish } = createRpcAdmin({
      publish: () =>
        Promise.resolve({
          data: null,
          error: { message: "share_publish_failed" },
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
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        p_status: "failed",
        p_code: "server_gate_failed",
        p_ai_call_count: 2,
      }),
    );
    const logs = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logs.some((l) => l.failure_code === "server_gate_failed")).toBe(true);
    expect(logs.some((l) => l.failure_code === "openrouter_failed")).toBe(false);
  });

  it("PE4: finishes with known aiCallCount when load throws after no AI", async () => {
    const { admin, finish, publish } = createRpcAdmin();
    const loadBoom = new HttpError(503, "menu_load_failed", "献立を読み込めませんでした");

    await processShareGeneralizationJob(makeClaimedJob(), {
      admin,
      loadSourceMenu: () => Promise.reject(loadBoom),
      sendPass: makePassSender((_pass, menu) => identityPatch(menu)),
    });

    expect(publish).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        p_status: "failed",
        p_code: "server_gate_failed",
        p_ai_call_count: 0,
      }),
    );
  });

  it("PE4: finishes with aiCallCount after Pass when post-AI path throws", async () => {
    const source = makeValidatedMenu({ menuId: SOURCE_MENU_ID });
    const { admin, finish, publish, rpc } = createRpcAdmin();
    // Pass 成功後に publish へ入る前に budget は済んでいる。publish を throw させ finish 経路を検証。
    // 既に createRpcAdmin の publish error 経路があるので、gate 後 metadata を壊す代わりに
    // rpc が publish 名で reject する（error object ではなく例外）。
    rpc.mockImplementation((name: string, args?: RpcArgs) => {
      const payload = args ?? {};
      if (name === "share_app_ai_budget_remaining") {
        return Promise.resolve({ data: 500, error: null });
      }
      if (name === "publish_shared_emergency_recipe") {
        return Promise.reject(new Error("publish_network_blip"));
      }
      if (name === "finish_share_generalization_job") {
        return finish(payload);
      }
      return Promise.reject(new Error(`unexpected rpc ${name}`));
    });

    await processShareGeneralizationJob(makeClaimedJob(), {
      admin,
      loadSourceMenu: () => Promise.resolve(source),
      sendPass: makePassSender((_pass, menu) => identityPatch(menu)),
      idFactory: createIdFactory(),
      allergenCatalog: buildSharePublishAllergenCatalog(),
    });

    expect(publish).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        p_status: "failed",
        p_code: "server_gate_failed",
        p_ai_call_count: 2,
      }),
    );
  });

  it("PE4: rethrows share_job_unfinished when finish RPC fails after AI", async () => {
    const source = makeValidatedMenu({ menuId: SOURCE_MENU_ID });
    const finishCalls: RpcArgs[] = [];
    const admin = {
      rpc: vi.fn((name: string, args?: RpcArgs) => {
        const payload = args ?? {};
        if (name === "share_app_ai_budget_remaining") {
          return Promise.resolve({ data: 500, error: null });
        }
        if (name === "publish_shared_emergency_recipe") {
          return Promise.resolve({
            data: null,
            error: { message: "share_publish_failed" },
          });
        }
        if (name === "finish_share_generalization_job") {
          finishCalls.push(payload);
          // process 内 finish は常に失敗 → PE4 rethrow で outer に委ねる
          return Promise.resolve({ data: { ok: false, reason: "db_down" }, error: null });
        }
        return Promise.reject(new Error(`unexpected rpc ${name}`));
      }),
      from: createConsentFrom().from,
    } as unknown as ProcessShareGeneralizationJobDeps["admin"];

    await expect(
      processShareGeneralizationJob(makeClaimedJob(), {
        admin,
        loadSourceMenu: () => Promise.resolve(source),
        sendPass: makePassSender((_pass, menu) => identityPatch(menu)),
        idFactory: createIdFactory(),
        allergenCatalog: buildSharePublishAllergenCatalog(),
      }),
    ).rejects.toThrow(/share_job_unfinished/);

    expect(finishCalls.length).toBe(1);
    expect(finishCalls[0]).toMatchObject({
      p_status: "failed",
      p_code: "server_gate_failed",
      p_ai_call_count: 2,
    });
  });

  it("PE4: handler outer finish uses max aiCallCount 2 when process rethrows unfinished", async () => {
    process.env[SHARE_WORKER_CRON_SECRET_ENV] = VALID_SECRET;
    const finishCalls: RpcArgs[] = [];
    let finishAttempt = 0;
    // mockReturnValue は vi.fn の戻り形を要求するため admin 型を ProcessDeps に寄せない
    const admin = {
      rpc: vi.fn((name: string, args?: RpcArgs) => {
        const payload = args ?? {};
        if (name === "share_app_ai_budget_remaining") {
          return Promise.resolve({ data: 500, error: null });
        }
        if (name === "finish_share_generalization_job") {
          finishAttempt += 1;
          finishCalls.push(payload);
          if (finishAttempt === 1) {
            // process 内 finish 失敗 → rethrow
            return Promise.resolve({ data: { ok: false, reason: "db_down" }, error: null });
          }
          // handler outer の保守 finish は成功
          return Promise.resolve({ data: { ok: true, status: "failed" }, error: null });
        }
        return Promise.reject(new Error(`unexpected rpc ${name}`));
      }),
      from: createConsentFrom().from,
    };

    claimShareGeneralizationJobs.mockResolvedValue([makeClaimedJob()]);
    getSupabaseAdmin.mockReturnValue(admin);
    // Pass 前の load 503 → process catch が finish(ai=0) → 失敗 → outer finish(ai=2)
    loadStoredMenu.mockRejectedValue(
      new HttpError(503, "menu_load_failed", "献立を読み込めませんでした"),
    );

    const response = await shareGeneralizeWorker(authorizedRequest());
    expect(response.status).toBe(204);
    expect(finishCalls.length).toBe(2);
    expect(finishCalls[0]).toMatchObject({
      p_status: "failed",
      p_code: "server_gate_failed",
      p_ai_call_count: 0,
    });
    expect(finishCalls[1]).toMatchObject({
      p_status: "failed",
      p_code: "server_gate_failed",
      p_ai_call_count: 2,
    });
  });

  it("skips with app_ai_cap before OpenRouter when budget remaining is 0", async () => {
    const source = makeValidatedMenu({ menuId: SOURCE_MENU_ID });
    const sendPass = vi.fn(makePassSender((_pass, menu) => identityPatch(menu)));
    const { admin, finish, publish } = createRpcAdmin({ aiBudgetRemaining: 0 });

    await processShareGeneralizationJob(makeClaimedJob(), {
      admin,
      loadSourceMenu: () => Promise.resolve(source),
      sendPass,
      idFactory: createIdFactory(),
      allergenCatalog: buildSharePublishAllergenCatalog(),
    });

    expect(sendPass).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        p_status: "skipped",
        p_code: "app_ai_cap",
        p_ai_call_count: 0,
      }),
    );
  });

  it("skips with denylist_precheck before OpenRouter when canonical hits PII denylist", async () => {
    const base = makeValidatedMenu({ menuId: SOURCE_MENU_ID });
    const source = makeValidatedMenu({
      menuId: SOURCE_MENU_ID,
      dishes: base.dishes.map((dish, index) =>
        index === 0
          ? {
              ...dish,
              ingredients: dish.ingredients.map((ingredient, ingredientIndex) =>
                ingredientIndex === 0
                  ? { ...ingredient, name: "うちの冷蔵庫の残りもの" }
                  : ingredient,
              ),
            }
          : dish,
      ),
    });
    const sendPass = vi.fn(makePassSender((_pass, menu) => identityPatch(menu)));
    const { admin, finish, publish } = createRpcAdmin();

    await processShareGeneralizationJob(makeClaimedJob(), {
      admin,
      loadSourceMenu: () => Promise.resolve(source),
      sendPass,
      idFactory: createIdFactory(),
      allergenCatalog: buildSharePublishAllergenCatalog(),
    });

    expect(sendPass).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        p_status: "skipped",
        p_code: "denylist_precheck",
        p_ai_call_count: 0,
      }),
    );
  });

  it("publishes allergen union of pre and post Pass ingredient names", async () => {
    const base = makeValidatedMenu({ menuId: SOURCE_MENU_ID });
    // pre: 卵 / post Pass で材料名を鶏卵に一般化しても egg を落とさない（和集合）
    const source = makeValidatedMenu({
      menuId: SOURCE_MENU_ID,
      dishes: base.dishes.map((dish, index) =>
        index === 0
          ? {
              ...dish,
              ingredients: dish.ingredients.map((ingredient, ingredientIndex) =>
                ingredientIndex === 0 ? { ...ingredient, name: "卵" } : ingredient,
              ),
            }
          : dish,
      ),
    });
    const { admin, publish } = createRpcAdmin();

    await processShareGeneralizationJob(makeClaimedJob(), {
      admin,
      loadSourceMenu: () => Promise.resolve(source),
      sendPass: makePassSender((pass, menu) => {
        const patch = identityPatch(menu);
        if (pass !== "pass1") return patch;
        return {
          ...patch,
          dishes: patch.dishes.map((dish, index) =>
            index === 0
              ? {
                  ...dish,
                  ingredients: dish.ingredients.map((ingredient, ingredientIndex) =>
                    ingredientIndex === 0 ? { ...ingredient, name: "鶏卵" } : ingredient,
                  ),
                }
              : dish,
          ),
        };
      }),
      idFactory: createIdFactory(),
      allergenCatalog: buildSharePublishAllergenCatalog(),
    });

    expect(publish).toHaveBeenCalledTimes(1);
    const args = publish.mock.calls[0]![0] as {
      p_standard_allergen_ids: string[];
    };
    expect(args.p_standard_allergen_ids).toContain("egg");
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
    loadStoredMenu.mockRejectedValue(new HttpError(404, "menu_not_found", "献立が見つかりません"));
    await expect(defaultLoadSourceMenu(loadInput)).resolves.toBeNull();
  });

  it("rethrows 503 menu_load_failed for process to finish (PE4)", async () => {
    // loader 自体は throw。process が finish(server_gate_failed, ai=0) する（running 残留しない）
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
