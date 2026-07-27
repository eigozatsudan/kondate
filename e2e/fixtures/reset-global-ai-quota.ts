import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { z } from "zod";

/**
 * E2E 専用: アプリ全体の AI 日次共有枠カウンタだけを空にする。
 *
 * GLOBAL_DAILY_AI_LIMIT は製品どおり最大 20 のまま。1 スイートで 20 件超の
 * 独立生成が走るため、生成直前にカウンタをリセットして実行順依存を防ぐ。
 * 上限値そのもの・ユーザ単位枠は変更しない（新規ユーザで独立）。
 */
export async function resetGlobalAiQuotaForE2e(): Promise<void> {
  const envText = await readFile("/workspace/.env", "utf8").catch(async () =>
    readFile(".env", "utf8"),
  );
  const password = z
    .string()
    .min(1)
    .parse(/^POSTGRES_PASSWORD=(.+)$/mu.exec(envText)?.[1]?.trim());
  const client = new Client({
    connectionString: `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:54322/postgres?sslmode=disable`,
  });
  await client.connect();
  try {
    await client.query("truncate private.ai_global_daily_usage");
  } finally {
    await client.end();
  }
}
