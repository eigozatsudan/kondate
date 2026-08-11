import type { Context } from "hono";
import type { AdminConfig } from "../config.js";
import { connectionHostLabel } from "../config.js";

export type HealthDeps = {
  config: AdminConfig;
  dbReady: boolean;
  sessionUser: string | null;
};

export function healthHandler(deps: HealthDeps) {
  return (c: Context) => {
    const connectionHost = (() => {
      try {
        return connectionHostLabel(deps.config.databaseUrl);
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
        sessionUser: deps.sessionUser,
      },
    });
  };
}
