/**
 * 共有プール掲載時の metadata 算出（決定論・AI なし）。
 * - standardAllergenIds: 材料名をカタログ/alias と照合して保守的に付与
 * - eligibleAgeBands: テンプレが安全にカバーできる帯のみ（不明・不足は狭くする）
 *
 * 「計算不能」や「意図的に空 allergen で全通し」は禁止。
 * 材料からアレルゲン候補が1つも取れない一般食材のみ [] を許可する。
 */

import { ageBands, type AgeBand } from "../contracts/domain.js";
import type { ValidatedMenu } from "../contracts/generation.js";
import { foodTextContainsAlias, normalizeFoodText } from "../safety/allergens.js";

/** 掲載時照合に必要な最小カタログ形（Functions は full alias を渡す） */
export type SharePublishAllergenCatalog = {
  catalog: readonly {
    id: string;
    displayName: string;
  }[];
  aliases?: readonly {
    allergenId: string;
    alias: string;
    normalizedAlias: string;
  }[];
};

export type SharePublishMetadata = {
  standardAllergenIds: string[];
  eligibleAgeBands: AgeBand[];
};

/**
 * 材料名から standardAllergenIds を保守的に収集する。
 * displayName exact（normalize 後）と alias の foodTextContainsAlias ヒットを和集合にする。
 * 並びは catalog 出現順で安定させる。
 */
function collectStandardAllergenIds(
  menu: ValidatedMenu,
  allergenCatalog: SharePublishAllergenCatalog,
): string[] {
  const catalogIds = new Set(allergenCatalog.catalog.map((entry) => entry.id));
  const hits = new Set<string>();

  // displayName → id（exact normalize）
  const byNormalizedDisplay = new Map<string, string>();
  for (const entry of allergenCatalog.catalog) {
    const key = normalizeFoodText(entry.displayName);
    if (key !== "") {
      byNormalizedDisplay.set(key, entry.id);
    }
  }

  // alias は catalog に無い id を持ち込まない
  const aliases = (allergenCatalog.aliases ?? []).filter((alias) =>
    catalogIds.has(alias.allergenId),
  );

  for (const dish of menu.dishes) {
    for (const ingredient of dish.ingredients) {
      const name = ingredient.name;
      const normalizedName = normalizeFoodText(name);
      if (normalizedName === "") continue;

      const exact = byNormalizedDisplay.get(normalizedName);
      if (exact !== undefined) {
        hits.add(exact);
      }

      // 部分一致（contains）で alias ヒットを拾う。卵様・加工名の取りこぼしを fail-closed 側へ倒す
      for (const alias of aliases) {
        if (
          foodTextContainsAlias(name, alias.normalizedAlias) ||
          foodTextContainsAlias(name, alias.alias)
        ) {
          hits.add(alias.allergenId);
        }
      }

      // aliases 未指定時でも displayName の部分一致は保守的に付与
      if (aliases.length === 0) {
        for (const entry of allergenCatalog.catalog) {
          if (foodTextContainsAlias(name, entry.displayName)) {
            hits.add(entry.id);
          }
        }
      }
    }
  }

  // catalog 順で安定ソート（wire / 台帳の比較を決定論に保つ）
  return allergenCatalog.catalog.map((entry) => entry.id).filter((id) => hits.has(id));
}

/**
 * テンプレ adaptations の bound safetyActions から eligibleAgeBands を狭く決める。
 * under-six 既定（remove_bones + cut_small）が揃わない限り post_weaning_to_2 / age_3_5 を載せない。
 * 中立 portion のみ・safetyActions 空の共有形が under-six で全通ししないことを保証する。
 */
function computeEligibleAgeBands(menu: ValidatedMenu): AgeBand[] {
  const actionKinds = new Set(
    menu.adaptations.flatMap((adaptation) => adaptation.safetyActions.map((action) => action.kind)),
  );
  const hasCutSmall = actionKinds.has("cut_small");
  const hasRemoveBones = actionKinds.has("remove_bones");

  // 制約不足時は広くしない。成人帯は常に候補（構造適格は別ゲート）。
  const eligible = new Set<AgeBand>(["age_13_17", "adult", "senior"]);

  // 学童帯は remove_bones 既定。bound action が無いと除骨を担保できないため狭くする。
  if (hasRemoveBones) {
    eligible.add("age_6_8");
    eligible.add("age_9_12");
  }

  // 未就学は remove_bones + cut_small が揃ったときだけ
  if (hasRemoveBones && hasCutSmall) {
    eligible.add("post_weaning_to_2");
    eligible.add("age_3_5");
  }

  return ageBands.filter((band) => eligible.has(band));
}

/**
 * 共有 publish 用 metadata を算出する。
 * allergenCatalog は Functions 側の現行辞書（catalog + aliases）を渡す想定。
 */
export function computeSharePublishMetadata(
  menu: ValidatedMenu,
  allergenCatalog: SharePublishAllergenCatalog,
): SharePublishMetadata {
  return {
    standardAllergenIds: collectStandardAllergenIds(menu, allergenCatalog),
    eligibleAgeBands: computeEligibleAgeBands(menu),
  };
}
