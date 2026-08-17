/**
 * 開発サーバ専用。本番 netlify.toml の `/* → /app.html` と同じ document 振り分け。
 *
 * @netlify/vite-plugin は project root を static ディレクトリにするため、
 * `/src/*.tsx` が生ソースで返り、`/@vite/client` は app.html に化ける。
 * redirects / staticFiles を切ったあと、この関数で HTML 遷移だけを寄せる。
 */

/**
 * @param {{ method: string, url: string, accept?: string | string[] }} input
 * @returns {string | null} 書き換えるなら `/app.html` + 元クエリ。触らないなら null
 */
export function rewriteDevDocumentUrl(input) {
  const method = input.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return null;
  }

  const accept = Array.isArray(input.accept) ? input.accept.join(",") : (input.accept ?? "");
  if (accept !== "" && !accept.includes("text/html") && !accept.includes("*/*")) {
    return null;
  }

  const queryIndex = input.url.indexOf("?");
  const pathname = queryIndex === -1 ? input.url : input.url.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : input.url.slice(queryIndex);

  if (pathname === "/" || pathname === "/index.html" || pathname === "/app.html") {
    return null;
  }
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return null;
  }
  if (
    pathname.startsWith("/@") ||
    pathname.startsWith("/src/") ||
    pathname.startsWith("/shared/") ||
    pathname.startsWith("/node_modules/")
  ) {
    return null;
  }
  // 拡張子付きは Vite / public の実ファイル。HTML シェルに落とさない。
  if (pathname.includes(".")) {
    return null;
  }

  return `/app.html${query}`;
}
