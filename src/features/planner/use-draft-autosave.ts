import { useCallback, useEffect, useRef, useState } from "react";
import {
  plannerDraftInputSchema,
  type PlannerDraft,
  type PlannerDraftInput,
} from "@shared/contracts/planner";
import { DraftRevisionConflictError } from "./planner-api";

export type DraftSaveState = "idle" | "saving" | "saved" | "error";

export type DraftAutosaveController = {
  state: DraftSaveState;
  revision: number;
  flush: () => Promise<PlannerDraft>;
};

/** 明示 reset 直後の強制保存 Promise。flush が完了を await できるように共有する（P1）。 */
type PendingForceSave = {
  promise: Promise<PlannerDraft>;
};

class SupersededDraftSaveError extends Error {
  constructor() {
    super("reset 前の下書き保存は無効化されました");
    this.name = "SupersededDraftSaveError";
  }
}

/**
 * 質問途中の整合前状態（例: idea + servings=null）。
 * DB CHECK / plannerDraftInputSchema が拒否するため RPC に送らない。
 * debounce autosave では error toast にせず握りつぶし、flush では呼び出し元へ返す。
 */
export class IncompleteDraftSaveError extends Error {
  readonly code = "incomplete_draft" as const;

  constructor() {
    super("献立条件の途中状態はまだ保存できません");
    this.name = "IncompleteDraftSaveError";
  }
}

/**
 * 永続化可能か判定する。value に id/revision 等が混ざっていても入力フィールドだけ見る
 * （hydrate 由来の余剰キーで false にしない）。
 */
/**
 * conflictRef.current を読む。直接比較すると await 前後で
 * CFA が null に固定し no-unnecessary-condition / only-throw-error が誤爆するため、
 * 関数経由で毎回読む。
 */
function peekDraftConflict(ref: {
  current: DraftRevisionConflictError | null;
}): DraftRevisionConflictError | null {
  return ref.current;
}

function isPersistableDraft(value: PlannerDraftInput): boolean {
  return plannerDraftInputSchema.safeParse({
    mealType: value.mealType,
    mainIngredients: value.mainIngredients,
    cuisineGenre: value.cuisineGenre,
    targetMode: value.targetMode,
    targetMemberIds: value.targetMemberIds,
    servings: value.servings,
    timeLimitMinutes: value.timeLimitMinutes,
    budgetPreference: value.budgetPreference,
    ingredientPreference: value.ingredientPreference,
    avoidIngredients: value.avoidIngredients,
    memo: value.memo,
    pantrySelections: value.pantrySelections,
  }).success;
}

