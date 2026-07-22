import { z } from "zod";
import {
  type GenerationCommandV2,
  type GenerationIntegrityContextV2,
} from "../../../shared/contracts/generation.js";
import { HttpError } from "./http.js";
import type { getSupabaseAdmin } from "./supabase-admin.js";

/** reserve RPC の p_integrity_context と lookup 復元で共有する snake_case 形 */
export type IntegrityContextPayload = {
  kind: GenerationIntegrityContextV2["kind"];
  target_mode: "household" | "idea";
  servings: number | null;
  target_member_ids: string[];
  source_menu_version: number | null;
};

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

const uuidSchema = z.uuid();

// draft / menu から解決した対象家族を mode 別に閉じる（NULL・重複・件数を fail-closed）
function parseHouseholdMemberIds(raw: readonly string[]): readonly [string, ...string[]] {
  if (raw.length < 1 || raw.length > 20) {
    throw new HttpError(422, "invalid_request", "対象の家族人数が不正です。");
  }
  const unique = new Set(raw);
  if (unique.size !== raw.length) {
    throw new HttpError(422, "invalid_request", "対象の家族が重複しています。");
  }
  for (const id of raw) {
    if (!uuidSchema.safeParse(id).success) {
      throw new HttpError(422, "invalid_request", "対象の家族IDが不正です。");
    }
  }
  return raw as [string, ...string[]];
}

function parseIdeaMemberIds(raw: readonly string[]): readonly [] {
  if (raw.length !== 0) {
    throw new HttpError(422, "invalid_request", "アイデアモードでは対象家族を指定できません。");
  }
  return [];
}

const draftRowSchema = z
  .object({
    target_mode: z.enum(["household", "idea"]),
    servings: z.number().int().min(1).max(20).nullable(),
    target_member_ids: z.array(z.uuid()),
  })
  .strict();

const menuRowSchema = z
  .object({
    id: z.uuid(),
    target_mode: z.enum(["household", "idea"]),
    servings: z.number().int().min(1).max(20),
    version: z.number().int().positive(),
  })
  .strict();

/**
 * 権威ある draft revision または source menu から整合性コンテキストを解決する。
 * クライアントの mode / servings / memberIds / source version は信頼しない。
 * lookup hit 経路では呼ばない（live draft/menu を読まない）。
 */
export async function resolveGenerationIntegrityContext(
  admin: AdminClient,
  userId: string,
  command: GenerationCommandV2,
): Promise<GenerationIntegrityContextV2> {
  if (command.kind === "new_menu") {
    // draftId + draftRevision + owner で凍結候補を読む（削除済みは不可）
    const { data, error } = await admin
      .from("generation_drafts")
      .select("target_mode, servings, target_member_ids")
      .eq("id", command.request.draftId)
      .eq("user_id", userId)
      .eq("revision", command.request.draftRevision)
      .is("deleted_at", null)
      .maybeSingle();
    if (error !== null) {
      throw new HttpError(500, "internal_error", "献立条件を確認できませんでした。");
    }
    if (data === null) {
      throw new HttpError(404, "draft_not_found", "保存した献立条件が見つかりませんでした。");
    }
    const draft = draftRowSchema.safeParse(data);
    if (!draft.success) {
      throw new HttpError(422, "invalid_request", "献立条件が不完全です。");
    }
    if (draft.data.target_mode === "household") {
      if (draft.data.servings !== null) {
        throw new HttpError(422, "invalid_request", "家族モードでは人数を指定できません。");
      }
      return {
        kind: "new_menu",
        targetMode: "household",
        servings: null,
        targetMemberIds: parseHouseholdMemberIds(draft.data.target_member_ids),
        sourceMenuVersion: null,
      };
    }
    if (draft.data.servings === null) {
      throw new HttpError(422, "invalid_request", "アイデアモードでは人数が必要です。");
    }
    return {
      kind: "new_menu",
      targetMode: "idea",
      servings: draft.data.servings,
      targetMemberIds: parseIdeaMemberIds(draft.data.target_member_ids),
      sourceMenuVersion: null,
    };
  }

  // 再生成: sourceMenuId + owner と対象 dish を取得し、menu の保存済み値を正本にする
  const { data: menuData, error: menuError } = await admin
    .from("menus")
    .select("id, target_mode, servings, version")
    .eq("id", command.request.sourceMenuId)
    .eq("user_id", userId)
    .maybeSingle();
  if (menuError !== null) {
    throw new HttpError(500, "internal_error", "元の献立を確認できませんでした。");
  }
  if (menuData === null) {
    throw new HttpError(404, "source_menu_not_found", "元の献立が見つかりません");
  }
  const menu = menuRowSchema.safeParse(menuData);
  if (!menu.success) {
    throw new HttpError(422, "invalid_request", "元の献立データが不正です。");
  }

  if (command.kind === "regenerate_dish") {
    const { data: dishData, error: dishError } = await admin
      .from("dishes")
      .select("id")
      .eq("id", command.request.dishId)
      .eq("menu_id", command.request.sourceMenuId)
      .eq("user_id", userId)
      .maybeSingle();
    if (dishError !== null) {
      throw new HttpError(500, "internal_error", "変更する料理を確認できませんでした。");
    }
    if (dishData === null) {
      throw new HttpError(404, "replace_dish_not_found", "変更する料理が見つかりません");
    }
  }

  const { data: memberRows, error: memberError } = await admin
    .from("menu_target_members")
    .select("household_member_id")
    .eq("menu_id", command.request.sourceMenuId)
    .eq("user_id", userId);
  if (memberError !== null) {
    throw new HttpError(500, "internal_error", "対象家族を確認できませんでした。");
  }
  const memberIds = memberRows.map((row) => {
    const id = z.object({ household_member_id: z.uuid() }).parse(row).household_member_id;
    return id;
  });

  const kind = command.kind;
  if (menu.data.target_mode === "household") {
    return {
      kind,
      targetMode: "household",
      servings: menu.data.servings,
      targetMemberIds: parseHouseholdMemberIds(memberIds),
      sourceMenuVersion: menu.data.version,
    };
  }
  return {
    kind,
    targetMode: "idea",
    servings: menu.data.servings,
    targetMemberIds: parseIdeaMemberIds(memberIds),
    sourceMenuVersion: menu.data.version,
  };
}

