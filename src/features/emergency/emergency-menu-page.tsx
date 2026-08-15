import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { EmergencyMenusData } from "@shared/emergency/contracts";
import type { PantryItem } from "@shared/contracts/pantry";
import { useAuth } from "@/features/auth/use-auth";
import {
  listHouseholdMembers,
  listMemberAllergies,
  type HouseholdMemberRow,
  type MemberAllergyRow,
} from "@/features/household/household-api";
import { listPantryItems } from "@/features/pantry/pantry-api";
import {
  hasExpiredPantryConfirmation,
  isPastEnteredExpiry,
  persistSessionExpiredPantryConfirmation,
} from "@/features/planner/expired-pantry-checks";
import { getPlannerDraft, plannerKeys } from "@/features/planner/planner-api";
import {
  householdKeys,
  householdSafetyChangedEvent,
  householdSafetyRevisionKey,
  householdSafetyRevisionStorageKey,
  isHouseholdSafetyRevisionStorageKeyForUser,
  subscribeHouseholdSafetyBroadcast,
} from "@/features/household/household-queries";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { emergencyMenuKeys, getEmergencyMenus } from "./emergency-menu-api";

const roleLabels = {
  main: "主菜",
  side: "副菜",
  soup: "汁物",
  staple: "主食",
  other: "料理",
} as const;

const emergencyTargetMemberLimit = 20;

/** 設計 §5 path 条件付き intro（exact plain JP） */
const householdIntroText =
  "現在の家族・アレルギー・年齢・必須条件で固定候補を絞り込みます。AI利用回数は消費しません。";
const ideaIntroText =
  "個人向けの固定候補です。家族のアレルギー・年齢条件は適用していません。AI利用回数は消費しません。調理前に原材料表示と家庭内の混入を確認してください。";
/** PE7: idea 候補表示時の追加開示（intro 設計文は変更せず、誤用を抑える） */
const ideaHouseholdNotAppliedNote =
  "この一覧はご家庭のアレルギー登録を見ていません。家族の制限がある場合は献立画面で「家族向け」に切り替えてください。";

/** 設計 §5 path 条件付き safety_only バナー（exact plain JP） */
const householdSafetyOnlyBannerText =
  "メイン食材は一致しませんでした。安全条件に合う候補を表示しています。";
const ideaSafetyOnlyBannerText =
  "メイン食材は一致しませんでした。アレルギー条件は適用していません。";

/**
 * PE4: draft で選んだが緊急適格外のメンバーを silent drop しないための開示。
 * 候補は対象にできた家族の条件だけを見ることを明示する。
 */
function buildIneligibleSelectedNotice(droppedDisplayNames: readonly string[]): string {
  if (droppedDisplayNames.length > 0) {
    return `選んだ家族のうち ${droppedDisplayNames.join("、")} さんは、アレルギー確認や設定の都合でこの一覧の対象から外しています。候補は対象にできた家族の条件だけを見ています。`;
  }
  return "選んだ家族のうち一部の方は、アレルギー確認や設定の都合でこの一覧の対象から外しています。候補は対象にできた家族の条件だけを見ています。";
}

/** 緊急 fixture は標準 allergen ID のみ照合。確認済み自由登録があるメンバーはサーバ Stage S 前と同様に除外。 */
type EmergencyHouseholdMember = HouseholdMemberRow & {
  hasConfirmedCustomAllergy: boolean;
};

function memberHasConfirmedCustomAllergy(allergies: readonly MemberAllergyRow[]): boolean {
  return allergies.some((row) => row.allergen_id === null && row.custom_confirmed);
}

function isEmergencyEligibleMember(member: EmergencyHouseholdMember): boolean {
  return (
    member.status === "complete" &&
    (member.allergy_status === "none" || member.allergy_status === "registered") &&
    member.unsupported_diet_status === "none" &&
    !member.hasConfirmedCustomAllergy
  );
}

function quantityText(value: number | null, unit: string | null, fallback: string): string {
  return value === null ? fallback : `${String(value)}${unit ?? ""}`;
}

