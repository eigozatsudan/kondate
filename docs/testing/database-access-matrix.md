# Database access matrix (Plan 7 schema)

Source of truth for `supabase/tests/database/rls_inventory.test.sql`.
Rows are derived from migrations after Plan 7 (including guided planner / optional household).

Columns: `object`, `owner`, `anon`, `authenticated`, `service_role`, `RLS/policy`, `reason`.

## Tables

| object | owner | anon | authenticated | service_role | RLS/policy | reason |
| --- | --- | --- | --- | --- | --- | --- |
| `private.ai_generation_requests` | postgres | none | none | none | off (not exposed) | private ledger; no Data API; service via SECURITY DEFINER only |
| `private.ai_global_daily_usage` | postgres | none | none | none | off (not exposed) | private ledger; no Data API; service via SECURITY DEFINER only |
| `private.ai_user_daily_external_attempts` | postgres | none | none | none | off (not exposed) | private ledger; no Data API; service via SECURITY DEFINER only |
| `private.ai_user_daily_usage` | postgres | none | none | none | off (not exposed) | private ledger; no Data API; service via SECURITY DEFINER only |
| `private.ai_user_rate_windows` | postgres | none | none | none | off (not exposed) | private ledger; no Data API; service via SECURITY DEFINER only |
| `private.auth_continuations` | postgres | none | none | none | off (not exposed) | private ledger; no Data API; service via SECURITY DEFINER only |
| `private.generation_draft_submission_versions` | postgres | none | none | none | off (not exposed) | private ledger; no Data API; service via SECURITY DEFINER only |
| `private.generation_regeneration_snapshots` | postgres | none | none | none | off (not exposed) | private ledger; no Data API; service via SECURITY DEFINER only |
| `private.shopping_mutations` | postgres | none | none | none | off (not exposed) | private ledger; no Data API; service via SECURITY DEFINER only |
| `public.allergen_aliases` | postgres | none | SELECT | ALL | on + policies | shared safety catalog; authenticated SELECT only |
| `public.allergen_catalog` | postgres | none | SELECT | ALL | on + policies | shared safety catalog; authenticated SELECT only |
| `public.dish_ingredients` | postgres | none | SELECT | ALL | on + policies | AI/derived rows; browser SELECT only; writes via service SECURITY DEFINER |
| `public.dishes` | postgres | none | SELECT | ALL | on + policies | AI/derived rows; browser SELECT only; writes via service SECURITY DEFINER |
| `public.food_safety_rules` | postgres | none | SELECT | ALL | on + policies | shared safety catalog; authenticated SELECT only |
| `public.generation_drafts` | postgres | none | SELECT | ALL | on + policies | owner SELECT; mutate via save/delete RPC |
| `public.generation_pantry_selections` | postgres | none | SELECT | ALL | on + policies | draft child; owner SELECT |
| `public.household_members` | postgres | none | DELETE, INSERT, SELECT, UPDATE | ALL | on + policies | user-owned browser CRUD via RLS |
| `public.member_allergies` | postgres | none | INSERT, SELECT | ALL | on + policies | owner SELECT+INSERT; delete via RPC |
| `public.member_dislikes` | postgres | none | DELETE, INSERT, SELECT, UPDATE | ALL | on + policies | user-owned browser CRUD via RLS |
| `public.menu_label_confirmations` | postgres | none | SELECT | ALL | on + policies | owner SELECT; confirm via RPC |
| `public.menu_member_adaptations` | postgres | none | SELECT | ALL | on + policies | AI/derived rows; browser SELECT only; writes via service SECURITY DEFINER |
| `public.menu_revalidations` | postgres | none | SELECT | ALL | on + policies | AI/derived rows; browser SELECT only; writes via service SECURITY DEFINER |
| `public.menu_safety_actions` | postgres | none | SELECT | ALL | on + policies | AI/derived rows; browser SELECT only; writes via service SECURITY DEFINER |
| `public.menu_target_members` | postgres | none | SELECT | ALL | on + policies | AI/derived rows; browser SELECT only; writes via service SECURITY DEFINER |
| `public.menu_timeline_steps` | postgres | none | SELECT | ALL | on + policies | AI/derived rows; browser SELECT only; writes via service SECURITY DEFINER |
| `public.menus` | postgres | none | SELECT | ALL | on + policies | owner SELECT; favorite column UPDATE only |
| `public.pantry_items` | postgres | none | DELETE, INSERT, SELECT, UPDATE | ALL | on + policies | user-owned browser CRUD via RLS |
| `public.privacy_consents` | postgres | none | INSERT, SELECT | ALL | on + policies | consent ledger; owner SELECT+INSERT |
| `public.profiles` | postgres | none | SELECT | ALL | on + policies | auth profile; owner SELECT; writes via trigger/RPC |
| `public.recipe_steps` | postgres | none | SELECT | ALL | on + policies | AI/derived rows; browser SELECT only; writes via service SECURITY DEFINER |
| `public.shopping_current_label_warnings` | postgres | none | SELECT | ALL | on + policies | AI/derived rows; browser SELECT only; writes via service SECURITY DEFINER |
| `public.shopping_item_sources` | postgres | none | SELECT | ALL | on + policies | AI/derived rows; browser SELECT only; writes via service SECURITY DEFINER |
| `public.shopping_items` | postgres | none | SELECT | ALL | on + policies | owner SELECT; mutate via RPC |
| `public.shopping_label_confirmations` | postgres | none | SELECT | ALL | on + policies | AI/derived rows; browser SELECT only; writes via service SECURITY DEFINER |
| `public.shopping_list_sources` | postgres | none | SELECT | ALL | on + policies | AI/derived rows; browser SELECT only; writes via service SECURITY DEFINER |
| `public.shopping_lists` | postgres | none | SELECT | ALL | on + policies | AI/derived rows; browser SELECT only; writes via service SECURITY DEFINER |

