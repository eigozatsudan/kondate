import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { EmergencyMenusData } from "@shared/emergency/contracts";
import { useAuth } from "@/features/auth/use-auth";
import { getPlannerDraft, plannerKeys } from "@/features/planner/planner-api";
import {
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

function quantityText(value: number | null, unit: string | null, fallback: string): string {
  return value === null ? fallback : `${String(value)}${unit ?? ""}`;
}

export function EmergencyMenuPage() {
  const userId = useAuth().session?.user.id;
  const [householdSafetyRevision, setHouseholdSafetyRevision] = useState(() => {
    try {
      return localStorage.getItem(householdSafetyRevisionStorageKey) ?? "initial";
    } catch {
      return "initial";
    }
  });
  useEffect(() => {
    const refreshRevision = () => {
      setHouseholdSafetyRevision((current) => {
        try {
          return localStorage.getItem(householdSafetyRevisionStorageKey) ?? `${current}:changed`;
        } catch {
          return `${current}:changed`;
        }
      });
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === householdSafetyRevisionStorageKey) refreshRevision();
    };
    window.addEventListener(householdSafetyChangedEvent, refreshRevision);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(householdSafetyChangedEvent, refreshRevision);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);
  const draftQuery = useQuery({
    queryKey: plannerKeys.draft(userId ?? "missing"),
    enabled: userId !== undefined,
    queryFn: () => getPlannerDraft(getBrowserSupabaseClient(), userId ?? ""),
  });
  // 下書きなし、またはidea下書き（家族条件を持たない）の場合は対象家族が0人になる。
  // route entryだけを理由に緊急献立APIや家族安全再検証を発生させない
  // （Step 10要件）ため、eligibleMembersが0件のときはクエリ自体を無効化する。
  const targetMemberIds = draftQuery.data?.targetMemberIds ?? [];
  const hasEligibleHouseholdMembers = targetMemberIds.length > 0;
  const request = {
    mealType: draftQuery.data?.mealType ?? "dinner",
    targetMemberIds,
    pantryItemIds: draftQuery.data?.pantrySelections.map((item) => item.pantryItemId) ?? [],
  } as const;
  const query = useQuery({
    queryKey: emergencyMenuKeys.candidates({
      userId: userId ?? "missing",
      ...request,
      householdSafetyRevision,
    }),
    enabled:
      userId !== undefined &&
      draftQuery.isSuccess &&
      draftQuery.data !== null &&
      !draftQuery.isFetching &&
      hasEligibleHouseholdMembers,
    queryFn: () => getEmergencyMenus(request),
  });
  const loading = draftQuery.isFetching || query.isFetching;
  const error = draftQuery.isError || query.isError ? "緊急献立を読み込めませんでした" : null;
  if (draftQuery.isSuccess && draftQuery.data === null) {
    return (
      <main className="page-frame stack emergency-menu-page">
        <h1>15分緊急献立</h1>
        <p role="alert">献立条件の下書きがありません。献立画面で条件を保存してください。</p>
        <a href="/planner">献立画面へ戻る</a>
      </main>
    );
  }
  if (draftQuery.isSuccess && draftQuery.data !== null && !hasEligibleHouseholdMembers) {
    return (
      <main className="page-frame stack emergency-menu-page">
        <h1>15分緊急献立</h1>
        <p role="alert">
          対象の家族が登録されていないため、緊急献立を表示できません。家族設定は任意です。
        </p>
        <a href="/onboarding">家族設定へ（任意）</a>
        <a href="/planner">献立画面へ戻る</a>
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
            <h2>{menu.dishes.map((dish) => dish.name).join("・")}</h2>
            <p>
              食卓まで全体 {menu.totalElapsedMinutes}分・{menu.servings}人分
            </p>
            <details open>
              <summary>材料と作り方を表示</summary>
              <section aria-labelledby={`${candidateDomId}-timeline`}>
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
