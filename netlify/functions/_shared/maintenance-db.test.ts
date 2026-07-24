import { afterEach, describe, expect, it, vi } from "vitest";

const connect = vi.fn();
const query = vi.fn();
const end = vi.fn();
const Client = vi.fn(function MockClient(this: unknown) {
  return { connect, query, end };
});

vi.mock("pg", () => ({
  default: { Client },
  Client,
}));

const { runMaintenance } = await import("./maintenance-db.js");

afterEach(() => {
  vi.clearAllMocks();
});

const counts = {
  staleReservationsFinalized: 1,
  generationLedgersDeleted: 2,
  shoppingMutationsDeleted: 3,
  authContinuationsDeleted: 4,
};

function mockHappyPath(): void {
  connect.mockResolvedValue(undefined);
  end.mockResolvedValue(undefined);
  query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("select session_user")) {
      // pre-begin: login / login; in-tx after set local role: login / executor
      const callIndex = query.mock.calls.filter((c) =>
        String(c[0]).startsWith("select session_user"),
      ).length;
      if (callIndex <= 1) {
        return {
          rows: [
            {
              session_user: "kondate_maintenance_login",
              current_user: "kondate_maintenance_login",
              statement_timeout: "20s",
            },
          ],
        };
      }
      return {
        rows: [
          {
            session_user: "kondate_maintenance_login",
            current_user: "kondate_maintenance_executor",
            statement_timeout: "20s",
          },
        ],
      };
    }
    if (sql.includes("run_kondate_maintenance")) {
      return { rows: [{ counts }] };
    }
    return { rows: [] };
  });
}

describe("runMaintenance", () => {
  it("uses one client, fixed parameterized RPC SQL, and four-count parse before commit", async () => {
    mockHappyPath();
    const result = await runMaintenance({
      connectionString: "postgresql://x",
      now: "2026-07-24T12:00:00.000Z",
      batchSize: 250,
    });
    expect(result).toEqual(counts);
    expect(Client).toHaveBeenCalledTimes(1);
    const clientMock = Client as unknown as {
      mock: { calls: unknown[][] };
    };
    const clientOptions = clientMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(clientOptions).toMatchObject({
      application_name: "kondate-maintenance",
      connectionTimeoutMillis: 5_000,
      query_timeout: 25_000,
    });
    const sqlCalls = query.mock.calls.map((c) => String(c[0]));
    expect(sqlCalls).toContain("begin");
    expect(sqlCalls).toContain("set local role kondate_maintenance_executor");
    expect(sqlCalls).toContain("set local statement_timeout = '20s'");
    expect(sqlCalls.some((s) => s.includes("run_kondate_maintenance"))).toBe(true);
    const rpcCall = query.mock.calls.find((c) => String(c[0]).includes("run_kondate_maintenance"));
    expect(rpcCall?.[1]).toEqual(["2026-07-24T12:00:00.000Z", 250]);
    expect(sqlCalls).toContain("commit");
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("rolls back and ends on malformed counts", async () => {
    mockHappyPath();
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("select session_user")) {
        const callIndex = query.mock.calls.filter((c) =>
          String(c[0]).startsWith("select session_user"),
        ).length;
        if (callIndex <= 1) {
          return {
            rows: [
              {
                session_user: "kondate_maintenance_login",
                current_user: "kondate_maintenance_login",
                statement_timeout: "20s",
              },
            ],
          };
        }
        return {
          rows: [
            {
              session_user: "kondate_maintenance_login",
              current_user: "kondate_maintenance_executor",
              statement_timeout: "20s",
            },
          ],
        };
      }
      if (sql.includes("run_kondate_maintenance")) {
        return {
          rows: [
            {
              counts: {
                ...counts,
                extraCategory: 1,
              },
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      runMaintenance({
        connectionString: "postgresql://x",
        now: "2026-07-24T12:00:00.000Z",
        batchSize: 250,
      }),
    ).rejects.toThrow("maintenance_failed");
    const sqlCalls = query.mock.calls.map((c) => String(c[0]));
    expect(sqlCalls).toContain("rollback");
    expect(sqlCalls).not.toContain("commit");
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("ends the client after SQL failure and never leaks driver text", async () => {
    mockHappyPath();
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("select session_user")) {
        return {
          rows: [
            {
              session_user: "kondate_maintenance_login",
              current_user: "kondate_maintenance_login",
              statement_timeout: "20s",
            },
          ],
        };
      }
      if (sql === "begin") {
        const err = new Error("password=supersecret host=db.abcdefghijklmnopqrst.supabase.co");
        (err as { code?: string }).code = "57014";
        throw err;
      }
      return { rows: [] };
    });

    await expect(
      runMaintenance({
        connectionString: "postgresql://user:pass@host/db",
        now: "2026-07-24T12:00:00.000Z",
        batchSize: 250,
      }),
    ).rejects.toThrow("maintenance_failed");
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("constructs no client when connection string is empty (caller parse failure path)", async () => {
    // 環境パース失敗は呼び出し側で client を作らない。アダプタ自体は
    // 接続を試みるが、このテストは Client が 1 回だけであることを固定する。
    mockHappyPath();
    connect.mockRejectedValue(new Error("ECONNREFUSED secret-host"));
    await expect(
      runMaintenance({
        connectionString: "postgresql://x",
        now: "2026-07-24T12:00:00.000Z",
        batchSize: 250,
      }),
    ).rejects.toThrow("maintenance_failed");
    expect(Client).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("rejects wrong pre-transaction role/timeout without beginning work", async () => {
    mockHappyPath();
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("select session_user")) {
        return {
          rows: [
            {
              session_user: "postgres",
              current_user: "postgres",
              statement_timeout: "0",
            },
          ],
        };
      }
      return { rows: [] };
    });
    await expect(
      runMaintenance({
        connectionString: "postgresql://x",
        now: "2026-07-24T12:00:00.000Z",
        batchSize: 250,
      }),
    ).rejects.toThrow("maintenance_failed");
    const sqlCalls = query.mock.calls.map((c) => String(c[0]));
    expect(sqlCalls).not.toContain("begin");
    expect(end).toHaveBeenCalledTimes(1);
  });
});