## Column write grants (browser roles)

SELECT column grants follow table-level SELECT. Only INSERT/UPDATE/DELETE column privileges are inventoried.

| object | column | authenticated | reason |
| --- | --- | --- | --- |
| `public.household_members` | `age_band` | INSERT | mirrors table/column GRANT |
| `public.household_members` | `age_band` | UPDATE | mirrors table/column GRANT |
| `public.household_members` | `allergy_status` | INSERT | mirrors table/column GRANT |
| `public.household_members` | `allergy_status` | UPDATE | mirrors table/column GRANT |
| `public.household_members` | `created_at` | INSERT | mirrors table/column GRANT |
| `public.household_members` | `created_at` | UPDATE | mirrors table/column GRANT |
| `public.household_members` | `display_name` | INSERT | mirrors table/column GRANT |
| `public.household_members` | `display_name` | UPDATE | mirrors table/column GRANT |
| `public.household_members` | `ease_preferences` | INSERT | mirrors table/column GRANT |
| `public.household_members` | `ease_preferences` | UPDATE | mirrors table/column GRANT |
| `public.household_members` | `id` | INSERT | mirrors table/column GRANT |
| `public.household_members` | `id` | UPDATE | mirrors table/column GRANT |
| `public.household_members` | `portion_size` | INSERT | mirrors table/column GRANT |
| `public.household_members` | `portion_size` | UPDATE | mirrors table/column GRANT |
| `public.household_members` | `required_safety_constraints` | INSERT | mirrors table/column GRANT |
| `public.household_members` | `required_safety_constraints` | UPDATE | mirrors table/column GRANT |
| `public.household_members` | `sort_order` | INSERT | mirrors table/column GRANT |
| `public.household_members` | `sort_order` | UPDATE | mirrors table/column GRANT |
| `public.household_members` | `spice_level` | INSERT | mirrors table/column GRANT |
| `public.household_members` | `spice_level` | UPDATE | mirrors table/column GRANT |
| `public.household_members` | `status` | INSERT | mirrors table/column GRANT |
| `public.household_members` | `status` | UPDATE | mirrors table/column GRANT |
| `public.household_members` | `unsupported_diet_kinds` | INSERT | mirrors table/column GRANT |
| `public.household_members` | `unsupported_diet_kinds` | UPDATE | mirrors table/column GRANT |
| `public.household_members` | `unsupported_diet_status` | INSERT | mirrors table/column GRANT |
| `public.household_members` | `unsupported_diet_status` | UPDATE | mirrors table/column GRANT |
| `public.household_members` | `updated_at` | INSERT | mirrors table/column GRANT |
| `public.household_members` | `updated_at` | UPDATE | mirrors table/column GRANT |
| `public.household_members` | `user_id` | INSERT | mirrors table/column GRANT |
| `public.household_members` | `user_id` | UPDATE | mirrors table/column GRANT |
| `public.member_allergies` | `allergen_id` | INSERT | mirrors table/column GRANT |
| `public.member_allergies` | `created_at` | INSERT | mirrors table/column GRANT |
| `public.member_allergies` | `custom_aliases` | INSERT | mirrors table/column GRANT |
| `public.member_allergies` | `custom_confirmed` | INSERT | mirrors table/column GRANT |
| `public.member_allergies` | `custom_name` | INSERT | mirrors table/column GRANT |
| `public.member_allergies` | `id` | INSERT | mirrors table/column GRANT |
| `public.member_allergies` | `member_id` | INSERT | mirrors table/column GRANT |
| `public.member_allergies` | `user_id` | INSERT | mirrors table/column GRANT |
| `public.member_dislikes` | `created_at` | INSERT | mirrors table/column GRANT |
| `public.member_dislikes` | `created_at` | UPDATE | mirrors table/column GRANT |
| `public.member_dislikes` | `id` | INSERT | mirrors table/column GRANT |
| `public.member_dislikes` | `id` | UPDATE | mirrors table/column GRANT |
| `public.member_dislikes` | `ingredient_name` | INSERT | mirrors table/column GRANT |
| `public.member_dislikes` | `ingredient_name` | UPDATE | mirrors table/column GRANT |
| `public.member_dislikes` | `member_id` | INSERT | mirrors table/column GRANT |
| `public.member_dislikes` | `member_id` | UPDATE | mirrors table/column GRANT |
| `public.member_dislikes` | `user_id` | INSERT | mirrors table/column GRANT |
| `public.member_dislikes` | `user_id` | UPDATE | mirrors table/column GRANT |
| `public.menus` | `is_favorite` | UPDATE | mirrors table/column GRANT |
| `public.pantry_items` | `created_at` | INSERT | mirrors table/column GRANT |
| `public.pantry_items` | `created_at` | UPDATE | mirrors table/column GRANT |
| `public.pantry_items` | `expiration_type` | INSERT | mirrors table/column GRANT |
| `public.pantry_items` | `expiration_type` | UPDATE | mirrors table/column GRANT |
| `public.pantry_items` | `expires_on` | INSERT | mirrors table/column GRANT |
| `public.pantry_items` | `expires_on` | UPDATE | mirrors table/column GRANT |
| `public.pantry_items` | `id` | INSERT | mirrors table/column GRANT |
| `public.pantry_items` | `id` | UPDATE | mirrors table/column GRANT |
| `public.pantry_items` | `name` | INSERT | mirrors table/column GRANT |
| `public.pantry_items` | `name` | UPDATE | mirrors table/column GRANT |
| `public.pantry_items` | `opened_state` | INSERT | mirrors table/column GRANT |
| `public.pantry_items` | `opened_state` | UPDATE | mirrors table/column GRANT |
| `public.pantry_items` | `quantity` | INSERT | mirrors table/column GRANT |
| `public.pantry_items` | `quantity` | UPDATE | mirrors table/column GRANT |
| `public.pantry_items` | `unit` | INSERT | mirrors table/column GRANT |
| `public.pantry_items` | `unit` | UPDATE | mirrors table/column GRANT |
| `public.pantry_items` | `updated_at` | INSERT | mirrors table/column GRANT |
| `public.pantry_items` | `updated_at` | UPDATE | mirrors table/column GRANT |
| `public.pantry_items` | `user_id` | INSERT | mirrors table/column GRANT |
| `public.pantry_items` | `user_id` | UPDATE | mirrors table/column GRANT |
| `public.privacy_consents` | `accepted_at` | INSERT | mirrors table/column GRANT |
| `public.privacy_consents` | `created_at` | INSERT | mirrors table/column GRANT |
| `public.privacy_consents` | `notice_version` | INSERT | mirrors table/column GRANT |
| `public.privacy_consents` | `user_id` | INSERT | mirrors table/column GRANT |

