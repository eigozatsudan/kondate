/**
 * 本番 origin に対する非認証スモーク。本文・環境値は出さない。
 * プローブ失敗時はプローブ名と HTTP ステータスのみ。
 */
import { pathToFileURL } from "node:url";

const PROBES = [
  {
    name: "root",
    path: "/",
    method: "GET",
    assert: async (response) => {
      if (response.status !== 200) return `root ${response.status}`;
      const text = await response.text();
      if (!text.includes('id="root"') && !text.includes("id='root'")) {
        return "root missing_mount";
      }
      return null;
    },
  },
  {
    name: "generations_menu",
    path: "/api/generations/menu",
    method: "POST",
    assert: async (response) => {
      if (response.status !== 401) return `generations_menu ${response.status}`;
      // 実APIは handleError の nested envelope: { ok:false, error:{ code } }
      const body = await response.json().catch(() => null);
      if (!body || body.ok !== false || body.error?.code !== "auth_required") {
        return "generations_menu auth_required_missing";
      }
      return null;
    },
  },
  {
    name: "account_delete",
    path: "/api/account",
    method: "DELETE",
    assert: async (response) => {
      if (response.status !== 401) return `account_delete ${response.status}`;
      const body = await response.json().catch(() => null);
      if (!body || body.ok !== false || body.error?.code !== "auth_required") {
        return "account_delete auth_required_missing";
      }
      return null;
    },
  },
];

export function parseSmokeOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("smoke_origin_invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new Error("smoke_origin_invalid");
  }
  if (value !== parsed.origin) {
    throw new Error("smoke_origin_invalid");
  }
  return value;
}

/**
 * @param {string} origin already-verified PRODUCTION_ORIGIN string
 * @param {typeof fetch} fetchImpl
 */
export async function runSmokeProbes(origin, fetchImpl = fetch) {
  const verified = parseSmokeOrigin(origin);
  for (const probe of PROBES) {
    const response = await fetchImpl(`${verified}${probe.path}`, {
      method: probe.method,
      signal: AbortSignal.timeout(5_000),
      headers: probe.method === "POST" ? { "content-type": "application/json" } : undefined,
      body: probe.method === "POST" ? "{}" : undefined,
    });
    const failure = await probe.assert(response);
    if (failure) {
      throw new Error(failure);
    }
  }
  return verified;
}

export async function main(argv = process.argv.slice(2), fetchImpl = fetch, write = console.error) {
  if (argv.length !== 1) {
    write("smoke: origin_required");
    return 1;
  }
  try {
    await runSmokeProbes(argv[0], fetchImpl);
    return 0;
  } catch (error) {
    const code = error instanceof Error ? error.message : "smoke_failed";
    write(`smoke: ${code}`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main();
}
