import type { Context } from "hono";
import type { AdminConfig } from "../config.js";
import { connectionHostLabel } from "../config.js";

export type HealthDeps = {
  config: AdminConfig;
  dbReady: boolean;
  sessionUser: string | null;
};

/** direct host の 20 文字 project-ref。health は token 免除のため丸める */
const DIRECT_HOST_REF_RE = /^db\.[a-z0-9]{20}\.supabase\.co(?=:\d+$|$)/iu;
/** pooler session_user の role.ref。health から ref を推測しにくくする */
const SESSION_USER_REF_RE = /^kondate_ops_readonly\.[a-z0-9]{20}$/iu;

/** health 用。dashboard（token 必須）の表示は生の host のまま */
export function redactHealthConnectionHost(label: string): string {
  return label.replace(DIRECT_HOST_REF_RE, "db.***.supabase.co");
}

/** health 用。role.ref の project-ref だけ伏せる */
export function redactHealthSessionUser(user: string | null): string | null {
  if (user === null) return null;
  return SESSION_USER_REF_RE.test(user) ? "kondate_ops_readonly.***" : user;
}

export function healthHandler(deps: HealthDeps) {
  return (c: Context) => {
    const connectionHost = (() => {
      try {
        return redactHealthConnectionHost(connectionHostLabel(deps.config.databaseUrl));
      } catch {
        return null;
      }
    })();

    return c.json({
      ok: true as const,
      data: {
        status: deps.dbReady ? ("up" as const) : ("degraded" as const),
        dbReady: deps.dbReady,
        connectionHost,
        sessionUser: redactHealthSessionUser(deps.sessionUser),
      },
    });
  };
}
