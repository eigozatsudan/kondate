/**
 * admin プロセス設定の読み込み。
 * 秘密（URL・token）をログや toString に載せない。
 */
import { ADMIN_LOCAL_TOKEN_MIN_LENGTH } from "./middleware/token.js";

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
  // 空/欠落は loopback。0.0.0.0 は明示時のみ（compose 内 listen 用）。
  const rawBind = typeof env.ADMIN_BIND_HOST === "string" ? env.ADMIN_BIND_HOST.trim() : "";
  const bindHost = rawBind.length > 0 ? rawBind : "127.0.0.1";

  // AO8: UI / Bearer は trim する。env も揃えないと末尾空白で「見た目どおり」が 401 になる。
  const tokenRaw = typeof env.ADMIN_LOCAL_TOKEN === "string" ? env.ADMIN_LOCAL_TOKEN.trim() : "";
  // ADM5: 空は従来どおり optional null。非空かつ短すぎる token は fail-closed。
  let localToken: string | null = null;
  if (tokenRaw.length > 0) {
    if (tokenRaw.length < ADMIN_LOCAL_TOKEN_MIN_LENGTH) {
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
    const port =
      u.port || (u.protocol === "postgresql:" || u.protocol === "postgres:" ? "5432" : "");
    return port ? `${u.hostname}:${port}` : u.hostname;
  } catch {
    return "(unknown)";
  }
}
