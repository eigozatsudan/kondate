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
  const serialized = JSON.stringify(value);
  latestRef.current = value;

  useEffect(() => {
    revisionRef.current = initialRevision;
    setSavedRevision(initialRevision);
  }, [initialRevision]);

  const enqueue = useCallback(
    (next: PlannerDraftInput): Promise<PlannerDraft> => {
      const operationNumber = ++operationNumberRef.current;
      setState("saving");
      const operation = queueRef.current.then(() => save(next, revisionRef.current));
      queueRef.current = operation.then(
        (saved) => {
          revisionRef.current = saved.revision;
          setSavedRevision(saved.revision);
          if (operationNumber === operationNumberRef.current) setState("saved");
        },
        (error: unknown) => {
          if (operationNumber === operationNumberRef.current) setState("error");
          if (error instanceof DraftRevisionConflictError) onConflict?.();
        },
      );
      return operation;
    },
    [onConflict, save],
  );

  useEffect(() => {
    if (!enabled) return undefined;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void enqueue(value).catch(() => undefined);
    }, 600);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [enabled, enqueue, serialized, value]);

  const flush = useCallback((): Promise<PlannerDraft> => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return enqueue(latestRef.current);
  }, [enqueue]);

  return { state, revision: savedRevision, flush };
}
