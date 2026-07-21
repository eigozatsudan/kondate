import { PostgrestError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeValidatedMenu } from "../../../shared/testing/factories.js";
import type { GenerationCommand } from "../../../shared/contracts/generation.js";
import type { Database } from "../../../src/shared/types/database.js";
import { HttpError } from "./http.js";

type RpcResult = { data: unknown; error: PostgrestError | null };
type RpcMock = (name: string, parameters: unknown) => Promise<RpcResult>;

const hmacKey = Buffer.alloc(32, 7);

const { createUserScopedSupabaseMock, getServerEnvMock, rpcMock, userClient } = vi.hoisted(() => {
  const client = { from: vi.fn() };
  return {
    createUserScopedSupabaseMock: vi.fn(() => client),
    getServerEnvMock: vi.fn(() => ({
      openRouter: {
        userDailyLimit: 5,
        globalDailyLimit: 45,
        staleAfterSeconds: 180,
      },
      generationIntegrity: {
        requestHmacKey: Buffer.alloc(32, 7),
      },
    })),
    rpcMock: vi.fn<RpcMock>(),
    userClient: client,
  };
});

vi.mock("./env.js", () => ({ getServerEnv: getServerEnvMock }));
vi.mock("./supabase-admin.js", () => ({
  getSupabaseAdmin: vi.fn(() => ({ rpc: rpcMock })),
}));
vi.mock("./supabase-user.js", () => ({
  createUserScopedSupabase: createUserScopedSupabaseMock,
}));

import {
  generationRequestHmac,
  generationRequestHmacVersion,
} from "./generation-command-integrity.js";
import { createGenerationRepository, type GenerationRepository } from "./generation-repository.js";

const user = {
  userId: "10000000-0000-4000-8000-000000000001",
  accessToken: "access-token",
};
const requestId = "20000000-0000-4000-8000-000000000001";
const idempotencyKey = "30000000-0000-4000-8000-000000000001";
const draftId = "40000000-0000-4000-8000-000000000001";
const sourceMenuId = "60000000-0000-4000-8000-000000000001";
const retryAt = "2026-07-20T00:00:00+09:00";

const newMenuCommand: GenerationCommand = {
  kind: "new_menu",
  request: {
    idempotencyKey,
    draftId,
    draftRevision: 7,
    privacyNoticeVersion: "2026-07-11.v1",
    expiredPantryConfirmations: [],
  },
};

const publicRecord = {
  request_id: requestId,
  idempotency_key: idempotencyKey,
  status: "processing",
  failure_code: null,
  retry_at: null,
  processing_expires_at: "2026-07-19T12:03:00+09:00",
  completed_menu_id: null,
  remaining: 4,
  user_daily_limit: 5,
  consumed: false,
  terminal_details: null,
  actual_model_ids: ["model:free"],
  started_at: "2026-07-19T12:00:00+09:00",
  completed_at: null,
  replayed: false,
};

const privateRecord = {
  ...publicRecord,
  user_id: user.userId,
  request_hmac: "private-hmac",
  raw_payload: "private-payload",
};

const expectedPublicRecord = { ...publicRecord };

