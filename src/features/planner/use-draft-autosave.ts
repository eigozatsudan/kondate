import { useCallback, useEffect, useRef, useState } from "react";
import type { PlannerDraft, PlannerDraftInput } from "@shared/contracts/planner";
import { DraftRevisionConflictError } from "./planner-api";

export type DraftSaveState = "idle" | "saving" | "saved" | "error";

export type DraftAutosaveController = {
  state: DraftSaveState;
  revision: number;
  flush: () => Promise<PlannerDraft>;
};

export function useDraftAutosave({
  value,
  enabled,
  initialRevision,
  save,
  onConflict,
}: {
  value: PlannerDraftInput;
  enabled: boolean;
  initialRevision: number;
  save: (value: PlannerDraftInput, revision: number) => Promise<PlannerDraft>;
  onConflict?: () => void;
}): DraftAutosaveController {
  const [state, setState] = useState<DraftSaveState>("idle");
  const [savedRevision, setSavedRevision] = useState(initialRevision);
  const revisionRef = useRef(initialRevision);
  const latestRef = useRef(value);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const timerRef = useRef<number | null>(null);
  const operationNumberRef = useRef(0);
  const conflictRef = useRef<DraftRevisionConflictError | null>(null);
  const serialized = JSON.stringify(value);
  const latestSerializedRef = useRef(serialized);
  const baselineSerializedRef = useRef(serialized);
  const wasEnabledRef = useRef(false);
  latestRef.current = value;
  latestSerializedRef.current = serialized;

  useEffect(() => {
    // 競合後に refetch された revision だけを古い表示値へ結び直すと他画面の保存を上書きするため、
    // 明示的な再読み込みで画面全体が作り直されるまでは競合時点の revision を保持する。
    if (conflictRef.current !== null) return;
    revisionRef.current = initialRevision;
    setSavedRevision(initialRevision);
    // サーバーから取得した revision と現在表示値を新しい保存基準とし、
    // hydration や競合後の refetch 自体をユーザー編集として再保存しない。
    baselineSerializedRef.current = latestSerializedRef.current;
  }, [initialRevision]);

  const enqueue = useCallback(
    (next: PlannerDraftInput): Promise<PlannerDraft> => {
      if (conflictRef.current !== null) {
        setState("error");
        return Promise.reject(conflictRef.current);
      }
      const operationNumber = ++operationNumberRef.current;
      setState("saving");
      const operation = queueRef.current.then(() => {
        // 競合前に予約済みだった後続保存も、先行保存の競合判明後は実行しない。
        if (conflictRef.current !== null) throw conflictRef.current;
        return save(next, revisionRef.current);
      });
      queueRef.current = operation.then(
        (saved) => {
          revisionRef.current = saved.revision;
          baselineSerializedRef.current = JSON.stringify(next);
          setSavedRevision(saved.revision);
          if (operationNumber === operationNumberRef.current) setState("saved");
        },
        (error: unknown) => {
          if (operationNumber === operationNumberRef.current) setState("error");
          if (error instanceof DraftRevisionConflictError && conflictRef.current === null) {
            conflictRef.current = error;
            onConflict?.();
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
      return undefined;
    }
    if (!wasEnabledRef.current) {
      wasEnabledRef.current = true;
      baselineSerializedRef.current = serialized;
      return undefined;
    }
    if (serialized === baselineSerializedRef.current) return undefined;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void enqueue(latestRef.current).catch(() => undefined);
    }, 600);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [enabled, enqueue, serialized]);

  const flush = useCallback((): Promise<PlannerDraft> => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return enqueue(latestRef.current);
  }, [enqueue]);

  return { state, revision: savedRevision, flush };
}
