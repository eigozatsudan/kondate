import type { AgeBand, MealType } from "../contracts/domain.js";
import { validatedMenuSchema, type ValidatedMenu } from "../contracts/generation.js";
import type { CurrentSafetyContext, CurrentSafetyMember } from "../safety/context.js";
import type { GenerationContext } from "../safety/generation-context.js";
import { collectMenuTextSources, normalizeFoodText } from "../safety/allergens.js";
import { validateGeneratedMenu } from "../safety/validate-generated-menu.js";
import type {
  EmergencyEmptyReason,
  EmergencyMatchMode,
  EmergencyMenuCandidate,
} from "./contracts.js";
import { emergencyMenuCandidateSchema } from "./contracts.js";
import { emergencyFixtureMetadataV1, emergencyMenuFixturesV1 } from "./fixtures.v1.js";

export type {
  EmergencyLabelWarning,
  EmergencyMenuCandidate,
  EmergencyMenusData,
} from "./contracts.js";

export type EmergencyFilterResult = {
  menus: readonly ValidatedMenu[];
  emptyReason: EmergencyEmptyReason | null;
  matchMode: EmergencyMatchMode | null;
};

export type EmergencySourceMetadata = {
  eligibleAgeBands: readonly AgeBand[];
  standardAllergenIds: readonly string[];
};

/** S1 fixture / S2 community 共通の Stage S 入力候補 */
export type EmergencySourceCandidate = {
  menu: ValidatedMenu;
  metadata: EmergencySourceMetadata;
  source: "fixture" | "community";
};

export type EmergencyMultiSourceFilterResult = EmergencyFilterResult & {
  sourceCounts: { fixture: number; community: number };
};

type StagedMenu = {
  menu: ValidatedMenu;
  source: "fixture" | "community";
};

export function buildEmergencyMenuCandidate(input: {
  menu: ValidatedMenu;
  context: CurrentSafetyContext;
  memberLabels: Readonly<Record<string, string>>;
}): EmergencyMenuCandidate {
  const allergens = new Map(
    input.context.allergenDictionary.catalog.map((item) => [item.id, item.displayName] as const),
  );
  const allergenLabels = Object.fromEntries(
    [...new Set(input.menu.labelConfirmations.map((item) => item.allergenId))].map((allergenId) => {
      const displayName = allergens.get(allergenId);
      if (displayName === undefined) throw new Error("reviewed_emergency_label_mapping_failed");
      return [allergenId, displayName] as const;
    }),
  );
  const labelWarnings = input.menu.labelConfirmations.map((confirmation) => {
    const allergenDisplayName = allergenLabels[confirmation.allergenId];
    const memberDisplayName = input.memberLabels[confirmation.anonymousMemberRef];
    if (allergenDisplayName === undefined || memberDisplayName === undefined) {
      throw new Error("reviewed_emergency_label_mapping_failed");
    }
    return {
      sourceType: confirmation.sourceType,
      sourceId: confirmation.sourceId,
      sourcePath: confirmation.sourcePath,
      sourceDisplayName: confirmation.sourceText,
      allergenId: confirmation.allergenId,
      allergenDisplayName,
      anonymousMemberRef: confirmation.anonymousMemberRef,
      memberDisplayName,
      dictionaryVersion: confirmation.dictionaryVersion,
      confirmationStatus: "pending" as const,
    };
  });
  return emergencyMenuCandidateSchema.parse({
    menu: input.menu,
    memberLabels: input.memberLabels,
    allergenLabels,
    labelWarnings,
  });
}

function remapUuidForMember(id: string, memberIndex: number): string {
  if (memberIndex === 0) return id;
  const suffix = BigInt(`0x${id.slice(-12)}`);
  const remapped = (suffix + BigInt(memberIndex) * 0x100000000n) % 0x1000000000000n;
  return `${id.slice(0, -12)}${remapped.toString(16).padStart(12, "0")}`;
}

/**
 * 配信時 remap: テンプレ adaptations を閲覧者メンバー数へ展開する。
 * S1 fixture / S2 community の両方で同一経路を使う。
 */
export function remapFixtureForMembers(
  menu: ValidatedMenu,
  members: readonly CurrentSafetyMember[],
): ValidatedMenu {
  return validatedMenuSchema.parse({
    ...menu,
    adaptations: members.flatMap((member, memberIndex) =>
      menu.adaptations.map((adaptation) => ({
        ...adaptation,
        id: remapUuidForMember(adaptation.id, memberIndex),
        anonymousMemberRef: member.anonymousRef,
        safetyActions: adaptation.safetyActions.map((action) => ({
          ...action,
          anonymousMemberRef: member.anonymousRef,
        })),
      })),
    ),
  });
}

/**
 * 緊急 fixture 検証用の GenerationContext。
 * idea 経路でも常に targetMode: "household" を渡すこと（本番 filter が保証）。
 * validateIdeaMenu は adaptations を拒否し fixture が全滅するため禁止。
 * wire の path: "idea" が製品上の真実であり、この builder の targetMode とは一致しない。
 */
