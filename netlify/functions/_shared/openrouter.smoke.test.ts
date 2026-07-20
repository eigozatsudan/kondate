import { describe, expect, it } from "vitest";
import { sendMenuGeneration } from "./openrouter.js";

// --- OpenRouter実環境スモークテスト ---
// RUN_OPENROUTER_SMOKE=1 を明示設定した場合だけ実行される。
// 通常のテストゲートでは実行されず、実際のOpenRouterへのリクエストは発生しない。
// オペレータが無料の構造化出力対応モデルを選んで手動実行するためのテスト。
describe.skipIf(process.env.RUN_OPENROUTER_SMOKE !== "1")("real OpenRouter", () => {
  it("returns one structurally valid response through one application HTTP request", async () => {
    if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is required");
    const result = await sendMenuGeneration({
      timeoutMs: 20_000,
      messages: [
        { role: "system", content: "指定されたJSON Schemaだけを返してください。" },
        { role: "user", content: "匿名の大人1人向け、15分の和食朝食2品を生成してください。" },
      ],
    });
    expect(["success", "constraint_conflict"]).toContain(result.output.outcome);
    expect(result.modelId.endsWith(":free")).toBe(true);
  }, 70_000);
});
