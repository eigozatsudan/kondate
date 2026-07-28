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

/** 設計 §5 path 条件付き intro（exact plain JP） */
const householdIntroText =
  "現在の家族・アレルギー・年齢・必須条件で固定候補を絞り込みます。AI利用回数は消費しません。";
const ideaIntroText =
  "個人向けの固定候補です。家族のアレルギー・年齢条件は適用していません。AI利用回数は消費しません。調理前に原材料表示と家庭内の混入を確認してください。";

/** 設計 §5 path 条件付き safety_only バナー（exact plain JP） */
const householdSafetyOnlyBannerText =
  "メイン食材は一致しませんでした。安全条件に合う候補を表示しています。";
const ideaSafetyOnlyBannerText =
  "メイン食材は一致しませんでした。アレルギー条件は適用していません。";

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

  const draftQuery = useQuery({
    queryKey: plannerKeys.draft(userId ?? "missing"),
    enabled: draftQueryEnabled,
    queryFn: () => getPlannerDraft(getBrowserSupabaseClient(), userId ?? ""),
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
  // idea 下書きでは household 安全信号を購読しない（safetyRealtimeEnabled で gate）。
  useEffect(() => {
    if (userId === undefined || !safetyRealtimeEnabled) return;
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
  }, [userId, safetyRealtimeEnabled]);

  const shouldResolveUnselectedTargets =
    draftQuery.data?.targetMode === null && draftQuery.data.targetMemberIds.length === 0;
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

  const mealType = draft?.mealType ?? "dinner";
  const mainIngredients = draft?.mainIngredients ?? [];
  const pantryItemIds = draft?.pantrySelections.map((item) => item.pantryItemId) ?? [];
  // 設計 §5: idea は targetMemberIds 空・targetMode idea。eligible 0 でも候補 query を起動する。
  const request = isIdea
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
    (isIdea || (householdQueryEnabled && householdQuery.isSuccess && targetMemberIds.length > 0));

  const query = useQuery({
    queryKey: emergencyMenuKeys.candidates({
      userId: userId ?? "missing",
      ...request,
      householdSafetyRevision,
    }),
    enabled: candidateQueryEnabled,
    queryFn: () => getEmergencyMenus(request),
  });

  // loading / error は candidateQueryEnabled の後に定義する（設計 §5 順序）。
  // draft は「データ無しの初回取得」だけ loading。キャッシュ済みの背景 refetch では
  // intro/candidates を消さない（window-focus での空白フラッシュ防止）。
  const draftInitialLoading =
    draftQueryEnabled && (draftQuery.isPending || (draftQuery.isFetching && !draftResolved));
  const loading =
    draftInitialLoading ||
    (householdQueryEnabled && (householdQuery.isPending || householdQuery.isFetching)) ||
    (candidateQueryEnabled && (query.isPending || query.isFetching));
  const error =
    draftQuery.isError || (householdQueryEnabled && householdQuery.isError) || query.isError
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

  // pre-API empty: candidate query が disabled のときだけ。idea は落とさない。
  // draft/household ロード中は出さない（loading 中に empty フラッシュしない）。
  const showPreApiEmpty =
    draftReady &&
    !isIdea &&
    !loading &&
    error === null &&
    !candidateQueryEnabled &&
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
      expectedPath={expectedPath}
      response={loading || error !== null ? null : (query.data ?? null)}
    />
  );
}

/** 設計 §5 post-API empty body（exact plain JP）。message は heading のみに使い body は emptyReason で分岐する。 */
function postApiEmptyBody(response: EmergencyMenusData): string {
  if (response.emptyReason === "current_safety_unavailable" && response.path === "household") {
    return "アレルギー確認未了または対応できない食事条件のため、候補を表示していません。条件は緩めていません";
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
}: {
  loading: boolean;
  error: string | null;
  /**
   * draft 由来。loading 中 intro/empty chrome の正本。
   * null = draft 未解決。path 条件付き intro を出さない（世帯 intro の誤フラッシュ防止）。
   */
  expectedPath: "household" | "idea" | null;
  response: EmergencyMenusData | null;
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
      {loading && <p>候補を確認中…</p>}
      {displayError !== null && <p role="alert">{displayError}</p>}
      {showSafetyOnlyBanner && <p role="note">{safetyOnlyBannerText}</p>}
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
