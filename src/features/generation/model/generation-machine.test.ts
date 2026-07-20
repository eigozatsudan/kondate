import { describe, expect, it } from "vitest";
import type { GenerationStatusData } from "@shared/contracts/generation";
import { generationReducer, type GenerationClientState } from "./generation-machine";

const KEY = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "50000000-0000-4000-8000-000000000001";
const quota = {
  consumed: false,
  remaining: 4,
  userDailyLimit: 5,
  limitKind: null,
  retryAt: null,
} as const;
const statuses = {
  not_started: { status: "not_started", idempotencyKey: KEY, quota },
  processing: {
    status: "processing",
    idempotencyKey: KEY,
    requestId: REQUEST_ID,
    startedAt: "2026-07-11T00:00:00.000Z",
    quota,
  },
  succeeded: {
    status: "succeeded",
    idempotencyKey: KEY,
    requestId: REQUEST_ID,
    menuId: "60000000-0000-4000-8000-000000000001",
    completedAt: "2026-07-11T00:00:01.000Z",
    quota: { ...quota, consumed: true },
  },
  failed: {
    status: "failed",
    idempotencyKey: KEY,
    requestId: REQUEST_ID,
    error: { code: "model_unavailable", message: "利用できません", retryable: true },
    completedAt: "2026-07-11T00:00:01.000Z",
    quota,
  },
  constraint_conflict: {
    status: "constraint_conflict",
    idempotencyKey: KEY,
    requestId: REQUEST_ID,
    conflicts: [
      {
        code: "must_use_conflict",
        message: "条件を同時に満たせません。",
        conditionRefs: ["pantry_1"],
      },
    ],
    completedAt: "2026-07-11T00:00:01.000Z",
    quota,
  },
} satisfies Record<string, GenerationStatusData>;

const idle = { phase: "idle", effect: "none" } as const;
const checking = { phase: "checking", effect: "status" } as const;
const submitting = { phase: "submitting", effect: "submit" } as const;
const processing: GenerationClientState = {
  phase: "processing",
  data: statuses.processing,
  effect: "poll",
};
const succeeded: GenerationClientState = {
  phase: "succeeded",
  data: statuses.succeeded,
  effect: "navigate",
};
const failed: GenerationClientState = {
  phase: "failed",
  data: statuses.failed,
  effect: "none",
};
const conflict: GenerationClientState = {
  phase: "constraint_conflict",
  data: statuses.constraint_conflict,
  effect: "none",
};
const offline: GenerationClientState = {
  phase: "offline",
  previous: processing,
  effect: "wait_online",
};

describe("generationReducer", () => {
  it("starts an explicit submit only from idle", () => {
    expect(generationReducer(idle, { type: "submit" })).toEqual({
      phase: "submitting",
      effect: "submit",
    });
  });

  it.each([checking, submitting, processing, offline, succeeded, failed, conflict])(
    "keeps every non-idle state on an explicit submit",
    (state) => {
      expect(generationReducer(state, { type: "submit" })).toBe(state);
    },
  );

  it.each([
    [statuses.not_started, "submitting", "submit"],
    [statuses.processing, "processing", "poll"],
    [statuses.succeeded, "succeeded", "navigate"],
    [statuses.failed, "failed", "none"],
    [statuses.constraint_conflict, "constraint_conflict", "none"],
  ] as const)("projects status $0.status to $1", (data, phase, effect) => {
    expect(generationReducer(checking, { type: "status", data })).toMatchObject({
      phase,
      effect,
    });
  });

  it("moves recovery into status checking", () => {
    expect(generationReducer(idle, { type: "recover" })).toEqual(checking);
  });

  it("wraps the current state on a network error", () => {
    expect(generationReducer(processing, { type: "network_error" })).toEqual({
      phase: "offline",
      previous: processing,
      effect: "wait_online",
    });
  });

  it("keeps an existing offline state on repeated network errors", () => {
    expect(generationReducer(offline, { type: "network_error" })).toBe(offline);
  });

  it("checks status again when connectivity returns", () => {
    expect(generationReducer(offline, { type: "online" })).toEqual(checking);
  });

  it.each([checking, submitting, processing, offline, succeeded, failed, conflict])(
    "clears $phase to idle",
    (state) => {
      expect(generationReducer(state, { type: "clear" })).toEqual(idle);
    },
  );
});