const reserveArgs = {
  p_user_id: user.userId,
  p_idempotency_key: idempotencyKey,
  p_request_kind: "new_menu",
  p_draft_id: draftId,
  p_draft_revision: 7,
  p_source_menu_id: null,
  p_replace_dish_id: null,
  p_change_reason: null,
  p_request_hmac_version: generationRequestHmacVersion,
  p_request_hmac: generationRequestHmac(newMenuCommand, hmacKey),
  p_user_limit: 5,
  p_global_limit: 45,
  p_stale_after_seconds: 180,
} satisfies Database["public"]["Functions"]["reserve_ai_generation"]["Args"];
const markSentArgs = {
  p_request_id: requestId,
} satisfies Database["public"]["Functions"]["mark_ai_global_sent"]["Args"];
const reserveRepairArgs = {
  p_request_id: requestId,
  p_global_limit: 45,
} satisfies Database["public"]["Functions"]["reserve_ai_repair_call"]["Args"];
const recordModelArgs = {
  p_request_id: requestId,
  p_model_id: "model:free",
} satisfies Database["public"]["Functions"]["record_ai_generation_model"]["Args"];
const failArgs = {
  p_request_id: requestId,
  p_failure_code: "generation_timeout",
  p_retry_at: retryAt,
} satisfies Database["public"]["Functions"]["finalize_ai_generation_failure"]["Args"];
const conflicts = [
  {
    code: "current_safety_changed" as const,
    message: "条件が更新されました",
    conditionRefs: ["member_1"],
  },
  {
    code: "current_safety_changed" as const,
    message: "重複コードは一意化する",
    conditionRefs: [],
  },
];
const conflictArgs = {
  p_request_id: requestId,
  p_conflict_codes: ["current_safety_changed"],
} satisfies Database["public"]["Functions"]["finalize_ai_generation_conflict"]["Args"];
const menu = makeValidatedMenu();
const succeedInput = {
  requestId,
  menu,
  preferenceSnapshot: { portions: ["regular"] },
  safetySnapshot: { members: ["member_1"] },
  safetyFingerprint: "safety-fingerprint",
  allergenVersion: "jp-caa-2026-04.v1",
  foodRuleVersion: "jp-caa-child-shape-2026-07.v1",
  targetMembers: [{ anonymousRef: "member_1" }],
  expiredChecks: [{ pantryItemId: "70000000-0000-4000-8000-000000000001" }],
  sourceMenuId,
  changeReason: "食材を変更",
  changeReasonCustom: "旬の野菜へ変更",
};
const succeedArgs = {
  p_request_id: requestId,
  p_menu: menu,
  p_preference_snapshot: succeedInput.preferenceSnapshot,
  p_safety_snapshot: succeedInput.safetySnapshot,
  p_safety_fingerprint: "safety-fingerprint",
  p_allergen_version: "jp-caa-2026-04.v1",
  p_food_rule_version: "jp-caa-child-shape-2026-07.v1",
  p_target_members: succeedInput.targetMembers,
  p_expired_checks: succeedInput.expiredChecks,
  p_source_menu_id: sourceMenuId,
  p_change_reason: "食材を変更",
  p_change_reason_custom: "旬の野菜へ変更",
} satisfies Database["public"]["Functions"]["finalize_ai_generation_success"]["Args"];
const statusArgs = {
  p_user_id: user.userId,
  p_idempotency_key: idempotencyKey,
  p_user_limit: 5,
} satisfies Database["public"]["Functions"]["get_ai_generation_status"]["Args"];

type SuccessCase = {
  name: string;
  rpcName: keyof Database["public"]["Functions"];
  args: unknown;
  data: unknown;
  invoke: (repository: GenerationRepository) => Promise<unknown>;
  expected: unknown;
};

const successCases: readonly SuccessCase[] = [
  {
    name: "reserve",
    rpcName: "reserve_ai_generation",
    args: reserveArgs,
    data: privateRecord,
    invoke: (repository) => repository.reserve(newMenuCommand),
    expected: expectedPublicRecord,
  },
  {
    name: "markSent",
    rpcName: "mark_ai_global_sent",
    args: markSentArgs,
    data: privateRecord,
    invoke: (repository) => repository.markSent(requestId),
    expected: expectedPublicRecord,
  },
  {
    name: "reserveRepair",
    rpcName: "reserve_ai_repair_call",
    args: reserveRepairArgs,
    data: { reserved: true, retry_at: null },
    invoke: (repository) => repository.reserveRepair(requestId),
    expected: { reserved: true, retry_at: null },
  },
  {
    name: "recordModel",
    rpcName: "record_ai_generation_model",
    args: recordModelArgs,
    data: { ignored: true },
    invoke: (repository) => repository.recordModel(requestId, "model:free"),
    expected: undefined,
  },
  {
    name: "fail",
    rpcName: "finalize_ai_generation_failure",
    args: failArgs,
    data: privateRecord,
    invoke: (repository) => repository.fail(requestId, "generation_timeout", retryAt),
    expected: expectedPublicRecord,
  },
  {
    name: "conflict",
    rpcName: "finalize_ai_generation_conflict",
    args: conflictArgs,
    data: privateRecord,
    invoke: (repository) => repository.conflict(requestId, conflicts),
    expected: expectedPublicRecord,
  },
  {
    name: "succeed",
    rpcName: "finalize_ai_generation_success",
    args: succeedArgs,
    data: privateRecord,
    invoke: (repository) => repository.succeed(succeedInput),
    expected: expectedPublicRecord,
  },
  {
    name: "status",
    rpcName: "get_ai_generation_status",
    args: statusArgs,
    data: privateRecord,
    invoke: (repository) => repository.status(idempotencyKey),
    expected: expectedPublicRecord,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockReset();
  getServerEnvMock.mockReturnValue({
    openRouter: {
      userDailyLimit: 5,
      globalDailyLimit: 45,
      staleAfterSeconds: 180,
    },
    generationIntegrity: {
      requestHmacKey: hmacKey,
    },
  });
});

