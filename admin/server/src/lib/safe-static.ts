/**
 * root 封じ込め付き静的配信。
 * - リクエスト path の leading `/` を剥がし、絶対 path 扱いにしない
 * - resolve 後は root 配下（exact または root+sep 接頭）のみ許可（fail-closed）
 * - 中間/末端 symlink は lstat+realpath で実体が root 内か確認する
 * - 許可されたファイルだけ createReadStream する
 *
 * Node 24 の path.join は absolute 第2引数を相対扱いするが、
 * 防御を join 意味論に依存させず明示的に封じ込める。
 * 本番 Docker は COPY 済み dist 前提（通常成果物に symlink は無い）。
 */
import {
  closeSync,
  constants,
  createReadStream,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  statSync,
  type Stats,
} from "node:fs";
import { resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { Context, MiddlewareHandler, Next } from "hono";
import { getMimeType } from "hono/utils/mime";
import { applyAdminSecurityHeaders } from "../middleware/secure-headers.js";

/**
 * リクエスト path を root 配下の実ファイル path に解決する。
 * 封じ込めに失敗・不正エンコードなら null。
 */
export function resolveContainedPath(root: string, requestPath: string): string | null {
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
  if (relativePath.length > 0 && /(?:^|[/\\])\.{1,2}(?:$|[/\\])|[/\\]{2,}|\\/u.test(relativePath)) {
    return null;
  }

  const rootResolved = resolve(root);
  // relativePath が空なら root 自身（ディレクトリ扱い）
  const candidate = relativePath.length === 0 ? rootResolved : resolve(rootResolved, relativePath);

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

function tryStat(filePath: string): Stats | null {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}

function tryLstat(filePath: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(filePath);
  } catch {
    return null;
  }
}

function tryRealpath(filePath: string): string | null {
  try {
    return realpathSync(filePath);
  } catch {
    return null;
  }
}

type ContainedExisting =
  { kind: "missing" } | { kind: "escaped" } | { kind: "ok"; path: string; stats: Stats };

/**
 * 文字列接頭辞通過後に実体を確認する。
 * 末端・中間の symlink が root 外へ出る、または解決不能なら escaped。
 */
function resolveContainedExisting(candidate: string, rootResolved: string): ContainedExisting {
  const rootReal = tryRealpath(rootResolved);
  if (rootReal === null) {
    return { kind: "escaped" };
  }
  const appeared = tryLstat(candidate);
  const real = tryRealpath(candidate);
  if (real === null) {
    return appeared === null ? { kind: "missing" } : { kind: "escaped" };
  }
  if (!isPathInsideRoot(real, rootReal)) {
    return { kind: "escaped" };
  }
  const stats = tryStat(real);
  if (stats === null) {
    return { kind: "missing" };
  }
  return { kind: "ok", path: real, stats };
}

/**
 * AO3: realpath 成功〜 open のあいだに leaf が root 外向き symlink へ差し替わっても
 * 外ファイルを 200 しない。O_NOFOLLOW で末端を辿らず、開いた fd の実体を再確認する。
 */
function openContainedFileStream(
  realPath: string,
  rootReal: string,
): ReturnType<typeof createReadStream> | null {
  let fd: number;
  try {
    fd = openSync(realPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) {
      closeSync(fd);
      return null;
    }
    // 中間ディレクトリ差し替えは O_NOFOLLOW では閉じない。fd 実体を再確認する。
    const openedReal = tryRealpath(`/proc/self/fd/${String(fd)}`);
    if (openedReal === null || !isPathInsideRoot(openedReal, rootReal)) {
      closeSync(fd);
      return null;
    }
    return createReadStream(realPath, { fd });
  } catch {
    closeSync(fd);
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

    applyAdminSecurityHeaders(c);
    const pathname = new URL(c.req.url).pathname;
    if (pathname.startsWith("/api/")) {
      return next();
    }

    const method = c.req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return next();
    }

    const filePath = resolveContainedPath(rootResolved, pathname);
    if (filePath === null) {
      // 封じ込め失敗は next せず 404 相当（SPA に漏らさない）
      return c.text("Not Found", 404);
    }

    let existing = resolveContainedExisting(filePath, rootResolved);
    if (existing.kind === "escaped") {
      return c.text("Not Found", 404);
    }
    if (existing.kind === "ok" && existing.stats.isDirectory()) {
      const indexPath = resolve(existing.path, "index.html");
      const rootReal = tryRealpath(rootResolved) ?? rootResolved;
      if (!isPathInsideRoot(indexPath, rootReal)) {
        return c.text("Not Found", 404);
      }
      existing = resolveContainedExisting(indexPath, rootResolved);
      if (existing.kind === "escaped") {
        return c.text("Not Found", 404);
      }
    }

    if (existing.kind !== "ok" || !existing.stats.isFile()) {
      return next();
    }

    const mimeType = getMimeType(existing.path) || "application/octet-stream";
    c.header("Content-Type", mimeType);
    c.header("Content-Length", String(existing.stats.size));

    if (method === "HEAD") {
      return c.body(null, 200);
    }

    const rootReal = tryRealpath(rootResolved) ?? rootResolved;
    const stream = openContainedFileStream(existing.path, rootReal);
    if (stream === null) {
      return c.text("Not Found", 404);
    }
    return c.body(createStreamBody(stream), 200);
  };
}

/**
 * SPA フォールバック: API 以外で index.html を root 内からだけ返す。
 */
export function createSpaFallbackMiddleware(root: string): MiddlewareHandler {
  const rootResolved = resolve(root);
  const indexPath = resolve(rootResolved, "index.html");

  return async (c: Context, next: Next) => {
    applyAdminSecurityHeaders(c);
    const pathname = new URL(c.req.url).pathname;
    if (pathname.startsWith("/api/")) {
      return next();
    }

    if (!isPathInsideRoot(indexPath, rootResolved) || !existsSync(indexPath)) {
      return next();
    }

    const existing = resolveContainedExisting(indexPath, rootResolved);
    if (existing.kind !== "ok" || !existing.stats.isFile()) {
      return next();
    }

    c.header("Content-Type", getMimeType(existing.path) || "text/html");
    c.header("Content-Length", String(existing.stats.size));
    if (c.req.method.toUpperCase() === "HEAD") {
      return c.body(null, 200);
    }
    const rootReal = tryRealpath(rootResolved) ?? rootResolved;
    const stream = openContainedFileStream(existing.path, rootReal);
    if (stream === null) {
      return next();
    }
    return c.body(createStreamBody(stream), 200);
  };
}
