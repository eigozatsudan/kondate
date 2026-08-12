/**
 * 7 画面（共有レシピ含む）分の API ルートを Hono に接続する。
 * 業務 SQL は withReadOnly 経由のみ。
 * 共有レシピは構造化本文を返すため localToken 設定時のみ登録する。
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
import {
  getSharedRecipe,
  listSharedRecipes,
} from "../queries/sharedRecipes.js";

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

/**
 * ADM7: :id 用。8-4-4-4-12 の hex UUID のみ（PG cast 500 を避ける）。
 * shared-recipes / generations / feedback で共通。
 */
const ADMIN_RESOURCE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      const id = c.req.param("id");
      // ADM7: 不正 UUID は 400（shared-recipes と揃え PG cast 500 を避ける）
      if (!id || !ADMIN_RESOURCE_UUID_RE.test(id)) {
        throw badRequest("invalid_id", "id が不正です。");
      }
      const pool = requirePool(deps.pool);
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
      const id = c.req.param("id");
      // ADM7: 不正 UUID は 400
      if (!id || !ADMIN_RESOURCE_UUID_RE.test(id)) {
        throw badRequest("invalid_id", "id が不正です。");
      }
      const pool = requirePool(deps.pool);
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

  // 共有レシピは構造化本文を返すため token 未設定時はルート自体を載せない
  if (deps.config.localToken) {
    app.get("/api/shared-recipes", async (c) => {
      try {
        // クエリ検証を pool 取得より先に行い、不正入力を DB 不在でも 400 にできる
        const q = c.req.query();
        // Spec §7.1: from/to 必須（親 jst の「双方省略=直近7日」は共有レシピでは使わない）
        if (!q.from || !q.to) {
          throw badRequest(
            "date_range_required",
            "日付範囲 from と to は必須です。",
          );
        }
        const range = parseJstDateRange({ from: q.from, to: q.to });
        const status =
          q.status === "active" || q.status === "disabled"
            ? q.status
            : undefined;
        const mealType =
          q.mealType === "breakfast" ||
          q.mealType === "lunch" ||
          q.mealType === "dinner"
            ? q.mealType
            : undefined;
        if (q.status && !status) {
          throw badRequest("invalid_status", "status が不正です。");
        }
        if (q.mealType && !mealType) {
          throw badRequest("invalid_meal_type", "mealType が不正です。");
        }
        const pool = requirePool(deps.pool);
        const data = await withReadOnly(pool, (client) =>
          listSharedRecipes(client, {
            fromUtc: range.fromUtc,
            toUtcExclusive: range.toUtcExclusive,
            status,
            mealType,
            limit: clampLimit(q.limit),
            offset: clampOffset(q.offset),
          }),
        );
        return ok(c, data);
      } catch (e) {
        return fail(c, e);
      }
    });

    app.get("/api/shared-recipes/:id", async (c) => {
      try {
        const id = c.req.param("id");
        // RFC 型 UUID のみ受理（緩い 36 文字 hex+`-` は PG cast 500 を避ける）
        if (!id || !ADMIN_RESOURCE_UUID_RE.test(id)) {
          throw badRequest("invalid_id", "id が不正です。");
        }
        const pool = requirePool(deps.pool);
        const data = await withReadOnly(pool, (client) =>
          getSharedRecipe(client, id),
        );
        if (!data) throw notFound();
        return ok(c, data);
      } catch (e) {
        return fail(c, e);
      }
    });
  } else {
    console.warn(
      "[admin] ADMIN_LOCAL_TOKEN 未設定のため共有レシピ API は無効です。",
    );
  }
}
