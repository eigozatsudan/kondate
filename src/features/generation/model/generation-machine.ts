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
      // 409 idempotency_payload_mismatch 専用。offline 再POST ループに落とさない。
      phase: "request_conflict";
      code: "idempotency_payload_mismatch";
      message: string;
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
  | {
      type: "request_conflict";
      code: "idempotency_payload_mismatch";
      message: string;
    }
  | { type: "clear" };

export function generationReducer(
  state: GenerationClientState,
  event: GenerationEvent,
): GenerationClientState {
  if (event.type === "clear") {
    return { phase: "idle", effect: "none" };
  }

  // request_conflict は明示 clear / 新しい start 以外では動かさない（Plan 3）。
  if (state.phase === "request_conflict") {
    if (event.type === "request_conflict") {
      return {
        phase: "request_conflict",
        code: event.code,
        message: event.message,
        effect: "none",
      };
    }
    return state;
  }

  if (event.type === "request_conflict") {
    return {
      phase: "request_conflict",
      code: event.code,
      message: event.message,
      effect: "none",
    };
  }
  if (event.type === "network_error") {
    return state.phase === "offline"
      ? state
      : { phase: "offline", previous: state, effect: "wait_online" };
  }
  if (event.type === "online" || event.type === "recover") {
    // G15: サーバ終端 failed / constraint_conflict はメッセージ表示のため pending を残す。
    // online / TOKEN_REFRESHED 経由の recover で checking に落とすと UI thrash になる。
    // G28: succeeded も同様。navigate 前の TOKEN_REFRESHED で checking に戻すと
    // 2 回目 navigate が他タブ pending を消し得る。
    // offline 包み（phase === "offline"）からの online は下の checking へ進む。
    if (
      state.phase === "failed" ||
      state.phase === "constraint_conflict" ||
      state.phase === "succeeded"
    ) {
      return state;
    }
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