export function EmergencyMenuPage() {
  const userId = useAuth().session?.user.id;
  const draftQueryEnabled = userId !== undefined;
  const householdSafetyEventVersion = useRef(0);
  const expiredDialogDescriptionId = useId();
  const expiredConfirmRef = useRef<HTMLButtonElement>(null);
  const expiredSafeRef = useRef<HTMLButtonElement>(null);
  // PE8: 辞退した期限切れ pantry は候補スコア用 ID から外す（下書きは書き換えない）
  const [declinedExpiredPantryIds, setDeclinedExpiredPantryIds] = useState<readonly string[]>([]);
  // PE8: 確認直後の再レンダー用（session 書込後に hasExpired を再評価）
  const [expiredConfirmTick, setExpiredConfirmTick] = useState(0);
  const [pantryRows, setPantryRows] = useState<readonly PantryItem[] | null>(null);
  const [pantryLoadState, setPantryLoadState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  // PE2: pantry 実物の再読込世代。ID CSV が同じでも期限更新で effect を再走させる。
  const [pantryRefreshTick, setPantryRefreshTick] = useState(0);
  const [householdSafetyRevision, setHouseholdSafetyRevision] = useState(() => {
    if (userId === undefined) return "initial";
    try {
      // U4-003: user-scoped を優先、レガシー固定キーは移行読取
      return (
        localStorage.getItem(householdSafetyRevisionKey(userId)) ??
        localStorage.getItem(householdSafetyRevisionStorageKey) ??
        "initial"
      );
    } catch {
      return "initial";
    }
  });

  const queryClient = useQueryClient();
  const draftQuery = useQuery({
    queryKey: plannerKeys.draft(userId ?? "missing"),
    enabled: draftQueryEnabled,
    queryFn: () => getPlannerDraft(getBrowserSupabaseClient(), userId ?? ""),
    // PE9: 既定 30s stale だと他タブの対象メンバー変更が残る。focus / Realtime で取り直す。
    staleTime: 0,
  });

  // 設計 §5 enablement: draft 由来で household / idea を分岐する。
  // draftResolved = キャッシュ済み下書きがある。背景 refetch（isFetching）では落とさない。
  // 初回未解決のみ chrome を抑止し、window-focus 再取得で候補を消さない。
  const draft = draftQuery.data;
  const draftResolved = draftQuery.isSuccess && draft !== null && draft !== undefined;
  const draftReady = draftResolved;
  const isIdea = draft?.targetMode === "idea";
  const isHouseholdPath = draft !== null && draft !== undefined && draft.targetMode !== "idea";
  // draftReady 前は path を決めず intro を抑止する（未解決時に世帯 intro を出さない）。
  // 解決後は loading 中も draft から chrome を決める。response.path だけに頼らない。
  const expectedPath: "household" | "idea" | null = !draftReady
    ? null
    : isIdea
      ? "idea"
      : "household";

  // 初回 draft 未解決の isFetching では household を起動しない。キャッシュがある背景 refetch は許可。
  const householdQueryEnabled = userId !== undefined && draftResolved && isHouseholdPath;
  // Realtime / 60s poll も household 経路のみ（idea では購読しない）
  const safetyRealtimeEnabled = householdQueryEnabled;

  // 別端末・他タブでの家族/アレルギー変更を、history revalidation と同様に
  // owner-scoped Realtime + focus/visible/online + 60s poll で拾う。
  // revision を query key に載せ、signal 直後は旧候補を閉じて再取得完了まで fail closed。
  // PE6: CHANNEL_ERROR / TIMED_OUT も revision 更新（history / shopping 同型）。
  // idea 下書きでは household 安全信号を購読しない（safetyRealtimeEnabled で gate）。
  useEffect(() => {
    if (userId === undefined || !safetyRealtimeEnabled) return;
    const revisionKey = householdSafetyRevisionKey(userId);
    const refreshRevision = () => {
      householdSafetyEventVersion.current += 1;
      setHouseholdSafetyRevision((current) => {
        try {
          // U4-003: user-scoped key を優先し、レガシー固定キーは移行読取のみ
          const storedRevision =
            localStorage.getItem(revisionKey) ??
            localStorage.getItem(householdSafetyRevisionStorageKey);
          return `${storedRevision ?? current}:event:${String(householdSafetyEventVersion.current)}`;
        } catch {
          return `${current}:event:${String(householdSafetyEventVersion.current)}`;
        }
      });
      // PE9: 家族 Realtime だけでは draft ∩ eligible の draft 側が古いまま。下書きを取り直す。
      void queryClient.invalidateQueries({ queryKey: plannerKeys.draft(userId) });
    };
    const handleStorage = (event: StorageEvent) => {
      // H12: 自 user key + レガシー固定のみ（他 user の prefix 一致は無視）
      if (isHouseholdSafetyRevisionStorageKeyForUser(event.key, userId)) {
        refreshRevision();
      }
    };
    const handleVisible = () => {
      if (document.visibilityState === "visible") refreshRevision();
    };
    const client = getBrowserSupabaseClient();
    // Realtime は user_id で絞り、他ownerの変更は購読側で捨てる。
    const ownerFilter = `user_id=eq.${userId}`;
    const channel = client
      .channel(`emergency-safety:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "household_members", filter: ownerFilter },
        refreshRevision,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "member_allergies", filter: ownerFilter },
        refreshRevision,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "generation_drafts", filter: ownerFilter },
        refreshRevision,
      )
      .subscribe((status) => {
        // PE6: history revalidation / shopping と同型。CHANNEL_ERROR / TIMED_OUT は
        // 購読死のまま最大 60s 旧候補を残さない（hard fail-closed → revision 再取得）。
        const state: string = status;
        if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
          refreshRevision();
        }
      });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) refreshRevision();
    }, 60_000);
    window.addEventListener(householdSafetyChangedEvent, refreshRevision);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleVisible);
    window.addEventListener("online", refreshRevision);
    window.addEventListener("offline", refreshRevision);
    document.addEventListener("visibilitychange", handleVisible);
    // H-R3: setItem 失敗時の cross-tab hard を BroadcastChannel で補う
    const unsubscribeBroadcast = subscribeHouseholdSafetyBroadcast(userId, refreshRevision);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(householdSafetyChangedEvent, refreshRevision);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleVisible);
      window.removeEventListener("online", refreshRevision);
      window.removeEventListener("offline", refreshRevision);
      document.removeEventListener("visibilitychange", handleVisible);
      unsubscribeBroadcast();
      void client.removeChannel(channel);
    };
  }, [userId, safetyRealtimeEnabled, queryClient]);

  const shouldResolveUnselectedTargets =
    draftQuery.data?.targetMode === null && draftQuery.data.targetMemberIds.length === 0;
  const householdQuery = useQuery({
    // 家族設定のauthority key配下に安全revisionを加え、家族更新のinvalidationと
    // 同画面・別画面の安全更新eventのどちらでもfresh cacheを再利用しない。
    queryKey: [...householdKeys.members(userId ?? "missing"), "emergency", householdSafetyRevision],
    enabled: householdQueryEnabled,
    queryFn: async (): Promise<EmergencyHouseholdMember[]> => {
      const client = getBrowserSupabaseClient();
      const uid = userId ?? "";
      const members = await listHouseholdMembers(client, uid);
      // サーバ hasUnmappedCustomAllergy と同趣旨: 確認済み自由登録があれば緊急対象外
      return Promise.all(
        members.map(async (member) => {
          if (member.status !== "complete") {
            return { ...member, hasConfirmedCustomAllergy: false };
          }
          const allergies = await listMemberAllergies(client, uid, member.id);
          return {
            ...member,
            hasConfirmedCustomAllergy: memberHasConfirmedCustomAllergy(allergies),
          };
        }),
      );
    },
  });
  // mode未選択の下書きだけは、後から完了した家族を初期対象にできる。
  // ideaまたは明示済みhouseholdから別家族へ黙って切り替えない。
  const eligibleMemberIds = (householdQuery.data ?? [])
    .filter(isEmergencyEligibleMember)
    .map((member) => member.id);
  // idea は対象メンバーなし。household のみ eligible と draft 選択の積集合。
  const targetMemberIds = isIdea
    ? []
    : shouldResolveUnselectedTargets
      ? eligibleMemberIds.slice(0, emergencyTargetMemberLimit)
      : draft?.targetMode === "household"
        ? draft.targetMemberIds
            .filter((memberId) => eligibleMemberIds.includes(memberId))
            .slice(0, emergencyTargetMemberLimit)
        : [];
  const hasEligibleHouseholdMembers = targetMemberIds.length > 0;
  // PE4: 明示 household 選択のうち適格外を落としたとき、部分集合候補であることを開示する。
  // 未選択下書きの自動 eligible 補充は「落とした選択」ではないので対象外。
  let ineligibleSelectedNotice: string | null = null;
  if (
    !isIdea &&
    draft?.targetMode === "household" &&
    hasEligibleHouseholdMembers &&
    householdQuery.isSuccess
  ) {
    // isSuccess 後は data が定義済み（?? [] は型上不要）
    const roster = householdQuery.data;
    const selectedIds = new Set(draft.targetMemberIds);
    const droppedOnRoster = roster.filter(
      (member) => selectedIds.has(member.id) && !isEmergencyEligibleMember(member),
    );
    const missingFromRoster = draft.targetMemberIds.filter(
      (id) => !roster.some((member) => member.id === id),
    ).length;
    if (droppedOnRoster.length + missingFromRoster > 0) {
      ineligibleSelectedNotice = buildIneligibleSelectedNotice(
        droppedOnRoster
          .map((member) => member.display_name?.trim() ?? "")
          .filter((name) => name.length > 0),
      );
    }
  }

  // EMRG-1: mealType 未選択の下書きに夕食を捏造しない（null は pre-API empty）
  const mealType = draft?.mealType ?? null;
  const mainIngredients = draft?.mainIngredients ?? [];
  const draftPantryItemIds = draft?.pantrySelections.map((item) => item.pantryItemId) ?? [];
  const declinedExpiredSet = useMemo(
    () => new Set(declinedExpiredPantryIds),
    [declinedExpiredPantryIds],
  );

  // PE8: 下書きに pantry 選択があるときだけ実物期限を読み、未確認の期限切れを候補起動前に止める。
  // useQuery を増やさず effect 読込にし、既存 draft/household/candidate の 3 本 mock 契約を壊さない。
  const pantryGateNeeded = draftReady && draftPantryItemIds.length > 0;
  const draftPantryKey = draftPantryItemIds.join(",");
  // PE2: ID CSV が同じでも他タブの期限更新・削除を拾う。focus / Realtime / 60s で再読込する。
  useEffect(() => {
    if (userId === undefined || !pantryGateNeeded) return;
    const refreshPantry = () => {
      setPantryRefreshTick((tick) => tick + 1);
    };
    const handleVisible = () => {
      if (document.visibilityState === "visible") refreshPantry();
    };
    const client = getBrowserSupabaseClient();
    const ownerFilter = `user_id=eq.${userId}`;
    const channel = client
      .channel(`emergency-pantry:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pantry_items", filter: ownerFilter },
        refreshPantry,
      )
      .subscribe();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) refreshPantry();
    }, 60_000);
    window.addEventListener("focus", handleVisible);
    window.addEventListener("online", refreshPantry);
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", handleVisible);
      window.removeEventListener("online", refreshPantry);
      document.removeEventListener("visibilitychange", handleVisible);
      void client.removeChannel(channel);
    };
  }, [userId, pantryGateNeeded]);
  useEffect(() => {
    if (userId === undefined || !pantryGateNeeded) {
      setPantryRows(null);
      setPantryLoadState("idle");
      return;
    }
    let cancelled = false;
    // 再読込中に候補を落とさないよう、初回だけ loading。ready のまま差し替える。
    setPantryLoadState((current) => (current === "ready" ? current : "loading"));
    void listPantryItems(getBrowserSupabaseClient(), userId)
      .then((rows) => {
        if (cancelled) return;
        setPantryRows(rows);
        setPantryLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setPantryRows(null);
        setPantryLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [userId, pantryGateNeeded, draftPantryKey, pantryRefreshTick]);

  // expiredConfirmTick を読んで確認直後に session を再評価する（eslint 未使用回避）
  const sessionConfirmGeneration = expiredConfirmTick;
  const nowForExpiry = new Date();
  // PE1: 確認済み期限切れもスコア対象から外す（サーバは期限切れ名を落とす。確認/辞退を揃える）
  const pantryItemIds = draftPantryItemIds.filter((id) => {
    if (declinedExpiredSet.has(id)) return false;
    if (pantryLoadState !== "ready" || pantryRows === null) return true;
    const item = pantryRows.find((row) => row.id === id);
    if (item === undefined) return true;
    void sessionConfirmGeneration;
    return !(
      isPastEnteredExpiry(item, nowForExpiry) &&
      hasExpiredPantryConfirmation(null, userId, item.id, nowForExpiry)
    );
  });
  const unconfirmedExpiredItems: PantryItem[] =
    pantryLoadState === "ready" && pantryRows !== null
      ? draftPantryItemIds
          .filter((id) => !declinedExpiredSet.has(id))
          .map((id) => pantryRows.find((row) => row.id === id))
          .filter((item): item is PantryItem => item !== undefined)
          .filter((item) => {
            // sessionConfirmGeneration 変化で再計算（hasExpired は session を都度読む）
            void sessionConfirmGeneration;
            return (
              isPastEnteredExpiry(item, nowForExpiry) &&
              !hasExpiredPantryConfirmation(null, userId, item.id, nowForExpiry)
            );
          })
      : [];
  const pendingExpiredItem = unconfirmedExpiredItems[0] ?? null;
  const expiredPantryGateBlocks =
    pantryGateNeeded &&
    (pantryLoadState === "loading" ||
      pantryLoadState === "error" ||
      unconfirmedExpiredItems.length > 0);

  // 設計 §5: idea は targetMemberIds 空・targetMode idea。eligible 0 でも候補 query を起動する。
  const request =
    mealType === null
      ? null
      : isIdea
        ? {
            mealType,
            mainIngredients,
            targetMode: "idea" as const,
            targetMemberIds: [] as const,
            pantryItemIds,
          }
        : {
            mealType,
            mainIngredients,
            targetMode: "household" as const,
            targetMemberIds,
            pantryItemIds,
          };

  const candidateQueryEnabled =
    userId !== undefined &&
    draftReady &&
    request !== null &&
    !expiredPantryGateBlocks &&
    (isIdea || (householdQueryEnabled && householdQuery.isSuccess && targetMemberIds.length > 0));

  const query = useQuery({
    queryKey: emergencyMenuKeys.candidates({
      userId: userId ?? "missing",
      // request null（mealType 未設定）時は query を起動しない。key は安定 placeholder。
      mealType: request?.mealType ?? "dinner",
      mainIngredients: request?.mainIngredients ?? [],
      targetMode: request?.targetMode ?? "household",
      targetMemberIds: request?.targetMemberIds ?? [],
      pantryItemIds: request?.pantryItemIds ?? [],
      householdSafetyRevision,
    }),
    enabled: candidateQueryEnabled,
    queryFn: () => {
      if (request === null) {
        throw new Error("emergency request missing mealType");
      }
      return getEmergencyMenus(request);
    },
  });

  // loading / error は candidateQueryEnabled の後に定義する（設計 §5 順序）。
  // PE9: draft と同様、household/candidate も「データ無しの初回」だけ loading。
  // キャッシュ済みの背景 refetch（window focus / 60s）では intro・候補・開示を消さない。
  // safety revision 変更で key が変わったときは data が無いので isPending で hard close を維持。
  const draftInitialLoading =
    draftQueryEnabled && (draftQuery.isPending || (draftQuery.isFetching && !draftResolved));
  const householdInitialLoading =
    householdQueryEnabled &&
    (householdQuery.isPending || (householdQuery.isFetching && householdQuery.data === undefined));
  const pantryInitialLoading = pantryGateNeeded && pantryLoadState === "loading";
  const candidateInitialLoading =
    candidateQueryEnabled && (query.isPending || (query.isFetching && query.data === undefined));
  const loading =
    draftInitialLoading ||
    householdInitialLoading ||
    pantryInitialLoading ||
    candidateInitialLoading;
  const error =
    draftQuery.isError ||
    (householdQueryEnabled && householdQuery.isError) ||
    pantryLoadState === "error" ||
    query.isError
      ? pantryLoadState === "error"
        ? "冷蔵庫の食材を確認できませんでした。通信を確認してから再度お試しください。"
        : "緊急献立を読み込めませんでした"
      : null;

  useEffect(() => {
    if (pendingExpiredItem === null) return;
    expiredSafeRef.current?.focus();
  }, [pendingExpiredItem]);

  if (draftQuery.isSuccess && draftQuery.data === null) {
    return (
      <main className="page-frame stack emergency-menu-page">
        <Link className="emergency-back-link" to="/planner" aria-label="献立画面へ戻る">
          ← 献立画面へ戻る
        </Link>
        <h1>15分緊急献立</h1>
        <p role="alert">献立条件の下書きがありません。献立画面で条件を保存してください。</p>
      </main>
    );
  }

  // EMRG-1: 食事帯が未選択なら候補 API を叩かず planner へ戻す
  if (draftReady && mealType === null && !loading && error === null) {
    return (
      <main className="page-frame stack emergency-menu-page">
        <Link className="emergency-back-link" to="/planner" aria-label="献立画面へ戻る">
          ← 献立画面へ戻る
        </Link>
        <h1>15分緊急献立</h1>
        <p role="alert">
          食事の時間帯がまだ決まっていません。献立画面で朝・昼・夕を選んでから開き直してください。
        </p>
        <Link className="primary-button min-h-11" to="/planner">
          献立画面へ戻る
        </Link>
      </main>
    );
  }

  // PE8: 直接 /emergency-menus で未確認の期限切れ pantry があるうちは候補を取らない。
  // planner CTA は attempt+session に確認を載せる。ここは session 未確認の残窓を閉じる。
  if (draftReady && !loading && error === null && pendingExpiredItem !== null) {
    const item = pendingExpiredItem;
    return (
      <main className="page-frame stack emergency-menu-page">
        <Link className="emergency-back-link" to="/planner" aria-label="献立画面へ戻る">
          ← 献立画面へ戻る
        </Link>
        <h1>15分緊急献立</h1>
        <p role="alert" data-testid="emergency-expired-pantry-gate">
          期限切れの食材が選ばれています。冷蔵庫の食材で確認してから緊急献立を開いてください。
        </p>
        <div className="pantry-expired-dialog-backdrop">
          <div
            role="alertdialog"
            aria-label="期限を過ぎた食材の確認"
            aria-modal="true"
            aria-describedby={expiredDialogDescriptionId}
            className="card stack pantry-expired-dialog-panel"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setDeclinedExpiredPantryIds((prev) =>
                  prev.includes(item.id) ? prev : [...prev, item.id],
                );
                return;
              }
              if (event.key !== "Tab") return;
              event.preventDefault();
              if (event.shiftKey) {
                if (document.activeElement === expiredSafeRef.current) {
                  expiredConfirmRef.current?.focus();
                } else {
                  expiredSafeRef.current?.focus();
                }
              } else if (document.activeElement === expiredSafeRef.current) {
                expiredConfirmRef.current?.focus();
              } else {
                expiredSafeRef.current?.focus();
              }
            }}
          >
            <p id={expiredDialogDescriptionId}>
              「{item.name}
              」は入力した期限を過ぎています。アプリは食べられるか判断しません。今回、実物の状態を確認しましたか？
            </p>
            <button
              ref={expiredConfirmRef}
              className="primary-button min-h-11"
              type="button"
              onClick={() => {
                const checkedAt = new Date();
                if (userId !== undefined) {
                  persistSessionExpiredPantryConfirmation(userId, item.id, checkedAt);
                }
                setExpiredConfirmTick((tick) => tick + 1);
              }}
            >
              実物を確認して今回だけ使う
            </button>
            <button
              ref={expiredSafeRef}
              className="secondary-button min-h-11"
              type="button"
              onClick={() => {
                setDeclinedExpiredPantryIds((prev) =>
                  prev.includes(item.id) ? prev : [...prev, item.id],
                );
              }}
            >
              使わない
            </button>
          </div>
        </div>
        <Link className="secondary-button min-h-11" to="/planner">
          献立画面へ戻る
        </Link>
      </main>
    );
  }

  // pre-API empty: candidate query が disabled のときだけ。idea は落とさない。
  // draft/household ロード中は出さない（loading 中に empty フラッシュしない）。
  // PE8: 期限切れゲート中は empty に落とさない（確認 UI を優先）。
  const showPreApiEmpty =
    draftReady &&
    !isIdea &&
    !loading &&
    error === null &&
    !candidateQueryEnabled &&
    !expiredPantryGateBlocks &&
    !hasEligibleHouseholdMembers;

  if (showPreApiEmpty) {
    // C-I6: 空理由を正直に分岐する。適格0 / 選択フィルタ / 真の0人を混同しない。
    // idea ブロック文言は設計 §5 により削除（個人候補 API へ進む）。
    const householdMembers = householdQuery.data ?? [];
    const emptyState =
      householdMembers.length === 0
        ? {
            message:
              "対象の家族が登録されていないため、緊急献立を表示できません。家族設定は任意です。",
            href: "/onboarding",
            linkLabel: "家族設定へ（任意）",
          }
        : eligibleMemberIds.length === 0
          ? {
              message:
                "表示できる対象の家族がいません。アレルギー確認（自由登録アレルギーを含む）と家族設定の完了を確認してください。",
              href: "/onboarding",
              linkLabel: "家族設定を確認する",
            }
          : {
              message:
                "選んだ家族が対象にできないため、緊急献立を表示できません。献立画面で対象を見直してください。",
              href: "/planner",
              linkLabel: "献立画面で対象を見直す",
            };
    return (
      <main className="page-frame stack emergency-menu-page">
        <Link className="emergency-back-link" to="/planner" aria-label="献立画面へ戻る">
          ← 献立画面へ戻る
        </Link>
        <h1>15分緊急献立</h1>
        <p role="alert">{emptyState.message}</p>
        <Link to={emptyState.href}>{emptyState.linkLabel}</Link>
      </main>
    );
  }

  return (
    <EmergencyMenuContent
      loading={loading}
      error={error}
      expectedPath={expectedPath}
      response={loading || error !== null ? null : (query.data ?? null)}
      ineligibleSelectedNotice={ineligibleSelectedNotice}
    />
  );
}

