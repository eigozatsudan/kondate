/**
 * 時間メンテナンス用 PostgreSQL URL の閉じたパーサ。
 * 接続文字列を返すだけで、ログ・シリアライズ・toString ヘルパは持たない。
 * ローカルは Compose 内部の `db:5432` のみ。本番は managed project ref に束縛する。
 */

const localLoginUser = "kondate_maintenance_login";
const managedProjectRefPattern = /^[a-z0-9]{20}$/u;
const poolerHostPattern = /^[a-z0-9-]+\.pooler\.supabase\.com$/u;

export type MaintenanceEnvironmentMode = "local" | "production";

export type ParseMaintenanceDatabaseEnvOptions =
  { mode: "local" } | { mode: "production"; expectedProjectRef: string };

/**
 * CONTEXT=dev かつ KONDATE_MAINTENANCE_ENV=local のときだけ local。
 * 片方だけ・deploy-preview・branch-deploy・production はすべて production 厳格解釈。
 */
export function selectMaintenanceEnvironmentMode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): MaintenanceEnvironmentMode {
  if (env.CONTEXT === "dev" && env.KONDATE_MAINTENANCE_ENV === "local") {
    return "local";
  }
  return "production";
}

function closedFailure(): never {
  throw new Error("maintenance_db_url_invalid");
}

function assertNoBrowserAlias(env: Record<string, string | undefined>): void {
  // 空文字でもキー存在自体を拒否する（ブラウザへ漏れる経路を閉じる）
  if (Object.hasOwn(env, "VITE_SUPABASE_MAINTENANCE_DB_URL")) {
    closedFailure();
  }
}

function parseUrlOpaque(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    closedFailure();
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    closedFailure();
  }
  if (!parsed.password || parsed.password.length === 0) {
    closedFailure();
  }
  if (parsed.pathname !== "/postgres") {
    closedFailure();
  }
  if (parsed.hash) {
    closedFailure();
  }
  // クエリは sslmode 1 キーのみ。options / search_path / timeout 等の上書きを拒否
  const keys = [...parsed.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "sslmode") {
    closedFailure();
  }
  if (parsed.searchParams.getAll("sslmode").length !== 1) {
    closedFailure();
  }
  return parsed;
}

function parseLocal(env: Record<string, string | undefined>): string {
  assertNoBrowserAlias(env);
  const raw = env.SUPABASE_MAINTENANCE_DB_URL;
  if (typeof raw !== "string" || raw.length === 0) {
    closedFailure();
  }
  const parsed = parseUrlOpaque(raw);
  if (decodeURIComponent(parsed.username) !== localLoginUser) {
    closedFailure();
  }
  // コンテナ内部アドレスのみ。ホスト公開 127.0.0.1:54322 は受理しない
  if (parsed.hostname !== "db" || parsed.port !== "5432") {
    closedFailure();
  }
  if (parsed.searchParams.get("sslmode") !== "disable") {
    closedFailure();
  }
  return raw;
}

function parseProduction(
  env: Record<string, string | undefined>,
  expectedProjectRef: string,
): string {
  assertNoBrowserAlias(env);
  if (!managedProjectRefPattern.test(expectedProjectRef)) {
    closedFailure();
  }
  const raw = env.SUPABASE_MAINTENANCE_DB_URL;
  if (typeof raw !== "string" || raw.length === 0) {
    closedFailure();
  }
  const parsed = parseUrlOpaque(raw);
  const sslmode = parsed.searchParams.get("sslmode");
  if (sslmode !== "require" && sslmode !== "verify-ca" && sslmode !== "verify-full") {
    closedFailure();
  }
  if (parsed.port !== "5432") {
    closedFailure();
  }

  const username = decodeURIComponent(parsed.username);
  const directHost = `db.${expectedProjectRef}.supabase.co`;
  const sessionUser = `${localLoginUser}.${expectedProjectRef}`;

  const isDirect = username === localLoginUser && parsed.hostname === directHost;
  const isSession = username === sessionUser && poolerHostPattern.test(parsed.hostname);

  if (!isDirect && !isSession) {
    closedFailure();
  }
  return raw;
}

/**
 * 検証済み接続文字列を返す。失敗時は閉じたコードのみ。
 * 例外メッセージに URL / パスワード / host / project ref を載せない。
 */
export function parseMaintenanceDatabaseEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  options: ParseMaintenanceDatabaseEnvOptions,
): string {
  const record = env as Record<string, string | undefined>;
  if (options.mode === "local") {
    return parseLocal(record);
  }
  if (typeof options.expectedProjectRef !== "string" || options.expectedProjectRef.length === 0) {
    closedFailure();
  }
  return parseProduction(record, options.expectedProjectRef);
}
