/**
 * root 封じ込め付き静的配信。
 * - リクエスト path の leading `/` を剥がし、絶対 path 扱いにしない
 * - resolve 後は root 配下（exact または root+sep 接頭）のみ許可（fail-closed）
 * - 許可されたファイルだけ createReadStream する
 *
 * Node 24 の path.join は absolute 第2引数を相対扱いするが、
 * 防御を join 意味論に依存させず明示的に封じ込める。
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { Context, MiddlewareHandler, Next } from "hono";
import { getMimeType } from "hono/utils/mime";

/**
 * リクエスト path を root 配下の実ファイル path に解決する。
 * 封じ込めに失敗・不正エンコードなら null。
 */
export function resolveContainedPath(
  root: string,
  requestPath: string,
): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  if (decoded.includes("\0")) {
    return null;
  }

  // leading slash / backslash を剥がし absolute セグメントにしない
  const relativePath = decoded.replace(/^[/\\]+/u, "");

  // 単独の . / .. 断片や \\ を拒否（resolve 前の明示ガード）
  if (
    relativePath.length > 0 &&
    /(?:^|[/\\])\.{1,2}(?:$|[/\\])|[/\\]{2,}|\\/u.test(relativePath)
  ) {
    return null;
  }

  const rootResolved = resolve(root);
  // relativePath が空なら root 自身（ディレクトリ扱い）
  const candidate =
    relativePath.length === 0
      ? rootResolved
      : resolve(rootResolved, relativePath);

  if (!isPathInsideRoot(candidate, rootResolved)) {
    return null;
  }

  return candidate;
}

/** candidate が root そのもの、または root 配下かを判定する */
export function isPathInsideRoot(candidate: string, rootResolved: string): boolean {
  if (candidate === rootResolved) {
    return true;
  }
  const prefix = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;
  return candidate.startsWith(prefix);
}

function createStreamBody(stream: ReturnType<typeof createReadStream>): ReadableStream {
  return Readable.toWeb(stream) as ReadableStream;
}

function tryStat(filePath: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}

/**
 * root 配下の静的ファイルのみ配信する middleware。
 * 見つからない・root 外は next()（SPA フォールバックや 404 に委ねる）。
 * /api/* は触らない。
 */
export function createSafeStaticMiddleware(root: string): MiddlewareHandler {
  const rootResolved = resolve(root);

  return async (c: Context, next: Next) => {
    if (c.finalized) {
      return next();
    }

    const pathname = new URL(c.req.url).pathname;
    if (pathname.startsWith("/api/")) {
      return next();
    }

    const method = c.req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return next();
    }

    let filePath = resolveContainedPath(rootResolved, pathname);
    if (filePath === null) {
      // 封じ込め失敗は next せず 404 相当（SPA に漏らさない）
      return c.text("Not Found", 404);
    }

    let stats = tryStat(filePath);
    if (stats?.isDirectory()) {
      const indexPath = resolve(filePath, "index.html");
      if (!isPathInsideRoot(indexPath, rootResolved)) {
        return c.text("Not Found", 404);
      }
      filePath = indexPath;
      stats = tryStat(filePath);
    }

    if (!stats || !stats.isFile()) {
      return next();
    }

    const mimeType = getMimeType(filePath) || "application/octet-stream";
    c.header("Content-Type", mimeType);
    c.header("Content-Length", String(stats.size));

    if (method === "HEAD") {
      return c.body(null, 200);
    }

    return c.body(createStreamBody(createReadStream(filePath)), 200);
  };
}

/**
 * SPA フォールバック: API 以外で index.html を root 内からだけ返す。
 */
export function createSpaFallbackMiddleware(root: string): MiddlewareHandler {
  const rootResolved = resolve(root);
  const indexPath = resolve(rootResolved, "index.html");

  return async (c: Context, next: Next) => {
    const pathname = new URL(c.req.url).pathname;
    if (pathname.startsWith("/api/")) {
      return next();
    }

    if (!isPathInsideRoot(indexPath, rootResolved) || !existsSync(indexPath)) {
      return next();
    }

    const stats = tryStat(indexPath);
    if (!stats?.isFile()) {
      return next();
    }

    c.header("Content-Type", getMimeType(indexPath) || "text/html");
    c.header("Content-Length", String(stats.size));
    if (c.req.method.toUpperCase() === "HEAD") {
      return c.body(null, 200);
    }
    return c.body(createStreamBody(createReadStream(indexPath)), 200);
  };
}