describe("createGenerationRepository", () => {
  it("creates the user-scoped client from the authenticated access token", () => {
    const repository = createGenerationRepository(user);

    expect(createUserScopedSupabaseMock).toHaveBeenCalledWith("access-token");
    expect(repository.userClient).toBe(userClient);
  });

  it.each(successCases)("unwraps and validates the $name RPC response", async (testCase) => {
    rpcMock.mockResolvedValueOnce({ data: testCase.data, error: null });
    const repository = createGenerationRepository(user);

    await expect(testCase.invoke(repository)).resolves.toEqual(testCase.expected);
    expect(rpcMock).toHaveBeenCalledOnce();
    expect(rpcMock).toHaveBeenCalledWith(testCase.rpcName, testCase.args);
  });

  it.each([
    {
      name: "unknown code",
      conflicts: [
        {
          ...conflicts[0],
          code: "internal_only_conflict",
        },
      ],
    },
    {
      name: "unknown field",
      conflicts: [
        {
          ...conflicts[0],
          raw_payload: "private-payload",
        },
      ],
    },
  ])("rejects an $name outside the closed conflict schema", async (testCase) => {
    const repository = createGenerationRepository(user);

    await expect(repository.conflict(requestId, testCase.conflicts)).rejects.toBeDefined();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each(successCases)("sanitizes a PostgREST error from $name", async (testCase) => {
    const databaseError = new PostgrestError({
      message: "private database message",
      details: "private database details",
      hint: "private database hint",
      code: "P0001",
    });
    rpcMock.mockResolvedValueOnce({ data: null, error: databaseError });
    const repository = createGenerationRepository(user);

    await expectSanitizedDatabaseError(testCase.invoke(repository));
  });

  it("maps an idempotency payload mismatch to a non-retryable conflict", async () => {
    const databaseError = new PostgrestError({
      message: "idempotency_payload_mismatch",
      details: "private database details",
      hint: "private database hint",
      code: "22023",
    });
    rpcMock.mockResolvedValueOnce({ data: null, error: databaseError });
    const repository = createGenerationRepository(user);

    try {
      await repository.reserve(newMenuCommand);
      throw new Error("Expected repository.reserve to reject");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HttpError);
      if (!(error instanceof HttpError)) throw error;
      expect(error.status).toBe(409);
      expect(error.code).toBe("idempotency_payload_mismatch");
      expect(error.message).toBe(
        "同じ操作番号で異なる内容は送信できません。最初からやり直してください。",
      );
      expect(String(error)).not.toContain("private database");
    }
  });

  it("sanitizes a rejected RPC promise", async () => {
    rpcMock.mockRejectedValueOnce(new Error("private rejection detail"));
    const repository = createGenerationRepository(user);

    await expectSanitizedDatabaseError(repository.reserve(newMenuCommand));
  });
});

async function expectSanitizedDatabaseError(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
    throw new Error("Expected repository operation to reject");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(HttpError);
    if (!(error instanceof HttpError)) throw error;
    expect(error.status).toBe(500);
    expect(error.code).toBe("quota_transition_failed");
    expect(error.message).toBe("生成の受付状態を更新できませんでした。");
    expect(error.details).toBeUndefined();
    expect(String(error)).not.toContain("private database");
    expect(String(error)).not.toContain("private rejection");
  }
}
