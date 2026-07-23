import type { PlannerDraftInput, TargetMode } from "@shared/contracts/planner";

/**
 * ウィザードのstep順序。質問順（meal→ingredients→cuisine→audience）に
 * reviewを続けた固定配列。UI・resume判定・focus順の唯一の正とする。
 */
export const plannerSteps = ["meal", "ingredients", "cuisine", "audience", "review"] as const;
export type PlannerStep = (typeof plannerSteps)[number];

/**
 * PlannerDraftInputの11フィールドをUI上のfield単位へ対応させた名前。
 * targetMode/targetMemberIds/servingsはaudience stepにまとめて表示するが、
 * field-local errorは実際に問題がある入力ごとに個別に出すため、
 * 3つを1つの名前へ集約しない（brief: 「additionalConditionsへの一括集約は行わない」）。
 */
export type PlannerFieldName =
  | "mealType"
  | "mainIngredients"
  | "cuisineGenre"
  | "targetMode"
  | "targetMemberIds"
  | "servings"
  | "timeLimitMinutes"
  | "budgetPreference"
  | "avoidIngredients"
  | "memo"
  | "pantrySelections";

/**
 * 下書きの回答状況から「まだ答えられていない最初のstep」を判定する。
 * 個別フィールド単位ではなくstep単位でresumeさせるのは、
 * 4質問stepは1フィールドにつき1step、audience stepだけが
 * targetMode/targetMemberIds/servingsの3フィールドを1つのstepにまとめて
 * 扱う設計（brief step 7）に合わせるため。
 *
 * 呼び出し側（route/wizard）はこの結果をそのままstep遷移先として使うため、
 * ここで判定した回答済みフィールドの値そのものは変更しない
 * （「resumes ... without losing answers」の前提）。
 */
export function firstIncompletePlannerStep(draft: PlannerDraftInput): PlannerStep {
  if (draft.mealType === null) return "meal";
  if (draft.mainIngredients.length === 0) return "ingredients";
  if (draft.cuisineGenre === null) return "cuisine";
  if (!isAudienceComplete(draft)) return "audience";
  return "review";
}

/**
 * audience（対象家族/人数）の回答が完成しているかどうかを判定する。
 * shared/contracts/planner.tsのrefineTargetAndServingsが強制する不変条件
 * （household: 対象1人以上・servings未指定 / idea: 対象0人・servings必須）
 * をUI側のresume判定にもそのまま反映させる。
 */
function isAudienceComplete(draft: PlannerDraftInput): boolean {
  if (draft.targetMode === "household") return draft.targetMemberIds.length > 0;
  if (draft.targetMode === "idea") return draft.servings !== null;
  return false;
}

/**
 * Zodのissue pathからPlannerFieldNameへ正規化する。
 * 配列を持つfield（mainIngredients/targetMemberIds/avoidIngredients/
 * pantrySelections）はindexやネストしたキー（pantrySelections.0.pantryItemId等）
 * を持つことがあるため、path先頭のroot fieldだけを見て判定し、
 * 添字以降の深さは無視する。未知のroot fieldはUIが表示すべき場所を
 * 持たないため、summary/field-localどちらにも出さずnullにする
 * （fail-closed: 想定外pathを無理に既知fieldへ寄せない）。
 */
export function mapPlannerIssuePathToField(path: readonly PropertyKey[]): PlannerFieldName | null {
  const root = path[0];
  if (typeof root !== "string") return null;
  return isPlannerFieldName(root) ? root : null;
}

const plannerFieldNames: readonly PlannerFieldName[] = [
  "mealType",
  "mainIngredients",
  "cuisineGenre",
  "targetMode",
  "targetMemberIds",
  "servings",
  "timeLimitMinutes",
  "budgetPreference",
  "avoidIngredients",
  "memo",
  "pantrySelections",
];

function isPlannerFieldName(value: string): value is PlannerFieldName {
  return (plannerFieldNames as readonly string[]).includes(value);
}

