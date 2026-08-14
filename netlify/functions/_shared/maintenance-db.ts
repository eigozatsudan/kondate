/**
 * 時間メンテナンス用の 1 呼び出し 1 クライアント PostgreSQL アダプタ。
 * 接続前から 25s 全体締切を張り、ロール / statement_timeout ガードの後に
 * 固定 SQL で public.run_kondate_maintenance だけを呼ぶ。
 * 接続文字列・project ref・ドライバ生文はログも例外も出さない。
 */
import pg from "pg";

const { Client } = pg;

export type MaintenanceCounts = {
  staleReservationsFinalized: number;
  generationLedgersDeleted: number;
  shoppingMutationsDeleted: number;
  authContinuationsDeleted: number;
  userFeedbackDeleted: number;
  draftSubmissionsDeleted: number;
  /** identity / quality 日次・月次台帳の削除合計 */
  identityLedgersDeleted: number;
  /** flyer 週次台帳 + 終端 flyer request の削除合計 */
  flyerLedgersDeleted: number;
  /** 共有一般化 job: lease 超過 running → failed(lease_expired) の件数 */
  staleShareJobsReaped: number;
};

export type RunMaintenanceInput = {
  connectionString: string;
  now: string;
  batchSize: number;
  signal?: AbortSignal;
  /**
   * 統合テスト専用。RPC 実行後・COMMIT 前に pg_sleep する。
   * 本番ハンドラは渡さないこと。
   */
  testSeam?: { sleepSecondsAfterRpc: number };
};

const closedError = () => new Error("maintenance_failed");

const COUNT_KEYS = [
  "staleReservationsFinalized",
  "generationLedgersDeleted",
  "shoppingMutationsDeleted",
  "authContinuationsDeleted",
  "userFeedbackDeleted",
  "draftSubmissionsDeleted",
  "identityLedgersDeleted",
  "flyerLedgersDeleted",
  "staleShareJobsReaped",
] as const;

/**
 * 本番 URL は maintenance-env が sslmode=require|verify-ca|verify-full を強制済み。
 *
 * pg 8.x の ConnectionParameters は
 * `Object.assign({}, clientConfig, parse(connectionString))` のため、
 * connectionString 上の sslmode が Client の `ssl` オプションを上書きする。
 * 対策: 検証用の sslmode クエリだけ外し、TLS は `ssl.rejectUnauthorized` で明示する。
 * env に保存する URL 形状は変えない。admin `buildPoolSslOptions` と同型:
 * - require: 暗号化のみ。証明書は検証しない（Session pooler の自己署名連鎖）。
 *   verify-full を名乗って無効化はしない。
 * - verify-ca / verify-full: rejectUnauthorized: true で実際に検証する。
 *   pooler では自己署名連鎖で接続失敗し得る（require を使う）。
 * - disable（ローカル）: ssl オフ。
 */
function clientConnectionOptions(connectionString: string): {
  connectionString: string;
  ssl?: { rejectUnauthorized: boolean };
} {
  let sslmode: string | null = null;
  let stripped = connectionString;
  try {
    const parsed = new URL(connectionString);
    sslmode = parsed.searchParams.get("sslmode");
    if (sslmode !== "require" && sslmode !== "verify-ca" && sslmode !== "verify-full") {
      return { connectionString };
    }
    parsed.searchParams.delete("sslmode");
    stripped = parsed.toString();
    // URL#toString が末尾に残した空クエリを落とす
    if (stripped.endsWith("?")) {
      stripped = stripped.slice(0, -1);
    }
  } catch {
    // パース不能時は元文字を維持（上位の env パーサが既に弾いている想定）
    return { connectionString };
  }
  const verifyPeer = sslmode === "verify-ca" || sslmode === "verify-full";
  return {
    connectionString: stripped,
    ssl: { rejectUnauthorized: verifyPeer },
  };
}

function parseCounts(value: unknown): MaintenanceCounts {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw closedError();
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== COUNT_KEYS.length) {
    throw closedError();
  }
  const counts = {} as MaintenanceCounts;
  for (const key of COUNT_KEYS) {
    if (!Object.hasOwn(record, key)) {
      throw closedError();
    }
    const n = record[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      throw closedError();
    }
    counts[key] = n;
  }
  return counts;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: string }).name === "AbortError"
  );
}

/**
 * 1 回のメンテナンス呼び出し。プールなし・finally で必ず end。
 */