## Routines (EXECUTE)

| object | owner | anon | authenticated | service_role | RLS/policy | reason |
| --- | --- | --- | --- | --- | --- | --- |
| `private.ai_conflict_codes_valid(p_codes text[])` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.ai_generation_terminal_details_valid(p_status text, p_terminal_details jsonb)` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.ai_jst_day(p_now timestamp with time zone)` | postgres | EXECUTE | EXECUTE | EXECUTE | n/a | trigger/helper; default PUBLIC EXECUTE retained |
| `private.ai_next_jst_midnight(p_now timestamp with time zone)` | postgres | EXECUTE | EXECUTE | EXECUTE | n/a | trigger/helper; default PUBLIC EXECUTE retained |
| `private.ai_request_payload(p_request private.ai_generation_requests, p_replayed boolean)` | postgres | EXECUTE | EXECUTE | EXECUTE | n/a | trigger/helper; default PUBLIC EXECUTE retained |
| `private.assert_menu_label_source_owner()` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.assign_regeneration_lineage(p_user_id uuid, p_source_menu_id uuid, p_completed_menu_id uuid, p_change_reason text, p_change_reason_custom text)` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.cleanup_expired_shopping_mutations(p_user_id uuid, p_limit integer)` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE; request-path per-user 30-day cleaner (coexists with account-wide `private.cleanup_shopping_mutations`) |
| `private.cleanup_shopping_mutations(p_before timestamp with time zone, p_limit integer)` | postgres | none | none | none | n/a | private helper; scheduled account-wide 30-day shopping mutation sweep; executor has no direct EXECUTE |
| `private.current_safety_fingerprint(p_user_id uuid, p_target_member_ids uuid[])` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.enforce_registered_member_allergy()` | postgres | EXECUTE | EXECUTE | EXECUTE | n/a | trigger/helper; default PUBLIC EXECUTE retained |
| `private.enforce_shopping_item_provenance()` | postgres | EXECUTE | EXECUTE | EXECUTE | n/a | trigger/helper; default PUBLIC EXECUTE retained |
| `private.handle_new_auth_user()` | postgres | EXECUTE | EXECUTE | EXECUTE | n/a | trigger/helper; default PUBLIC EXECUTE retained |
| `private.idea_safety_fingerprint()` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.is_canonical_bounded_text(p_value text, p_min_length integer, p_max_length integer)` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.is_valid_draft_pantry_selections(p_value jsonb)` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.is_valid_draft_text_array(p_value text[], p_max_count integer, p_max_length integer)` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.is_valid_draft_uuid_array(p_value uuid[], p_max_count integer)` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.is_valid_generation_integrity_context(p_context jsonb, p_request_kind text)` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.is_valid_generation_target_member_ids(p_value uuid[], p_target_mode text)` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.is_valid_submission_target_member_ids(p_value uuid[], p_target_mode text)` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.lock_and_assert_current_safety_fingerprint(p_user_id uuid, p_target_member_ids uuid[], p_expected text)` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.lock_and_assert_selected_pantry_rows(p_user_id uuid, p_pantry_usage jsonb)` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.lock_and_check_shopping_list_safety(p_user_id uuid, p_list_id uuid, p_expected text)` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.lock_and_check_shopping_safety(p_user_id uuid, p_menu_id uuid, p_expected text)` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.normalize_allergen_term(p_value text)` | postgres | EXECUTE | EXECUTE | EXECUTE | n/a | trigger/helper; default PUBLIC EXECUTE retained |
| `private.normalize_member_allergy()` | postgres | EXECUTE | EXECUTE | EXECUTE | n/a | trigger/helper; default PUBLIC EXECUTE retained |
| `private.persist_validated_menu(p_request private.ai_generation_requests, p_menu jsonb, p_preference_snapshot jsonb, p_safety_snapshot jsonb, p_safety_fingerprint text, p_allergen_version text, p_food_rule_version text, p_target_mode text, p_target_members jsonb, p_expired_checks jsonb)` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.prevent_last_registered_member_allergy_removal()` | postgres | EXECUTE | EXECUTE | EXECUTE | n/a | trigger/helper; default PUBLIC EXECUTE retained |
| `private.reject_generation_regeneration_snapshot_update()` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.set_updated_at()` | postgres | EXECUTE | EXECUTE | EXECUTE | n/a | trigger/helper; default PUBLIC EXECUTE retained |
| `private.soft_delete_generation_draft(p_user_id uuid, p_draft_id uuid, p_expected_revision bigint)` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.touch_updated_at()` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `private.write_shopping_items(p_user_id uuid, p_list_id uuid, p_items jsonb)` | postgres | none | none | none | n/a | private helper; no browser-role EXECUTE |
| `public.accept_menu_version(p_menu_id uuid)` | postgres | none | EXECUTE | EXECUTE | n/a (function) | browser-callable SECURITY DEFINER RPC |
| `public.add_custom_member_allergy(p_member_id uuid, p_custom_name text, p_custom_aliases text[])` | postgres | none | EXECUTE | EXECUTE | n/a (function) | browser-callable SECURITY DEFINER RPC |
| `public.apply_shopping_draft(p_user_id uuid, p_menu_id uuid, p_mode text, p_active_list_id uuid, p_expected_list_version integer, p_safety_fingerprint text, p_idempotency_key uuid, p_request_hash text, p_draft jsonb)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.apply_shopping_reconciliation(p_user_id uuid, p_list_id uuid, p_expected_list_version integer, p_source_menu_id uuid, p_source_menu_version integer, p_safety_fingerprint text, p_idempotency_key uuid, p_request_hash text, p_resolved_diff jsonb)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.claim_auth_continuation(p_id uuid, p_state_hash bytea, p_secret_hash bytea, p_origin text, p_now timestamp with time zone)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.cleanup_ai_generation_requests(p_before timestamp with time zone, p_user_id uuid)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC; legacy opportunistic cleaner (no integer overload) |
| `public.cleanup_ai_generation_requests_batch(p_before timestamp with time zone, p_limit integer)` | postgres | none | none | none | n/a (function) | scheduled batch helper; no browser/service EXECUTE; called only via `run_kondate_maintenance` |
| `public.cleanup_auth_continuations(p_now timestamp with time zone)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC; expire-only, limit 100 |
| `public.cleanup_auth_continuations_batch(p_now timestamp with time zone, p_limit integer)` | postgres | none | none | none | n/a (function) | scheduled batch helper; expire-only with SKIP LOCKED; no browser/service EXECUTE |
| `public.cleanup_stale_ai_generations(p_now timestamp with time zone)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC; delegates to batch with fixed limit |
| `public.cleanup_stale_ai_generations_batch(p_now timestamp with time zone, p_limit integer)` | postgres | none | none | none | n/a (function) | scheduled batch helper; no browser/service EXECUTE |
| `public.run_kondate_maintenance(p_now timestamp with time zone, p_limit integer)` | postgres | none | none | none | n/a (function) | EXECUTE only for `kondate_maintenance_executor` (NOLOGIN); revoked from PUBLIC/anon/authenticated/service_role |
| `public.complete_household_member(p_member_id uuid)` | postgres | none | EXECUTE | EXECUTE | n/a (function) | browser-callable SECURITY DEFINER RPC |
| `public.confirm_menu_label_confirmation(p_menu_id uuid, p_confirmation_id uuid, p_expected_safety_fingerprint text)` | postgres | none | EXECUTE | none | n/a (function) | authenticated-only SECURITY DEFINER RPC |
| `public.create_auth_continuation(p_state_hash bytea, p_secret_hash bytea, p_origin text, p_return_to text, p_now timestamp with time zone, p_ttl_seconds integer)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.delete_generation_draft(p_expected_revision bigint)` | postgres | none | EXECUTE | none | n/a (function) | authenticated-only SECURITY DEFINER RPC |
| `public.delete_member_allergy(p_allergy_id uuid)` | postgres | none | EXECUTE | EXECUTE | n/a (function) | browser-callable SECURITY DEFINER RPC |
| `public.delete_menu_group(p_derivation_group_id uuid)` | postgres | none | EXECUTE | EXECUTE | n/a (function) | browser-callable SECURITY DEFINER RPC |
| `public.deposit_auth_continuation(p_id uuid, p_state_hash bytea, p_origin text, p_ciphertext bytea, p_iv bytea, p_now timestamp with time zone)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.finalize_ai_generation_conflict(p_request_id uuid, p_conflict_codes text[], p_now timestamp with time zone)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.finalize_ai_generation_failure(p_request_id uuid, p_failure_code text, p_retry_at timestamp with time zone, p_now timestamp with time zone)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.finalize_ai_generation_success(p_request_id uuid, p_menu jsonb, p_preference_snapshot jsonb, p_safety_snapshot jsonb, p_safety_fingerprint text, p_allergen_version text, p_food_rule_version text, p_target_members jsonb, p_expired_checks jsonb, p_source_menu_id uuid, p_change_reason text, p_change_reason_custom text, p_now timestamp with time zone)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.get_ai_generation_regeneration_snapshot(p_request_id uuid, p_user_id uuid)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.get_ai_generation_status(p_user_id uuid, p_idempotency_key uuid, p_user_limit integer, p_now timestamp with time zone)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.get_ai_generation_submission_snapshot(p_request_id uuid, p_user_id uuid)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.get_ai_usage_today(p_user_id uuid, p_now timestamp with time zone)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.get_current_safety_snapshot(p_user_id uuid, p_target_member_ids uuid[])` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.get_shopping_mutation_replay(p_user_id uuid, p_idempotency_key uuid, p_request_hash text)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.lookup_ai_generation_request(p_user_id uuid, p_idempotency_key uuid)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.mark_ai_global_sent(p_request_id uuid, p_now timestamp with time zone)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.mutate_shopping_item(p_list_id uuid, p_expected_list_version integer, p_expected_safety_fingerprint text, p_operation text, p_item_id uuid, p_idempotency_key uuid, p_payload jsonb)` | postgres | none | EXECUTE | EXECUTE | n/a (function) | browser-callable SECURITY DEFINER RPC |
| `public.reconcile_menu_label_confirmations(p_user_id uuid, p_menu_id uuid, p_expected_safety_fingerprint text, p_requirements jsonb)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.record_ai_generation_model(p_request_id uuid, p_model_id text, p_now timestamp with time zone)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.refresh_shopping_list_safety(p_user_id uuid, p_list_id uuid, p_expected_fingerprint text, p_warnings jsonb)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.reserve_ai_generation(p_user_id uuid, p_idempotency_key uuid, p_request_kind text, p_draft_id uuid, p_draft_revision bigint, p_source_menu_id uuid, p_replace_dish_id uuid, p_change_reason text, p_request_hmac_version text, p_request_hmac text, p_integrity_context jsonb, p_user_limit integer, p_global_limit integer, p_stale_after_seconds integer, p_now timestamp with time zone)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.reserve_ai_repair_call(p_request_id uuid, p_global_limit integer, p_now timestamp with time zone)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.save_generation_draft(p_expected_revision bigint, p_meal_type text, p_main_ingredients text[], p_cuisine_genre text, p_target_mode text, p_target_member_ids uuid[], p_servings smallint, p_time_limit_minutes smallint, p_budget_preference text, p_avoid_ingredients text[], p_memo text, p_pantry_selections jsonb)` | postgres | none | EXECUTE | none | n/a (function) | authenticated-only SECURITY DEFINER RPC |
| `public.set_onboarding_status(p_status text)` | postgres | none | EXECUTE | EXECUTE | n/a (function) | browser-callable SECURITY DEFINER RPC |
| `public.shopping_list_safety_fingerprint(p_user_id uuid, p_list_id uuid)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.shopping_safety_fingerprint(p_user_id uuid, p_menu_id uuid)` | postgres | none | none | EXECUTE | n/a (function) | service_role-only SECURITY DEFINER RPC |
| `public.start_household_onboarding(p_sort_order integer)` | postgres | none | EXECUTE | EXECUTE | n/a (function) | browser-callable SECURITY DEFINER RPC |