export function emergencyGenerationContext(
  menu: ValidatedMenu,
  context: CurrentSafetyContext,
  memberLabels: Readonly<Record<string, string>>,
): GenerationContext {
  // idea 経路でも常に targetMode: "household" を渡す。validateIdeaMenu は adaptations を
  // 拒否し fixture が全滅するため禁止。wire の path: "idea" が製品上の真実。
  return {
    targetMode: "household",
    submission: {
      mealType: menu.mealType,
      mainIngredients: [],
      cuisineGenre: menu.cuisineGenre,
      targetMode: "household",
      targetMemberIds: context.members.map((member) => member.householdMemberId),
      servings: null,
      timeLimitMinutes: 15,
      budgetPreference: "standard",
      ingredientPreference: null,
      avoidIngredients: [],
      memo: "",
      pantrySelections: [],
    },
    safety: context,
    pantryItems: [],
    // 緊急献立の検証は真の安全条件（requiredSafetyConstraints / 食材ルール / アレルゲン）
    // だけでゲートする。safety 制約を easePreferences に写像すると structured action の
    // ease 経路を強制し、未検証の cut_small などで候補が空になるため写像しない。
    memberPreferences: context.members.map((member) => ({
      householdMemberId: member.householdMemberId,
      anonymousMemberRef: member.anonymousRef,
      portionSize: "regular",
      spiceLevel: "regular",
      easePreferences: [],
      dislikes: [],
    })),
    targetMembers: context.members.map((member, index) => ({
      householdMemberId: member.householdMemberId,
      anonymousRef: member.anonymousRef,
      displayNameSnapshot: memberLabels[member.anonymousRef] ?? `家族${String(index + 1)}`,
    })),
    allergenVersion: context.dictionaryVersion,
    foodRuleVersion: context.foodRuleVersion,
    expiredPantryChecks: [],
    idempotencyKey: "82600000-0000-4000-8000-000000000001",
    preferenceSnapshot: {},
    safetySnapshot: {},
  };
}

function normalizeMainIngredientForMatch(value: string): string {
  return value.normalize("NFKC").trim();
}

function isCurrentSafetyUnavailable(context: CurrentSafetyContext): boolean {
  return (
    context.members.length === 0 ||
    context.members.some(
      (member) =>
        member.allergyStatus === "unconfirmed" ||
        member.hasUnmappedCustomAllergy ||
        member.unsupportedDietStatus !== "none",
    )
  );
}

/**
 * 1 候補の Stage S（metadata ゲート → remap → validate）。
 * community で remap 後 adaptations が空なら fail-closed（空 adaptation での通過禁止）。
 */
function stageSSourceCandidate(
  candidate: EmergencySourceCandidate,
  input: {
    mealType: MealType;
    context: CurrentSafetyContext;
    memberLabels: Readonly<Record<string, string>>;
  },
): ValidatedMenu | null {
  if (candidate.menu.mealType !== input.mealType) {
    return null;
  }
  const { metadata } = candidate;
  if (
    input.context.members.some(
      (member) =>
        !metadata.eligibleAgeBands.includes(member.ageBand) ||
        member.allergenIds.some((allergenId) => metadata.standardAllergenIds.includes(allergenId)),
    )
  ) {
    return null;
  }
  const remapped = remapFixtureForMembers(candidate.menu, input.context.members);
  // S2: 空 adaptations は under-six 向けに「通したように見せる」抜け道になるため明示 drop。
  // 成人でもコミュニティ候補はテンプレ必須方針に合わせ、空は載せない。
  if (candidate.source === "community" && remapped.adaptations.length === 0) {
    return null;
  }
  const validated = validateGeneratedMenu(
    remapped,
    emergencyGenerationContext(remapped, input.context, input.memberLabels),
  );
  return validated.ok ? validated.menu : null;
}

/**
 * 多ソース緊急フィルタの純粋コア。
 * S1（fixture）を先に Stage S し max まで採用 → 空き枠だけ S2（community）。
 * 一括 merge 後の source ソートだけに頼らない（採用順そのものが S1 優先）。
 */
