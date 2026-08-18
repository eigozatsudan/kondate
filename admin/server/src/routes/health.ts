import type { Context } from "hono";
import type { AdminConfig } from "../config.js";
import { connectionHostLabel } from "../config.js";
import { redactHealthConnectionHost, redactHealthSessionUser } from "../lib/redact-connection.js";

export type HealthDeps = {
  config: AdminConfig;
  dbReady: boolean;
  sessionUser: string | null;
};

/** 既存 import 向け。実装は lib/redact-connection（startup と共有） */
export { redactHealthConnectionHost, redactHealthSessionUser };

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
