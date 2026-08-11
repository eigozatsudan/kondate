import { describe, it, expect } from "vitest";
import { generationListItemSchema, FORBIDDEN_DTO_KEYS } from "./schemas.js";

describe("admin DTOs", () => {
  it("parses a safe generation row", () => {
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-08-11T00:00:00.000Z",
      status: "succeeded",
      requestKind: "new_menu",
      failureCode: null,
      durationMs: 1200,
      actualModelIds: ["x"],
      qualityMode: false,
      repairAttempted: false,
      userId: "22222222-2222-4222-8222-222222222222",
    };
    expect(generationListItemSchema.parse(row).status).toBe("succeeded");
  });

  it("forbidden keys are listed for mapper guards", () => {
    expect(FORBIDDEN_DTO_KEYS).toContain("identity_key");
    expect(FORBIDDEN_DTO_KEYS).toContain("request_hmac");
  });
});