// 質問順（brief固定順）でのfocus対象field列。mapPlannerIssuePathToFieldが
// 返すPlannerFieldNameのうち、複数issueが同時発生したときにどれを最優先で
// focusすべきかを決めるための固定順序。
const focusOrder: readonly PlannerFieldName[] = plannerFieldNames;

const stepByField: Readonly<Record<PlannerFieldName, PlannerStep>> = {
  mealType: "meal",
  mainIngredients: "ingredients",
  cuisineGenre: "cuisine",
  targetMode: "audience",
  targetMemberIds: "audience",
  servings: "audience",
  timeLimitMinutes: "review",
  budgetPreference: "review",
  avoidIngredients: "review",
  memo: "review",
  pantrySelections: "review",
};

/**
 * plannerSubmissionSchemaのissueをPlannerFieldName別のmapへ正規化する。
 * 複数issueの中で「質問順・質問内順で最初」のfieldをfocusTargetとして返す
 * ことで、呼び出し側（route層）はDOM操作なしに「どのstepへ戻ってfocusすべきか」
 * を判定できる（brief: 「複数issueでは質問順と質問内順の最初のinvalid fieldへfocus」）。
 */
export function buildPlannerSubmissionFieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): {
  fieldErrors: Partial<Record<PlannerFieldName, string>>;
  firstInvalidField: PlannerFieldName | null;
  firstInvalidStep: PlannerStep | null;
} {
  const fieldErrors: Partial<Record<PlannerFieldName, string>> = {};
  for (const issue of issues) {
    const field = mapPlannerIssuePathToField(issue.path);
    if (field === null) continue;
    // 同じfieldに複数issueがある場合は最初に見つかったmessageだけを残す
    // （brief: 「実入力ごとにfield名を持ち」、field単位で1つのmessageを表示する設計）。
    if (fieldErrors[field] === undefined) fieldErrors[field] = issue.message;
  }
  const firstInvalidField = focusOrder.find((field) => fieldErrors[field] !== undefined) ?? null;
  return {
    fieldErrors,
    firstInvalidField,
    firstInvalidStep: firstInvalidField === null ? null : stepByField[firstInvalidField],
  };
}

/**
 * 利用可能家族数などmode変更時点の追加情報。
 * eligibleMemberCountは「householdを選んだ後に対象家族が0件になった」
 * ケースをidea側の判定と区別するために渡す（brief: 「idea へ自動降格しない」）。
 */
export type AudienceModeChangeContext = {
  eligibleMemberCount?: number;
};

/**
 * audience stepでtargetModeを切り替える際に、targetMode/targetMemberIds/servingsの
 * 3フィールドを常に整合した状態へ揃えるヘルパー。
 *
 * 設計上の判断理由:
 * - modeを切り替えた瞬間に前のmodeの値（household IDs or idea人数）を
 *   残してしまうと、UIの見た目とは無関係に「送信可能な不整合下書き」が
 *   一時的に成立してしまう（例: household + 前のidea servings）。
 *   これはshared/contracts/planner.tsのrefineTargetAndServingsが
 *   最終的にはじくものの、ユーザーには送信直前まで見えない不整合になるため、
 *   mode切替の時点で必ず空へリセットする。
 * - household選択時にeligibleMemberCountが0であれば、audienceを
 *   householdのまま「対象0件」で保持せず、mode未選択へ戻す。
 *   ideaへ自動的に降格させないのは、ユーザーが意図しない人数入力モードへ
 *   無断で切り替わることを避けるため（briefが明示する不変条件）。
 */
export function normalizeAudienceForModeChange(
  draft: PlannerDraftInput,
  nextMode: TargetMode | null,
  context: AudienceModeChangeContext = {},
): PlannerDraftInput {
  const resolvedMode =
    nextMode === "household" && context.eligibleMemberCount === 0 ? null : nextMode;
  return {
    ...draft,
    targetMode: resolvedMode,
    targetMemberIds: [],
    servings: null,
  };
}
