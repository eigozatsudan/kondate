/**
 * ops readonly 用 pg プールと URL 検証。
 * - ユーザー名は exact: kondate_ops_readonly または kondate_ops_readonly.<20-char-ref>
 * - port 6543（transaction pooler）拒否、postgres ロール拒否
 * - 本番相当は sslmode require|verify-ca|verify-full + rejectUnauthorized: true
 * - 業務 SQL は withReadOnly 経由のみ（pool.query 直叩き禁止）
 */
import pg from "pg";
import type { AdminConfig } from "./config.js";
import { databaseStartupFailed, databaseUrlInvalid } from "./errors.js";

const { Pool } = pg;

const LOCAL_LOGIN_USER = "kondate_ops_readonly";
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const POOLER_HOST_PATTERN = /^[a-z0-9-]+\.pooler\.supabase\.com$/u;
const DIRECT_HOST_PATTERN = /^db\.[a-z0-9]{20}\.supabase\.co$/u;
const LOCAL_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "host.docker.internal",
  "db",
]);

export type AssertDatabaseUrlOpts = {
  allowInsecureLocalDb: boolean;
};

/**
 * ADMIN_DATABASE_URL を fail-closed で検証し、パース済み URL を返す。
 * 例外メッセージにパスワードを載せない（closed 文言）。
 */
export function assertDatabaseUrl(
  url: string,
  opts: AssertDatabaseUrlOpts,
): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    databaseUrlInvalid();
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    databaseUrlInvalid();
  }

  if (!parsed.password || parsed.password.length === 0) {
    databaseUrlInvalid();
  }

  // pathname は /postgres を期待（空や他 DB 名は拒否）
  if (parsed.pathname !== "/postgres" && parsed.pathname !== "") {
    // 空 path も一部クライアントがあるが、本プロジェクト契約は /postgres
    if (parsed.pathname !== "/postgres") {
      databaseUrlInvalid();
    }
  }

  const port = parsed.port || "5432";
  if (port === "6543") {
    throw new Error("database_url_invalid: transaction pooler port 6543 is not allowed");
  }
  if (port !== "5432") {
    // ローカルのみ非 5432 を許可（Compose ホスト公開 54322 等は insecure フラグ時）
    if (!opts.allowInsecureLocalDb) {
      databaseUrlInvalid();
    }
  }

  const username = decodeURIComponent(parsed.username);
  if (username === "postgres" || username.startsWith("postgres.")) {
    throw new Error("database_url_invalid: only kondate_ops_readonly is allowed");
  }

  // exact のみ。prefix 一致（kondate_ops_readonly_evil）は拒否
  const isBareRole = username === LOCAL_LOGIN_USER;
  let isRoleWithRef = false;
  if (username.startsWith(`${LOCAL_LOGIN_USER}.`)) {
    const ref = username.slice(LOCAL_LOGIN_USER.length + 1);
    isRoleWithRef = PROJECT_REF_PATTERN.test(ref);
  }
  if (!isBareRole && !isRoleWithRef) {
    throw new Error("database_url_invalid: username must be kondate_ops_readonly or kondate_ops_readonly.<20-char-ref>");
  }

  const sslmode = parsed.searchParams.get("sslmode");
  const host = parsed.hostname;
  const isLocalHost = LOCAL_HOSTS.has(host);

  if (opts.allowInsecureLocalDb && isLocalHost) {
    // ローカル Compose: sslmode=disable のみ
    if (sslmode !== "disable") {
      databaseUrlInvalid();
    }
    if (!isBareRole) {
      // ローカルは bare role のみ
      databaseUrlInvalid();
    }
    return parsed;
  }

  // 本番 / staging 相当
  if (sslmode !== "require" && sslmode !== "verify-ca" && sslmode !== "verify-full") {
    databaseUrlInvalid();
  }
  if (port !== "5432") {
    databaseUrlInvalid();
  }

  const isDirect =
    isBareRole && DIRECT_HOST_PATTERN.test(host);
  const isSession =
    isRoleWithRef && POOLER_HOST_PATTERN.test(host);

  if (!isDirect && !isSession) {
    // bare role + pooler や role.ref + direct は拒否
    databaseUrlInvalid();
  }

  return parsed;
}

