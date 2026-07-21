import { getServerEnv } from "./env.js";

/** Compose openrouter-mock の正準 base URL（trailing slash なし） */
export const LOCAL_OPENROUTER_MOCK_BASE_URL = "http://openrouter-mock:8787/api/v1";

/**
 * リクエストヘッダ x-kondate-mock-scenario を、OPENROUTER_BASE_URL が
 * 厳密にローカル mock のときだけ返す。本番 URL では常に undefined。
 */
export function readLocalMockScenario(request: Request): string | undefined {
  const baseUrl = getServerEnv().openRouter.baseUrl;
  if (baseUrl !== LOCAL_OPENROUTER_MOCK_BASE_URL) {
    return undefined;
  }
  const header = request.headers.get("x-kondate-mock-scenario");
  if (header === null) return undefined;
  const trimmed = header.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