export async function runMaintenance(input: RunMaintenanceInput): Promise<MaintenanceCounts> {
  if (input.signal?.aborted) {
    throw closedError();
  }

  let client: pg.Client | null = null;
  let ended = false;
  let inTransaction = false;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  const endClient = async (): Promise<void> => {
    if (ended || client === null) {
      ended = true;
      return;
    }
    ended = true;
    try {
      await client.end();
    } catch {
      // 切断失敗は元エラーを置換しない
    }
  };

  const abortWait = new Promise<never>((_, reject) => {
    const fail = () => {
      reject(closedError());
    };
    deadlineTimer = setTimeout(fail, 25_000);
    if (input.signal) {
      onAbort = fail;
      if (input.signal.aborted) {
        fail();
        return;
      }
      input.signal.addEventListener("abort", fail, { once: true });
    }
  });

  const clearDeadline = (): void => {
    if (deadlineTimer !== undefined) {
      clearTimeout(deadlineTimer);
      deadlineTimer = undefined;
    }
    if (onAbort && input.signal) {
      input.signal.removeEventListener("abort", onAbort);
      onAbort = undefined;
    }
  };

  try {
    client = new Client({
      ...clientConnectionOptions(input.connectionString),
      application_name: "kondate-maintenance",
      connectionTimeoutMillis: 5_000,
      query_timeout: 25_000,
      // idle_in_transaction_session_timeout は起動オプションとして渡す
      //（ドライバが認識するキーは ClientConfig の範囲に限定）
      idle_in_transaction_session_timeout: 25_000,
    });

    await Promise.race([client.connect(), abortWait]);

    // トランザクション前ガード: LOGIN と role 既定 20s
    const pre = await Promise.race([
      client.query<{
        session_user: string;
        current_user: string;
        statement_timeout: string;
      }>(
        `select session_user::text as session_user,
                current_user::text as current_user,
                current_setting('statement_timeout') as statement_timeout`,
      ),
      abortWait,
    ]);
    const preRow = pre.rows[0];
    if (
      !preRow ||
      preRow.session_user !== "kondate_maintenance_login" ||
      preRow.current_user !== "kondate_maintenance_login" ||
      preRow.statement_timeout !== "20s"
    ) {
      throw closedError();
    }

    await Promise.race([client.query("begin"), abortWait]);
    inTransaction = true;

    await Promise.race([client.query("set local role kondate_maintenance_executor"), abortWait]);
    await Promise.race([client.query("set local statement_timeout = '20s'"), abortWait]);

    const guard = await Promise.race([
      client.query<{
        session_user: string;
        current_user: string;
        statement_timeout: string;
      }>(
        `select session_user::text as session_user,
                current_user::text as current_user,
                current_setting('statement_timeout') as statement_timeout`,
      ),
      abortWait,
    ]);
    const guardRow = guard.rows[0];
    if (
      !guardRow ||
      guardRow.session_user !== "kondate_maintenance_login" ||
      guardRow.current_user !== "kondate_maintenance_executor" ||
      guardRow.statement_timeout !== "20s"
    ) {
      throw closedError();
    }

    const result = await Promise.race([
      client.query<{ counts: unknown }>(
        "select public.run_kondate_maintenance($1::timestamptz, $2::integer) as counts",
        [input.now, input.batchSize],
      ),
      abortWait,
    ]);

    const counts = parseCounts(result.rows[0]?.counts);

    if (input.testSeam?.sleepSecondsAfterRpc) {
      // 統合テスト: DB の 20s がクライアント 25s より先に勝つことを証明する
      await Promise.race([
        client.query("select pg_sleep($1::double precision)", [
          input.testSeam.sleepSecondsAfterRpc,
        ]),
        abortWait,
      ]);
    }

    await Promise.race([client.query("commit"), abortWait]);
    inTransaction = false;
    return counts;
  } catch (error) {
    // inTransaction が true の間は client は接続済みで end 前（finally より先）
    if (inTransaction && client !== null) {
      try {
        await client.query("rollback");
      } catch {
        // プロトコル不安定時は SQL を重ねずソケット切断に任せる
      }
      inTransaction = false;
    }
    if (isAbortError(error)) {
      throw closedError();
    }
    // ドライバ生文を公開しない
    throw closedError();
  } finally {
    clearDeadline();
    await endClient();
  }
}
