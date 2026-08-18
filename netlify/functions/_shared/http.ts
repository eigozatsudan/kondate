import { z } from "zod";
import type { ApiResponse } from "../../../shared/contracts/http.js";

const maxBodyBytes = 8 * 1024;

export function jsonResponse(status: number, value: unknown): Response {
  // auth continuation の code 等を含むため json() と同型で no-store を付ける
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function invalidRequest(): Response {
  return jsonResponse(400, {
    ok: false,
    error: { code: "invalid_request", message: "リクエストを確認してください" },
  });
}

export function continuationUnavailable(): Response {
  return jsonResponse(404, {
    ok: false,
    error: { code: "continuation_unavailable", message: "認証をもう一度お試しください" },
  });
}

/**
 * claim RPC 成功後に payload 読取（bytea）/ decrypt / 応答検証が失敗したとき用。
 * C3: サーバ ciphertext は expires_at まで保持され、同一 credential なら冪等 re-claim 可能。
 * ここでの 410 は「行が burned で消えた」ではなく、bytea 破損・decrypt 失敗・応答 schema 不一致など
 * クライアントが 404 リトライしても回復しない terminal 障害を示す。
 */
export function continuationGone(): Response {
  return jsonResponse(410, {
    ok: false,
    error: { code: "continuation_unavailable", message: "認証をもう一度お試しください" },
  });
}

export function requireOrigin(request: Request, origin: string): boolean {
  return request.headers.get("origin") === origin;
}

/**
 * SC5 / SC-R2: Content-Length 欠落・過小申告でもストリーム累積で上限超過を読取完了前に拒否する。
 * flyer の累積拒否と同型。超過時は cancel してから投げる。
 */
async function readRequestTextUntilLimit(
  request: Request,
  isOverLimit: (total: number) => boolean,
): Promise<string> {
  if (request.body === null) {
    return "";
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (isOverLimit(total)) {
      await reader.cancel();
      throw new Error("request_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * auth-continuation 用の厳密 JSON 境界。
 * C8: `application/json; charset=utf-8` や `*+json` を isJsonContentType と同型で許容する
 * （exact match だと中間 proxy / 将来 wrapper が charset を付けただけで 400 になる）。
 * SC-R2: 宣言が 8KiB 未満でも本文は累積拒否する。request.text() は打ち切らないので使わない。
 */
export async function parseJsonRequest(request: Request): Promise<unknown> {
  if (!isJsonContentType(request.headers.get("content-type"))) throw new Error("invalid_request");
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) >= maxBodyBytes)
  ) {
    throw new Error("invalid_request");
  }
  let text: string;
  try {
    // 8KiB は既存どおり排他上限（>=）。欠落・過小申告は読取完了前に invalid_request。
    text = await readRequestTextUntilLimit(request, (total) => total >= maxBodyBytes);
  } catch {
    throw new Error("invalid_request");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("invalid_request");
  }
}

export async function parseStrictJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await parseJsonRequest(request));
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function json<T>(status: number, body: ApiResponse<T>): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function methodNotAllowed(allowed: readonly string[]): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code: "method_not_allowed", message: "この操作方法は利用できません" },
    } satisfies ApiResponse<never>),
    {
      status: 405,
      headers: {
        "content-type": "application/json",
        allow: allowed.join(", "),
        "cache-control": "no-store",
      },
    },
  );
}

/**
 * Content-Type が JSON 系か（application/json または *+json）。
 * charset 等のパラメータは許容する。text/plain 等は拒否。
 * parseJsonRequest / parseJson の双方がこれを使う（C8）。
 */
function isJsonContentType(header: string | null): boolean {
  if (header === null) return false;
  const mediaType = header.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

/**
 * fieldErrors の path 名は残し、メッセージは入力本文を埋め込まない固定語に閉じる。
 * 将来の refine が free-text を message に載せてもクライアントへエコーしない。
 */
export function closedFieldErrors(
  fieldErrors: Record<string, string[] | undefined>,
): Record<string, string[]> {
  const closed: Record<string, string[]> = {};
  for (const [path, messages] of Object.entries(fieldErrors)) {
    if (messages === undefined || messages.length === 0) continue;
    // path 名も free-text を避ける（識別子のみ）
    if (!/^[A-Za-z_][A-Za-z0-9_.[\]]{0,79}$/u.test(path)) continue;
    closed[path] = messages.map(() => "invalid");
  }
  return closed;
}

/**
 * S8: HttpError.details を閉じた schema のみに正規化する。
 * - fields: path → ["invalid"] のみ（parseJson と対称）
 * - release_failed: true のみ（billing checkout B6）
 * 未知キー・free-text 値・ネスト任意 Record は落とす。
 */
export function closedHttpErrorDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (details === undefined) return undefined;
  const closed: Record<string, unknown> = {};
  const rawFields = details.fields;
  if (rawFields !== undefined && rawFields !== null && typeof rawFields === "object") {
    const fieldSource: Record<string, string[] | undefined> = {};
    for (const [path, value] of Object.entries(rawFields as Record<string, unknown>)) {
      if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
        fieldSource[path] = value;
      } else if (value !== undefined) {
        // 配列以外の形でも path だけ残し message は閉じる
        fieldSource[path] = ["invalid"];
      }
    }
    const fields = closedFieldErrors(fieldSource);
    if (Object.keys(fields).length > 0) closed.fields = fields;
  }
  if (details.release_failed === true) {
    closed.release_failed = true;
  }
  return Object.keys(closed).length === 0 ? undefined : closed;
}

