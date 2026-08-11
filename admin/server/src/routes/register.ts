/**
 * 6 画面分の API ルートを Hono に接続する。
 * 業務 SQL は withReadOnly 経由のみ。
 */
import type { Hono } from "hono";
import type { Pool } from "pg";
import type { AdminConfig } from "../config.js";
import { connectionHostLabel } from "../config.js";
import { withReadOnly } from "../db.js";
import { badRequest, notFound } from "../errors.js";
import { fail, ok } from "../lib/envelope.js";
import {
  clampLimit,
  clampOffset,
  getJstDateKey,
  jstDayStartUtc,
  parseJstDateRange,
  addJstDays,
} from "../lib/jst.js";
import { getBilling } from "../queries/billing.js";
import { getDashboard } from "../queries/dashboard.js";
import { getFeedback, listFeedback } from "../queries/feedback.js";
import { getGeneration, listGenerations } from "../queries/generations.js";
import { getQuotaHealth } from "../queries/quotaHealth.js";
import { getShareJobs } from "../queries/shareJobs.js";

export type RouteDeps = {
  pool: Pool | null;
  config: AdminConfig;
  sessionUser?: string | null;
};

function requirePool(pool: Pool | null): Pool {
  if (!pool) {
    throw badRequest("db_unavailable", "データベースに接続できません。");
  }
  return pool;
}

export function registerApiRoutes(app: Hono, deps: RouteDeps): void {
  app.get("/api/dashboard", async (c) => {
    try {
      const pool = requirePool(deps.pool);
      const q = c.req.query();
      const range = parseJstDateRange({ from: q.from, to: q.to });
      const todayJst = getJstDateKey();
      const data = await withReadOnly(pool, (client) =>
        getDashboard(client, {
          fromUtc: range.fromUtc,
          toUtcExclusive: range.toUtcExclusive,
          fromJst: range.fromJst,
          toJst: range.toJst,
          todayJst,
          connectionHost: connectionHostLabel(deps.config.databaseUrl),
          sessionUser: deps.sessionUser ?? "kondate_ops_readonly",
        }),
      );
      return ok(c, data);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get("/api/generations", async (c) => {
    try {
      const pool = requirePool(deps.pool);
      const q = c.req.query();
      const range = parseJstDateRange({ from: q.from, to: q.to });
      const data = await withReadOnly(pool, (client) =>
        listGenerations(client, {
          fromUtc: range.fromUtc,
          toUtcExclusive: range.toUtcExclusive,
          status: q.status || undefined,
          requestKind: q.requestKind || undefined,
          failureCode: q.failureCode || undefined,
          userId: q.userId || undefined,
          limit: clampLimit(q.limit),
          offset: clampOffset(q.offset),
        }),
      );
      return ok(c, { items: data, range: { from: range.fromJst, to: range.toJst } });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get("/api/generations/:id", async (c) => {
    try {
      const pool = requirePool(deps.pool);
      const id = c.req.param("id");
      if (!id) throw notFound();
      const data = await withReadOnly(pool, (client) => getGeneration(client, id));
      if (!data) throw notFound();
      return ok(c, data);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get("/api/feedback", async (c) => {
    try {
      const pool = requirePool(deps.pool);
      const q = c.req.query();
      const range = parseJstDateRange({ from: q.from, to: q.to });
      const data = await withReadOnly(pool, (client) =>
        listFeedback(client, {
          fromUtc: range.fromUtc,
          toUtcExclusive: range.toUtcExclusive,
          category: q.category || undefined,
          userId: q.userId || undefined,
          limit: clampLimit(q.limit),
          offset: clampOffset(q.offset),
        }),
      );
      return ok(c, { items: data, range: { from: range.fromJst, to: range.toJst } });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get("/api/feedback/:id", async (c) => {
    try {
      const pool = requirePool(deps.pool);
      const id = c.req.param("id");
      if (!id) throw notFound();
      // 全文は includeBody=1 の明示時のみ（キーワード検索は未実装）
      const includeBody = c.req.query("includeBody") === "1";
      const data = await withReadOnly(pool, (client) =>
        getFeedback(client, id, includeBody),
      );
      if (!data) throw notFound();
      return ok(c, data);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get("/api/quota-health", async (c) => {
    try {
      const pool = requirePool(deps.pool);
      const now = new Date();
      const todayJst = getJstDateKey(now);
      const dayFromUtc = jstDayStartUtc(todayJst);
      const dayToUtcExclusive = jstDayStartUtc(addJstDays(todayJst, 1));
      const data = await withReadOnly(pool, (client) =>
        getQuotaHealth(client, {
          dayFromUtc,
          dayToUtcExclusive,
          range24hFrom: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          range7dFrom: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          now,
        }),
      );
      return ok(c, data);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get("/api/billing", async (c) => {
    try {
      const pool = requirePool(deps.pool);
      // webhook 集計は直近 7 日（JST）
      const range = parseJstDateRange({});
      const data = await withReadOnly(pool, (client) =>
        getBilling(client, {
          webhookFromUtc: range.fromUtc,
          webhookToUtcExclusive: range.toUtcExclusive,
        }),
      );
      return ok(c, data);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get("/api/share-jobs", async (c) => {
    try {
      const pool = requirePool(deps.pool);
      const q = c.req.query();
      const range = parseJstDateRange({ from: q.from, to: q.to });
      const data = await withReadOnly(pool, (client) =>
        getShareJobs(client, {
          fromUtc: range.fromUtc,
          toUtcExclusive: range.toUtcExclusive,
          status: q.status || undefined,
          failureCode: q.failureCode || undefined,
          limit: clampLimit(q.limit),
          offset: clampOffset(q.offset),
        }),
      );
      return ok(c, data);
    } catch (e) {
      return fail(c, e);
    }
  });
}
