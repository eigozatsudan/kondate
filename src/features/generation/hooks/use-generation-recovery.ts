import { useCallback, useEffect, useReducer, useRef } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/features/auth/use-auth";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { getGenerationStatus, postGeneration } from "../api/generation-api";
import {
  generationReducer,
  type GenerationClientState,
  type GenerationEvent,
} from "../model/generation-machine";
import {
  clearPendingGeneration,
  pendingGenerationCommand,
  readPendingGeneration,
  savePendingGeneration,
  type PendingGeneration,
} from "../model/pending-generation";

export type GenerationRecoveryController = {
  state: GenerationClientState;
  startGeneration(pending: PendingGeneration): Promise<void>;
  retryStatus(): Promise<void>;
  clearGeneration(): void;
};

type LifecyclePhase = GenerationClientState["phase"] | "starting";
type GenerationLifecycleToken = {
  ownerUserId: string;
  idempotencyKey: string;
  epoch: number;
  phase: LifecyclePhase;
};
type InFlightRecord = { token: GenerationLifecycleToken; promise: Promise<void> };

// テスト専用の初期状態注入。実利用の useGenerationRecovery() は引数なしで呼ばれ、
// マウント時の recover 判定と初回 effect 実行を通常どおり行う。
//
// この注入口が存在する理由: テスト（use-generation-recovery.test.tsx）の一部は
// マウント直後のフックが「特定の中間状態（例: submitting/offline）」を参照等価
// （toBe(initialState)）で保持していることを検証する必要があるが、実際の非同期
// 復旧フローを通してこの中間状態に到達させることは構造上できない（recover は
// 常に "checking" から始まり、非同期の GET 応答を経て初めて他の phase へ遷移する
// ため）。そのためテストにのみ許された初期状態の直接注入口として存在する。
//
// onDispatch は dispatch 呼び出しをその場で同期的に観測するためのフックである。
// テスト側のリデューサーモック（reducerListenerRef）への一本化を検討したが、
// React は act() 内で dispatch をバッチ処理するため、その経路での観測は実際の
// レンダー確定（非同期の POST 応答より後）まで遅延してしまい、save→submit/
// clear→post という操作順序をレースなく検証できない。そのためこの seam はここに残す。
export type GenerationRecoverySeedForTesting = {
  state: GenerationClientState;
  token: GenerationLifecycleToken | null;
  onDispatch?: (event: GenerationEvent) => void;
  // 既に「別 token へ切り替わった後」の孤立した submit 継続を再現するためのテスト専用フック。
  staleSubmit?: {
    pending: PendingGeneration;
    resultSink: { promise?: Promise<void> };
  };
};

