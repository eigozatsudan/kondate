// ローカル開発用の .env を生成する。infra/supabase/.env.example をベースに、
// パスワード・JWT・APIキーなどのローカル専用シークレットを都度ランダム生成して
// 上書きし、既存の .env は --force を渡さない限り保護する（誤って
// 本番相当の設定を上書きしないため）。生成後は一時ファイル経由でアトミックに
// .env へリネームする。
import { createHmac, randomBytes } from "node:crypto";
import { access, open, readFile, rename, unlink } from "node:fs/promises";

const force = process.argv.includes("--force");
const output = ".env";

// --force なしで既存の .env がある場合は上書きせず失敗させる。
if (!force) {
  try {
    await access(output);
    throw new Error(".env already exists; pass --force to rotate local-only credentials");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(".env already")) throw error;
  }
}

const source = await readFile("infra/supabase/.env.example", "utf8");
const values = new Map();
for (const line of source.split(/\r?\n/u)) {
  if (line.length === 0 || line.startsWith("#") || !line.includes("=")) continue;
  const separator = line.indexOf("=");
  values.set(line.slice(0, separator), line.slice(separator + 1));
}
values.delete("COMPOSE_FILE");
if (force) {
  // --force での再生成時は、既存のOAuthモック用パスワードだけは維持する
  // （ローテーションのたびにモックログイン情報が変わると不便なため）。
  let existing = "";
  try {
    existing = await readFile(output, "utf8");
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  for (const line of existing.split(/\r?\n/u)) {
    if (line.startsWith("OAUTH_MOCK_USER_PASSWORD=")) {
      values.set("OAUTH_MOCK_USER_PASSWORD", line.slice("OAUTH_MOCK_USER_PASSWORD=".length));
    }
  }
}

const base64url = (value) => Buffer.from(value).toString("base64url");
const jwtSecret = randomBytes(32).toString("hex");
const now = Math.floor(Date.now() / 1000);
// ローカルSupabase用のanon/service_roleロールJWTを自前で署名する
// （本番のSupabase発行鍵とは無関係な、このチェックアウト限定の鍵）。
const signRole = (role) => {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ role, iss: "supabase", iat: now, exp: now + 315_576_000 }),
  );
  const signature = createHmac("sha256", jwtSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
};

