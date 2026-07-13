import { createHmac, randomBytes } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";

const force = process.argv.includes("--force");
const output = ".env";

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
if (force) {
  const existing = await readFile(output, "utf8");
  for (const line of existing.split(/\r?\n/u)) {
    if (line.startsWith("OAUTH_MOCK_USER_PASSWORD=")) {
      values.set("OAUTH_MOCK_USER_PASSWORD", line.slice("OAUTH_MOCK_USER_PASSWORD=".length));
    }
  }
}

const base64url = (value) => Buffer.from(value).toString("base64url");
const jwtSecret = randomBytes(32).toString("hex");
const now = Math.floor(Date.now() / 1000);
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
values.set("SERVER_SITE_ORIGIN", "http://127.0.0.1:5173");
values.set("DASHBOARD_USERNAME", "kondate");
values.set("DASHBOARD_PASSWORD", randomBytes(24).toString("base64url"));
values.set("SECRET_KEY_BASE", randomBytes(48).toString("hex"));
values.set("VAULT_ENC_KEY", randomBytes(16).toString("hex"));
values.set("SITE_URL", "http://127.0.0.1:5173");
values.set("ADDITIONAL_REDIRECT_URLS", "http://127.0.0.1:5173/**");
values.set("API_EXTERNAL_URL", "http://127.0.0.1:8000");
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
values.set(
  "LOCAL_DB_URL",
  `postgresql://postgres:${values.get("POSTGRES_PASSWORD")}@127.0.0.1:54322/postgres`,
);
values.set("OPENROUTER_BASE_URL", "http://openrouter-mock:8787");

const rendered = [...values.entries()]
  .map(
    ([key, value]) =>
      `${key}=${/[^A-Za-z0-9_./:*@?=-]/u.test(value) ? JSON.stringify(value) : value}`,
  )
  .join("\n");
await writeFile(output, `${rendered}\n`, { mode: 0o600 });
console.log("Created .env with local-only credentials");
