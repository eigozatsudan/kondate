import { useCallback, useEffect, useReducer, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { isAuthSessionFailure } from "@/features/auth/session";
import { redirectToLoginForExpiredSession } from "@/features/auth/session-expiry";
import { useAuth } from "@/features/auth/use-auth";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import {
  generationFailureCodes,
  issueMessages,
  type GenerationFailureCode,
  type GenerationStatusData,
  type UsageTodayData,
} from "@shared/contracts/generation";
import { planQuota } from "@shared/contracts/plan-quota";
import {
  getGenerationStatus,
  postGeneration,
  readLiveGenerationDraftPin,
} from "../api/generation-api";
import {
  generationReducer,
  type GenerationClientState,
  type GenerationEvent,
} from "../model/generation-machine";
import {
  clearPendingGeneration,
  pendingGenerationCommand,
  pendingGenerationSchema,
  readPendingGeneration,
  savePendingGeneration,
  type PendingGeneration,
} from "../model/pending-generation";
import { historyKeys } from "@/features/history/api/history-api";
import { plannerKeys } from "@/features/planner/planner-api";
import { jstDayKey, usageTodayQueryKey } from "./use-usage-today";

const generationFailureCodeSet = new Set<string>(generationFailureCodes);

function isGenerationFailureCode(code: string): code is GenerationFailureCode {
  return generationFailureCodeSet.has(code);
}

/**
 * generationFailureCodes 外だが ok:false で返る閉じたサーバ code。
 * POST/GET とも offline + pending 維持（G1/G2: reserve 後の 500 で pending を焼くと
 * processing 台帳を status 再送できず枠拘束・ロックアウトになる）。
 * 端末 failed にするのは ok:true 契約の generationFailureCodes のみ。
 */
const CLOSED_SERVER_RECOVERABLE_CODES = new Set([
  "billing_entitlement_unavailable",
  "request_failed",
  "quota_transition_failed",
  // G8: mapClosedRpcFailure が写す設定ミス・repair 拒否 code。pending を焼かず offline 維持。
  "release_quota_mismatch",
  "invalid_request_hmac",
  "invalid_identity_key",
  "repair_not_available",
]);

/**
 * ok:false + Error.message 経路で来る post-reserve 系 code。
 * 正規業務終端は ok:true + status failed。Error 名だけで failed に焼くと
 * processing 台帳の status 回収を失うため POST では offline 維持する（G7）。
 * GET は status 回収そのものなので generationFailureCodes を failed のまま扱う。
 */
const POST_ERROR_STATUS_RECOVERABLE_FAILURE_CODES = new Set([
  "model_unavailable",
  "invalid_ai_response",
  "generation_timeout",
  "internal_error",
  "duplicate_output",
]);

/** offline 自動再試行の初回間隔。以降は指数バックオフ（上限 OFFLINE_RETRY_MAX_MS）。 */
const OFFLINE_RETRY_BASE_MS = 5_000;
const OFFLINE_RETRY_MAX_MS = 60_000;

/**
 * G14: 他端末 processing の合成 generation_in_progress を前面タブで再 POST する間隔。
 * POST IP 40/180s を超えないよう 5s（36/180s）。cancel RPC は足さない。
 */
export const GENERATION_IN_PROGRESS_RETRY_MS = 5_000;

/**
 * ok:false 端末失敗を GenerationStatusData failed に載せ替え（issueMessages 正本）。
 * G17: userDailyLimit を Free 3 固定にしない。usage キャッシュがあれば success.limit を採用し、
 * 無ければ planQuota.free をスキーマ充足用フォールバックにする（パネルは userId ありで usage を正とする）。
 */
function syntheticFailedStatus(
  idempotencyKey: string,
  code: GenerationFailureCode,
  message: string = issueMessages[code],
  usageHint?: Pick<UsageTodayData, "success"> | null,
): Extract<GenerationStatusData, { status: "failed" }> {
  const hintLimit = usageHint?.success.limit;
  const userDailyLimit =
    hintLimit === planQuota.plus.successPerDay
      ? planQuota.plus.successPerDay
      : planQuota.free.successPerDay;
  // remaining は usage 正本を優先し、無いときは 0（TerminalQuotaBlock は userId ありで usage 表示）。
  const remaining =
    usageHint === undefined || usageHint === null
      ? 0
      : Math.min(Math.max(0, usageHint.success.remaining), userDailyLimit);
  return {
    status: "failed",
    idempotencyKey,
    requestId: "00000000-0000-4000-8000-000000000099",
    error: {
      code,
      message,
      retryable: false,
    },
    completedAt: new Date().toISOString(),
    quota: {
      consumed: false,
      remaining,
      userDailyLimit,
      limitKind: null,
      retryAt: null,
    },
  };
}

/** G17: 当日 usage キャッシュから success 枠だけ読む（未取得は null）。 */
function readCachedUsageSuccess(
  queryClient: QueryClient,
  ownerUserId: string,
): Pick<UsageTodayData, "success"> | null {
  const cached = queryClient.getQueryData<UsageTodayData>(usageTodayQueryKey(ownerUserId));
  if (cached === undefined) return null;
  return { success: cached.success };
}

/**
 * API throw を端末分類する。
 * - auth → 再ログイン
 * - request_conflict → 冪等衝突専用 UI
 * - failed → 業務/品質 code。POST の閉じたサーバ code も含む
 * - offline → transport・未知。GET の閉じたサーバ code も含む（pending 維持）
 *
 * @param surface POST は作成確定の業務失敗を failed に、GET は一時障害を offline に分ける
 */
function classifyGenerationClientError(
  error: unknown,
  surface: "post" | "get" = "post",
):
  | { kind: "auth" }
  | { kind: "request_conflict" }
  | { kind: "failed"; code: GenerationFailureCode; message: string }
  | { kind: "offline" } {
  if (isAuthSessionFailure(error)) {
    return { kind: "auth" };
  }
  if (!(error instanceof Error)) {
    return { kind: "offline" };
  }
  const code = error.message;
  if (code === "idempotency_payload_mismatch") {
    return { kind: "request_conflict" };
  }
  if (isGenerationFailureCode(code)) {
    // G7: POST の Error 経路では post-reserve 系を offline にして pending を守る。
    // pre-reserve / 合成業務 code（draft_not_found 等）は classify 上 failed。
    // G1: new_menu の draft_not_found だけは submit 側で live revision 採用を試みる。
    if (surface === "post" && POST_ERROR_STATUS_RECOVERABLE_FAILURE_CODES.has(code)) {
      return { kind: "offline" };
    }
    return { kind: "failed", code, message: issueMessages[code] };
  }
  if (CLOSED_SERVER_RECOVERABLE_CODES.has(code)) {
    // surface に関わらず pending 維持して status/再POST で回収する（G1/G2）
    void surface;
    return { kind: "offline" };
  }
  return { kind: "offline" };
}

/**
 * G1: 別端末が live draft を in-place で N+1 に進めると、pin した N は 0 行になり
 * integrity が draft_not_found を返す。下書き本体は残っているので pending を焼かず、
 * 同じ idempotencyKey のまま revision だけ進めた next を返す。generation_in_progress は
 * 台帳行を増やさないため HMAC 再計算でも payload_mismatch にならない。削除・別 id・
 * 同 revision は null。
 * G-R3: save はここではしない。呼び出し側が isCurrent のときだけ書く。discard 中の
 * live 読取が終わっても、捨てた pending を N+1 で書き戻さない。
 */
async function adoptStalePinnedDraftRevision(
  pending: PendingGeneration,
): Promise<PendingGeneration | null> {
  if (pending.kind !== "new_menu") return null;
  const live = await readLiveGenerationDraftPin(pending.ownerUserId);
  if (live === null) return null;
  if (live.draftId !== pending.request.draftId) return null;
  if (live.revision <= pending.request.draftRevision) return null;
  return pendingGenerationSchema.parse({
    ...pending,
    request: {
      ...pending.request,
      draftRevision: live.revision,
    },
  });
}

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
  const queryClient = useQueryClient();

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
  const isActiveToken = useCallback((token: GenerationLifecycleToken) => {
    const current = lifecycleRef.current;
    return (
      current === token &&
      current.ownerUserId === token.ownerUserId &&
      current.epoch === token.epoch &&
      current.idempotencyKey === token.idempotencyKey
    );
  }, []);
  const isCurrent = useCallback(
    (token: GenerationLifecycleToken) => isActiveToken(token) && storedMatches(token),
    [isActiveToken, storedMatches],
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
        let commandPending = pending;
        for (;;) {
          try {
            const data = await postGeneration(pendingGenerationCommand(commandPending));
            // 他タブが先に結果着地して pending を消しても、同一 lifecycle の
            // processing / succeeded は回収する。not_started 再POST は pending 必須。
            if (data.status === "succeeded" || data.status === "processing") {
              if (!isActiveToken(token)) return;
            } else if (!isCurrent(token)) {
              return;
            }
            token.phase = data.status === "not_started" ? "submitting" : data.status;
            dispatch({ type: "status", data });
            return;
          } catch (error) {
            if (!isCurrent(token)) return;
            const classified = classifyGenerationClientError(error, "post");
            // Plan 3: 409 idempotency_payload_mismatch は offline 再試行ループへ落とさない。
            if (classified.kind === "request_conflict") {
              token.phase = "request_conflict";
              // remount / C1 安全のため pending は即消し、端末 UI はメモリ上に残す。
              clearPendingGeneration();
              dispatch({
                type: "request_conflict",
                code: "idempotency_payload_mismatch",
                message: issueMessages.idempotency_payload_mismatch,
              });
              return;
            }
            // 業務・品質・閉じたサーバ code は failed。offline「通信確認」に落とさない（本番 422 調査）。
            if (classified.kind === "failed") {
              // G1: 別端末の live revision 進行で pin N が消えたときは live を載せて再 POST。
              // G-R2: 読取〜再 POST のあいだに C が N+2 へ進めても同じ submit で再 adopt する。
              // 削除・別 id・同 revision は従来どおり終端（adopt が null）。
              // G-R1: query error は throw し、ここが offline で pending を守る。
              // G-R3: 成功 adopt でも !isCurrent なら合成 draft_not_found へ落とさない。
              // discard の idle を維持し、adopt の書き込みもここではしない。
              // G-R4: adopt throw も !isCurrent なら network_error しない。
              // discard 済み idle を offline に戻すと GenerationPage の Navigate が外れる。
              if (classified.code === "draft_not_found") {
                let adopted: PendingGeneration | null;
                try {
                  adopted = await adoptStalePinnedDraftRevision(commandPending);
                } catch (adoptError) {
                  const adoptClassified = classifyGenerationClientError(adoptError, "post");
                  if (adoptClassified.kind === "auth") {
                    clearPendingGeneration();
                    invalidateLifecycle();
                    dispatch({ type: "clear" });
                    void redirectToLoginForExpiredSession({ returnTo: "/planner" });
                    return;
                  }
                  // G-R4: discard 済みなら idle を維持する。G-R1 の pending 維持は isCurrent のときだけ。
                  if (!isCurrent(token)) return;
                  token.phase = "offline";
                  dispatch({ type: "network_error" });
                  return;
                }
                if (adopted !== null) {
                  if (!isCurrent(token)) return;
                  savePendingGeneration(adopted);
                  commandPending = adopted;
                  continue;
                }
              }
              clearPendingGeneration();
              const failed = syntheticFailedStatus(
                commandPending.request.idempotencyKey,
                classified.code,
                classified.message,
                readCachedUsageSuccess(queryClient, token.ownerUserId),
              );
              token.phase = "failed";
              dispatch({ type: "status", data: failed });
              return;
            }
            // 認証切れを offline にすると「通信確認」のまま永久に止まる（複数端末ログアウト等）。
            // lifecycle も無効化し、replace 遅延中に再試行が「operation is active」で詰まるのを防ぐ（A2）。
            if (classified.kind === "auth") {
              clearPendingGeneration();
              invalidateLifecycle();
              dispatch({ type: "clear" });
              void redirectToLoginForExpiredSession({ returnTo: "/planner" });
              return;
            }
            // transport / 未知の Error.message のみ offline
            token.phase = "offline";
            dispatch({ type: "network_error" });
            return;
          }
        }
      });
      const record: InFlightRecord = { token, promise: operation };
      submitInFlightRef.current = record;
      void operation.finally(() => {
        if (submitInFlightRef.current === record) submitInFlightRef.current = null;
      });
      return operation;
    },
    [dispatch, invalidateLifecycle, isActiveToken, isCurrent, queryClient],
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
    let token = lifecycleRef.current;
    if (pending === null) {
      // 他タブが先に結果着地して pending を消しても、同一 lifecycle の
      // processing poll / succeeded 着地は続ける。破棄（invalidate）後は止める。
      if (token === null || userId === null || token.ownerUserId !== userId) {
        return Promise.resolve();
      }
    } else if (
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
    const idempotencyKey = pending?.request.idempotencyKey ?? token.idempotencyKey;
    const current = statusInFlightRef.current;
    if (current?.token === token) return current.promise;
    const operation = Promise.resolve().then(async () => {
      try {
        const data = await getGenerationStatus(idempotencyKey);
        // 他タブが先に結果着地して pending を消しても、同一 lifecycle の
        // processing / succeeded は回収する。not_started 再POST は pending 必須。
        if (data.status === "succeeded" || data.status === "processing") {
          if (!isActiveToken(token)) return;
        } else if (!isCurrent(token)) {
          return;
        }
        token.phase = data.status === "not_started" ? "submitting" : data.status;
        dispatch({ type: "status", data });
        if (data.status === "not_started" && pending !== null && isCurrent(token))
          void resumeNotStarted(token, pending);
      } catch (error) {
        if (!isCurrent(token)) return;
        // GET は surface "get": 閉じたサーバ code は offline（pending 維持）。業務 code のみ failed。
        const classified = classifyGenerationClientError(error, "get");
        if (classified.kind === "auth") {
          clearPendingGeneration();
          invalidateLifecycle();
          dispatch({ type: "clear" });
          void redirectToLoginForExpiredSession({ returnTo: "/planner" });
          return;
        }
        if (classified.kind === "failed") {
          clearPendingGeneration();
          const failed = syntheticFailedStatus(
            idempotencyKey,
            classified.code,
            classified.message,
            readCachedUsageSuccess(queryClient, token.ownerUserId),
          );
          token.phase = "failed";
          dispatch({ type: "status", data: failed });
          return;
        }
        if (classified.kind === "request_conflict") {
          clearPendingGeneration();
          token.phase = "request_conflict";
          dispatch({
            type: "request_conflict",
            code: "idempotency_payload_mismatch",
            message: issueMessages.idempotency_payload_mismatch,
          });
          return;
        }
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
  }, [
    dispatch,
    invalidateLifecycle,
    isActiveToken,
    isCurrent,
    queryClient,
    read,
    resumeNotStarted,
    userId,
  ]);

  const startGeneration = useCallback(
    async (pending: PendingGeneration) => {
      const previous = lifecycleRef.current;
      const previousPhase = previous?.phase ?? "idle";
      const allowed =
        previousPhase === "idle" ||
        previousPhase === "succeeded" ||
        previousPhase === "failed" ||
        previousPhase === "constraint_conflict" ||
        previousPhase === "request_conflict";
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
      // G14: document.hidden でも timer チェーンを切らない。
      // 以前は hidden 時に retry を飛ばし、state 不変のまま次の setTimeout が張られず
      // visibilitychange まで status が進まなかった。background 完了の体感遅延を縮める。
      // （visibility 復帰時の即時 retry は下の listener が担当）
      const timer = window.setTimeout(() => {
        void retryStatus();
      }, 2_000);
      return () => {
        window.clearTimeout(timer);
      };
    }
    const token = lifecycleRef.current;
    if (state.phase === "succeeded" && userId !== null) {
      void queryClient.invalidateQueries({
        queryKey: usageTodayQueryKey(userId, jstDayKey()),
      });
      // 再生成で同グループに案が増える。versions/groups を残すと 15–30s の間
      // スイッチャーが1案のまま・履歴「N案」が古いままになる（敵対的 C1/C11）。
      void queryClient.invalidateQueries({ queryKey: historyKeys.groups(userId) });
      void queryClient.invalidateQueries({
        queryKey: ["history", "versions", userId],
      });
      // finalize の soft-delete は new_menu（draft_id あり）のみ。
      // regenerate_* は下書きを消さないため、cache を null で潰すと planner の
      // 一回限り hydrate が空フォームを固定し得る。kind は clear 前に読む。
      // read() と同じく now を明示（省略すると mock/実装とも TTL 判定が壊れる）。
      const pending = readPendingGeneration(userId, new Date());
      if (pending?.kind === "new_menu") {
        queryClient.setQueryData(plannerKeys.draft(userId), null);
      }
      void queryClient.invalidateQueries({ queryKey: plannerKeys.draft(userId) });
    }
    if (
      state.effect === "navigate" &&
      token !== null &&
      token.phase === "succeeded" &&
      token.idempotencyKey === state.data.idempotencyKey &&
      isActiveToken(token)
    ) {
      // G-R2: 別タブが claim した新しい pending B は消さない。
      // clearPendingGeneration は key 非照合なので、pending 無し（他タブが A を
      // 先に消した着地）または stored key が token A と一致するときだけ呼ぶ。
      const stored = userId === null ? null : readPendingGeneration(userId, new Date());
      if (stored === null || stored.request.idempotencyKey === token.idempotencyKey) {
        clearPendingGeneration();
      }
      void navigate(`/menus/${state.data.menuId}?recovered=1`);
    }
    if (
      (state.phase === "failed" || state.phase === "constraint_conflict") &&
      token !== null &&
      token.phase === state.phase &&
      token.idempotencyKey === state.data.idempotencyKey &&
      isCurrent(token)
    ) {
      // pending はここでは消さない。
      // Planner が POST 完了後に /generation へ遷移する経路では、終端化と同時に
      // pending を消すと新しい Recovery インスタンスが idle のまま /planner へ戻り、
      // 失敗・条件競合のメッセージが一度も表示されない。
      // TTL 切れ・次の startGeneration（上書き）・clearGeneration が掃除を担う。
      if (userId !== null) {
        void queryClient.invalidateQueries({
          queryKey: usageTodayQueryKey(userId, jstDayKey()),
        });
      }
    }
    // request_conflict は submit 時に pending を消済み。利用状況だけ更新する。
    if (state.phase === "request_conflict" && userId !== null) {
      void queryClient.invalidateQueries({
        queryKey: usageTodayQueryKey(userId, jstDayKey()),
      });
    }
    // G14: 合成 in_progress は台帳行が無い。GET は not_started なので POST を遅延再送する。
    // G-R1: 再 POST は A 完了後の reserveNew 本生成で終端まで返らない。
    // startGeneration と同じく token.phase と submit を先に進め、飛行中は
    // submitting パネル（破棄 confirm あり）にする。submit は idle からしか
    // submitting に入らないため、failed からは clear してから submit する。
    if (state.phase === "failed" && state.data.error.code === "generation_in_progress") {
      const pending = read();
      const waitToken = lifecycleRef.current;
      if (pending !== null && waitToken !== null && isCurrent(waitToken)) {
        const timer = window.setTimeout(() => {
          if (!isCurrent(waitToken)) return;
          waitToken.phase = "submitting";
          dispatch({ type: "clear" });
          dispatch({ type: "submit" });
          void submitWithToken(waitToken, pending);
        }, GENERATION_IN_PROGRESS_RETRY_MS);
        return () => {
          window.clearTimeout(timer);
        };
      }
    }
    return undefined;
  }, [
    dispatch,
    isActiveToken,
    isCurrent,
    navigate,
    queryClient,
    read,
    retryStatus,
    state,
    submitWithToken,
    userId,
  ]);

  useEffect(() => {
    // イベント駆動の復旧は「保存済み pending があるときだけ」。
    // failed / constraint_conflict は terminal UI を残したまま pending を消すため、
    // 無条件 online / TOKEN_REFRESHED は checking 永久スピナーになる（C1）。
    // マウント時 recover と同じく pending を正とする。visibilitychange は
    // retryStatus のみで phase を変えないためこのガード対象外。
    const recover = () => {
      if (read() === null) return;
      const token = lifecycleRef.current;
      // G15: サーバ終端で pending をメッセージ表示用に保持している間、online /
      // TOKEN_REFRESHED で checking 再入 + status re-fetch すると UI thrash する。
      // サーバ終端は不変なので recheck もしない（processing 中の recover は従来どおり）。
      // G28: succeeded も同じ。navigate 前の TOKEN_REFRESHED で checking に戻さない。
      if (
        token !== null &&
        (token.phase === "failed" ||
          token.phase === "constraint_conflict" ||
          token.phase === "succeeded")
      ) {
        return;
      }
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
  }, [clearGeneration, dispatch, read, retryStatus, userId]);

  // ブラウザが online のまま API だけ落ちる場合、window "online" が再発火しない。
  // offline 表示中のみ指数バックオフ再試行（5s→10s→…→60s）。半死 API の連打を抑える。
  const offlineRetryAttemptRef = useRef(0);
  useEffect(() => {
    if (state.phase !== "offline") {
      offlineRetryAttemptRef.current = 0;
      return undefined;
    }
    let cancelled = false;
    let timer: number | undefined;
    const arm = () => {
      const attempt = offlineRetryAttemptRef.current;
      const delay = Math.min(
        OFFLINE_RETRY_MAX_MS,
        OFFLINE_RETRY_BASE_MS * 2 ** Math.min(attempt, 4),
      );
      timer = window.setTimeout(() => {
        if (cancelled) return;
        if (
          (typeof navigator === "undefined" || navigator.onLine) &&
          !document.hidden &&
          read() !== null
        ) {
          void retryStatus();
          // G16: retry を実際に発行したときだけ attempt を進める。
          // hidden / オフラインで skip した tick では据え置きし、復帰後の間隔を伸ばさない。
          offlineRetryAttemptRef.current = Math.min(attempt + 1, 8);
        }
        // 成功して phase が変わっても cleanup で cancelled になる。
        arm();
      }, delay);
    };
    arm();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [state.phase, read, retryStatus]);

  return { state, startGeneration, retryStatus, clearGeneration };
}
