/**
 * admin プロセス設定の読み込み。
 * 秘密（URL・token）をログや toString に載せない。
 */

export type AdminConfig = {
  databaseUrl: string;
  port: number;
  bindHost: string;
  localToken: string | null;
  allowInsecureLocalDb: boolean;
};

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error("admin_port_invalid");
  }
  return n;
}

/**
 * process.env から AdminConfig を構築する。
 * ADMIN_DATABASE_URL 欠落はここで throw（closed メッセージは呼び出し側で扱ってよい）。
 */
export function loadConfig(env: NodeJS.ProcessEnv): AdminConfig {
  const databaseUrl = env.ADMIN_DATABASE_URL;
  if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
    throw new Error("admin_database_url_missing");
  }

  const port = parsePort(env.ADMIN_PORT, 5193);
  const bindHost =
    typeof env.ADMIN_BIND_HOST === "string" && env.ADMIN_BIND_HOST.length > 0
      ? env.ADMIN_BIND_HOST
      : "0.0.0.0";

  const tokenRaw = env.ADMIN_LOCAL_TOKEN;
  // ADM5: 空は従来どおり optional null。非空かつ短すぎる token は fail-closed。
  let localToken: string | null = null;
  if (typeof tokenRaw === "string" && tokenRaw.length > 0) {
    // 循環 import を避けるため長さ定数をここにもリテラルで固定（token.ts と一致）
    if (tokenRaw.length < 16) {
      throw new Error("admin_local_token_too_short");
    }
    localToken = tokenRaw;
  }

  const allowInsecureLocalDb = env.ADMIN_ALLOW_INSECURE_LOCAL_DB === "1";

  return {
    databaseUrl,
    port,
    bindHost,
    localToken,
    allowInsecureLocalDb,
  };
}

/**
 * ヘッダ表示用。userinfo / password / query を落とす。
 */
export function connectionHostLabel(databaseUrl: string): string {
  try {
    const u = new URL(databaseUrl);
    const port = u.port || (u.protocol === "postgresql:" || u.protocol === "postgres:" ? "5432" : "");
    return port ? `${u.hostname}:${port}` : u.hostname;
  } catch {
    return "(unknown)";
  }
}
