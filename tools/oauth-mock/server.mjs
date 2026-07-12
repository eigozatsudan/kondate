import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const json = (response, status, value, origin) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...(origin === undefined ? {} : { "access-control-allow-origin": origin, vary: "Origin" }),
  });
  response.end(JSON.stringify(value));
};
const readJson = async (request) => {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_048) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

export function createOAuthMockServer({ appOrigin, fixture, now, issueLocalCredentials }) {
  const pending = new Map();
  const callback = new URL("/auth/callback", appOrigin).href;
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://oauth-mock.invalid");
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { status: "ok" });
    }
    if (request.method === "GET" && url.pathname === "/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri");
      const flow = url.searchParams.get("flow");
      const state = url.searchParams.get("state");
      const action = url.searchParams.get("action");
      if (redirectUri !== callback || !/^[0-9a-f-]{36}$/u.test(flow ?? "") ||
          state === null || state.length < 32 || state.length > 256 ||
          ![null, "approve", "cancel"].includes(action)) {
        return json(response, 400, { error: "invalid_request" });
      }
      if (action === null) {
        const approve = new URL(url); approve.searchParams.set("action", "approve");
        const cancel = new URL(url); cancel.searchParams.set("action", "cancel");
        response.writeHead(200, { "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
          "cache-control": "no-store" });
        return response.end(`<!doctype html><html lang="ja"><meta charset="utf-8">
          <title>ローカルGoogle認証</title><main><h1>ローカルGoogle認証</h1>
          <p>${fixture.displayName}として続けます。</p>
          <a href="${approve.pathname}${approve.search}">Googleテスト利用者で続ける</a>
          <a href="${cancel.pathname}${cancel.search}">キャンセル</a></main></html>`);
      }
      const destination = new URL(callback);
      destination.searchParams.set("flow", flow);
      destination.searchParams.set("state", state);
      if (action === "cancel") {
        destination.searchParams.set("error", "access_denied");
      } else {
        const code = randomBytes(32).toString("base64url");
        pending.set(code, { createdAt: now().getTime(), fixture });
        destination.searchParams.set("code", code);
      }
      response.writeHead(302, { location: destination.href, "cache-control": "no-store" });
      return response.end();
    }
    if (request.method === "OPTIONS" && url.pathname === "/exchange") {
      if (request.headers.origin !== appOrigin) return json(response, 403, { error: "origin_forbidden" });
      response.writeHead(204, { "access-control-allow-origin": appOrigin,
        "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type",
        vary: "Origin" });
      return response.end();
    }
    if (request.method === "POST" && url.pathname === "/exchange") {
      if (request.headers.origin !== appOrigin) return json(response, 403, { error: "origin_forbidden" });
      try {
        const body = await readJson(request);
        const code = typeof body.code === "string" ? body.code : "";
        const record = pending.get(code);
        pending.delete(code);
        if (record === undefined || now().getTime() - record.createdAt > 300_000) {
          return json(response, 404, { error: "code_unavailable" }, appOrigin);
        }
        const credentials = await issueLocalCredentials(record.fixture);
        return json(response, 200, credentials, appOrigin);
      } catch {
        return json(response, 400, { error: "invalid_request" }, appOrigin);
      }
    }
    return json(response, 404, { error: "not_found" });
  });
}

async function createLocalCredentialIssuer(env) {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OAUTH_MOCK_USER_PASSWORD"];
  for (const key of required) if (typeof env[key] !== "string" || env[key] === "") {
    throw new Error(`oauth_mock_missing_${key.toLowerCase()}`);
  }
  return async (fixture) => {
    const response = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST", headers: { authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email: fixture.email, password: env.OAUTH_MOCK_USER_PASSWORD,
        email_confirm: true, user_metadata: { provider: fixture.provider,
          providerSubject: fixture.subject, displayName: fixture.displayName } }),
    });
    if (!response.ok && response.status !== 422) throw new Error("oauth_mock_user_unavailable");
    return { email: fixture.email, password: env.OAUTH_MOCK_USER_PASSWORD };
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/google-user.json", import.meta.url), "utf8"));
  const issueLocalCredentials = await createLocalCredentialIssuer(process.env);
  const port = Number(process.env.PORT ?? "8788");
  createOAuthMockServer({ appOrigin: "http://127.0.0.1:5173", fixture,
    now: () => new Date(), issueLocalCredentials }).listen(port, "0.0.0.0", () => {
      console.log(`oauth-mock listening on ${port}`);
    });
}
