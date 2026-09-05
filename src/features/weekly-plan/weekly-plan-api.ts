import { GENERATION_POST_CLIENT_TIMEOUT_MS } from "@shared/contracts/function-budget";
import {
  weeklyPlanResultSchema,
  type WeeklyPlanRequest,
  type WeeklyPlanResult,
} from "@shared/contracts/weekly-plan";

/**
 * 週献立 GET のクライアント abort 上限（ms）。GET は読取のみでサーバ側の生成予算とは
 * 無関係なので、usage-today と同様 hung proxy で永久 pending にならないよう 30s のまま。
 * POST（サーバの生成予算に縛られる）には使わない。POST は GENERATION_POST_CLIENT_TIMEOUT_MS を使う
 * （下記 postWeeklyPlan 参照。P2修正B: サーバ予算 55s より短い 30s で abort すると、
 * サーバが finalize/insert を完了しているのにクライアント側では失敗になり得た）。
 */
export const WEEKLY_PLAN_CLIENT_TIMEOUT_MS = 30_000;

export class WeeklyPlanApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WeeklyPlanApiError";
  }
}

function parseErrorPayload(value: unknown): { code: string; message: string } {
  const record = value as { error?: { code?: unknown; message?: unknown } };
  const code = typeof record.error?.code === "string" ? record.error.code : "request_failed";
  const message =
    typeof record.error?.message === "string" ? record.error.message : "処理を完了できませんでした";
  return { code, message };
}

async function parseWeeklyPlanResponse(response: Response): Promise<WeeklyPlanResult> {
  const payload: unknown = await response.json();
  if (!response.ok) {
    const { code, message } = parseErrorPayload(payload);
    throw new WeeklyPlanApiError(response.status, code, message);
  }
  const record = payload as { data?: unknown };
  return weeklyPlanResultSchema.parse(record.data);
}

export async function postWeeklyPlan(
  accessToken: string,
  body: WeeklyPlanRequest,
): Promise<WeeklyPlanResult> {
  const response = await fetch("/api/weekly-plan", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GENERATION_POST_CLIENT_TIMEOUT_MS),
  });
  return parseWeeklyPlanResponse(response);
}

export async function getWeeklyPlanById(
  accessToken: string,
  weeklyPlanId: string,
): Promise<WeeklyPlanResult> {
  const response = await fetch(`/api/weekly-plan/${weeklyPlanId}`, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(WEEKLY_PLAN_CLIENT_TIMEOUT_MS),
  });
  return parseWeeklyPlanResponse(response);
}