values.set("POSTGRES_PASSWORD", randomBytes(24).toString("hex"));
values.set("JWT_SECRET", jwtSecret);
values.set("ANON_KEY", signRole("anon"));
values.set("SERVICE_ROLE_KEY", signRole("service_role"));
values.set("AUTH_CONTINUATION_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
values.set("AUTH_CONTINUATION_TTL_SECONDS", "300");
const localUid = process.env.LOCAL_UID ?? "1000";
const localGid = process.env.LOCAL_GID ?? "1000";
if (!/^\d+$/u.test(localUid) || !/^\d+$/u.test(localGid)) {
  throw new Error("LOCAL_UID and LOCAL_GID must be numeric");
}
values.set("LOCAL_UID", localUid);
values.set("LOCAL_GID", localGid);
const composeProjectName = process.env.KONDATE_COMPOSE_PROJECT_NAME ?? "";
if (!/^kondate-[0-9a-f]{32}$/u.test(composeProjectName)) {
  throw new Error("KONDATE_COMPOSE_PROJECT_NAME must be a derived checkout identity");
}
values.set("KONDATE_COMPOSE_PROJECT_NAME", composeProjectName);
values.set("REALTIME_DB_ENC_KEY", randomBytes(8).toString("hex"));
values.set("PG_META_CRYPTO_KEY", randomBytes(24).toString("base64url"));
values.set("LOGFLARE_PUBLIC_ACCESS_TOKEN", randomBytes(24).toString("base64url"));
values.set("LOGFLARE_PRIVATE_ACCESS_TOKEN", randomBytes(24).toString("base64url"));
values.set("S3_PROTOCOL_ACCESS_KEY_ID", randomBytes(16).toString("hex"));
values.set("S3_PROTOCOL_ACCESS_KEY_SECRET", randomBytes(32).toString("hex"));
values.set("SERVER_SITE_ORIGIN", "http://127.0.0.1:5173");
values.set("DASHBOARD_USERNAME", "kondate");
values.set("DASHBOARD_PASSWORD", randomBytes(24).toString("base64url"));
values.set("SECRET_KEY_BASE", randomBytes(48).toString("hex"));
values.set("VAULT_ENC_KEY", randomBytes(16).toString("hex"));
values.set("SITE_URL", "http://127.0.0.1:5173");
values.set("ADDITIONAL_REDIRECT_URLS", "http://127.0.0.1:5173/**");
values.set("API_EXTERNAL_URL", "http://127.0.0.1:8000/auth/v1");
values.set("SUPABASE_PUBLIC_URL", "http://127.0.0.1:8000");
values.set("SMTP_HOST", "mailpit");
values.set("SMTP_PORT", "1025");
values.set("SMTP_USER", "mailpit");
values.set("SMTP_PASS", "mailpit");
values.set("SMTP_ADMIN_EMAIL", "noreply@kondate.local");
values.set("SMTP_SENDER_NAME", "こんだて日和");
values.set("ENABLE_EMAIL_AUTOCONFIRM", "false");
values.set("ENABLE_GOOGLE_SIGNUP", "false");
values.set("GOOGLE_CLIENT_ID", "");
values.set("GOOGLE_SECRET", "");
values.set("GOOGLE_REDIRECT_URI", "http://127.0.0.1:8000/auth/v1/callback");
for (const key of [
  "MAILER_URLPATHS_CONFIRMATION",
  "MAILER_URLPATHS_INVITE",
  "MAILER_URLPATHS_RECOVERY",
  "MAILER_URLPATHS_EMAIL_CHANGE",
]) {
  values.set(key, "/auth/v1/verify");
}
if (!values.has("OAUTH_MOCK_USER_PASSWORD") || values.get("OAUTH_MOCK_USER_PASSWORD") === "") {
  values.set("OAUTH_MOCK_USER_PASSWORD", randomBytes(24).toString("base64url"));
}
values.set("VITE_SUPABASE_URL", "http://127.0.0.1:8000");
values.set("VITE_MAGIC_LINK_RESEND_SECONDS", "60");
values.set("VITE_AUTH_CONTINUATION_TTL_MS", "300000");
values.set("VITE_AUTH_PROVIDER_MODE", "oauth_mock");
values.set("VITE_OAUTH_MOCK_ORIGIN", "http://127.0.0.1:8788");
values.set("OPENROUTER_BASE_URL", "http://openrouter-mock:8787/api/v1");

// 値に特殊文字が含まれる場合のみJSON文字列としてクォートし、通常の
// KEY=VALUE 行との互換性を保つ。
const rendered = [...values.entries()]
  .map(
    ([key, value]) =>
      `${key}=${/[^A-Za-z0-9_./:*@?=-]/u.test(value) ? JSON.stringify(value) : value}`,
  )
  .join("\n");
// 一時ファイルへ書き込んでから rename でアトミックに .env を差し替える
// （書き込み途中でのプロセス中断による破損や、他プロセスとの競合を防ぐ）。
const temporaryOutput = `.env.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
let temporaryFile;
try {
  temporaryFile = await open(temporaryOutput, "wx", 0o600);
  await temporaryFile.writeFile(`${rendered}\n`, "utf8");
  await temporaryFile.close();
  temporaryFile = undefined;
  await rename(temporaryOutput, output);
} catch (error) {
  await temporaryFile?.close().catch(() => {});
  await unlink(temporaryOutput).catch(() => {});
  throw error;
}
console.log("Created .env with local-only credentials");
