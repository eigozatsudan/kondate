import {
  weeklyPlanResultSchema,
  type WeeklyPlanRequest,
  type WeeklyPlanResult,
} from "@shared/contracts/weekly-plan";

/**
 * 週献立API呼び出しのクライアント abort 上限（ms）。
 * usage-today と同様、hung proxy で永久 pending にならないよう 30s。
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
    signal: AbortSignal.timeout(WEEKLY_PLAN_CLIENT_TIMEOUT_MS),
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
