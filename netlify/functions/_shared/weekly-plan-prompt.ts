/**
 * 週献立専用プロンプト。テキストのみ（image_url は送らない）。
 * wire は既存 mode: "flyer_weekly" をそのまま使う（response_format も再利用）。
 */
import {
  EFFORT_HINTS_ENABLED,
  WEEKLY_EFFORT_SENTENCE,
  shouldIncludeEffortHints,
} from "./effort-hints.js";
import { buildPromptMemberSafetyDto } from "./generation-prompt.js";
import type { OpenRouterMessage } from "./openrouter.js";
import type { CurrentSafetyContext } from "../../../shared/safety/context.js";
import type { WeeklyPlanRequest } from "../../../shared/contracts/weekly-plan.js";

function serializeWeeklyPlanPayload(
  request: WeeklyPlanRequest,
  safety: CurrentSafetyContext,
  effortEnabled: boolean,
) {
  const membersById = new Map(safety.members.map((member) => [member.householdMemberId, member]));
  const members = request.targetMemberIds.map((id) => {
    const member = membersById.get(id);
    if (member === undefined) throw new Error("member_context_mismatch");
    return buildPromptMemberSafetyDto(member);
  });
  return JSON.stringify({
    preferences: {
      cuisineGenre: request.cuisineGenre,
      budgetPreference: request.budgetPreference,
      noveltyPreference: request.noveltyPreference,
      // easy かつ kill-switch on のときだけ載せる（日次と同じ規約）
      ...(effortEnabled ? { effortPreference: "easy" as const } : {}),
      // 利用者が優先して使いたい食材（自由入力）。安全条件が常に優先。
      priorityIngredients: request.priorityIngredients,
    },
    members,
    validationVersions: {
      allergenDictionary: safety.dictionaryVersion,
      foodSafetyRules: safety.foodRuleVersion,
    },
  });
}

export function buildWeeklyPlanMessages(
  request: WeeklyPlanRequest,
  safety: CurrentSafetyContext,
): OpenRouterMessage[] {
  // 手間を載せるかは 1 回だけ判定し、system の 1 文と payload のキーの両方へ同じ値を使う。
  // flag は import した定数を渡し、*-effort-off テストの vi.mock を効かせる
  const effortEnabled = shouldIncludeEffortHints(EFFORT_HINTS_ENABLED, request.effortPreference);
  return [
    {
      role: "system",
      content:
        "あなたは家庭の週間献立アシスタントです。渡された家族の安全条件（アレルギー・年齢帯の制約）" +
        "から、主菜中心の7日分献立を JSON で返してください。" +
        "days は dayIndex 1..7 を一意に含み、各日 mainName と ingredients（食材名の配列）を必ず入れてください。" +
        "preferences.priorityIngredients に挙げた食材は、安全条件に抵触しない範囲で" +
        "7日の献立に優先的に取り入れてください。" +
        (effortEnabled ? WEEKLY_EFFORT_SENTENCE : "") +
        "membersのallergenIds・customAllergies（name/aliases）・requiredSafetyConstraintsに" +
        "抵触する食材は一切使わないでください。氏名・呼び名は入力にありません。" +
        "「安全です」「アレルギー対応済み」等の保証表現は一切使わないでください。" +
        "アレルギー・医療・離乳食の専門判断は行わず、一般的な家庭料理に限定してください。",
    },
    {
      role: "user",
      content: `<kondate_weekly_plan_input>\n${serializeWeeklyPlanPayload(request, safety, effortEnabled)}\n</kondate_weekly_plan_input>`,
    },
  ];
}
