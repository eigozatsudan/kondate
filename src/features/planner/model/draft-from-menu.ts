import type { PlannerDraftInput, PlannerSubmission } from "@shared/contracts/planner";

/**
 * 完成献立の preference_snapshot.submission から、新規作成用の下書き入力を作る。
 *
 * 食事・主食材・ジャンル・任意条件・冷蔵庫選択は引き継ぎ、
 * 対象だけ（targetMode / targetMemberIds / servings）を未選択へ戻す。
 * これは再生成 lineage の mode 変更ではなく、audience から始める新規作成である。
 */
export function createPlannerDraftFromMenu(submission: PlannerSubmission): PlannerDraftInput {
  return {
    mealType: submission.mealType,
    mainIngredients: [...submission.mainIngredients],
    cuisineGenre: submission.cuisineGenre,
    // 対象3項目だけを未選択へ戻し、wizard は audience から再開する
    targetMode: null,
    targetMemberIds: [],
    servings: null,
    timeLimitMinutes: submission.timeLimitMinutes,
    budgetPreference: submission.budgetPreference,
    avoidIngredients: [...submission.avoidIngredients],
    memo: submission.memo,
    pantrySelections: submission.pantrySelections.map((item) => ({ ...item })),
  };
}
