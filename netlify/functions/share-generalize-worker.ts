/**
 * 共有一般化 worker（Task 7d: claim → load → canonical → Pass1/2 → gate → publish）。
 * generate-menu / generation-service の同期寿命には載せない。
 * 公開 path + アプリ層 secret 認証のみ（Netlify の schedule 経路は使わない）。
 * 定期実行は secret 付き HTTP（GitHub Actions 等）から POST する。
 * ログは閉じた code / jobId / failureCode / 件数のみ。タイトル・プロンプト・payload 禁止。
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { OPENROUTER_TIMEOUT_MS } from "../../shared/contracts/function-budget.js";
import type { ValidatedMenu } from "../../shared/contracts/generation.js";
import {
  shareFailureCodes,
  shareSkipReasons,
  type ShareFailureCode,
  type ShareSkipReason,
} from "../../shared/contracts/share-job.js";
import { buildShareCanonicalMenu } from "../../shared/emergency/share-canonical.js";
import {
  computeSharePublishMetadata,
  mergeSharePublishMetadata,
  type SharePublishAllergenCatalog,
} from "../../shared/emergency/share-publish-metadata.js";
import { currentAllergenCatalogV1 } from "../../shared/safety/current-allergen-catalog.v1.js";
import { currentAllergenAliasManifest } from "./_shared/current-safety.js";
import { safeLog } from "./_shared/logger.js";
import { claimShareGeneralizationJobs, type ShareClaimedJob } from "./_shared/share-claim.js";
import {
  runShareGeneralizeAiPipeline,
  type SharePassSender,
} from "./_shared/share-generalize-pipeline.js";
import { sendShareGeneralizationPassFromEnv } from "./_shared/share-openrouter.js";
import {
  captureShareIngredientGraphLock,
  menuHitsShareDenylist,
  runShareServerGate,
} from "./_shared/share-server-gate.js";
import { HttpError } from "./_shared/http.js";
import { loadStoredMenu } from "./_shared/stored-menu-loader.js";
import { getSupabaseAdmin, type AdminSupabaseClient } from "./_shared/supabase-admin.js";

/** 共有 worker secret の env 名（local .env / 本番 Netlify secret）。 */
export const SHARE_WORKER_CRON_SECRET_ENV = "SHARE_WORKER_CRON_SECRET";

/** 手動・local invoke 用ヘッダ。 */
export const SHARE_WORKER_CRON_SECRET_HEADER = "x-share-worker-cron-secret";

const MIN_SECRET_LENGTH = 16;

const REQUEST_ID = "share-worker";

/** Functions 現行辞書（catalog + aliases）を publish metadata 用に閉じる */
export function buildSharePublishAllergenCatalog(): SharePublishAllergenCatalog {
  return {
    catalog: currentAllergenCatalogV1.map((entry) => ({
      id: entry.id,
      displayName: entry.displayName,
    })),
    aliases: currentAllergenAliasManifest.map((entry) => ({
      allergenId: entry.allergenId,
      alias: entry.alias,
      normalizedAlias: entry.normalizedAlias,
    })),
  };
}

const finishJobResultSchema = z.looseObject({
  ok: z.boolean(),
  reason: z.string().optional(),
  status: z.string().optional(),
  job_id: z.string().optional(),
  code: z.string().optional(),
});

const publishJobResultSchema = z.looseObject({
  ok: z.boolean(),
  published: z.boolean().optional(),
  reason: z.string().optional(),
  job_id: z.string().optional(),
  recipe_id: z.string().optional(),
});

function secretsEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

