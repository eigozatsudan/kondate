import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { EmergencyMenusData } from "@shared/emergency/contracts";
import { useAuth } from "@/features/auth/use-auth";
import { listHouseholdMembers, type HouseholdMemberRow } from "@/features/household/household-api";
import { getPlannerDraft, plannerKeys } from "@/features/planner/planner-api";
import {
  householdKeys,
  householdSafetyChangedEvent,
  householdSafetyRevisionStorageKey,
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

function isEmergencyEligibleMember(member: HouseholdMemberRow): boolean {
  return (
    member.status === "complete" &&
    (member.allergy_status === "none" || member.allergy_status === "registered") &&
    member.unsupported_diet_status === "none"
  );
}

function quantityText(value: number | null, unit: string | null, fallback: string): string {
  return value === null ? fallback : `${String(value)}${unit ?? ""}`;
}

export function EmergencyMenuPage() {
  const userId = useAuth().session?.user.id;
  const draftQueryEnabled = userId !== undefined;
  const householdSafetyEventVersion = useRef(0);
  const [householdSafetyRevision, setHouseholdSafetyRevision] = useState(() => {
    try {
      return localStorage.getItem(householdSafetyRevisionStorageKey) ?? "initial";
    } catch {
      return "initial";
    }
  });
  // 別端末・他タブでの家族/アレルギー変更を、history revalidation と同様に
  // owner-scoped Realtime + focus/visible/online + 60s poll で拾う。
  // revision を query key に載せ、signal 直後は旧候補を閉じて再取得完了まで fail closed。
  useEffect(() => {
    if (userId === undefined) return;
    const refreshRevision = () => {
      householdSafetyEventVersion.current += 1;
      setHouseholdSafetyRevision((current) => {
        try {
          const storedRevision = localStorage.getItem(householdSafetyRevisionStorageKey);
          return `${storedRevision ?? current}:event:${String(householdSafetyEventVersion.current)}`;
        } catch {
          return `${current}:event:${String(householdSafetyEventVersion.current)}`;
        }
      });
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === householdSafetyRevisionStorageKey) refreshRevision();
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
      .subscribe();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) refreshRevision();
    }, 60_000);
    window.addEventListener(householdSafetyChangedEvent, refreshRevision);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleVisible);
    window.addEventListener("online", refreshRevision);
    window.addEventListener("offline", refreshRevision);
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(householdSafetyChangedEvent, refreshRevision);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleVisible);
      window.removeEventListener("online", refreshRevision);
      window.removeEventListener("offline", refreshRevision);
      document.removeEventListener("visibilitychange", handleVisible);
      void client.removeChannel(channel);
    };
  }, [userId]);
  const draftQuery = useQuery({
    queryKey: plannerKeys.draft(userId ?? "missing"),
    enabled: draftQueryEnabled,
    queryFn: () => getPlannerDraft(getBrowserSupabaseClient(), userId ?? ""),
  });
  const shouldLoadHouseholdTargets =
    draftQuery.data !== null &&
    draftQuery.data !== undefined &&
    draftQuery.data.targetMode !== "idea";
  const shouldResolveUnselectedTargets =
    draftQuery.data?.targetMode === null && draftQuery.data.targetMemberIds.length === 0;
  const householdQueryEnabled =
    userId !== undefined &&
    draftQuery.isSuccess &&
    !draftQuery.isFetching &&
    shouldLoadHouseholdTargets;
  const householdQuery = useQuery({
    // 家族設定のauthority key配下に安全revisionを加え、家族更新のinvalidationと
    // 同画面・別画面の安全更新eventのどちらでもfresh cacheを再利用しない。
    queryKey: [...householdKeys.members(userId ?? "missing"), "emergency", householdSafetyRevision],
    enabled: householdQueryEnabled,
    queryFn: () => listHouseholdMembers(getBrowserSupabaseClient(), userId ?? ""),
  });
  // mode未選択の下書きだけは、後から完了した家族を初期対象にできる。
  // ideaまたは明示済みhouseholdから別家族へ黙って切り替えない。
  const eligibleMemberIds = (householdQuery.data ?? [])
    .filter(isEmergencyEligibleMember)
    .map((member) => member.id);
  const targetMemberIds = shouldResolveUnselectedTargets
    ? eligibleMemberIds.slice(0, emergencyTargetMemberLimit)
    : draftQuery.data?.targetMode === "household"
      ? draftQuery.data.targetMemberIds
          .filter((memberId) => eligibleMemberIds.includes(memberId))
          .slice(0, emergencyTargetMemberLimit)
      : [];
  const hasEligibleHouseholdMembers = targetMemberIds.length > 0;
  const request = {
    mealType: draftQuery.data?.mealType ?? "dinner",
    mainIngredients: draftQuery.data?.mainIngredients ?? [],
    targetMemberIds,
    pantryItemIds: draftQuery.data?.pantrySelections.map((item) => item.pantryItemId) ?? [],
  } as const;
  const candidateQueryEnabled =
    userId !== undefined &&
    draftQuery.isSuccess &&
    draftQuery.data !== null &&
    !draftQuery.isFetching &&
    (!shouldLoadHouseholdTargets || householdQuery.isSuccess) &&
    hasEligibleHouseholdMembers;
  const query = useQuery({
    queryKey: emergencyMenuKeys.candidates({
      userId: userId ?? "missing",
      ...request,
      householdSafetyRevision,
    }),
    enabled: candidateQueryEnabled,
    queryFn: () => getEmergencyMenus(request),
  });
  const loading =
    (draftQueryEnabled && (draftQuery.isPending || draftQuery.isFetching)) ||
    (householdQueryEnabled && (householdQuery.isPending || householdQuery.isFetching)) ||
    (candidateQueryEnabled && (query.isPending || query.isFetching));
  const error =
    draftQuery.isError || (shouldLoadHouseholdTargets && householdQuery.isError) || query.isError
      ? "緊急献立を読み込めませんでした"
      : null;
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
  if (
    draftQuery.isSuccess &&
    draftQuery.data !== null &&
    !loading &&
    error === null &&
    !hasEligibleHouseholdMembers
  ) {
    // C-I6: 空理由を正直に分岐する。idea / 適格0 / 選択フィルタ / 真の0人を混同しない。
    const targetMode = draftQuery.data.targetMode;
    const householdMembers = householdQuery.data ?? [];
    const emptyState =
      targetMode === "idea"
        ? {
            message:
              "アイデアモードでは緊急献立を表示できません。献立画面で「家族向け」に切り替えてください。",
            href: "/planner",
            linkLabel: "家族向けに切り替える",
          }
        : householdMembers.length === 0
          ? {
              message:
                "対象の家族が登録されていないため、緊急献立を表示できません。家族設定は任意です。",
              href: "/onboarding",
              linkLabel: "家族設定へ（任意）",
            }
          : eligibleMemberIds.length === 0
            ? {
                message:
                  "表示できる対象の家族がいません。アレルギー確認と家族設定の完了を確認してください。",
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
      response={loading || error !== null ? null : (query.data ?? null)}
    />
  );
}

export function EmergencyMenuContent({
  loading,
  error,
  response,
}: {
  loading: boolean;
  error: string | null;
  response: EmergencyMenusData | null;
}) {
  const visibleResponse = loading || error !== null ? null : response;
  return (
    <main className="page-frame stack emergency-menu-page">
      <Link className="emergency-back-link" to="/planner" aria-label="献立画面へ戻る">
        ← 献立画面へ戻る
      </Link>
      <div>
        <p className="eyebrow">AIを使わない</p>
        <h1>15分緊急献立</h1>
      </div>
      <p>
        現在の家族・アレルギー・年齢・必須条件で固定候補を絞り込みます。AI利用回数は消費しません。
      </p>
      {loading && <p>候補を確認中…</p>}
      {error !== null && <p role="alert">{error}</p>}
      {visibleResponse?.candidates.length === 0 && (
        <section className="card">
          <h2>{visibleResponse.message}</h2>
          <p>条件を緩めず、候補を表示していません。</p>
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
                        <h4>家族向けの取り分け</h4>
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
                                <strong>安全のための手順</strong>
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
