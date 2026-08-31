import { useCallback, useEffect, useRef, useState } from "react";
import {
  plannerDraftInputSchema,
  type PlannerDraft,
  type PlannerDraftInput,
} from "@shared/contracts/planner";
import { neutralizeAudienceForPersistence } from "./model/planner-wizard";
import { DraftRevisionConflictError } from "./planner-api";

export type DraftSaveState = "idle" | "saving" | "saved" | "error";

export type DraftAutosaveController = {
  state: DraftSaveState;
  revision: number;
  /**
   * `abandonQueued` は leave timeout 後の generate 専用。
   * dirty enqueue の never-settle 連鎖を切り、新 save が先行 RPC に再合流しない。
   * 既開始 RPC は cancel しない。reset の pendingForceSave も切る（hung force に再合流しない）。
   * 旧 success / conflict は generation を進めて無効化する（遅延 CAS の onConflict abort 防止）。
   * 再 leave は渡さない（直列 join を維持）。
   */
  flush: (options?: { abandonQueued?: boolean }) => Promise<PlannerDraft>;
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

function toDraftInputFields(value: PlannerDraftInput | PlannerDraft): PlannerDraftInput {
  return {
    mealType: value.mealType,
    mainIngredients: value.mainIngredients,
    cuisineGenre: value.cuisineGenre,
    targetMode: value.targetMode,
    targetMemberIds: value.targetMemberIds,
    servings: value.servings,
    timeLimitMinutes: value.timeLimitMinutes,
    budgetPreference: value.budgetPreference,
    ingredientPreference: value.ingredientPreference,
    noveltyPreference: value.noveltyPreference,
    avoidIngredients: value.avoidIngredients,
    memo: value.memo,
    pantrySelections: value.pantrySelections,
  };
}

function isPersistableDraft(value: PlannerDraftInput): boolean {
  return plannerDraftInputSchema.safeParse(toDraftInputFields(value)).success;
}

/**
 * fingerprint / Zod と同じ persistable 入力。保存応答は trim 済み、UI は raw のまま。
 */
function canonicalPersistableInput(value: PlannerDraftInput | PlannerDraft): PlannerDraftInput {
  const fields = toDraftInputFields(value);
  const parsed = plannerDraftInputSchema.safeParse(fields);
  return parsed.success ? parsed.data : fields;
}

/**
 * flush が RPC せず返す lastSaved が、現行 persistable と同一入力か。
 * 照合は sanitize / fingerprint と同じ canonical 入力を使う（P-R1）。
 * memberIds がサーバ行と違うときは一致とみなさない（P-R3）。
 * persistOnReset=false 後の empty に旧 complete を返すと cache へ undelete 相当を書く。
 */
function lastSavedMatchesLatest(
  lastSaved: PlannerDraft,
  latest: PlannerDraftInput,
  lastPersisted: PlannerDraftInput | null,
): boolean {
  const latestCanon = canonicalPersistableInput(latest);
  const savedCanon = canonicalPersistableInput(lastSaved);
  const latestFp = persistenceFingerprint(latestCanon, lastPersisted);
  return persistenceFingerprint(savedCanon, lastPersisted) === latestFp;
}

/**
 * abandon 後の自タブ CAS 負け。live が latest と同じなら旧 leave が同じ内容で勝った。
 * live が放棄済みペイロードと同じなら timeout 後の追記を live.revision で再送する。
 * どちらでもない（他タブ）は本物の conflict。
 */
function classifyAbandonedConflict(
  live: PlannerDraft,
  latest: PlannerDraftInput,
  abandoned: PlannerDraftInput,
  lastPersisted: PlannerDraftInput | null,
): "adopt" | "retry" | "conflict" {
  if (lastSavedMatchesLatest(live, latest, lastPersisted)) return "adopt";
  if (lastSavedMatchesLatest(live, abandoned, lastPersisted)) return "retry";
  return "conflict";
}

/** empty / rev=0 の undelete 防止。persistable empty をサーバへ書かない（P1）。 */
function isEmptyPersistableInput(value: PlannerDraftInput): boolean {
  const fields = canonicalPersistableInput(value);
  return (
    fields.mealType === null &&
    fields.mainIngredients.length === 0 &&
    fields.cuisineGenre === null &&
    fields.targetMode === null &&
    fields.targetMemberIds.length === 0 &&
    fields.servings === null &&
    fields.timeLimitMinutes === null &&
    fields.budgetPreference === null &&
    fields.ingredientPreference === null &&
    fields.avoidIngredients.length === 0 &&
    fields.memo === "" &&
    fields.pantrySelections.length === 0
  );
}

/**
 * 直前にサーバへ書いた（または hydrate した）入力に audience があるか。
 * あるときだけ incomplete → 中立形の strip 保存を許可する（P3）。
 * idea 選択直後の servings=null など「途中入力」では false のままにし、debounce/flush しない。
 */
function hasPersistedAudience(persisted: PlannerDraftInput | null): boolean {
  if (persisted === null) return false;
  return (
    persisted.targetMode !== null ||
    persisted.targetMemberIds.length > 0 ||
    persisted.servings !== null
  );
}

/**
 * 同一 op 内で latest が non-persistable のとき、サーバへ書く audience 中立形。
 * meal 等は latest を保ち、targetMode/members/servings だけ null/空にする。
 */
function audienceNeutralPersistable(value: PlannerDraftInput): PlannerDraftInput | null {
  const neutralized = neutralizeAudienceForPersistence(value);
  return isPersistableDraft(neutralized) ? neutralized : null;
}

/**
 * 旧 complete mode がサーバに残る遷移、および中立保存後に meal 等だけ変わった
 * incomplete を中立形で書く。初回の incomplete idea（lastPersisted 無し、または
 * 中立形が lastPersisted と同じ）では書かない。
 */
function shouldWriteAudienceNeutral(
  latest: PlannerDraftInput,
  lastPersisted: PlannerDraftInput | null,
): boolean {
  if (isPersistableDraft(latest)) return false;
  const neutralized = audienceNeutralPersistable(latest);
  if (neutralized === null) return false;
  if (hasPersistedAudience(lastPersisted)) return true;
  // 中立保存後に meal/ingredients/cuisine だけ変わった incomplete は差分を書く（P1）
  if (lastPersisted !== null && isPersistableDraft(lastPersisted)) {
    return JSON.stringify(neutralized) !== JSON.stringify(lastPersisted);
  }
  return false;
}

/**
 * dirty / baseline 比較用の fingerprint。
 * - persistable はそのまま
 * - strip が必要な incomplete は audience 中立形（P3 後の再送ループ防止 / P11）
 * - 途中 incomplete は「最後に永続化した形」と同一視し debounce を起こさない
 */
function persistenceFingerprint(
  value: PlannerDraftInput,
  lastPersisted: PlannerDraftInput | null,
): string {
  if (isPersistableDraft(value)) return JSON.stringify(value);
  if (shouldWriteAudienceNeutral(value, lastPersisted)) {
    const neutralized = audienceNeutralPersistable(value);
    if (neutralized !== null) return JSON.stringify(neutralized);
  }
  // 途中 incomplete: サーバへ書けないので lastPersisted（または中立形）を dirty 基準にする
  if (lastPersisted !== null && isPersistableDraft(lastPersisted)) {
    return JSON.stringify(lastPersisted);
  }
  const neutralized = audienceNeutralPersistable(value);
  if (neutralized !== null) return JSON.stringify(neutralized);
  return JSON.stringify(value);
}

/**
 * 同一 op 内の追記ループ収束判定用。
 * dirty 用と違い、incomplete は常に中立形と照合する（lastPersisted 依存で誤収束しない）。
 */
function convergenceFingerprint(value: PlannerDraftInput): string {
  if (isPersistableDraft(value)) return JSON.stringify(value);
  const neutralized = audienceNeutralPersistable(value);
  if (neutralized !== null) return JSON.stringify(neutralized);
  return JSON.stringify(value);
}

export function useDraftAutosave({
  value,
  enabled,
  baselineRevision,
  resetToken,
  persistOnReset = true,
  holdLiveRevision = false,
  shouldHoldLiveRevision,
  save,
  onConflict,
  onSaved,
  saveOnUnload,
  hydratedDraft = null,
  refreshLiveDraft,
}: {
  value: PlannerDraftInput;
  enabled: boolean;
  baselineRevision: number;
  resetToken: number;
  /**
   * false のとき resetToken は conflict 解除と local baseline 揃えだけ行う。
   * 公開 sticky 中の empty 強制保存や live-null 解決の undelete を避ける（P-R1 / P-R3）。
   */
  persistOnReset?: boolean;
  /**
   * true のとき flush / debounce / unload は live 下書きを書かない。
   * 公開 sticky の draftRevision pin（C2 再開）を N のまま残す（P-R5）。
   * persistOnReset=false（live-null 解決）とは独立。局所 UI は変えてよい。
   * render 時点の snapshot。跨タブ claim 後の未再描画は shouldHoldLiveRevision で再判定する。
   */
  holdLiveRevision?: boolean;
  /**
   * enqueue / debounce / pagehide 発火時に storage の公開 meta を再読する口（P-R7）。
   * holdLiveRevision が false のままの予約済み timer / unload でも live を進めない。
   */
  shouldHoldLiveRevision?: () => boolean;
  save: (value: PlannerDraftInput, revision: number) => Promise<PlannerDraft>;
  onConflict?: () => void | Promise<void>;
  /** サーバ確定後の cache 同期など。supersede で破棄した書込では呼ばない。 */
  onSaved?: (draft: PlannerDraft) => void;
  /**
   * persistable dirty、または shouldWriteAudienceNeutral が真の incomplete を
   * document unload（pagehide / beforeunload）で同期開始する口。
   * useBlocker は unload を見ない。通常 enqueue は keepalive 無しで中断され得る。
   * 呼び出し側は keepalive 可能な経路を渡す。失敗は可視化しない（best-effort）。
   */
  saveOnUnload?: (value: PlannerDraftInput, revision: number) => void;
  /**
   * hydrate 済み live 行。fingerprint === baseline の flush が RPC しないとき
   * generate / emergency へ id/revision を返す（lastSaved の種）。
   * 生成成功後の null は種を置かず、empty / rev=0 leave の undelete を防ぐ。
   */
  hydratedDraft?: PlannerDraft | null;
  /**
   * flush 短絡の前に live 行を取り直す口（P-R2）。
   * 既定 30s stale の cache を信じない。null は soft-delete。失敗は throw。
   */
  refreshLiveDraft?: () => Promise<PlannerDraft | null>;
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
  /**
   * 直近にサーバへ書いた（または hydrate 同期した）入力。
   * incomplete → 中立 strip の可否判定に使う（初回 idea 途中では audience 無し）。
   */
  const lastPersistedInputRef = useRef<PlannerDraftInput | null>(null);
  /** flush が RPC なしで返すための直近成功 row（P3 中立保存後の incomplete flush）。 */
  const lastSavedDraftRef = useRef<PlannerDraft | null>(null);
  const serialized = JSON.stringify(value);
  // dirty 判定は fingerprint（strip 要の incomplete は中立形）を使い、P3 後の再送ループを防ぐ
  const fingerprint = persistenceFingerprint(value, lastPersistedInputRef.current);
  const latestSerializedRef = useRef(serialized);
  const latestFingerprintRef = useRef(fingerprint);
  const baselineSerializedRef = useRef(fingerprint);
  const wasEnabledRef = useRef(false);
  const enabledRef = useRef(enabled);
  const hasCompletedInitialResetEffectRef = useRef(false);
  const enqueueRef = useRef<(next: PlannerDraftInput) => Promise<PlannerDraft>>(() =>
    Promise.reject(new Error("autosave enqueue is not ready")),
  );
  // P1: reset 強制保存を fire-and-forget で握りつぶさず、flush から await 可能にする
  const pendingForceSaveRef = useRef<PendingForceSave | null>(null);
  /** 既開始 save のペイロード。abandon 時に自タブ CAS 回収の照合元にする（P-R2）。 */
  const inFlightSaveRef = useRef<PlannerDraftInput | null>(null);
  /** abandon した in-flight ペイロード。次の conflict 1 回だけ回収に使う。 */
  const abandonedSaveRef = useRef<PlannerDraftInput | null>(null);
  /** 無効化後に commit した旧 save の行。refresh 前の回収フォールバック。 */
  const orphanedCommittedDraftRef = useRef<PlannerDraft | null>(null);
  const onSavedRef = useRef(onSaved);
  const saveOnUnloadRef = useRef(saveOnUnload);
  const persistOnResetRef = useRef(persistOnReset);
  const holdLiveRevisionRef = useRef(holdLiveRevision);
  const shouldHoldLiveRevisionRef = useRef(shouldHoldLiveRevision);
  const hydratedDraftRef = useRef(hydratedDraft);
  const refreshLiveDraftRef = useRef(refreshLiveDraft);
  /** pagehide と beforeunload が連続しても keepalive は 1 回だけ。 */
  const unloadPersistStartedRef = useRef(false);
  latestRef.current = value;
  latestSerializedRef.current = serialized;
  latestFingerprintRef.current = fingerprint;
  baselineRevisionRef.current = baselineRevision;
  enabledRef.current = enabled;
  onSavedRef.current = onSaved;
  saveOnUnloadRef.current = saveOnUnload;
  persistOnResetRef.current = persistOnReset;
  holdLiveRevisionRef.current = holdLiveRevision;
  shouldHoldLiveRevisionRef.current = shouldHoldLiveRevision;
  hydratedDraftRef.current = hydratedDraft;
  refreshLiveDraftRef.current = refreshLiveDraft;

  const resetBaseline = useCallback((revision: number): void => {
    revisionRef.current = revision;
    setSavedRevision(revision);
    baselineSerializedRef.current = latestFingerprintRef.current;
    pendingDebounceRef.current = false;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    if (conflictRef.current !== null) return;
    resetBaseline(baselineRevision);
    // サーバ確定 revision の更新に合わせ、persistable な現行 value を「永続化済み」と同期する。
    // incomplete UI のまま baseline だけ進んだ場合は触らない（中立 strip 判定を壊さない）。
    if (isPersistableDraft(latestRef.current)) {
      lastPersistedInputRef.current = latestRef.current;
    }
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
      // hydrate 済み draft の audience を strip 判定の基準にする（未保存 incomplete は中立形 or null）
      const initial = latestRef.current;
      if (isPersistableDraft(initial)) {
        lastPersistedInputRef.current = initial;
      } else {
        lastPersistedInputRef.current = audienceNeutralPersistable(initial);
      }
      baselineSerializedRef.current = persistenceFingerprint(
        initial,
        lastPersistedInputRef.current,
      );
      latestFingerprintRef.current = baselineSerializedRef.current;
      // live 行があれば clean flush が id/rev を返せる。null（生成後）は種を置かない。
      if (hydratedDraftRef.current !== null) {
        lastSavedDraftRef.current = hydratedDraftRef.current;
      }
      return;
    }

    // 公開 sticky / live-null 解決: conflict は落とすが empty をサーバへ書かない。
    // persistable empty を dirty のままにすると debounce が 600ms 後に revision を進める。
    if (!persistOnResetRef.current) {
      const local = latestRef.current;
      if (isPersistableDraft(local)) {
        lastPersistedInputRef.current = local;
      } else {
        lastPersistedInputRef.current = audienceNeutralPersistable(local);
      }
      baselineSerializedRef.current = persistenceFingerprint(local, lastPersistedInputRef.current);
      latestFingerprintRef.current = baselineSerializedRef.current;
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

  useEffect(() => {
    // query 到着後の種。古い lastSaved を新しい live revision で上書きする。
    // null は live 消滅（他タブ soft-delete / 生成後）。削除済み id を残さない（P-R2）。
    // 生成後 remount は初回 effect も種を置かない（P1 undelete）。
    if (hydratedDraft === null) {
      lastSavedDraftRef.current = null;
      return;
    }
    const current = lastSavedDraftRef.current;
    if (current === null || hydratedDraft.revision >= current.revision) {
      lastSavedDraftRef.current = hydratedDraft;
    }
  }, [hydratedDraft]);

  const enqueue = useCallback(
    (next: PlannerDraftInput): Promise<PlannerDraft> => {
      // 公開 sticky の pin を進める live 書込を止める。局所 UI / lastPersisted は変えてよい。
      // P-R7: render snapshot だけでなく発火時に storage meta を再読する。
      if (holdLiveRevisionRef.current || shouldHoldLiveRevisionRef.current?.() === true) {
        const lastSaved = lastSavedDraftRef.current;
        if (lastSaved !== null) return Promise.resolve(lastSaved);
        return Promise.reject(new IncompleteDraftSaveError());
      }
      {
        const existingConflict = peekDraftConflict(conflictRef);
        if (existingConflict !== null) {
          if (mountedRef.current) setState("error");
          return Promise.reject(existingConflict);
        }
      }
      // idea 選択直後など整合前の一時状態:
      // - 直前永続化に audience があり中立形へ落とせる → P3 でサーバ旧 mode を消すためキューへ進める
      // - それ以外（初回 incomplete idea 等）→ RPC せず Incomplete（偽の保存失敗 toast / 誤 flush 成功を防ぐ）
      if (
        !isPersistableDraft(next) &&
        !shouldWriteAudienceNeutral(next, lastPersistedInputRef.current)
      ) {
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
        // P4 residual-intentional: 既開始 RPC のペイロードは transport cancel できない。
        // 中間 revision N（例: strip 前 members）は他タブが読み得る短い窓がある。
        // 同一 op の追記で N+1 へ収束し、hydrate sanitize / 生成 current-safety が第二防衛。
        // キャンセル可能 transport の導入は契約拡張のためここでは行わない。
        for (;;) {
          if (resetGeneration !== resetGenerationRef.current) {
            throw new SupersededDraftSaveError();
          }
          {
            const existingConflict = peekDraftConflict(conflictRef);
            if (existingConflict !== null) throw existingConflict;
          }

          const latest = latestRef.current;
          let toSave: PlannerDraftInput;
          if (isPersistableDraft(latest)) {
            toSave = latest;
          } else if (shouldWriteAudienceNeutral(latest, lastPersistedInputRef.current)) {
            // P3/P11: 旧 complete mode がサーバに残る遷移だけ audience 中立形を書く。
            // UI の incomplete 選択（idea+servings=null 等）はローカルに残す。
            const neutralized = audienceNeutralPersistable(latest);
            if (neutralized === null) {
              throw new IncompleteDraftSaveError();
            }
            toSave = neutralized;
          } else {
            // 初回 incomplete idea など、strip 不要な途中状態は保存しない
            throw new IncompleteDraftSaveError();
          }
          // ネットワーク直前にも generation を再確認（await 開始前の切替を拾う）
          if (resetGeneration !== resetGenerationRef.current) {
            throw new SupersededDraftSaveError();
          }
          // P1: hold は enqueue 入口だけだと、キュー待ち / 追記ループが claim 後も live を進める。
          // 既開始 RPC は cancel 不能（残差）。save 直前の再読で後続書込だけ止める。
          if (holdLiveRevisionRef.current || shouldHoldLiveRevisionRef.current?.() === true) {
            const lastSaved = lastSavedDraftRef.current;
            if (lastSaved !== null) {
              return {
                saved: lastSaved,
                toSave: lastPersistedInputRef.current ?? toSave,
              };
            }
            throw new IncompleteDraftSaveError();
          }

          try {
            // P4 残差: 既に飛んだ RPC のペイロードは開始時 toSave のまま commit される。
            // キャンセル可能な transport は持たないため、成功後の追記ループで latest に収束する。
            inFlightSaveRef.current = toSave;
            let saved: PlannerDraft;
            try {
              saved = await save(toSave, revisionRef.current);
            } finally {
              if (inFlightSaveRef.current === toSave) inFlightSaveRef.current = null;
            }
            if (resetGeneration !== resetGenerationRef.current) {
              // 無効化後でもサーバ revision は進んでいる。後続 CAS が stale expected にならないよう引き継ぐ。
              // lastPersisted / lastSaved / onSaved は触らない（timeout 後の追記 B を跨ぎ前の A で消さない）。
              revisionRef.current = Math.max(revisionRef.current, saved.revision);
              if (mountedRef.current) setSavedRevision(revisionRef.current);
              orphanedCommittedDraftRef.current = saved;
              throw new SupersededDraftSaveError();
            }
            abandonedSaveRef.current = null;
            orphanedCommittedDraftRef.current = null;
            // 同一 op の追記判定用に、成功した書き込みをすぐ lastPersisted へ反映する
            // （household 保存直後に incomplete へ切替 → 中立 strip を許可するため）
            lastPersistedInputRef.current = toSave;
            lastSavedDraftRef.current = saved;
            // ループ継続用にローカル revision を進める。
            // P2 で Incomplete に落ちても次の persistable 保存が conflict しないよう UI revision も同期する。
            revisionRef.current = saved.revision;
            if (mountedRef.current) setSavedRevision(saved.revision);

            // latest と toSave が raw 不一致でも、収束 fingerprint 一致なら P3 中立収束とみなす
            // （dirty 用 fingerprint は lastPersisted 依存のため、ループ内では使わない）
            if (convergenceFingerprint(toSave) !== convergenceFingerprint(latestRef.current)) {
              continue;
            }
            return { saved, toSave };
          } catch (error: unknown) {
            if (resetGeneration !== resetGenerationRef.current) {
              throw new SupersededDraftSaveError();
            }
            // P-R2: abandon 後の新 save が自タブの遅延 leave に CAS 負けしても
            // onConflict せず、同じ内容なら live を採用、追記なら live.revision で再送する。
            if (error instanceof DraftRevisionConflictError && abandonedSaveRef.current !== null) {
              const abandoned = abandonedSaveRef.current;
              abandonedSaveRef.current = null;
              let live: PlannerDraft | null =
                orphanedCommittedDraftRef.current ?? lastSavedDraftRef.current;
              const refresh = refreshLiveDraftRef.current;
              if (refresh !== undefined) {
                live = await refresh();
                if (resetGeneration !== resetGenerationRef.current) {
                  throw new SupersededDraftSaveError();
                }
              }
              if (live === null) {
                lastSavedDraftRef.current = null;
                throw new IncompleteDraftSaveError();
              }
              revisionRef.current = Math.max(revisionRef.current, live.revision);
              if (mountedRef.current) setSavedRevision(revisionRef.current);
              const classified = classifyAbandonedConflict(
                live,
                latestRef.current,
                abandoned,
                lastPersistedInputRef.current,
              );
              if (classified === "adopt") {
                const toAdopt = canonicalPersistableInput(latestRef.current);
                lastPersistedInputRef.current = toAdopt;
                lastSavedDraftRef.current = { ...live, ...toAdopt };
                orphanedCommittedDraftRef.current = null;
                return { saved: lastSavedDraftRef.current, toSave: toAdopt };
              }
              if (classified === "retry") {
                continue;
              }
            }
            throw error;
          }
        }
      });
      queueRef.current = operation.then(
        (result) => {
          if (resetGeneration !== resetGenerationRef.current) return;
          revisionRef.current = result.saved.revision;
          lastPersistedInputRef.current = result.toSave;
          lastSavedDraftRef.current = result.saved;
          // baseline は fingerprint（中立形含む）で保持し、incomplete UI との再送ループを防ぐ
          baselineSerializedRef.current = persistenceFingerprint(
            result.toSave,
            lastPersistedInputRef.current,
          );
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
          // Incomplete は error toast にしないが、saving 固着を避け idle へ戻す
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
      baselineSerializedRef.current = fingerprint;
      wasEnabledRef.current = false;
      pendingDebounceRef.current = false;
      return undefined;
    }
    if (holdLiveRevision || shouldHoldLiveRevisionRef.current?.() === true) {
      // dirty でも RPC しない。enable 初回扱いにすると hold 解除後の追記が消える。
      wasEnabledRef.current = true;
      pendingDebounceRef.current = false;
      return undefined;
    }
    if (!wasEnabledRef.current) {
      wasEnabledRef.current = true;
      baselineSerializedRef.current = fingerprint;
      pendingDebounceRef.current = false;
      return undefined;
    }
    if (fingerprint === baselineSerializedRef.current) {
      pendingDebounceRef.current = false;
      return undefined;
    }
    pendingDebounceRef.current = true;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      pendingDebounceRef.current = false;
      // P-R7: 予約時は hold 無しでも、発火時に公開 sticky があれば破棄する。
      if (holdLiveRevisionRef.current || shouldHoldLiveRevisionRef.current?.() === true) {
        return;
      }
      void enqueue(latestRef.current).catch(() => undefined);
    }, 600);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [enabled, enqueue, fingerprint, holdLiveRevision]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // debounce 待ちだけでなく、error 後などで dirty のまま残った編集も離脱時に再試行する
      const dirty = latestFingerprintRef.current !== baselineSerializedRef.current;
      if (!pendingDebounceRef.current && !dirty) return;
      // P-R7: unmount 時点で storage の公開 meta を再読する。
      if (holdLiveRevisionRef.current || shouldHoldLiveRevisionRef.current?.() === true) {
        return;
      }
      pendingDebounceRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      // 画面離脱直前の編集も通常保存と同じ直列キューへ積み、完了後は UI state を更新しない。
      // unmount 後は toast を出せないため失敗は握りつぶす。settings 等の明示遷移は
      // route が await flush + submissionError で可視化する。
      void enqueueRef.current(latestRef.current).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const persistOnDocumentUnload = (): void => {
      if (unloadPersistStartedRef.current) return;
      if (!enabledRef.current) return;
      // P-R7: pagehide は render を待たない。発火時に公開 meta を再読する。
      if (holdLiveRevisionRef.current || shouldHoldLiveRevisionRef.current?.() === true) {
        return;
      }
      const persist = saveOnUnloadRef.current;
      if (persist === undefined) return;
      if (peekDraftConflict(conflictRef) !== null) return;
      const dirty = latestFingerprintRef.current !== baselineSerializedRef.current;
      if (!pendingDebounceRef.current && !dirty) return;
      const latest = latestRef.current;
      // persistable dirty、または debounce/flush と同じ audience 中立 strip。
      // 初回の途中 idea（audience 無しの persistable から servings=null）は RPC 不能なので送らない。
      let toPersist: PlannerDraftInput | null = null;
      if (isPersistableDraft(latest)) {
        toPersist = latest;
      } else if (shouldWriteAudienceNeutral(latest, lastPersistedInputRef.current)) {
        toPersist = audienceNeutralPersistable(latest);
      }
      if (toPersist === null) return;
      unloadPersistStartedRef.current = true;
      persist(toPersist, revisionRef.current);
    };
    const resetUnloadGuard = (): void => {
      // bfcache 復帰後に再編集→再離脱できるよう、1 回フラグだけ戻す。
      unloadPersistStartedRef.current = false;
    };
    window.addEventListener("pagehide", persistOnDocumentUnload);
    window.addEventListener("beforeunload", persistOnDocumentUnload);
    window.addEventListener("pageshow", resetUnloadGuard);
    return () => {
      window.removeEventListener("pagehide", persistOnDocumentUnload);
      window.removeEventListener("beforeunload", persistOnDocumentUnload);
      window.removeEventListener("pageshow", resetUnloadGuard);
    };
  }, []);

  const flush = useCallback(
    (options?: { abandonQueued?: boolean }): Promise<PlannerDraft> => {
      // P-R1: route が IIFE を捨てても dirty leave の enqueue は queueRef に残る。
      // 新 flush が then 連結すると never-settle save に再合流し isSubmitting が固着する。
      // 既開始 RPC は cancel しない。キュー先頭だけ切って新 save を始める。
      // P-R2: 旧 handler を generation で無効化し、遅延 CAS 負けの onConflict abort を止める。
      // P-R3: reset が hung queue に載せた pendingForceSave も切る（abandon 後 generate が再合流しない）。
      if (options?.abandonQueued === true) {
        if (inFlightSaveRef.current !== null) {
          abandonedSaveRef.current = inFlightSaveRef.current;
        }
        queueRef.current = Promise.resolve();
        resetGenerationRef.current += 1;
        pendingForceSaveRef.current = null;
      }
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingDebounceRef.current = false;
      // 公開 pin 中は persistable でも RPC しない。lastSaved があれば C2 再開用に返す。
      // P-R7: flush 呼出時にも storage を再読し、未再描画の pin を進める。
      if (holdLiveRevisionRef.current || shouldHoldLiveRevisionRef.current?.() === true) {
        const lastSaved = lastSavedDraftRef.current;
        if (lastSaved !== null) return Promise.resolve(lastSaved);
        return Promise.reject(new IncompleteDraftSaveError());
      }
      // P1: reset 強制保存が走っている間はそれを await し、完了/失敗を呼び出し元へ返す。
      // 成功後にまだ dirty（reset 直後の追記編集など）なら通常 enqueue で追従する。
      const pending = pendingForceSaveRef.current;
      if (pending !== null) {
        return pending.promise.then(
          (saved) => {
            if (latestFingerprintRef.current !== baselineSerializedRef.current) {
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

      const latestAtFlushStart = latestRef.current;
      if (!isPersistableDraft(latestAtFlushStart)) {
        // 旧 mode strip が必要なときだけ中立形を書く
        if (shouldWriteAudienceNeutral(latestAtFlushStart, lastPersistedInputRef.current)) {
          return enqueue(latestAtFlushStart);
        }
        // P3 中立保存後: 直前永続化が既に audience 無しで latest の収束先と同じなら RPC なしで返す。
        // dirty fingerprint の re-render 待ちに依存せず Incomplete で旧 mode 成功扱いにしない。
        const lastSaved = lastSavedDraftRef.current;
        const lastPersisted = lastPersistedInputRef.current;
        if (
          lastSaved !== null &&
          lastPersisted !== null &&
          !hasPersistedAudience(lastPersisted) &&
          convergenceFingerprint(latestAtFlushStart) === JSON.stringify(lastPersisted)
        ) {
          return Promise.resolve(lastSaved);
        }
        // 途中 idea（servings=null 等）は明示的に拒否
        return Promise.reject(new IncompleteDraftSaveError());
      }
      // persistable でも fingerprint === baseline なら debounce と同型で RPC しない。
      // 生成成功後の empty / rev=0 hydrate からの leave-flush が
      // save(empty, 0) → save_generation_draft の undelete に落ち、
      // 消費済み下書きが空行として live に戻るのを防ぐ。
      // 公開 pin と reset 強制保存は上で処理済み。
      // lastSaved 短絡は live が新鮮なときだけ（P-R2）。
      // stale live を信じると削除済み id+rev で POST が draft_not_found。
      if (latestFingerprintRef.current === baselineSerializedRef.current) {
        return (async (): Promise<PlannerDraft> => {
          // abandon / reset 前に始めた GET。timeout 後 generate が generation を進めても
          // この IIFE は生き残る。await 後に latest を再 enqueue すると N+2 になり
          // claim pin（N+1）とずれ、route 旧 IIFE の onConflict で生成が消える。
          const refreshGeneration = resetGenerationRef.current;
          const refresh = refreshLiveDraftRef.current;
          let live = hydratedDraftRef.current;
          if (refresh !== undefined) {
            live = await refresh();
            if (refreshGeneration !== resetGenerationRef.current) {
              throw new SupersededDraftSaveError();
            }
            if (live === null) {
              lastSavedDraftRef.current = null;
              throw new IncompleteDraftSaveError();
            }
            const currentSaved = lastSavedDraftRef.current;
            if (currentSaved === null || live.revision >= currentSaved.revision) {
              lastSavedDraftRef.current = live;
            }
          }
          // P1: GET 待ち中に公開された pin で live を進めない。
          if (holdLiveRevisionRef.current || shouldHoldLiveRevisionRef.current?.() === true) {
            const held = lastSavedDraftRef.current;
            if (held !== null) return held;
            throw new IncompleteDraftSaveError();
          }
          if (refreshGeneration !== resetGenerationRef.current) {
            throw new SupersededDraftSaveError();
          }
          // P2: 同一 leave 中（abandon 前）は refresh 後に latest を再読して書く。
          // timeout 後 generate の abandon 済み IIFE は上で切る（再 enqueue しない）。
          const latest = latestRef.current;
          if (!isPersistableDraft(latest)) {
            if (shouldWriteAudienceNeutral(latest, lastPersistedInputRef.current)) {
              return enqueue(latest);
            }
            throw new IncompleteDraftSaveError();
          }
          const lastSaved = lastSavedDraftRef.current;
          const serverRow = live ?? lastSaved;
          // サーバ行と latest の persist 対象（memberIds 含む）が違うなら書く（P-R3）。
          // empty は undelete になるので書かない（P1）。
          if (
            serverRow !== null &&
            isPersistableDraft(latest) &&
            !lastSavedMatchesLatest(serverRow, latest, lastPersistedInputRef.current) &&
            !isEmptyPersistableInput(latest)
          ) {
            return enqueue(latest);
          }
          // live 消滅は effect / refresh が lastSaved を消す（P-R2）。
          // save 由来の種は query 無しでも返す（P1）。
          if (
            lastSaved !== null &&
            (live === null || lastSaved.id === live.id) &&
            lastSavedMatchesLatest(lastSaved, latest, lastPersistedInputRef.current)
          ) {
            // sanitize / trim 済み latest を id/rev に載せる。raw の ineligible を返さない（P-R1）。
            return {
              ...lastSaved,
              ...canonicalPersistableInput(latest),
            };
          }
          throw new IncompleteDraftSaveError();
        })();
      }
      return enqueue(latestAtFlushStart);
    },
    [enqueue],
  );

  return { state, revision: savedRevision, flush };
}