export function useGenerationRecovery(
  seedForTesting?: GenerationRecoverySeedForTesting,
): GenerationRecoveryController {
  const navigate = useNavigate();
  const userId = useAuth().session?.user.id ?? null;

  // マウント時の seed 短絡判定を一箇所にまとめる。seed 済みの初回レンダーでは
  // （1）注入された state/token をそのまま初期値にし、（2）自動 recover 判定
  // （下の recover effect）と（3）effect-runner の初回自動実行の両方を抑制する。
  // 実利用（seedForTesting 省略）では isSeeded は常に false になり、通常どおり
  // "idle" から始まって自動 recover が走る。
  const isSeeded = seedForTesting !== undefined;
  const seedInitialState = seedForTesting?.state ?? { phase: "idle", effect: "none" };
  const seedInitialToken = seedForTesting?.token ?? null;

  const [state, dispatchState] = useReducer(generationReducer, seedInitialState);
  const dispatch = useCallback(
    (event: GenerationEvent) => {
      seedForTesting?.onDispatch?.(event);
      dispatchState(event);
    },
    [seedForTesting],
  );
  const read = useCallback(
    () => (userId === null ? null : readPendingGeneration(userId, new Date())),
    [userId],
  );
  const epochRef = useRef(0);
  const lifecycleRef = useRef<GenerationLifecycleToken | null>(seedInitialToken);
  const statusInFlightRef = useRef<InFlightRecord | null>(null);
  const submitInFlightRef = useRef<InFlightRecord | null>(null);
  const skipInitialEffectRunRef = useRef(isSeeded);

  const storedMatches = useCallback(
    (token: GenerationLifecycleToken) => {
      const stored = read();
      return (
        userId === token.ownerUserId &&
        stored !== null &&
        stored.ownerUserId === token.ownerUserId &&
        stored.request.idempotencyKey === token.idempotencyKey
      );
    },
    [read, userId],
  );
  const isCurrent = useCallback(
    (token: GenerationLifecycleToken) => {
      const current = lifecycleRef.current;
      return (
        current === token &&
        current.ownerUserId === token.ownerUserId &&
        current.epoch === token.epoch &&
        current.idempotencyKey === token.idempotencyKey &&
        storedMatches(token)
      );
    },
    [storedMatches],
  );
  const invalidateLifecycle = useCallback(() => {
    epochRef.current += 1;
    lifecycleRef.current = null;
    statusInFlightRef.current = null;
    submitInFlightRef.current = null;
  }, []);

  const submitWithToken = useCallback(
    (token: GenerationLifecycleToken, pending: PendingGeneration): Promise<void> => {
      const current = submitInFlightRef.current;
      if (current?.token === token) return current.promise;
      const operation = Promise.resolve().then(async () => {
        try {
          const data = await postGeneration(pendingGenerationCommand(pending));
          if (!isCurrent(token)) return;
          token.phase = data.status === "not_started" ? "submitting" : data.status;
          dispatch({ type: "status", data });
        } catch {
          if (!isCurrent(token)) return;
          token.phase = "offline";
          dispatch({ type: "network_error" });
        }
      });
      const record: InFlightRecord = { token, promise: operation };
      submitInFlightRef.current = record;
      void operation.finally(() => {
        if (submitInFlightRef.current === record) submitInFlightRef.current = null;
      });
      return operation;
    },
    [dispatch, isCurrent],
  );

  useEffect(() => {
    const stale = seedForTesting?.staleSubmit;
    if (stale === undefined) return;
    const staleToken: GenerationLifecycleToken = {
      ownerUserId: stale.pending.ownerUserId,
      idempotencyKey: stale.pending.request.idempotencyKey,
      epoch: -1,
      phase: "submitting",
    };
    stale.resultSink.promise = submitWithToken(staleToken, stale.pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resumeNotStarted = useCallback(
    (token: GenerationLifecycleToken, pending: PendingGeneration): Promise<void> => {
      if (
        token.ownerUserId !== pending.ownerUserId ||
        token.idempotencyKey !== pending.request.idempotencyKey ||
        !isCurrent(token)
      ) {
        return Promise.resolve();
      }
      return submitWithToken(token, pending);
    },
    [isCurrent, submitWithToken],
  );

  const retryStatus = useCallback((): Promise<void> => {
    const pending = read();
    if (!pending) return Promise.resolve();
    let token = lifecycleRef.current;
    if (
      token === null ||
      token.ownerUserId !== pending.ownerUserId ||
      token.idempotencyKey !== pending.request.idempotencyKey
    ) {
      token = {
        ownerUserId: pending.ownerUserId,
        idempotencyKey: pending.request.idempotencyKey,
        epoch: ++epochRef.current,
        phase: "checking",
      };
      lifecycleRef.current = token;
    }
    const current = statusInFlightRef.current;
    if (current?.token === token) return current.promise;
    const operation = Promise.resolve().then(async () => {
      try {
        const data = await getGenerationStatus(pending.request.idempotencyKey);
        if (!isCurrent(token)) return;
        token.phase = data.status === "not_started" ? "submitting" : data.status;
        dispatch({ type: "status", data });
        if (data.status === "not_started" && isCurrent(token))
          void resumeNotStarted(token, pending);
      } catch {
        if (!isCurrent(token)) return;
        token.phase = "offline";
        dispatch({ type: "network_error" });
      }
    });
    const record: InFlightRecord = { token, promise: operation };
    statusInFlightRef.current = record;
    void operation.finally(() => {
      if (statusInFlightRef.current === record) statusInFlightRef.current = null;
    });
    return operation;
  }, [dispatch, isCurrent, read, resumeNotStarted]);

  const startGeneration = useCallback(
    async (pending: PendingGeneration) => {
      const previous = lifecycleRef.current;
      const previousPhase = previous?.phase ?? "idle";
      const allowed =
        previousPhase === "idle" ||
        previousPhase === "succeeded" ||
        previousPhase === "failed" ||
        previousPhase === "constraint_conflict";
      if (!allowed || userId === null || pending.ownerUserId !== userId) {
        throw new Error("generation operation is active");
      }
      const token: GenerationLifecycleToken = {
        ownerUserId: pending.ownerUserId,
        idempotencyKey: pending.request.idempotencyKey,
        epoch: ++epochRef.current,
        phase: "starting",
      };
      lifecycleRef.current = token;
      try {
        savePendingGeneration(pending);
      } catch (error) {
        if (lifecycleRef.current === token) lifecycleRef.current = previous;
        throw error;
      }
      token.phase = "submitting";
      if (previousPhase !== "idle") dispatch({ type: "clear" });
      dispatch({ type: "submit" });
      await submitWithToken(token, pending);
    },
    [dispatch, submitWithToken, userId],
  );
  const clearGeneration = useCallback(() => {
    invalidateLifecycle();
    clearPendingGeneration();
    dispatch({ type: "clear" });
  }, [dispatch, invalidateLifecycle]);

  useEffect(() => {
    // seed 注入時はテストが用意した中間状態をそのまま観測させるため、
    // マウント時の自動 recover 判定を実行しない（isSeeded の定義は上部参照）。
    if (isSeeded) return;
    const pending = read();
    if (pending === null) return;
    const current = lifecycleRef.current;
    if (
      current === null ||
      current.ownerUserId !== pending.ownerUserId ||
      current.idempotencyKey !== pending.request.idempotencyKey
    ) {
      lifecycleRef.current = {
        ownerUserId: pending.ownerUserId,
        idempotencyKey: pending.request.idempotencyKey,
        epoch: ++epochRef.current,
        phase: "checking",
      };
    } else {
      current.phase = "checking";
    }
    dispatch({ type: "recover" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read]);

  useEffect(() => {
    if (skipInitialEffectRunRef.current) {
      skipInitialEffectRunRef.current = false;
      return undefined;
    }
    if (state.effect === "status") void retryStatus();
    if (state.effect === "poll") {
      const timer = window.setTimeout(() => {
        if (!document.hidden) void retryStatus();
      }, 2_000);
      return () => {
        window.clearTimeout(timer);
      };
    }
    const token = lifecycleRef.current;
    if (
      state.effect === "navigate" &&
      token !== null &&
      token.phase === "succeeded" &&
      token.idempotencyKey === state.data.idempotencyKey &&
      isCurrent(token)
    ) {
      clearPendingGeneration();
      void navigate(`/menus/${state.data.menuId}?recovered=1`);
    }
    if (
      (state.phase === "failed" || state.phase === "constraint_conflict") &&
      token !== null &&
      token.phase === state.phase &&
      token.idempotencyKey === state.data.idempotencyKey &&
      isCurrent(token)
    ) {
      clearPendingGeneration();
    }
    return undefined;
  }, [isCurrent, navigate, retryStatus, state]);

  useEffect(() => {
    const recover = () => {
      const token = lifecycleRef.current;
      if (token !== null) token.phase = "checking";
      dispatch({ type: "online" });
      void retryStatus();
    };
    const visible = () => {
      if (!document.hidden) void retryStatus();
    };
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", visible);
    const { data } = getBrowserSupabaseClient().auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || session?.user.id !== userId) {
        clearGeneration();
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") recover();
    });
    return () => {
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", visible);
      data.subscription.unsubscribe();
    };
  }, [clearGeneration, dispatch, retryStatus, userId]);

  return { state, startGeneration, retryStatus, clearGeneration };
}
