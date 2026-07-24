// @vitest-environment node
/**
 * 実ローカル PostgreSQL + kondate_maintenance_login に対する統合テスト。
 * 通常 vitest スイートからは exclude。npm run test:maintenance-db:integration で実行。
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMaintenance } from "./maintenance-db.js";
import { parseMaintenanceDatabaseEnv } from "./maintenance-env.js";

const connectionString = parseMaintenanceDatabaseEnv(process.env, { mode: "local" });

function adminClient(): Client {
  const password = process.env.POSTGRES_PASSWORD;
  if (!password) {
    throw new Error("POSTGRES_PASSWORD required for admin checks");
  }
  return new Client({
    connectionString: `postgresql://postgres:${encodeURIComponent(password)}@db:5432/postgres`,
  });
}

describe("maintenance-db integration", () => {
  beforeAll(async () => {
    // 事前条件: provision-maintenance-role.sh 済みであること
    const probe = new Client({ connectionString });
    await probe.connect();
    const roles = await probe.query(
      `select session_user::text as session_user,
              current_user::text as current_user,
              current_setting('statement_timeout') as statement_timeout`,
    );
    expect(roles.rows[0]).toMatchObject({
      session_user: "kondate_maintenance_login",
      current_user: "kondate_maintenance_login",
      statement_timeout: "20s",
    });
    await probe.end();
  });

  afterAll(async () => {
    // 残留接続がないことを軽く確認
    const admin = adminClient();
    await admin.connect();
    const active = await admin.query(
      `select count(*)::int as n from pg_stat_activity
       where application_name = 'kondate-maintenance'`,
    );
    expect(active.rows[0]?.n ?? 0).toBe(0);
    await admin.end();
  });

  it("runs maintenance under executor role and closes the connection", async () => {
    const counts = await runMaintenance({
      connectionString,
      now: new Date().toISOString(),
      batchSize: 250,
    });
    expect(counts).toEqual({
      staleReservationsFinalized: expect.any(Number),
      generationLedgersDeleted: expect.any(Number),
      shoppingMutationsDeleted: expect.any(Number),
      authContinuationsDeleted: expect.any(Number),
    });
    for (const value of Object.values(counts)) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("cancels with SQLSTATE 57014 near 20s on pg_sleep after RPC and rolls back", async () => {
    const admin = adminClient();
    await admin.connect();
    const marker = `maint-int-${Date.now()}`;
    const userId = "f9000000-0000-4000-8000-000000000001";
    await admin.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)
       on conflict (id) do nothing`,
      [userId, `${marker}@example.test`],
    );
    const older = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await admin.query(
      `insert into private.ai_generation_requests (
         id, user_id, idempotency_key, request_kind, status,
         request_hmac_version, request_hmac, user_usage_day,
         failure_code, started_at, completed_at
       ) values (
         'f9100000-0000-4000-8000-000000000001', $1,
         'f9200000-0000-4000-8000-000000000001', 'regenerate_menu', 'failed',
         'generation-command.v2', repeat('9', 64), current_date,
         'generation_timeout', $2::timestamptz, $2::timestamptz
       ) on conflict do nothing`,
      [userId, older],
    );

    const started = Date.now();
    await expect(
      runMaintenance({
        connectionString,
        now: new Date().toISOString(),
        batchSize: 250,
        testSeam: { sleepSecondsAfterRpc: 21 },
      }),
    ).rejects.toThrow("maintenance_failed");
    const elapsed = Date.now() - started;
    // DB 20s が 25s クライアントより先に勝つ
    expect(elapsed).toBeGreaterThanOrEqual(15_000);
    expect(elapsed).toBeLessThan(28_000);

    const leftover = await admin.query(
      `select count(*)::int as n from private.ai_generation_requests
       where id = 'f9100000-0000-4000-8000-000000000001'`,
    );
    expect(leftover.rows[0]?.n).toBe(1);

    const activity = await admin.query(
      `select count(*)::int as n from pg_stat_activity
       where application_name = 'kondate-maintenance'`,
    );
    expect(activity.rows[0]?.n ?? 0).toBe(0);
    await admin.end();
  }, 60_000);

  it("rolls back earlier category work when a later table is exclusively locked", async () => {
    const admin = adminClient();
    await admin.connect();
    const userId = "f9000000-0000-4000-8000-000000000002";
    const older = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await admin.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)
       on conflict (id) do nothing`,
      [userId, "maint-lock@example.test"],
    );
    await admin.query(
      `insert into private.ai_generation_requests (
         id, user_id, idempotency_key, request_kind, status,
         request_hmac_version, request_hmac, user_usage_day,
         failure_code, started_at, completed_at
       ) values (
         'f9100000-0000-4000-8000-000000000002', $1,
         'f9200000-0000-4000-8000-000000000002', 'regenerate_menu', 'failed',
         'generation-command.v2', repeat('8', 64), current_date,
         'generation_timeout', $2::timestamptz, $2::timestamptz
       ) on conflict do nothing`,
      [userId, older],
    );
    await admin.query(
      `insert into private.shopping_mutations (
         user_id, idempotency_key, request_hash, response, created_at
       ) values (
         $1, 'f9300000-0000-4000-8000-000000000001', repeat('7', 64),
         '{"ok":true}'::jsonb, $2::timestamptz
       ) on conflict do nothing`,
      [userId, older],
    );

    // 後段カテゴリの auth_continuations を ACCESS EXCLUSIVE で塞ぎ、
    // 先に進んだ generation/shopping 変更が rollback されることを証明する
    await admin.query("begin");
    await admin.query("lock table private.auth_continuations in access exclusive mode");

    const started = Date.now();
    const maintenancePromise = runMaintenance({
      connectionString,
      now: new Date().toISOString(),
      batchSize: 250,
    });

    await expect(maintenancePromise).rejects.toThrow("maintenance_failed");
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(15_000);
    expect(elapsed).toBeLessThan(28_000);

    await admin.query("rollback");

    const gen = await admin.query(
      `select count(*)::int as n from private.ai_generation_requests
       where id = 'f9100000-0000-4000-8000-000000000002'`,
    );
    const shop = await admin.query(
      `select count(*)::int as n from private.shopping_mutations
       where idempotency_key = 'f9300000-0000-4000-8000-000000000001'`,
    );
    expect(gen.rows[0]?.n).toBe(1);
    expect(shop.rows[0]?.n).toBe(1);

    const activity = await admin.query(
      `select count(*)::int as n from pg_stat_activity
       where application_name = 'kondate-maintenance'`,
    );
    expect(activity.rows[0]?.n ?? 0).toBe(0);
    await admin.end();
  }, 60_000);
});