/** lookup RPC の integrity ペイロードを閉じた union へ復元する */
export function parseIntegrityContextPayload(value: unknown): GenerationIntegrityContextV2 {
  const base = z
    .object({
      kind: z.enum(["new_menu", "regenerate_menu", "regenerate_dish"]),
      target_mode: z.enum(["household", "idea"]),
      servings: z.number().int().min(1).max(20).nullable(),
      target_member_ids: z.array(z.uuid()),
      source_menu_version: z.number().int().positive().nullable(),
    })
    .strict()
    .parse(value);

  if (base.kind === "new_menu") {
    if (base.source_menu_version !== null) {
      throw new HttpError(500, "internal_error", "生成の受付状態が不正です。");
    }
    if (base.target_mode === "household") {
      if (base.servings !== null) {
        throw new HttpError(500, "internal_error", "生成の受付状態が不正です。");
      }
      return {
        kind: "new_menu",
        targetMode: "household",
        servings: null,
        targetMemberIds: parseHouseholdMemberIds(base.target_member_ids),
        sourceMenuVersion: null,
      };
    }
    if (base.servings === null) {
      throw new HttpError(500, "internal_error", "生成の受付状態が不正です。");
    }
    return {
      kind: "new_menu",
      targetMode: "idea",
      servings: base.servings,
      targetMemberIds: parseIdeaMemberIds(base.target_member_ids),
      sourceMenuVersion: null,
    };
  }

  if (base.servings === null || base.source_menu_version === null) {
    throw new HttpError(500, "internal_error", "生成の受付状態が不正です。");
  }
  if (base.target_mode === "household") {
    return {
      kind: base.kind,
      targetMode: "household",
      servings: base.servings,
      targetMemberIds: parseHouseholdMemberIds(base.target_member_ids),
      sourceMenuVersion: base.source_menu_version,
    };
  }
  return {
    kind: base.kind,
    targetMode: "idea",
    servings: base.servings,
    targetMemberIds: parseIdeaMemberIds(base.target_member_ids),
    sourceMenuVersion: base.source_menu_version,
  };
}

/** reserve RPC へ渡す integrity_context jsonb（snake_case） */
export function toIntegrityContextPayload(
  integrity: GenerationIntegrityContextV2,
): IntegrityContextPayload {
  return {
    kind: integrity.kind,
    target_mode: integrity.targetMode,
    servings: integrity.servings,
    target_member_ids: [...integrity.targetMemberIds],
    source_menu_version: integrity.sourceMenuVersion,
  };
}
