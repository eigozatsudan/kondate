import { describe, expect, it } from "vitest";
import { sendMenuGeneration } from "./openrouter.js";

// --- OpenRouter実環境スモークテスト ---
// RUN_OPENROUTER_SMOKE=1 を明示設定した場合だけ実行される。
// 通常のテストゲートでは実行されず、実際のOpenRouterへのリクエストは発生しない。
// オペレータが無料の構造化出力対応モデルを選んで手動実行するためのテスト。
describe.skipIf(process.env.RUN_OPENROUTER_SMOKE !== "1")("real OpenRouter", () => {
  it("returns one structurally valid response through one application HTTP request", async () => {
    if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is required");
    // fetch呼出し回数を計測し、内部リトライが発生していないことを確認する
    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return originalFetch(...args);
    };
    try {
      const result = await sendMenuGeneration({
        timeoutMs: 20_000,
        messages: [
          { role: "system", content: "指定されたJSON Schemaだけを返してください。" },
          { role: "user", content: "匿名の大人1人向け、15分の和食朝食2品を生成してください。" },
        ],
      });
      expect(result.mode).toBe("full_menu");
      if (result.mode !== "full_menu") throw new Error("expected full_menu");
      expect(["success", "constraint_conflict"]).toContain(result.output.outcome);
      expect(result.modelId.endsWith(":free")).toBe(true);
      // 1アプリケーションリクエスト = 1 HTTP fetch のみ
      expect(fetchCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 70_000);
});