/**
 * node-pg 用接続オプション。
 * 本番相当: TLS 必須かつ rejectUnauthorized: true。
 * ローカル insecure: ssl オフ。
 *
 * 注意: connectionString 上の sslmode=require が ssl オプションを上書きし得るため、
 * 本番経路では sslmode クエリを外してから明示 ssl を渡す。
 */
export function buildPoolSslOptions(
  connectionString: string,
  allowInsecureLocalDb: boolean,
): { connectionString: string; ssl?: { rejectUnauthorized: boolean } | false } {
  const parsed = assertDatabaseUrl(connectionString, { allowInsecureLocalDb });
  const sslmode = parsed.searchParams.get("sslmode");

  if (sslmode === "disable") {
    return { connectionString };
  }

  const stripped = new URL(connectionString);
  stripped.searchParams.delete("sslmode");
  let next = stripped.toString();
  if (next.endsWith("?")) {
    next = next.slice(0, -1);
  }
  return {
    connectionString: next,
    ssl: { rejectUnauthorized: true },
  };
}

export function createPool(config: AdminConfig): pg.Pool {
  assertDatabaseUrl(config.databaseUrl, {
    allowInsecureLocalDb: config.allowInsecureLocalDb,
  });
  const conn = buildPoolSslOptions(
    config.databaseUrl,
    config.allowInsecureLocalDb,
  );
  return new Pool({
    connectionString: conn.connectionString,
    ssl: conn.ssl,
    max: 3,
    // ロール側 default_transaction_read_only と二重で防御
    options: "-c default_transaction_read_only=on",
  });
}

/**
 * 業務 SELECT 用。BEGIN READ ONLY … COMMIT/ROLLBACK を強制する。
 * ルートからは raw pool.query を使わないこと。
 */
export async function withReadOnly<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * listen 前に必須。失敗時は process を落とす前提の closed throw。
 */
export async function runStartupDbChecks(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const userRes = await client.query<{
      session_user: string;
      current_user: string;
    }>("select session_user::text as session_user, current_user::text as current_user");
    const row = userRes.rows[0];
    if (!row || row.session_user !== LOCAL_LOGIN_USER) {
      databaseStartupFailed();
    }

    const timeoutRes = await client.query<{ v: string }>(
      "select current_setting('statement_timeout') as v",
    );
    const timeout = timeoutRes.rows[0]?.v ?? "";
    // '15s' または ms 表記（15000）を許容
    if (timeout !== "15s" && timeout !== "15000ms" && timeout !== "15000") {
      databaseStartupFailed();
    }

    await client.query("begin read only");
    try {
      await client.query("select 1");
      await client.query("commit");
    } catch {
      try {
        await client.query("rollback");
      } catch {
        /* ignore */
      }
      databaseStartupFailed();
    }

    // 書込 canary: READ ONLY 外で temp 作成を試し、失敗することを確認
    let writeBlocked = false;
    try {
      await client.query("create temporary table admin_ops_canary(id int)");
      // 成功してしまったら危険
      try {
        await client.query("drop table if exists admin_ops_canary");
      } catch {
        /* ignore */
      }
      writeBlocked = false;
    } catch {
      writeBlocked = true;
    }
    if (!writeBlocked) {
      // default_transaction_read_only で弾かれているはず。弾かれないなら fail
      databaseStartupFailed();
    }

    const privRes = await client.query<{ ok: boolean }>(
      `select not has_table_privilege(current_user, 'private.ai_generation_requests', 'INSERT') as ok`,
    );
    if (privRes.rows[0]?.ok !== true) {
      databaseStartupFailed();
    }

    // 代表 SELECT が permission エラーにならないこと
    await client.query(
      "select id from public.user_feedback limit 1",
    );
  } catch (e) {
    if (e instanceof Error && e.message.includes("database_startup")) {
      throw e;
    }
    databaseStartupFailed();
  } finally {
    client.release();
  }
}