export function filterEmergencyMenuCandidates(input: {
  mealType: MealType;
  mainIngredients?: readonly string[];
  pantryNames: readonly string[];
  context: CurrentSafetyContext;
  memberLabels?: Readonly<Record<string, string>>;
  candidates: readonly EmergencySourceCandidate[];
  maxCandidates: number;
}): EmergencyMultiSourceFilterResult {
  const mainIngredients = (input.mainIngredients ?? []).map(normalizeMainIngredientForMatch);
  const memberLabels = input.memberLabels ?? {};
  const emptyCounts = { fixture: 0, community: 0 } as const;

  // 1) Stage S 前ゲート
  if (isCurrentSafetyUnavailable(input.context)) {
    return {
      menus: [],
      emptyReason: "current_safety_unavailable",
      matchMode: null,
      sourceCounts: { ...emptyCounts },
    };
  }

  const maxCandidates = Math.max(0, Math.trunc(input.maxCandidates));
  const stageInput = {
    mealType: input.mealType,
    context: input.context,
    memberLabels,
  };

  // 2) Stage S — fixture を先に max まで、空きだけ community
  const staged: StagedMenu[] = [];
  for (const candidate of input.candidates) {
    if (candidate.source !== "fixture") continue;
    if (staged.length >= maxCandidates) break;
    const menu = stageSSourceCandidate(candidate, stageInput);
    if (menu !== null) {
      staged.push({ menu, source: "fixture" });
    }
  }
  if (staged.length < maxCandidates) {
    for (const candidate of input.candidates) {
      if (candidate.source !== "community") continue;
      if (staged.length >= maxCandidates) break;
      const menu = stageSSourceCandidate(candidate, stageInput);
      if (menu !== null) {
        staged.push({ menu, source: "community" });
      }
    }
  }

  const pantry = input.pantryNames.map(normalizeFoodText).filter((name) => name !== "");

  // 3) Stage M（既存と同じ。通過集合は Stage S 採用分に限定）
  let selected: StagedMenu[];
  let matchMode: EmergencyMatchMode | null;
  let emptyReason: EmergencyEmptyReason | null;

  if (mainIngredients.length === 0) {
    selected = staged;
    matchMode = staged.length > 0 ? "none" : null;
    emptyReason = staged.length > 0 ? null : "no_matching_fixture";
  } else {
    // 自由文の手順や説明ではなく、料理名と材料名だけをメイン食材との対応根拠にする。
    // 候補がユーザー指定を含む方向だけを見る。
    // 逆方向（"塩鮭".includes("塩")）は調味料・短い総称語で過剰マッチするため使わない。
    // PE12: 1 文字の調味・汎用語は過剰ヒットしやすいので Stage M から除外（「鶏」等の蛋白 1 字は残す）。
    const stageMGenericSingletons = new Set(["塩", "油", "酢", "糖", "水", "酒", "粉", "湯", "味"]);
    const matchableMains = mainIngredients.filter(
      (main) => !(main.length === 1 && stageMGenericSingletons.has(main)),
    );
    const mainMatched =
      matchableMains.length === 0
        ? []
        : staged.filter((item) => {
            const candidateNames = item.menu.dishes.flatMap((dish) => [
              normalizeMainIngredientForMatch(dish.name),
              ...dish.ingredients.map((ingredient) =>
                normalizeMainIngredientForMatch(ingredient.name),
              ),
            ]);
            return matchableMains.every((mainIngredient) =>
              candidateNames.some((candidateName) => candidateName.includes(mainIngredient)),
            );
          });
    if (mainMatched.length > 0) {
      selected = mainMatched;
      matchMode = "main_ingredient";
      emptyReason = null;
    } else if (staged.length > 0) {
      // メイン不一致でも Stage S 通過候補を safety_only で返す（空にしない）
      selected = staged;
      matchMode = "safety_only";
      emptyReason = null;
    } else {
      selected = [];
      matchMode = null;
      emptyReason = "no_matching_fixture";
    }
  }

  // 4) 優先帯: fixture が常に community より前。帯内は pantry スコア → menuId
  const menus = [...selected]
    .sort((left, right) => {
      if (left.source !== right.source) {
        return left.source === "fixture" ? -1 : 1;
      }
      const score = (menu: ValidatedMenu) =>
        collectMenuTextSources(menu).filter((source) =>
          pantry.some((name) => normalizeFoodText(source.text).includes(name)),
        ).length;
      return (
        score(right.menu) - score(left.menu) || left.menu.menuId.localeCompare(right.menu.menuId)
      );
    })
    .map((item) => item.menu);

  const sourceCounts = {
    fixture: selected.filter((item) => item.source === "fixture").length,
    community: selected.filter((item) => item.source === "community").length,
  };

  return { menus, emptyReason, matchMode, sourceCounts };
}

/**
 * fixture 専用ラッパ。既存呼び出し互換のため内部で多ソースコアに委譲する。
 * max はカタログ全件を通し、API 側 cap は Task 9 で emergencyMaxCandidates を渡す。
 */
export function filterEmergencyMenus(input: {
  mealType: MealType;
  mainIngredients?: readonly string[];
  pantryNames: readonly string[];
  context: CurrentSafetyContext;
  memberLabels?: Readonly<Record<string, string>>;
}): EmergencyFilterResult {
  const candidates: EmergencySourceCandidate[] = emergencyMenuFixturesV1.flatMap((menu) => {
    const metadata = emergencyFixtureMetadataV1[menu.menuId];
    if (metadata === undefined) return [];
    return [
      {
        menu,
        metadata: {
          eligibleAgeBands: metadata.eligibleAgeBands,
          standardAllergenIds: metadata.standardAllergenIds,
        },
        source: "fixture" as const,
      },
    ];
  });
  const multi = filterEmergencyMenuCandidates({
    ...input,
    candidates,
    // 既存テスト・handler 互換: カタログ全件を Stage S 対象にする（返却 cap は呼び出し側）
    maxCandidates: candidates.length,
  });
  return {
    menus: multi.menus,
    emptyReason: multi.emptyReason,
    matchMode: multi.matchMode,
  };
}
