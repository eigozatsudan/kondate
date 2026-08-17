/**
 * Deploy context 別 Content-Security-Policy と _headers 本文の純関数。
 * production は exact managed Supabase origin のみ、preview/branch は
 * *.supabase.co を許す。Netlify の [[headers]] は context 非対応のため、
 * ビルド後に dist/_headers へ書き出す（emit-deploy-headers.mjs）。
 */

const managedSupabaseOrigin = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/u;

/** CSP 共通 directive（connect-src 以外）。style は self のみ（inline 許可なし）。 */
export const CSP_STATIC_DIRECTIVES =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; font-src 'self'; style-src 'self'; script-src 'self'";

export const CSP_FORM_ACTION = "form-action 'self'";

/** preview / branch-deploy 向け。別 managed プロジェクトを指し得る。 */
export const PREVIEW_CONNECT_SRC = "'self' https://*.supabase.co wss://*.supabase.co";

/**
 * @param {string} supabaseUrl production の VITE_SUPABASE_URL（path なし managed origin）
 * @returns {string} connect-src 値
 */
export function buildProductionConnectSrc(supabaseUrl) {
  if (typeof supabaseUrl !== "string" || supabaseUrl.length === 0) {
    throw new Error("csp_supabase_url_missing");
  }
  const match = managedSupabaseOrigin.exec(supabaseUrl);
  if (match === null || supabaseUrl !== `https://${match[1]}.supabase.co`) {
    throw new Error("csp_supabase_url_invalid");
  }
  const origin = supabaseUrl;
  const wsOrigin = `wss://${match[1]}.supabase.co`;
  return `'self' ${origin} ${wsOrigin}`;
}

/**
 * @param {"production" | "deploy-preview" | "branch-deploy" | string} context
 * @param {string | undefined} supabaseUrl production 時のみ必須
 */
export function buildConnectSrc(context, supabaseUrl) {
  if (context === "production") {
    return buildProductionConnectSrc(supabaseUrl ?? "");
  }
  return PREVIEW_CONNECT_SRC;
}

/**
 * @param {string} connectSrc
 */
export function buildContentSecurityPolicy(connectSrc) {
  return `${CSP_STATIC_DIRECTIVES}; connect-src ${connectSrc}; ${CSP_FORM_ACTION}`;
}

/**
 * Netlify publish 用 _headers 本文。
 * /sw.js は SPA rewrite で HTML に化けないよう JS MIME + no-cache を先に固定し、
 * manifest は application/manifest+json。/app.html のみ noindex（公開 LP の / は索引対象）。
 * CSP は /* にだけ載せ、文字列自体は変えない。
 * @param {string} csp
 */
export function buildHeadersFileContent(csp) {
  return `/sw.js
  Cache-Control: no-cache
  Content-Type: text/javascript; charset=utf-8

/manifest.webmanifest
  Content-Type: application/manifest+json

/app.html
  X-Robots-Tag: noindex

/*
  Content-Security-Policy: ${csp}
`;
}

/**
 * @param {{ context: string, supabaseUrl?: string }} options
 */
export function buildDeployHeadersFile({ context, supabaseUrl }) {
  const connectSrc = buildConnectSrc(context, supabaseUrl);
  return buildHeadersFileContent(buildContentSecurityPolicy(connectSrc));
}

/**
 * _headers または CSP 文字列から connect-src トークンを取り出す。
 * CSP 値に 'self' 等の単一引用符が含まれるため、行末までを取る（["'] で切らない）。
 * @param {string} source
 * @returns {string | null}
 */
export function extractConnectSrc(source) {
  if (typeof source !== "string") return null;
  // _headers / TOML 形式: Content-Security-Policy: <value>
  // 生 CSP: connect-src を含む1行または複数 directive 文字列
  const headerLine = /^[ \t]*Content-Security-Policy\s*[:=]\s*(.+)$/imu.exec(source);
  let csp;
  if (headerLine !== null) {
    csp = headerLine[1].trim().replace(/^["']|["']$/gu, "");
  } else if (source.includes("connect-src")) {
    csp = source;
  } else {
    return null;
  }
  const connectMatch = /connect-src\s+([^;]+)/iu.exec(csp);
  if (connectMatch === null) return null;
  return connectMatch[1].trim().replace(/\s+/gu, " ");
}

/**
 * production CSP が VITE_SUPABASE_URL と一致し、ワイルドカードを含まないことを検証する。
 * 失敗コードは秘密・URL を埋め込まない。
 * @param {string} headersOrCsp
 * @param {string} supabaseUrl
 */
export function assertProductionCspMatchesSupabaseUrl(headersOrCsp, supabaseUrl) {
  const expected = buildProductionConnectSrc(supabaseUrl);
  const actual = extractConnectSrc(headersOrCsp);
  if (actual === null) {
    throw new Error("csp_connect_src_missing");
  }
  if (actual.includes("*.supabase.co")) {
    throw new Error("csp_connect_src_wildcard_forbidden");
  }
  if (actual !== expected) {
    throw new Error("csp_connect_src_mismatch");
  }
  return true;
}
