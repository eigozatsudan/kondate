-- service_role に public 表の Data API 権限を明示付与する。
--
-- 背景:
-- ローカル Compose は default privileges で CREATE TABLE 時に service_role へ ALL が付く。
-- 本番 managed で "Automatically expose new tables" をオフにすると、その既定が効かず、
-- 既存 migration は anon/authenticated だけ revoke/grant して service_role を触らないため
-- Functions の admin クライアント（service_role）が PostgREST 経由で
-- public.generation_drafts 等を読めず 42501 permission denied になる。
--
-- 正本: docs/testing/database-access-matrix.md（public 表は service_role = ALL）。
-- private 表は Data API 非公開のまま（SECURITY DEFINER RPC のみ）。service_role への
-- table grant は付けない。

grant all on table
  public.allergen_aliases,
  public.allergen_catalog,
  public.dish_ingredients,
  public.dishes,
  public.food_safety_rules,
  public.generation_drafts,
  public.generation_pantry_selections,
  public.household_members,
  public.member_allergies,
  public.member_dislikes,
  public.menu_label_confirmations,
  public.menu_member_adaptations,
  public.menu_revalidations,
  public.menu_safety_actions,
  public.menu_target_members,
  public.menu_timeline_steps,
  public.menus,
  public.pantry_items,
  public.privacy_consents,
  public.profiles,
  public.recipe_steps,
  public.shopping_current_label_warnings,
  public.shopping_item_sources,
  public.shopping_items,
  public.shopping_label_confirmations,
  public.shopping_list_sources,
  public.shopping_lists,
  public.user_feedback
to service_role;
