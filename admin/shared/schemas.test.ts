import { describe, it, expect } from "vitest";
import {
  generationListItemSchema,
  generationDetailSchema,
  feedbackDetailSchema,
  FORBIDDEN_DTO_KEYS,
} from "./schemas.js";

const safeGenerationRow = {
  id: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-08-11T00:00:00.000Z",
  status: "succeeded" as const,
  requestKind: "new_menu",
  failureCode: null,
  durationMs: 1200,
  actualModelIds: ["x"],
  qualityMode: false,
  repairAttempted: false,
  userId: "22222222-2222-4222-8222-222222222222",
};

describe("admin DTOs", () => {
  it("parses a safe generation row", () => {
    expect(generationListItemSchema.parse(safeGenerationRow).status).toBe(
      "succeeded",
    );
  });

  it("forbidden keys are listed for mapper guards", () => {
    expect(FORBIDDEN_DTO_KEYS).toContain("identity_key");
    expect(FORBIDDEN_DTO_KEYS).toContain("request_hmac");
    expect(FORBIDDEN_DTO_KEYS).toContain("stripe_price_id");
    expect(FORBIDDEN_DTO_KEYS).toContain("request_hmac_version");
  });

  it("strips forbidden keys from generation list parse output", () => {
    // Zod object は unknown key を strip する。禁止キーが出力に残らないことを実行証明する。
    const dirty = {
      ...safeGenerationRow,
      identity_key: "deadbeef".repeat(8),
      identityKey: "should-not-leak",
      request_hmac: "hmac-secret",
      requestHmac: "hmac-secret-camel",
      request_hmac_version: 1,
      requestHmacVersion: 1,
      stripe_subscription_id: "sub_xxx",
      stripeSubscriptionId: "sub_xxx",
      stripe_customer_id: "cus_xxx",
      stripeCustomerId: "cus_xxx",
      stripe_event_id: "evt_xxx",
      stripeEventId: "evt_xxx",
      stripe_price_id: "price_xxx",
      stripePriceId: "price_xxx",
      email: "user@example.invalid",
    };

    const parsed = generationListItemSchema.parse(dirty);
    const keys = Object.keys(parsed);

    for (const forbidden of FORBIDDEN_DTO_KEYS) {
      expect(keys).not.toContain(forbidden);
    }

    // 合法フィールドは残る
    expect(parsed.id).toBe(safeGenerationRow.id);
    expect(parsed.status).toBe("succeeded");
  });

  it("strips forbidden keys from generation detail parse output", () => {
    const dirty = {
      ...safeGenerationRow,
      startedAt: null,
      completedAt: null,
      userUsageDay: null,
      globalSentCalls: null,
      terminalDetails: null,
      changeReason: null,
      draftId: null,
      sourceMenuId: null,
      replaceDishId: null,
      completedMenuId: null,
      processingExpiresAt: null,
      quotaSuccessLimit: null,
      identity_key: "leak",
      request_hmac: "leak",
      stripe_price_id: "price_leak",
      email: "leak@example.invalid",
    };

    const parsed = generationDetailSchema.parse(dirty);
    const keys = Object.keys(parsed);
    for (const forbidden of FORBIDDEN_DTO_KEYS) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("strips forbidden keys from feedback detail parse output", () => {
    const dirty = {
      id: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-08-11T00:00:00.000Z",
      category: "bug_report",
      clientPath: "/home",
      userId: "22222222-2222-4222-8222-222222222222",
      bodyPreview: "preview",
      body: "full body",
      identity_key: "should-strip",
      email: "should-strip@example.invalid",
      request_hmac: "should-strip",
    };

    const parsed = feedbackDetailSchema.parse(dirty);
    const keys = Object.keys(parsed);
    for (const forbidden of FORBIDDEN_DTO_KEYS) {
      expect(keys).not.toContain(forbidden);
    }
    expect(parsed.body).toBe("full body");
  });
});