function bearerToken(authorization: string | null): string | null {
  if (authorization === null) return null;
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * アプリ層認可（maintenance-cleanup と同型）:
 * - 提示 secret が無い（両ヘッダ空）→ 常に 401（env 有無をオラクルにしない）
 * - 提示あり + env 未設定/短すぎ → 403 fail-closed
 * - 提示あり + env あり → カスタムヘッダと Bearer の**いずれか**が一致すれば OK
 *   （片方誤りでも他方が正しければ通す。空文字ヘッダは「未提示」扱い）
 * - 提示あり + どちらも不一致 → 403
 * - x-netlify-event: schedule 単独は不可（Netlify schedule は使わない）
 */
export function authorizeShareGeneralizeWorker(
  request: Request,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): "ok" | "unauthorized" | "forbidden" {
  const customRaw = request.headers.get(SHARE_WORKER_CRON_SECRET_HEADER);
  const customSecret =
    customRaw === null ? null : customRaw.trim().length > 0 ? customRaw.trim() : null;
  const bearerSecret = bearerToken(request.headers.get("authorization"));

  if (customSecret === null && bearerSecret === null) {
    return "unauthorized";
  }

  const expected = (env[SHARE_WORKER_CRON_SECRET_ENV] ?? "").trim();
  if (expected.length < MIN_SECRET_LENGTH) {
    return "forbidden";
  }

  if (customSecret !== null && secretsEqual(customSecret, expected)) {
    return "ok";
  }
  if (bearerSecret !== null && secretsEqual(bearerSecret, expected)) {
    return "ok";
  }
  return "forbidden";
}

function authDeniedResponse(
  kind: "unauthorized" | "forbidden",
  started: number,
  requestId: string,
): Response {
  const code =
    kind === "unauthorized"
      ? "share_generalize_worker_unauthorized"
      : "share_generalize_worker_forbidden";
  safeLog({
    level: "warn",
    requestId,
    code,
    durationMs: Math.round(performance.now() - started),
  });
  return new Response(null, { status: kind === "unauthorized" ? 401 : 403 });
}

/** job 1 件処理の依存（テスト注入用）。本番は default 組み立て。 */
export type ProcessShareGeneralizationJobDeps = {
  admin: Pick<AdminSupabaseClient, "rpc" | "from">;
  /** source menu を ValidatedMenu へ。欠損は null（skipped）。 */
  loadSourceMenu: (input: {
    admin: Pick<AdminSupabaseClient, "from">;
    userId: string;
    menuId: string;
  }) => Promise<ValidatedMenu | null>;
  sendPass: SharePassSender;
  /** カノニカル再採番。省略時は randomUUID */
  idFactory?: () => string;
  /** publish metadata 用アレルゲン辞書。省略時は Functions 現行フル */
  allergenCatalog?: SharePublishAllergenCatalog;
};

/**
 * service_role で所有者境界をクエリする。
 * 欠損（404 menu_not_found）のみ null → skipped。
 * 503 / 一過性障害は throw。process 側が finish(server_gate_failed, ai=0) し、
 * finish 失敗時のみ running 残留 → handler outer / reaper が回収する（PE4）。
 */
export async function defaultLoadSourceMenu(input: {
  admin: Pick<AdminSupabaseClient, "from">;
  userId: string;
  menuId: string;
}): Promise<ValidatedMenu | null> {
  try {
    const aggregate = await loadStoredMenu(
      input.admin as AdminSupabaseClient,
      input.userId,
      input.menuId,
    );
    return aggregate.menu;
  } catch (error) {
    // 404 欠損だけ skip。それ以外（503 menu_load_failed 等）は再 throw
    if (error instanceof HttpError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/** 本番 Pass 送信（OpenRouter env）。テストでは sendPass を差し替える。 */
export function defaultSharePassSender(): SharePassSender {
  return async ({ pass, menu }) =>
    sendShareGeneralizationPassFromEnv({
      pass,
      menu,
      timeoutMs: OPENROUTER_TIMEOUT_MS,
    });
}

async function finishShareJob(input: {
  admin: Pick<AdminSupabaseClient, "rpc">;
  jobId: string;
  status: "failed" | "skipped";
  code: ShareFailureCode | ShareSkipReason;
  aiCallCount: number;
  pass1Model: string | null;
  pass2Model: string | null;
}): Promise<void> {
  const { error, data } = await input.admin.rpc("finish_share_generalization_job", {
    p_job_id: input.jobId,
    p_status: input.status,
    p_code: input.code,
    p_ai_call_count: input.aiCallCount,
    ...(input.pass1Model !== null ? { p_pass1_model: input.pass1Model } : {}),
    ...(input.pass2Model !== null ? { p_pass2_model: input.pass2Model } : {}),
  });
  if (error) {
    throw new Error("share_finish_failed");
  }
  const parsed = finishJobResultSchema.safeParse(data);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error("share_finish_failed");
  }
}

/**
 * claim 済み 1 job を固定パイプラインで処理する。
 * 1 claim → 2 load → 3 eligibility/canonical → 4 Pass1/2 → 5 gate → 6 metadata → 7 publish → 8 finish/台帳
 * publish RPC は success / consent_revoked / daily_success_cap で job を終端する。
 * それ以外の skip/fail は finish_share_generalization_job で AI call 台帳を計上する。
 *
 * PE4: 未捕捉例外で finish を呼ばず running 残留すると reaper の lease_expired が
 * p_ai_call_count 無しで台帳 undercount（fail-open）になる。process 内 try/catch で
 * 既知 aiCallCount 付き finish を必ず試み、finish 失敗時のみ handler outer へ再 throw する。
 */
export async function processShareGeneralizationJob(
  job: ShareClaimedJob,
  deps: ProcessShareGeneralizationJobDeps,
): Promise<void> {
  const jobStarted = performance.now();
  let aiCallCount = 0;
  let pass1Model: string | null = null;
  let pass2Model: string | null = null;
  // publish / finish で job が終端済みなら outer の二重 finish を避ける
  let jobTerminal = false;
  // finish RPC を試みたが失敗した（running 残留）。再 throw して handler outer に委ねる
  let finishAttempted = false;

  const logTerminal = (input: {
    level: "info" | "warn" | "error";
    code: string;
    failureCode?: string;
  }): void => {
    safeLog({
      level: input.level,
      requestId: REQUEST_ID,
      code: input.code,
      durationMs: Math.round(performance.now() - jobStarted),
      jobId: job.id,
      ...(input.failureCode !== undefined ? { failureCode: input.failureCode } : {}),
    });
  };

  const finish = async (
    status: "failed" | "skipped",
    code: ShareFailureCode | ShareSkipReason,
  ): Promise<void> => {
    finishAttempted = true;
    await finishShareJob({
      admin: deps.admin,
      jobId: job.id,
      status,
      code,
      aiCallCount,
      pass1Model,
      pass2Model,
    });
    jobTerminal = true;
    logTerminal({
      level: status === "failed" ? "error" : "info",
      code: status === "failed" ? "share_generalize_job_failed" : "share_generalize_job_skipped",
      failureCode: code,
    });
  };

  try {
    // --- 2. load source menu ---
    if (job.source_menu_id === null || job.contributor_user_id === null) {
      await finish("skipped", "ineligible_structure");
      return;
    }
    const sourceMenuId = job.source_menu_id;
    const sourceMenu = await deps.loadSourceMenu({
      admin: deps.admin,
      userId: job.contributor_user_id,
      menuId: sourceMenuId,
    });
    if (sourceMenu === null) {
      await finish("skipped", "ineligible_structure");
      return;
    }

    // --- 3. eligibility + canonical（構造。全 UUID 再採番） ---
    const idFactory = deps.idFactory ?? randomUUID;
    const canonical = buildShareCanonicalMenu(sourceMenu, idFactory);
    if (!canonical.ok) {
      await finish("skipped", canonical.reason);
      return;
    }
    // プール payload の menuId は source と一致させない（§9.5 / RED）
    if (canonical.menu.menuId === sourceMenuId) {
      await finish("failed", "server_gate_failed");
      return;
    }

    // --- 3b. Pass 前 AI 枠（0 なら OpenRouter を叩かず skip） ---
    {
      const { error: budgetError, data: budgetData } = await deps.admin.rpc(
        "share_app_ai_budget_remaining",
      );
      if (budgetError) {
        throw new Error("share_ai_budget_check_failed");
      }
      const remaining =
        typeof budgetData === "number" && Number.isFinite(budgetData) ? budgetData : 0;
      if (remaining <= 0) {
        await finish("skipped", "app_ai_cap");
        return;
      }
    }

    // --- 3c. Pass 前 denylist（ソース残渣を AI に送らない） ---
    if (menuHitsShareDenylist(canonical.menu)) {
      await finish("skipped", "denylist_precheck");
      return;
    }

    const lockedGraph = captureShareIngredientGraphLock(canonical.menu);
    const catalog = deps.allergenCatalog ?? buildSharePublishAllergenCatalog();
    // pre-Pass 材料名由来の metadata（publish 時に post と和集合 / 積集合）
    const metaPre = computeSharePublishMetadata(canonical.menu, catalog);

    // --- 4. Pass1 → Pass2（AI 台帳は injectable。generate 予約には非接触） ---
    // publish はゲート後に実 RPC するため、ここでは no-op でメニューだけ確定させる。
    const aiResult = await runShareGeneralizeAiPipeline({
      menu: canonical.menu,
      lockedGraph,
      sendPass: deps.sendPass,
      recordAiCallLedger: (delta) => {
        aiCallCount += delta;
      },
      publish: async () => {
        // Task 7d: 実 publish は gate + metadata の後
      },
    });
    aiCallCount = aiResult.aiCallCount;
    pass1Model = aiResult.pass1Model;
    pass2Model = aiResult.pass2Model;

    if (!aiResult.ok) {
      await finish("failed", aiResult.code);
      return;
    }

    // --- 5. server gate（Zod + グラフロック + denylist） ---
    const gate = runShareServerGate(aiResult.menu, lockedGraph);
    if (!gate.ok) {
      await finish("failed", gate.code);
      return;
    }

    // --- 6. publish metadata（pre∪post allergen / pre∩post age。空帯は禁止） ---
    const metaPost = computeSharePublishMetadata(aiResult.menu, catalog);
    const metadata = mergeSharePublishMetadata(metaPre, metaPost, catalog);
    if (metadata.eligibleAgeBands.length < 1) {
      await finish("failed", "server_gate_failed");
      return;
    }

    // 防御: 一般化後も source menuId を payload に載せない
    if (aiResult.menu.menuId === sourceMenuId) {
      await finish("failed", "server_gate_failed");
      return;
    }

    // --- 7. publish RPC（同一 TX で consent 再確認 + pool INSERT + AI 台帳） ---
    // AI 成功後の失敗は openrouter_failed にしない（関門/台帳側。メトリクス誤分類防止）
    let publishData: unknown;
    try {
      const result = await deps.admin.rpc("publish_shared_emergency_recipe", {
        p_job_id: job.id,
        p_payload: aiResult.menu,
        p_meal_type: aiResult.menu.mealType,
        p_total_elapsed: aiResult.menu.totalElapsedMinutes,
        p_standard_allergen_ids: metadata.standardAllergenIds,
        p_eligible_age_bands: [...metadata.eligibleAgeBands],
        p_ai_call_count: aiCallCount,
        ...(pass1Model !== null ? { p_pass1_model: pass1Model } : {}),
        ...(pass2Model !== null ? { p_pass2_model: pass2Model } : {}),
      });
      if (result.error) {
        throw new Error("share_publish_failed");
      }
      publishData = result.data;
    } catch {
      // RPC 例外時は job が running のまま残る可能性があるため finish を試みる。
      // finish 失敗は process 外 catch へ再 throw（PE4 undercount 防衛）。
      await finish("failed", "server_gate_failed");
      return;
    }

    const published = publishJobResultSchema.safeParse(publishData);
    if (!published.success || !published.data.ok) {
      await finish("failed", "server_gate_failed");
      return;
    }

    if (published.data.published) {
      // publish RPC が success + AI 台帳を同一 TX で終端済み
      jobTerminal = true;
      logTerminal({
        level: "info",
        code: "share_generalize_job_succeeded",
      });
      return;
    }

    // publish RPC 内で skipped（consent_revoked / daily_success_cap）。二重 finish しない。
    // AI 台帳も publish RPC 内で計上済み。
    jobTerminal = true;
    const reason = published.data.reason;
    const skipReason =
      reason !== undefined && (shareSkipReasons as readonly string[]).includes(reason)
        ? reason
        : reason !== undefined && (shareFailureCodes as readonly string[]).includes(reason)
          ? reason
          : "consent_revoked";
    logTerminal({
      level: "info",
      code: "share_generalize_job_skipped",
      failureCode: skipReason,
    });
  } catch {
    // PE4: 未終端例外は既知 aiCallCount で finish し、日次 AI 台帳 undercount を防ぐ
    if (jobTerminal) {
      return;
    }
    if (!finishAttempted) {
      try {
        await finish("failed", "server_gate_failed");
        return;
      } catch {
        logTerminal({
          level: "error",
          code: "share_generalize_job_failed",
          failureCode: "server_gate_failed",
        });
        // finish 失敗 → running 残留。handler outer が保守 finish を再試行する
        throw new Error("share_job_unfinished");
      }
    }
    // finish 済み試行が失敗してここに来た場合も outer へ
    throw new Error("share_job_unfinished");
  }
}

export default async function shareGeneralizeWorker(request?: Request): Promise<Response> {
  const started = performance.now();
  const requestId = REQUEST_ID;
  // functions:invoke / テスト互換で省略時は空 Request。
  const req = request ?? new Request("http://127.0.0.1/.netlify/functions/share-generalize-worker");

  // 運用 cron は POST のみ（誤キャッシュ・プリフェッチを避ける）。secret 検査前に閉じる。
  if (req.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  }

  const auth = authorizeShareGeneralizeWorker(req);
  if (auth !== "ok") {
    return authDeniedResponse(auth, started, requestId);
  }

  try {
    const admin = getSupabaseAdmin();
    // 1 job = Pass1+Pass2 各 OPENROUTER_TIMEOUT(24s)。2 件 claim すると 2×48s で Netlify 60s 壁を超える
    const jobs = await claimShareGeneralizationJobs({ admin, limit: 1 });
    safeLog({
      level: "info",
      requestId,
      code: "share_generalize_worker_claim",
      durationMs: Math.round(performance.now() - started),
      candidateCount: jobs.length,
    });

    const sendPass = defaultSharePassSender();
    for (const job of jobs) {
      try {
        await processShareGeneralizationJob(job, {
          admin,
          loadSourceMenu: defaultLoadSourceMenu,
          sendPass,
        });
      } catch {
        // PE4: process が finish 失敗で rethrow した場合の最終防衛。
        // process 内の正確な aiCallCount は失われているため Pass 上限 2 を保守計上（fail-closed）。
        // 既に終端済み job への finish は not_running で no-op 相当（AI 二重加算なし）。
        // 1 job の例外でバッチ全体を落とさない。ここでも finish 失敗時のみ reaper が回収する。
        try {
          await finishShareJob({
            admin,
            jobId: job.id,
            status: "failed",
            code: "server_gate_failed",
            aiCallCount: 2,
            pass1Model: null,
            pass2Model: null,
          });
        } catch {
          // finish も失敗 → running 残留。reaper が lease_expired + 保守 AI 計上する
        }
        safeLog({
          level: "error",
          requestId,
          code: "share_generalize_job_failed",
          durationMs: Math.round(performance.now() - started),
          jobId: job.id,
          failureCode: "server_gate_failed",
        });
      }
    }

    return new Response(null, { status: 204 });
  } catch {
    safeLog({
      level: "error",
      requestId,
      code: "share_generalize_worker_failed",
      durationMs: Math.round(performance.now() - started),
    });
    return new Response(null, { status: 500 });
  }
}

/** HTTP path のみ。定期起動は secret 付き外部 cron（GitHub Actions 等）。 */
export const config: Config = {
  path: "/api/share-generalize-worker",
  method: "POST",
};