/** 設計 §5 post-API empty body（exact plain JP）。message は heading のみに使い body は emptyReason で分岐する。 */
function postApiEmptyBody(response: EmergencyMenusData): string {
  if (response.emptyReason === "current_safety_unavailable" && response.path === "household") {
    return "アレルギー確認未了・自由登録アレルギー、または対応できない食事条件のため、候補を表示していません。条件は緩めていません";
  }
  if (response.emptyReason === "allergen_missing" && response.path === "household") {
    return "アレルギー情報が足りないため、候補を表示していません。条件は緩めていません";
  }
  if (response.emptyReason === "no_matching_fixture" && response.path === "household") {
    return "いまのアレルギー・年齢に合う15分固定候補がありません。条件は緩めていません";
  }
  if (response.emptyReason === "no_matching_fixture" && response.path === "idea") {
    return "固定候補を表示できませんでした";
  }
  // 不変条件上ここに来ないが fail closed。汎用 empty + 非緩和を明示する。
  return "条件に合う緊急献立がありません。条件は緩めていません";
}

export function EmergencyMenuContent({
  loading,
  error,
  expectedPath,
  response,
  ineligibleSelectedNotice = null,
}: {
  loading: boolean;
  error: string | null;
  /**
   * draft 由来。loading 中 intro/empty chrome の正本。
   * null = draft 未解決。path 条件付き intro を出さない（世帯 intro の誤フラッシュ防止）。
   */
  expectedPath: "household" | "idea" | null;
  response: EmergencyMenusData | null;
  /** PE4: 適格外メンバーを対象から外したときの開示。null なら出さない。 */
  ineligibleSelectedNotice?: string | null;
}) {
  // wire path と draft 推定が食い違うときは fail-closed（誤った家族絞り込み chrome を出さない）。
  const pathMismatch =
    !loading &&
    error === null &&
    response !== null &&
    expectedPath !== null &&
    response.path !== expectedPath;
  // 旧 path の candidates は loading 中 / path 不一致で visibleResponse=null にする。
  const visibleResponse = loading || error !== null || pathMismatch ? null : response;
  // 一致時のみ wire path を採用。draft 未解決は null。
  const chromePath: "household" | "idea" | null = visibleResponse?.path ?? expectedPath;
  // 設計 §5: matchMode のみがトリガ。server message（「固定」付き等）をパースして文言を選ばない。
  const showSafetyOnlyBanner =
    visibleResponse !== null &&
    visibleResponse.candidates.length > 0 &&
    visibleResponse.matchMode === "safety_only";
  const safetyOnlyBannerText =
    chromePath === "idea" ? ideaSafetyOnlyBannerText : householdSafetyOnlyBannerText;
  // draft 未解決中は path 固有 intro を抑止（中立 loading のみ）。path 不一致時も抑止。
  const introText =
    pathMismatch || chromePath === null
      ? null
      : chromePath === "idea"
        ? ideaIntroText
        : householdIntroText;
  // idea は「家族向け」見出しを使わず中立にする（個人パスと混同させない）
  const adaptationHeading = chromePath === "idea" ? "取り分け・切り方の目安" : "家族向けの取り分け";
  const displayError = error ?? (pathMismatch ? "緊急献立を読み込めませんでした" : null);

  return (
    <main className="page-frame stack emergency-menu-page">
      <Link className="emergency-back-link" to="/planner" aria-label="献立画面へ戻る">
        ← 献立画面へ戻る
      </Link>
      <div>
        <p className="eyebrow">AIを使わない</p>
        <h1>15分緊急献立</h1>
      </div>
      {/*
        path 条件付き intro。idea は role=status で開示必須。
        household は plain p。banner は role=note（intro の status と二重 status にしない）。
        draft 未解決（introText null）では path 固有 intro を出さない。
      */}
      {introText !== null &&
        (chromePath === "idea" ? <p role="status">{introText}</p> : <p>{introText}</p>)}
      {/* PE4: 選んだ家族の一部を対象外にしたことを silent にしない（role=status で開示） */}
      {ineligibleSelectedNotice !== null && chromePath === "household" && (
        <p role="status" data-testid="emergency-ineligible-selected-notice">
          {ineligibleSelectedNotice}
        </p>
      )}
      {loading && <p>候補を確認中…</p>}
      {displayError !== null && <p role="alert">{displayError}</p>}
      {showSafetyOnlyBanner && <p role="note">{safetyOnlyBannerText}</p>}
      {/* PE7: idea で候補が出ているときも家族非適用を再掲（false household safe と誤認させない） */}
      {chromePath === "idea" &&
        visibleResponse !== null &&
        visibleResponse.candidates.length > 0 && (
          <p role="note" data-testid="idea-allergy-not-applied-note">
            {ideaHouseholdNotAppliedNote}
          </p>
        )}
      {visibleResponse?.candidates.length === 0 && (
        <section className="card">
          <h2>{visibleResponse.message}</h2>
          <p>{postApiEmptyBody(visibleResponse)}</p>
        </section>
      )}
      {visibleResponse?.candidates.map(({ menu, memberLabels, labelWarnings }, candidateIndex) => {
        const candidateDomId = `emergency-candidate-${String(candidateIndex + 1)}`;
        return (
          <article className="card stack emergency-candidate" key={menu.menuId}>
            <header className="emergency-candidate-header">
              <p className="emergency-candidate-number">候補 {candidateIndex + 1}</p>
              <h2>{menu.dishes.map((dish) => dish.name).join("・")}</h2>
            </header>
            <div
              className="emergency-candidate-overview"
              role="group"
              aria-label={`候補${String(candidateIndex + 1)}の概要`}
            >
              <p>
                <strong>{menu.totalElapsedMinutes}分</strong>
                <span>食卓までの目安</span>
              </p>
              <p>
                <strong>{menu.servings}人分</strong>
                <span>分量の目安</span>
              </p>
            </div>
            <details open>
              <summary>材料と作り方を表示</summary>
              <section
                className="emergency-recipe-section"
                aria-labelledby={`${candidateDomId}-timeline`}
              >
                <h3 id={`${candidateDomId}-timeline`}>全体の段取り</h3>
                <ol>
                  {menu.timeline.map((step) => (
                    <li key={step.id}>
                      {step.startMinute}分〜（目安{step.durationMinutes}分） {step.instruction}
                    </li>
                  ))}
                </ol>
              </section>
              {menu.dishes.map((dish, dishIndex) => {
                const adaptations = menu.adaptations.filter((item) => item.dishId === dish.id);
                const dishDomId = `${candidateDomId}-dish-${String(dishIndex + 1)}`;
                return (
                  <section key={dish.id} aria-labelledby={dishDomId}>
                    <h3 id={dishDomId}>
                      {roleLabels[dish.role]}・{dish.name}
                    </h3>
                    <p>
                      {dish.description}（目安{dish.cookingTimeMinutes}分）
                    </p>
                    <h4>材料</h4>
                    <ul>
                      {dish.ingredients.map((ingredient) => (
                        <li className="emergency-ingredient" key={ingredient.id}>
                          <span>{ingredient.name}</span>
                          <span>{ingredient.quantityText}</span>
                        </li>
                      ))}
                    </ul>
                    <h4>作り方</h4>
                    <ol>
                      {dish.steps.map((step) => (
                        <li key={step.id}>
                          <strong>手順{step.position}</strong> {step.instruction}
                        </li>
                      ))}
                    </ol>
                    {adaptations.length > 0 && (
                      <section>
                        <h4>{adaptationHeading}</h4>
                        {adaptations.map((adaptation) => (
                          <dl key={adaptation.id}>
                            <dt>
                              <strong>
                                {memberLabels[adaptation.anonymousMemberRef] ?? "家族"}
                              </strong>
                              ・{adaptation.portionText}
                            </dt>
                            <dd>
                              分ける前: 手順
                              {dish.steps.find(
                                (step) => step.id === adaptation.branchBeforeRecipeStepId,
                              )?.position ?? "を確認"}
                            </dd>
                            {adaptation.additionalCutting !== null && (
                              <dd>切り方: {adaptation.additionalCutting}</dd>
                            )}
                            {adaptation.additionalHeating !== null && (
                              <dd>加熱: {adaptation.additionalHeating}</dd>
                            )}
                            {adaptation.additionalSeasoning !== null && (
                              <dd>味付け: {adaptation.additionalSeasoning}</dd>
                            )}
                            <dd>配膳時: {adaptation.servingCheck}</dd>
                            {adaptation.safetyActions.length > 0 && (
                              <dd>
                                {/* 結果画面と同型。保証語「安全のための手順」を避け取り分け時の注意とする */}
                                <strong>取り分け時の注意</strong>
                                <ul>
                                  {adaptation.safetyActions.map((action, index) => (
                                    <li key={`${action.beforeRecipeStepId}-${String(index)}`}>
                                      {action.instruction}
                                    </li>
                                  ))}
                                </ul>
                              </dd>
                            )}
                          </dl>
                        ))}
                      </section>
                    )}
                  </section>
                );
              })}
              <section aria-labelledby={`${candidateDomId}-pantry`}>
                <h3 id={`${candidateDomId}-pantry`}>冷蔵庫食材の使い方</h3>
                {menu.pantryUsage.length === 0 ? (
                  <p>今回選んだ冷蔵庫食材はありません。</p>
                ) : (
                  <ul>
                    {menu.pantryUsage.map((usage) => (
                      <li key={usage.selectionId}>
                        <strong>{usage.pantryItemName}</strong>
                        {usage.usageStatus === "used" ? (
                          <p>
                            使用予定 {quantityText(usage.plannedQuantity, usage.unit, "分量を確認")}
                            {usage.shortageQuantity !== null && usage.shortageQuantity > 0
                              ? `／不足 ${quantityText(usage.shortageQuantity, usage.unit, "")}`
                              : ""}
                          </p>
                        ) : (
                          <p>使わなかった理由: {usage.unusedReason}</p>
                        )}
                        {usage.dishIds.length > 0 && (
                          <p>
                            使用先:{" "}
                            {usage.dishIds
                              .flatMap((dishId) => {
                                const name = menu.dishes.find((dish) => dish.id === dishId)?.name;
                                return name === undefined ? [] : [name];
                              })
                              .join("・")}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </details>
            {labelWarnings.length > 0 && (
              <section role="note" className="emergency-label-warning">
                <h3>加工品は原材料表示を確認してください</h3>
                <ul>
                  {labelWarnings.map((warning, warningIndex) => (
                    <li key={`${candidateDomId}-warning-${String(warningIndex + 1)}`}>
                      {warning.sourceDisplayName}・{warning.allergenDisplayName}・
                      {warning.memberDisplayName}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p>
              固定データから表示しています。内容、加熱状態、加工品の原材料表示と家庭内の混入を調理前に確認してください。安全を保証する表示ではありません。
            </p>
          </article>
        );
      })}
    </main>
  );
}
