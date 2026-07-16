import { useCallback, useEffect, useRef, useState } from "react";
import type { PlannerDraft, PlannerDraftInput } from "@shared/contracts/planner";
import { DraftRevisionConflictError } from "./planner-api";

export type DraftSaveState = "idle" | "saving" | "saved" | "error";

export type DraftAutosaveController = {
  state: DraftSaveState;
  revision: number;
  flush: () => Promise<PlannerDraft>;
};

class SupersededDraftSaveError extends Error {
  constructor() {
    super("reset 前の下書き保存は無効化されました");
    this.name = "SupersededDraftSaveError";
  }
}

export function useDraftAutosave({
  value,
  enabled,
  baselineRevision,
  resetToken,
  save,
  onConflict,
}: {
  value: PlannerDraftInput;
  enabled: boolean;
  baselineRevision: number;
  resetToken: number;
  save: (value: PlannerDraftInput, revision: number) => Promise<PlannerDraft>;
  onConflict?: () => void | Promise<void>;
}): DraftAutosaveController {
  const [state, setState] = useState<DraftSaveState>("idle");
  const [savedRevision, setSavedRevision] = useState(baselineRevision);
  const revisionRef = useRef(baselineRevision);
  const latestRef = useRef(value);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const timerRef = useRef<number | null>(null);
  const pendingDebounceRef = useRef(false);
  const mountedRef = useRef(true);
  const operationNumberRef = useRef(0);
  const resetGenerationRef = useRef(0);
  const baselineRevisionRef = useRef(baselineRevision);
  const conflictRef = useRef<DraftRevisionConflictError | null>(null);
  const serialized = JSON.stringify(value);
  const latestSerializedRef = useRef(serialized);
  const baselineSerializedRef = useRef(serialized);
  const wasEnabledRef = useRef(false);
  latestRef.current = value;
  latestSerializedRef.current = serialized;
  baselineRevisionRef.current = baselineRevision;

  const resetBaseline = useCallback((revision: number): void => {
    revisionRef.current = revision;
    setSavedRevision(revision);
    baselineSerializedRef.current = latestSerializedRef.current;
    pendingDebounceRef.current = false;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    if (conflictRef.current !== null) return;
    resetBaseline(baselineRevision);
  }, [baselineRevision, resetBaseline]);

  useEffect(() => {
    // reset より前の非同期継続を、競合や revision を触る前に一括で失効させる。
    resetGenerationRef.current += 1;
    operationNumberRef.current += 1;
    conflictRef.current = null;
    resetBaseline(baselineRevisionRef.current);
    if (mountedRef.current) setState("idle");
  }, [resetBaseline, resetToken]);

  const enqueue = useCallback(
    (next: PlannerDraftInput): Promise<PlannerDraft> => {
      if (conflictRef.current !== null) {
        if (mountedRef.current) setState("error");
        return Promise.reject(conflictRef.current);
      }
      const resetGeneration = resetGenerationRef.current;
      const operationNumber = ++operationNumberRef.current;
      if (mountedRef.current) setState("saving");
      const operation = queueRef.current.then(async () => {
        if (resetGeneration !== resetGenerationRef.current) {
          throw new SupersededDraftSaveError();
        }
        // 競合前に予約済みだった後続保存も、先行保存の競合判明後は実行しない。
        if (conflictRef.current !== null) throw conflictRef.current;
        try {
          const saved = await save(next, revisionRef.current);
          if (resetGeneration !== resetGenerationRef.current) {
            throw new SupersededDraftSaveError();
          }
          return saved;
        } catch (error: unknown) {
          if (resetGeneration !== resetGenerationRef.current) {
            throw new SupersededDraftSaveError();
          }
          throw error;
        }
      });
      queueRef.current = operation.then(
        (saved) => {
          if (resetGeneration !== resetGenerationRef.current) return;
          revisionRef.current = saved.revision;
          baselineSerializedRef.current = JSON.stringify(next);
          if (mountedRef.current) {
            setSavedRevision(saved.revision);
            if (operationNumber === operationNumberRef.current) setState("saved");
          }
        },
        (error: unknown) => {
          if (
            resetGeneration !== resetGenerationRef.current ||
            error instanceof SupersededDraftSaveError
          ) {
            return;
          }
          if (mountedRef.current && operationNumber === operationNumberRef.current) {
            setState("error");
          }
          if (error instanceof DraftRevisionConflictError && conflictRef.current === null) {
            conflictRef.current = error;
            if (mountedRef.current) onConflict?.();
          }
        },
      );
      return operation;
    },
    [onConflict, save],
  );

  useEffect(() => {
    if (!enabled) {
      baselineSerializedRef.current = serialized;
      wasEnabledRef.current = false;
      pendingDebounceRef.current = false;
      return undefined;
    }
    if (!wasEnabledRef.current) {
      wasEnabledRef.current = true;
      baselineSerializedRef.current = serialized;
      pendingDebounceRef.current = false;
      return undefined;
    }
    if (serialized === baselineSerializedRef.current) {
      pendingDebounceRef.current = false;
      return undefined;
    }
    pendingDebounceRef.current = true;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      pendingDebounceRef.current = false;
      void enqueue(latestRef.current).catch(() => undefined);
    }, 600);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [enabled, enqueue, serialized]);

  const enqueueRef = useRef(enqueue);
  enqueueRef.current = enqueue;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (!pendingDebounceRef.current) return;
      pendingDebounceRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      // 画面離脱直前の編集も通常保存と同じ直列キューへ積み、完了後は UI state を更新しない。
      void enqueueRef.current(latestRef.current).catch(() => undefined);
    };
  }, []);

  const flush = useCallback((): Promise<PlannerDraft> => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingDebounceRef.current = false;
    return enqueue(latestRef.current);
  }, [enqueue]);

  return { state, revision: savedRevision, flush };
}