## Policies

| object | policy | command |
| --- | --- | --- |
| `public.allergen_aliases` | `allergen_aliases_authenticated_read` | SELECT |
| `public.allergen_catalog` | `allergen_catalog_authenticated_read` | SELECT |
| `public.dish_ingredients` | `dish_ingredients_owner_select` | SELECT |
| `public.dishes` | `dishes_owner_select` | SELECT |
| `public.food_safety_rules` | `food_safety_rules_authenticated_read` | SELECT |
| `public.generation_drafts` | `generation_drafts_owner_select` | SELECT |
| `public.generation_pantry_selections` | `generation_pantry_selections_owner_select` | SELECT |
| `public.household_members` | `members_delete_own` | DELETE |
| `public.household_members` | `members_insert_own` | INSERT |
| `public.household_members` | `members_select_own` | SELECT |
| `public.household_members` | `members_update_own` | UPDATE |
| `public.member_allergies` | `allergies_insert_own` | INSERT |
| `public.member_allergies` | `allergies_select_own` | SELECT |
| `public.member_dislikes` | `dislikes_delete_own` | DELETE |
| `public.member_dislikes` | `dislikes_insert_own` | INSERT |
| `public.member_dislikes` | `dislikes_select_own` | SELECT |
| `public.member_dislikes` | `dislikes_update_own` | UPDATE |
| `public.menu_label_confirmations` | `menu_label_confirmations_owner_select` | SELECT |
| `public.menu_member_adaptations` | `menu_member_adaptations_owner_select` | SELECT |
| `public.menu_revalidations` | `menu_revalidations_select_own` | SELECT |
| `public.menu_safety_actions` | `menu_safety_actions_owner_select` | SELECT |
| `public.menu_target_members` | `menu_target_members_owner_select` | SELECT |
| `public.menu_timeline_steps` | `menu_timeline_steps_owner_select` | SELECT |
| `public.menus` | `menus_owner_select` | SELECT |
| `public.menus` | `menus_owner_update_favorite` | UPDATE |
| `public.pantry_items` | `pantry_items_owner_delete` | DELETE |
| `public.pantry_items` | `pantry_items_owner_insert` | INSERT |
| `public.pantry_items` | `pantry_items_owner_select` | SELECT |
| `public.pantry_items` | `pantry_items_owner_update` | UPDATE |
| `public.privacy_consents` | `consents_insert_own` | INSERT |
| `public.privacy_consents` | `consents_select_own` | SELECT |
| `public.profiles` | `profiles_select_own` | SELECT |
| `public.recipe_steps` | `recipe_steps_owner_select` | SELECT |
| `public.shopping_current_label_warnings` | `shopping_current_labels_select_own` | SELECT |
| `public.shopping_item_sources` | `shopping_item_sources_select_own` | SELECT |
| `public.shopping_items` | `shopping_items_select_own` | SELECT |
| `public.shopping_label_confirmations` | `shopping_labels_select_own` | SELECT |
| `public.shopping_list_sources` | `shopping_list_sources_select_own` | SELECT |
| `public.shopping_lists` | `shopping_lists_select_own` | SELECT |

## Notes

- `anon` has **no** table grants on `public` or `private`.
- Private ledgers have **no** table grants to `anon`/`authenticated`/`service_role`; Functions reach them only through SECURITY DEFINER RPCs.
- Plan 7 objects of special interest: `private.generation_regeneration_snapshots` (service-only ledger), `private.idea_safety_fingerprint()`, `private.is_valid_generation_target_member_ids(...)` (no browser EXECUTE), and current signatures of `save_generation_draft`, `reserve_ai_generation`, `get_ai_generation_submission_snapshot`, `finalize_ai_generation_success`, `apply_shopping_draft`, `apply_shopping_reconciliation`, `set_onboarding_status`.
- Symmetric pgTAP comparisons live in `rls_inventory.test.sql` (`plan(8)`).

