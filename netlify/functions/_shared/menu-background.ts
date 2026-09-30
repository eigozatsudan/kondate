import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  MENU_BACKGROUND_TOTAL_BUDGET_MS,
  MENU_BACKGROUND_ATTEMPT_TIMEOUT_MS,
  MENU_BACKGROUND_HARD_DEADLINE_MS,
} from "../../../shared/contracts/function-budget.js";
import type { AuthenticatedUserWithEmail } from "./generation-repository.js";
import { createGenerationDeps, runGeneration } from "./generation-service.js";
import { getSupabaseAdmin } from "./supabase-admin.js";
import { getServerEnv } from "./env.js";
import type { MenuGenerationCommand } from "./menu-generation-command.js";
import { createOpenRouterGenerationSender, awaitWithAbort } from "./openrouter.js";
import { runWithOpenRouterMockScenario } from "./openrouter-mock-scenario.js";
import { runWithRequestDeadline } from "./request-deadline.js";
import { logGenerationEvent } from "./logger.js";
import {
  MENU_BACKGROUND_PATH,
  menuBackgroundSignatureHeaders,
} from "./menu-background-signature.js";

const registrationSchema = z.object({ token: z.uuid().nullable(), claimed: z.boolean() }).strict();

/** 受付の壁時計を単調時計へ写し、キュー遅延を新しい予算として与えない。 */
export function backgroundStartMonotonic(
  startedAt: string,
  wallNow: number,
  monotonicNow: number,
): number | null {
  const acceptedAt = Date.parse(startedAt);
  const elapsed = wallNow - acceptedAt;
  if (!Number.isFinite(acceptedAt) || elapsed < 0 || elapsed >= MENU_BACKGROUND_TOTAL_BUDGET_MS)
    return null;
  return monotonicNow - elapsed;
}

/** token は内部 dispatch だけへ渡し、status の DTO やログには含めない。 */
export async function dispatchMenuGeneration(
  user: AuthenticatedUserWithEmail,
  command: MenuGenerationCommand,
  requestId: string,
  scenario?: string,
): Promise<void> {
  const env = getServerEnv();
  const { data, error } = await getSupabaseAdmin().rpc("register_menu_background_dispatch", {
    p_user_id: user.userId,
    p_request_id: requestId,
    p_token: randomUUID(),
  });
  if (error !== null) throw error;
  const registration = registrationSchema.parse(data);
  if (registration.claimed || registration.token === null) return;
  const body = JSON.stringify({ token: registration.token, command });
  const authorization = `Bearer ${user.accessToken}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization,
    ...menuBackgroundSignatureHeaders(env.generationIntegrity.requestHmacKey, authorization, body),
  };
  if (scenario !== undefined) headers["x-kondate-mock-scenario"] = scenario;
  try {
    // 応答本文を読まない。Netlify は実行と独立して空の 202 を返す。
    // ローカルも同じ HTTP worker 経路を使い、受信 Host を信頼先へ流用しない。
    const dispatchSignal = AbortSignal.timeout(5_000);
    await awaitWithAbort(
      () =>
        fetch(new URL(MENU_BACKGROUND_PATH, env.SERVER_SITE_ORIGIN), {
          method: "POST",
          headers,
          body,
          signal: dispatchSignal,
        }),
      dispatchSignal,
    );
  } catch {
    // transport エラーは受理の有無が不明。claim 済み worker と競合する失敗保存をせず、
    // 同キーの再 dispatch または既存 180 秒の stale 回収へ委ねる。
    logGenerationEvent("warn", {
      requestId,
      errorCode: "internal_error",
      durationMs: 0,
      modelId: null,
    });
  }
}

/** HMAC/owner 照合後の claim は一度だけ。claim 後クラッシュは再送せず stale 回収する。 */
export async function executeMenuBackground(
  user: AuthenticatedUserWithEmail,
  command: MenuGenerationCommand,
  token: string,
  scenario?: string,
): Promise<void> {
  const entryNow = performance.now();
  const deps = createGenerationDeps(user, {
    requestStartedAtMonotonicMs: entryNow,
    ...(scenario === undefined ? {} : { localTestScenario: scenario }),
  });
  const lookup = await deps.repository.lookup(command.request.idempotencyKey);
  if (lookup.kind !== "hit") return;
  const replay = await deps.repository.replayExisting(command, lookup);
  if (replay.status !== "processing") return;
  // reserve/replay RPC は日時を省く。HMAC 照合後に status の権威日時を取得し、
  // 終端化との競合や別行への差し替えを claim 前にもう一度閉じる。
  const reservation = await deps.repository.status(command.request.idempotencyKey);
  if (
    reservation.status !== "processing" ||
    reservation.request_id !== lookup.requestId ||
    reservation.started_at === undefined
  )
    return;
  const start = backgroundStartMonotonic(reservation.started_at, Date.now(), performance.now());
  if (start === null) return;
  const { data, error } = await getSupabaseAdmin().rpc("claim_menu_background_dispatch", {
    p_user_id: user.userId,
    p_request_id: reservation.request_id,
    p_token: token,
  });
  if (error !== null) throw error;
  if (!z.boolean().parse(data)) return;
  const env = getServerEnv();
  const sender = createOpenRouterGenerationSender({
    apiKey: env.openRouter.apiKey,
    baseUrl: env.openRouter.baseUrl,
    models: env.openRouter.models,
    timeoutMs: MENU_BACKGROUND_ATTEMPT_TIMEOUT_MS,
  });
  await runWithRequestDeadline(start + MENU_BACKGROUND_HARD_DEADLINE_MS, () =>
    runGeneration(
      {
        ...deps,
        requestStartedAtMonotonicMs: start,
        functionTotalBudgetMs: MENU_BACKGROUND_TOTAL_BUDGET_MS,
        openRouterTimeoutMs: MENU_BACKGROUND_ATTEMPT_TIMEOUT_MS,
        callOpenRouter:
          scenario === undefined
            ? sender
            : (input) => runWithOpenRouterMockScenario(scenario, () => sender(input)),
      },
      command,
      { reservation, attemptTimeoutMs: MENU_BACKGROUND_ATTEMPT_TIMEOUT_MS },
    ),
  );
}
