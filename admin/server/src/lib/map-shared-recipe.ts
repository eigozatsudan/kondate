/**
 * 共有レシピ行 → 管理画面 DTO。
 * menu_payload の生 JSON はレスポンスに載せず、preview 投影のみ返す。
 */
import type {
  SharedRecipeDetail,
  SharedRecipeListItem,
  SharedRecipePreview,
} from "../../../shared/schemas.js";
import {
  sharedRecipeDetailSchema,
  sharedRecipeListItemSchema,
  sharedRecipePreviewSchema,
} from "../../../shared/schemas.js";
import { formatIso } from "./jst.js";

/** 構造化 preview を生成できる schemaVersion（未知は unsupported） */
const SUPPORTED_SCHEMA = "2026-07-11.v1";

export type SharedRecipeListRow = {
  id: string;
  created_at: Date | string;
  status: string;
  meal_type: string;
  total_elapsed_minutes: number;
  title: string;
  standard_allergen_ids: string[] | null;
  eligible_age_bands: string[] | null;
  contributor_user_id: string | null;
  source_menu_id: string | null;
};

export function mapSharedRecipeListItem(row: SharedRecipeListRow): SharedRecipeListItem {
  return sharedRecipeListItemSchema.parse({
    id: row.id,
    createdAt: formatIso(row.created_at) ?? "",
    status: row.status,
    mealType: row.meal_type,
    totalElapsedMinutes: row.total_elapsed_minutes,
    title: row.title,
    standardAllergenIds: row.standard_allergen_ids ?? [],
    eligibleAgeBands: row.eligible_age_bands ?? [],
    contributorUserId: row.contributor_user_id,
    sourceMenuId: row.source_menu_id,
  });
}

/** プレビュー投影対象として安全にプロパティ参照できる非 null オブジェクトか */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * menu_payload から管理画面向け preview を投影する。
 * - schemaVersion 欠落/null → invalid_menu_payload
 * - 未知の schemaVersion → unsupported_schema_version
 * - 構造不足・ネスト null・Zod 失敗・投影例外 → invalid_menu_payload
 * pantryUsage / labelConfirmations / 料理 UUID 等は拾わない。
 * 呼び出し側へ例外は投げない（壊れた payload は 500 ではなく previewError に閉じる）。
 */
export function buildPreviewFromPayload(raw: unknown): {
  preview: SharedRecipePreview | null;
  previewError: "invalid_menu_payload" | "unsupported_schema_version" | null;
} {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { preview: null, previewError: "invalid_menu_payload" };
  }
  const obj = raw as Record<string, unknown>;
  // 欠落は invalid、未知バージョンは unsupported（分岐順はテストと一致）
  if (obj.schemaVersion === undefined || obj.schemaVersion === null) {
    return { preview: null, previewError: "invalid_menu_payload" };
  }
  if (obj.schemaVersion !== SUPPORTED_SCHEMA) {
    return { preview: null, previewError: "unsupported_schema_version" };
  }

  const dishesIn = Array.isArray(obj.dishes) ? obj.dishes : null;
  const timelineIn = Array.isArray(obj.timeline) ? obj.timeline : null;
  const adaptationsIn = Array.isArray(obj.adaptations) ? obj.adaptations : [];

  if (!dishesIn || !timelineIn) {
    return { preview: null, previewError: "invalid_menu_payload" };
  }

  try {
    // dishes/timeline 等の配列要素が null のとき、プロパティ参照で TypeError になるのを防ぐ
    for (const d of dishesIn) {
      if (!isPlainObject(d)) {
        return { preview: null, previewError: "invalid_menu_payload" };
      }
      const ingredients = Array.isArray(d.ingredients) ? d.ingredients : [];
      const steps = Array.isArray(d.steps) ? d.steps : [];
      for (const i of ingredients) {
        if (!isPlainObject(i)) {
          return { preview: null, previewError: "invalid_menu_payload" };
        }
      }
      for (const s of steps) {
        if (!isPlainObject(s)) {
          return { preview: null, previewError: "invalid_menu_payload" };
        }
      }
    }
    for (const t of timelineIn) {
      if (!isPlainObject(t)) {
        return { preview: null, previewError: "invalid_menu_payload" };
      }
    }
    for (const a of adaptationsIn) {
      if (!isPlainObject(a)) {
        return { preview: null, previewError: "invalid_menu_payload" };
      }
      const actions = Array.isArray(a.safetyActions) ? a.safetyActions : [];
      for (const x of actions) {
        if (!isPlainObject(x)) {
          return { preview: null, previewError: "invalid_menu_payload" };
        }
      }
    }

    const picked = {
      schemaVersion: obj.schemaVersion,
      menuId: obj.menuId,
      mealType: obj.mealType,
      cuisineGenre: obj.cuisineGenre,
      servings: obj.servings,
      totalElapsedMinutes: obj.totalElapsedMinutes,
      safetyTags: Array.isArray(obj.safetyTags) ? obj.safetyTags : [],
      dishes: dishesIn.map((d) => {
        const dish = d as Record<string, unknown>;
        const ingredients = Array.isArray(dish.ingredients) ? dish.ingredients : [];
        const steps = Array.isArray(dish.steps) ? dish.steps : [];
        return {
          role: dish.role,
          position: dish.position,
          name: dish.name,
          description: dish.description,
          cookingTimeMinutes: dish.cookingTimeMinutes,
          ingredients: ingredients.map((i) => {
            const ing = i as Record<string, unknown>;
            return {
              name: ing.name,
              quantityText: ing.quantityText,
              unit: ing.unit ?? null,
              storeSection: ing.storeSection,
            };
          }),
          steps: steps.map((s) => {
            const step = s as Record<string, unknown>;
            return { position: step.position, instruction: step.instruction };
          }),
        };
      }),
      timeline: timelineIn.map((t) => {
        const step = t as Record<string, unknown>;
        return {
          position: step.position,
          startMinute: step.startMinute,
          durationMinutes: step.durationMinutes,
          instruction: step.instruction,
        };
      }),
      adaptations: adaptationsIn.map((a) => {
        const ad = a as Record<string, unknown>;
        const actions = Array.isArray(ad.safetyActions) ? ad.safetyActions : [];
        return {
          portionText: ad.portionText,
          additionalCutting: ad.additionalCutting ?? null,
          additionalHeating: ad.additionalHeating ?? null,
          additionalSeasoning: ad.additionalSeasoning ?? null,
          servingCheck: ad.servingCheck,
          anonymousMemberRef: ad.anonymousMemberRef,
          safetyActions: actions.map((x) => {
            const act = x as Record<string, unknown>;
            return { kind: act.kind, instruction: act.instruction };
          }),
        };
      }),
    };

    const parsed = sharedRecipePreviewSchema.safeParse(picked);
    if (!parsed.success) {
      return { preview: null, previewError: "invalid_menu_payload" };
    }
    return { preview: parsed.data, previewError: null };
  } catch {
    // 予期しない構造でも呼び出し側へは投げず previewError に閉じる
    return { preview: null, previewError: "invalid_menu_payload" };
  }
}

export function mapSharedRecipeDetail(
  row: SharedRecipeListRow & { menu_payload: unknown },
): SharedRecipeDetail {
  const base = mapSharedRecipeListItem(row);
  const { preview, previewError } = buildPreviewFromPayload(row.menu_payload);
  return sharedRecipeDetailSchema.parse({
    ...base,
    preview,
    previewError,
  });
}
