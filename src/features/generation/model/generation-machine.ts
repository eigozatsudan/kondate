import type { GenerationStatusData } from "@shared/contracts/generation";

export type GenerationClientState =
  | { phase: "idle"; effect: "none" }
  | { phase: "checking"; effect: "status" }
  | { phase: "submitting"; effect: "submit" }
  | {
      phase: "processing";
      data: Extract<GenerationStatusData, { status: "processing" }>;
      effect: "poll";
    }
  | {
      phase: "succeeded";
      data: Extract<GenerationStatusData, { status: "succeeded" }>;
      effect: "navigate";
    }
  | {
      phase: "failed";
      data: Extract<GenerationStatusData, { status: "failed" }>;
      effect: "none";
    }
  | {
      phase: "constraint_conflict";
      data: Extract<GenerationStatusData, { status: "constraint_conflict" }>;
      effect: "none";
    }
  | {
      phase: "offline";
      previous: Exclude<GenerationClientState, { phase: "offline" }>;
      effect: "wait_online";
    };

export type GenerationEvent =
  | { type: "recover" }
  | { type: "submit" }
  | { type: "status"; data: GenerationStatusData }
  | { type: "network_error" }
  | { type: "online" }
  | { type: "clear" };

export function generationReducer(
  state: GenerationClientState,
  event: GenerationEvent,
): GenerationClientState {
  if (event.type === "clear") {
    return { phase: "idle", effect: "none" };
  }
  if (event.type === "network_error") {
    return state.phase === "offline"
      ? state
      : { phase: "offline", previous: state, effect: "wait_online" };
  }
  if (event.type === "online") {
    return { phase: "checking", effect: "status" };
  }
  if (event.type === "recover") {
    return { phase: "checking", effect: "status" };
  }
  if (event.type === "submit") {
    return state.phase === "idle" ? { phase: "submitting", effect: "submit" } : state;
  }
  if (event.data.status === "not_started") {
    return { phase: "submitting", effect: "submit" };
  }
  if (event.data.status === "processing") {
    return { phase: "processing", data: event.data, effect: "poll" };
  }
  if (event.data.status === "succeeded") {
    return { phase: "succeeded", data: event.data, effect: "navigate" };
  }
  if (event.data.status === "failed") {
    return { phase: "failed", data: event.data, effect: "none" };
  }
  return {
    phase: "constraint_conflict",
    data: event.data,
    effect: "none",
  };
}