const parseJsonMaxBytes = 65_536;

/**
 * SC5: Content-Length 欠落・過小申告でもストリーム累積で上限超過を読取完了前に拒否する。
 * 宣言が上限超なら従来どおり先読み 413。flyer の累積拒否と同型。
 */
async function readJsonTextWithLimit(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, "request_too_large", "入力が大きすぎます");
  }
  try {
    return await readRequestTextUntilLimit(request, (total) => total > maxBytes);
  } catch (error) {
    if (error instanceof Error && error.message === "request_too_large") {
      throw new HttpError(413, "request_too_large", "入力が大きすぎます");
    }
    throw error;
  }
}

export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    if (!isJsonContentType(request.headers.get("content-type"))) {
      throw new HttpError(400, "invalid_json", "JSONを読み取れません");
    }
    const text = await readJsonTextWithLimit(request, parseJsonMaxBytes);
    value = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_json", "JSONを読み取れません");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, "invalid_request", "入力内容を確認してください", {
      fields: closedFieldErrors(z.flattenError(parsed.error).fieldErrors),
    });
  }
  return parsed.data;
}

/** Function エラー code: SafeLog closedErrorCode と同形の snake_case。 */
function closedHttpErrorCode(raw: string): string {
  if (/^[a-z][a-z0-9_]{0,79}$/u.test(raw)) return raw;
  return "request_failed";
}

const closedHttpErrorMessageFallback = "処理を完了できませんでした";

/**
 * 製品コピーの閉じた「アレルギー○」だけを除き、残った アレルギー は自由文とみなす。
 * 氏名＋品目（小麦アレルギー）やカスタムアレルギーを wire に出さない。
 * 品目前置（小麦アレルギー食材）・助詞挟み（小麦のアレルギー食材）・長音
 * （カレーアレルギー食材）・鉤括弧／読点の直後へは食い込まない。
 * 製品コピーで助詞例外が要るのは「とアレルギー条件」だけなので、それ以外の助詞では削らない。
 */
function hasAllergyFreeText(raw: string): boolean {
  const withoutClosed = raw.replace(
    /(?:とアレルギー条件)|(?:(?<![一-龯ぁ-んァ-ンー「」『』、。])(?:登録されたアレルギー内容|自由登録アレルギー|登録アレルギー|アレルギー確認|アレルギー情報|アレルギー条件|アレルギー内容|アレルギー食材))/gu,
    "",
  );
  return /アレルギー/u.test(withoutClosed);
}

/**
 * 国内電話らしい 10–11 桁。全角数字も見る。
 * 製品コピーの「明日0:00」「1 週間」は桁不足なので落とさない。
 */
function hasJapanesePhoneNumber(raw: string): boolean {
  const halfWidth = raw.replace(/[０-９]/gu, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  return /(?:\+81|0)(?:\d[-‐−–—ー－\s]?){8,10}\d/u.test(halfWidth);
}

/**
 * 既存の閉じた日本語 message を通し、email / stack / 人名混じり free-text は潰す。
 * 製品語（JSON / JPEG / PNG / WebP / Plus / multipart / ID / AI）は現行文言に残る。
 */
function closedHttpErrorMessage(raw: string): string {
  if (raw.length < 1 || raw.length > 500) return closedHttpErrorMessageFallback;
  if (/[@＠]/u.test(raw)) return closedHttpErrorMessageFallback;
  const withoutProductTokens = raw.replace(/\b(?:JSON|JPEG|PNG|WebP|Plus|multipart|ID|AI)\b/gu, "");
  if (/[A-Za-z]/u.test(withoutProductTokens)) return closedHttpErrorMessageFallback;
  if (!/[\u3040-\u30ff\u4e00-\u9fff]/u.test(raw)) return closedHttpErrorMessageFallback;
  // 人名混じり（敬称付き和文）。製品コピーは さん/様/君 を含まない。
  // 評価テンプレは 「花子」さん のように閉じ引用が敬称直前に来る。
  if (/(?:[一-龯ぁ-んァ-ン]{1,4}|[」』])(?:ちゃん|くん|さん|様|君)/u.test(raw)) {
    return closedHttpErrorMessageFallback;
  }
  // 氏名なしの品目・自由文アレルギー、および和文に混ざった電話番号。
  if (hasAllergyFreeText(raw) || hasJapanesePhoneNumber(raw)) {
    return closedHttpErrorMessageFallback;
  }
  return raw;
}

export function handleError(error: unknown): Response {
  if (error instanceof HttpError) {
    const details = closedHttpErrorDetails(error.details);
    return json(error.status, {
      ok: false,
      error: {
        code: closedHttpErrorCode(error.code),
        message: closedHttpErrorMessage(error.message),
        ...(details === undefined ? {} : { details }),
      },
    });
  }
  return json(500, {
    ok: false,
    error: { code: "request_failed", message: "処理を完了できませんでした" },
  });
}