export function useDraftAutosave({
  value,
  enabled,
  baselineRevision,
  resetToken,
  save,
  onConflict,
  onSaved,
}: {
  value: PlannerDraftInput;
  enabled: boolean;
  baselineRevision: number;
  resetToken: number;
  save: (value: PlannerDraftInput, revision: number) => Promise<PlannerDraft>;
  onConflict?: () => void | Promise<void>;
  /** サーバ確定後の cache 同期など。supersede で破棄した書込では呼ばない。 */
  onSaved?: (draft: PlannerDraft) => void;
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
  const enabledRef = useRef(enabled);
  const hasCompletedInitialResetEffectRef = useRef(false);
  const enqueueRef = useRef<(next: PlannerDraftInput) => Promise<PlannerDraft>>(() =>
    Promise.reject(new Error("autosave enqueue is not ready")),
  );
  // P1: reset 強制保存を fire-and-forget で握りつぶさず、flush から await 可能にする
  const pendingForceSaveRef = useRef<PendingForceSave | null>(null);
  const onSavedRef = useRef(onSaved);
  latestRef.current = value;
  latestSerializedRef.current = serialized;
  baselineRevisionRef.current = baselineRevision;
  enabledRef.current = enabled;
  onSavedRef.current = onSaved;

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
    revisionRef.current = baselineRevisionRef.current;
    setSavedRevision(baselineRevisionRef.current);
    pendingDebounceRef.current = false;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    if (mountedRef.current) setState("idle");

    // 初回 mount は hydrate 同期のみ（保存しない）。
    if (!hasCompletedInitialResetEffectRef.current) {
      hasCompletedInitialResetEffectRef.current = true;
      baselineSerializedRef.current = latestSerializedRef.current;
      return;
    }

    // P1: 明示 reset 後は empty が baseline 一致扱いになり debounce が no-op になる。
    // 現行 value（route は空下書き）を強制 enqueue しサーバと揃える。
    // in-flight は generation で supersede 済み。キュー末尾の強制保存が上書きする。
    // 失敗は enqueue 側で state=error。Promise は pendingForceSaveRef 経由で flush が await する
    // （.catch で結果を握りつぶさない。unhandled rejection だけ派生 then で抑止）。
    baselineSerializedRef.current = "\0__reset_force_dirty__";
    if (enabledRef.current) {
      const promise = enqueueRef.current(latestRef.current);
      const entry: PendingForceSave = { promise };
      pendingForceSaveRef.current = entry;
      void promise.then(
        () => {
          if (pendingForceSaveRef.current === entry) pendingForceSaveRef.current = null;
        },
        () => {
          // 失敗結果は呼び出し側（flush / toast 再試行）へ残す。ここでは pending 解除のみ。
          if (pendingForceSaveRef.current === entry) pendingForceSaveRef.current = null;
        },
      );
    }
  }, [resetToken]);

  const enqueue = useCallback(
    (next: PlannerDraftInput): Promise<PlannerDraft> => {
      {
        const existingConflict = peekDraftConflict(conflictRef);
        if (existingConflict !== null) {
          if (mountedRef.current) setState("error");
          return Promise.reject(existingConflict);
        }
      }
      // idea 選択直後など整合前の一時状態は RPC しない（CHECK 違反 → 偽の保存失敗 toast を防ぐ）。
      // state は触らない（直前の idle/saved を維持。error にもしない）。
      if (!isPersistableDraft(next)) {
        return Promise.reject(new IncompleteDraftSaveError());
      }
      const resetGeneration = resetGenerationRef.current;
      const operationNumber = ++operationNumberRef.current;
      if (mountedRef.current) setState("saving");
      const operation = queueRef.current.then(async () => {
        if (resetGeneration !== resetGenerationRef.current) {
          throw new SupersededDraftSaveError();
        }
        // 競合前に予約済みだった後続保存も、先行保存の競合判明後は実行しない。
        {
          const existingConflict = peekDraftConflict(conflictRef);
          if (existingConflict !== null) throw existingConflict;
        }

        // P4: キュー待ち〜in-flight 完了後に latest が変わっていれば追従する。
        // 予約時 next へのフォールバックは mode 切替・strip 後に旧内容を書くため使わない。
        for (;;) {
          if (resetGeneration !== resetGenerationRef.current) {
            throw new SupersededDraftSaveError();
          }
          {
            const existingConflict = peekDraftConflict(conflictRef);
            if (existingConflict !== null) throw existingConflict;
          }

          const latest = latestRef.current;
          if (!isPersistableDraft(latest)) {
            // P2: 途中状態（idea+servings=null 等）へ遷移したあと、既に書いた旧 mode を
            // 成功 return しない。onSaved / toast「保存しました」/ RQ cache が旧 household のまま
            // 進む idea/household 混乱を防ぐ。revision は save 成功時に local へ反映済み。
            // サーバ上の中間 revision は残り得る（P4 残差）。Incomplete で flush 呼び出し元へ通知する。
            throw new IncompleteDraftSaveError();
          }

          const toSave = latest;
          // ネットワーク直前にも generation を再確認（await 開始前の切替を拾う）
          if (resetGeneration !== resetGenerationRef.current) {
            throw new SupersededDraftSaveError();
          }

          try {
            // P4 残差: 既に飛んだ RPC のペイロードは開始時 toSave のまま commit される。
            // キャンセル可能な transport は持たないため、成功後の追記ループで latest に収束する。
            const saved = await save(toSave, revisionRef.current);
            if (resetGeneration !== resetGenerationRef.current) {
              // 無効化後でもサーバ revision は進んでいる。後続の空保存が conflict しないよう引き継ぐ。
              revisionRef.current = saved.revision;
              if (mountedRef.current) setSavedRevision(saved.revision);
              throw new SupersededDraftSaveError();
            }
            // ループ継続用にローカル revision を進める。
            // P2 で Incomplete に落ちても次の persistable 保存が conflict しないよう UI revision も同期する。
            revisionRef.current = saved.revision;
            if (mountedRef.current) setSavedRevision(saved.revision);

            // P4: in-flight 中の strip / 編集があれば最新を同一キュー内で追記保存する
            if (JSON.stringify(toSave) !== latestSerializedRef.current) {
              continue;
            }
            return { saved, toSave };
          } catch (error: unknown) {
            if (resetGeneration !== resetGenerationRef.current) {
              throw new SupersededDraftSaveError();
            }
            throw error;
          }
        }
      });
      queueRef.current = operation.then(
        (result) => {
          if (resetGeneration !== resetGenerationRef.current) return;
          revisionRef.current = result.saved.revision;
          // 成功 return は latest 一致時のみ（P2 で non-persistable 成功経路を廃止）
          baselineSerializedRef.current = JSON.stringify(result.toSave);
          if (mountedRef.current) {
            setSavedRevision(result.saved.revision);
            if (operationNumber === operationNumberRef.current) setState("saved");
          }
          onSavedRef.current?.(result.saved);
        },
        (error: unknown) => {
          if (
            resetGeneration !== resetGenerationRef.current ||
            error instanceof SupersededDraftSaveError
          ) {
            return;
          }
          // P2: Incomplete は error toast にしないが、saving 固着を避け idle へ戻す
          // （旧 lastSaved 成功 return では saved になっていた経路の代替）。
          if (error instanceof IncompleteDraftSaveError) {
            if (mountedRef.current && operationNumber === operationNumberRef.current) {
              setState("idle");
            }
            return;
          }
          if (mountedRef.current && operationNumber === operationNumberRef.current) {
            setState("error");
          }
          if (error instanceof DraftRevisionConflictError && conflictRef.current === null) {
            conflictRef.current = error;
            if (mountedRef.current) void onConflict?.();
          }
        },
      );
      return operation.then((result) => result.saved);
    },
    [onConflict, save],
  );

  enqueueRef.current = enqueue;

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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // P3: debounce 待ちだけでなく、error 後などで dirty のまま残った編集も離脱時に再試行する
      const dirty = latestSerializedRef.current !== baselineSerializedRef.current;
      if (!pendingDebounceRef.current && !dirty) return;
      pendingDebounceRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      // 画面離脱直前の編集も通常保存と同じ直列キューへ積み、完了後は UI state を更新しない。
      // P5 残差: unmount 後は toast を出せないため失敗は握りつぶす。settings 等の明示遷移は
      // route が await flush + submissionError で可視化する（P5 修正側）。
      void enqueueRef.current(latestRef.current).catch(() => undefined);
    };
  }, []);

  const flush = useCallback((): Promise<PlannerDraft> => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingDebounceRef.current = false;
    // P1: reset 強制保存が走っている間はそれを await し、完了/失敗を呼び出し元へ返す。
    // 成功後にまだ dirty（reset 直後の追記編集など）なら通常 enqueue で追従する。
    const pending = pendingForceSaveRef.current;
    if (pending !== null) {
      return pending.promise.then(
        (saved) => {
          if (latestSerializedRef.current !== baselineSerializedRef.current) {
            return enqueue(latestRef.current);
          }
          return saved;
        },
        (error: unknown) => {
          // supersede された強制保存は最新でやり直す。それ以外（ネットワーク等）は失敗を隠さない。
          if (error instanceof SupersededDraftSaveError) {
            return enqueue(latestRef.current);
          }
          throw error;
        },
      );
    }
    return enqueue(latestRef.current);
  }, [enqueue]);

  return { state, revision: savedRevision, flush };
}
