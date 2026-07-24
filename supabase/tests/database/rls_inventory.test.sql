-- RLS / grant inventory after Plan 7.
-- plan(8) = 4 generic inventory assertions + 4 matrix symmetry assertions.
-- expected_* CTEs are generated from the live catalog after Plan 7 migrations
-- and documented in docs/testing/database-access-matrix.md.
\ir 000_helpers.sql
begin;
select plan(8);

-- (1) RLS enabled on every public user-owned table
select is_empty(
  $$
    select format('%I.%I', n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
  $$,
  'all public user-owned tables enable RLS'
);

-- (2) no private table grants to browser roles
select is_empty(
  $$
    select table_schema || '.' || table_name
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'private'
  $$,
  'browser roles have no private schema table grants'
);

-- (3) every public user-owned table has a policy
select is_empty(
  $$ select n.nspname||'.'||c.relname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attname='user_id' and not a.attisdropped
    where n.nspname='public' and c.relkind in('r','p')
      and not exists(select 1 from pg_policy p where p.polrelid=c.oid) $$,
  'every public user-owned table has an explicit policy'
);

-- (4) anon has no application table grant
select is_empty(
  $$ select table_schema||'.'||table_name||':'||privilege_type
    from information_schema.role_table_grants where grantee='anon'
      and table_schema in('public','private') $$,
  'anon has no application table grant'
);

-- (5) table grants: live vs expected (anon/authenticated on public/private) — both directions
select is_empty(
  $$
    with expected_table_grants(object, grantee, privilege) as (values
  ('public.allergen_aliases', 'authenticated', 'SELECT'),
  ('public.allergen_catalog', 'authenticated', 'SELECT'),
  ('public.dish_ingredients', 'authenticated', 'SELECT'),
  ('public.dishes', 'authenticated', 'SELECT'),
  ('public.food_safety_rules', 'authenticated', 'SELECT'),
  ('public.generation_drafts', 'authenticated', 'SELECT'),
  ('public.generation_pantry_selections', 'authenticated', 'SELECT'),
  ('public.household_members', 'authenticated', 'DELETE'),
  ('public.household_members', 'authenticated', 'INSERT'),
  ('public.household_members', 'authenticated', 'SELECT'),
  ('public.household_members', 'authenticated', 'UPDATE'),
  ('public.member_allergies', 'authenticated', 'INSERT'),
  ('public.member_allergies', 'authenticated', 'SELECT'),
  ('public.member_dislikes', 'authenticated', 'DELETE'),
  ('public.member_dislikes', 'authenticated', 'INSERT'),
  ('public.member_dislikes', 'authenticated', 'SELECT'),
  ('public.member_dislikes', 'authenticated', 'UPDATE'),
  ('public.menu_label_confirmations', 'authenticated', 'SELECT'),
  ('public.menu_member_adaptations', 'authenticated', 'SELECT'),
  ('public.menu_revalidations', 'authenticated', 'SELECT'),
  ('public.menu_safety_actions', 'authenticated', 'SELECT'),
  ('public.menu_target_members', 'authenticated', 'SELECT'),
  ('public.menu_timeline_steps', 'authenticated', 'SELECT'),
  ('public.menus', 'authenticated', 'SELECT'),
  ('public.pantry_items', 'authenticated', 'DELETE'),
  ('public.pantry_items', 'authenticated', 'INSERT'),
  ('public.pantry_items', 'authenticated', 'SELECT'),
  ('public.pantry_items', 'authenticated', 'UPDATE'),
  ('public.privacy_consents', 'authenticated', 'INSERT'),
  ('public.privacy_consents', 'authenticated', 'SELECT'),
  ('public.profiles', 'authenticated', 'SELECT'),
  ('public.recipe_steps', 'authenticated', 'SELECT'),
  ('public.shopping_current_label_warnings', 'authenticated', 'SELECT'),
  ('public.shopping_item_sources', 'authenticated', 'SELECT'),
  ('public.shopping_items', 'authenticated', 'SELECT'),
  ('public.shopping_label_confirmations', 'authenticated', 'SELECT'),
  ('public.shopping_list_sources', 'authenticated', 'SELECT'),
  ('public.shopping_lists', 'authenticated', 'SELECT')
    ),
    live as (
      select table_schema||'.'||table_name as object, grantee, privilege_type as privilege
      from information_schema.role_table_grants
      where table_schema in ('public','private')
        and grantee in ('anon','authenticated')
    )
    select 'extra:'||object||'|'||grantee||'|'||privilege from live
    except select 'extra:'||object||'|'||grantee||'|'||privilege from expected_table_grants
    union all
    select 'missing:'||object||'|'||grantee||'|'||privilege from expected_table_grants
    except select 'missing:'||object||'|'||grantee||'|'||privilege from live
  $$,
  'table grants match database-access-matrix (anon/authenticated)'
);

-- (6) column write grants: live vs expected (INSERT/UPDATE/DELETE only)
select is_empty(
  $$
    with expected_column_grants(object, column_name, grantee, privilege) as (values
  ('public.household_members', 'age_band', 'authenticated', 'INSERT'),
  ('public.household_members', 'age_band', 'authenticated', 'UPDATE'),
  ('public.household_members', 'allergy_status', 'authenticated', 'INSERT'),
  ('public.household_members', 'allergy_status', 'authenticated', 'UPDATE'),
  ('public.household_members', 'created_at', 'authenticated', 'INSERT'),
  ('public.household_members', 'created_at', 'authenticated', 'UPDATE'),
  ('public.household_members', 'display_name', 'authenticated', 'INSERT'),
  ('public.household_members', 'display_name', 'authenticated', 'UPDATE'),
  ('public.household_members', 'ease_preferences', 'authenticated', 'INSERT'),
  ('public.household_members', 'ease_preferences', 'authenticated', 'UPDATE'),
  ('public.household_members', 'id', 'authenticated', 'INSERT'),
  ('public.household_members', 'id', 'authenticated', 'UPDATE'),
  ('public.household_members', 'portion_size', 'authenticated', 'INSERT'),
  ('public.household_members', 'portion_size', 'authenticated', 'UPDATE'),
  ('public.household_members', 'required_safety_constraints', 'authenticated', 'INSERT'),
  ('public.household_members', 'required_safety_constraints', 'authenticated', 'UPDATE'),
  ('public.household_members', 'sort_order', 'authenticated', 'INSERT'),
  ('public.household_members', 'sort_order', 'authenticated', 'UPDATE'),
  ('public.household_members', 'spice_level', 'authenticated', 'INSERT'),
  ('public.household_members', 'spice_level', 'authenticated', 'UPDATE'),
  ('public.household_members', 'status', 'authenticated', 'INSERT'),
  ('public.household_members', 'status', 'authenticated', 'UPDATE'),
  ('public.household_members', 'unsupported_diet_kinds', 'authenticated', 'INSERT'),
  ('public.household_members', 'unsupported_diet_kinds', 'authenticated', 'UPDATE'),
  ('public.household_members', 'unsupported_diet_status', 'authenticated', 'INSERT'),
  ('public.household_members', 'unsupported_diet_status', 'authenticated', 'UPDATE'),
  ('public.household_members', 'updated_at', 'authenticated', 'INSERT'),
  ('public.household_members', 'updated_at', 'authenticated', 'UPDATE'),
  ('public.household_members', 'user_id', 'authenticated', 'INSERT'),
  ('public.household_members', 'user_id', 'authenticated', 'UPDATE'),
  ('public.member_allergies', 'allergen_id', 'authenticated', 'INSERT'),
  ('public.member_allergies', 'created_at', 'authenticated', 'INSERT'),
  ('public.member_allergies', 'custom_aliases', 'authenticated', 'INSERT'),
  ('public.member_allergies', 'custom_confirmed', 'authenticated', 'INSERT'),
  ('public.member_allergies', 'custom_name', 'authenticated', 'INSERT'),
  ('public.member_allergies', 'id', 'authenticated', 'INSERT'),
  ('public.member_allergies', 'member_id', 'authenticated', 'INSERT'),
  ('public.member_allergies', 'user_id', 'authenticated', 'INSERT'),
  ('public.member_dislikes', 'created_at', 'authenticated', 'INSERT'),
  ('public.member_dislikes', 'created_at', 'authenticated', 'UPDATE'),
  ('public.member_dislikes', 'id', 'authenticated', 'INSERT'),
  ('public.member_dislikes', 'id', 'authenticated', 'UPDATE'),
  ('public.member_dislikes', 'ingredient_name', 'authenticated', 'INSERT'),
  ('public.member_dislikes', 'ingredient_name', 'authenticated', 'UPDATE'),
  ('public.member_dislikes', 'member_id', 'authenticated', 'INSERT'),
  ('public.member_dislikes', 'member_id', 'authenticated', 'UPDATE'),
  ('public.member_dislikes', 'user_id', 'authenticated', 'INSERT'),
  ('public.member_dislikes', 'user_id', 'authenticated', 'UPDATE'),
  ('public.menus', 'is_favorite', 'authenticated', 'UPDATE'),
  ('public.pantry_items', 'created_at', 'authenticated', 'INSERT'),
  ('public.pantry_items', 'created_at', 'authenticated', 'UPDATE'),
  ('public.pantry_items', 'expiration_type', 'authenticated', 'INSERT'),
  ('public.pantry_items', 'expiration_type', 'authenticated', 'UPDATE'),
  ('public.pantry_items', 'expires_on', 'authenticated', 'INSERT'),
  ('public.pantry_items', 'expires_on', 'authenticated', 'UPDATE'),
  ('public.pantry_items', 'id', 'authenticated', 'INSERT'),
  ('public.pantry_items', 'id', 'authenticated', 'UPDATE'),
  ('public.pantry_items', 'name', 'authenticated', 'INSERT'),
  ('public.pantry_items', 'name', 'authenticated', 'UPDATE'),
  ('public.pantry_items', 'opened_state', 'authenticated', 'INSERT'),
  ('public.pantry_items', 'opened_state', 'authenticated', 'UPDATE'),
  ('public.pantry_items', 'quantity', 'authenticated', 'INSERT'),
  ('public.pantry_items', 'quantity', 'authenticated', 'UPDATE'),
  ('public.pantry_items', 'unit', 'authenticated', 'INSERT'),
  ('public.pantry_items', 'unit', 'authenticated', 'UPDATE'),
  ('public.pantry_items', 'updated_at', 'authenticated', 'INSERT'),
  ('public.pantry_items', 'updated_at', 'authenticated', 'UPDATE'),
  ('public.pantry_items', 'user_id', 'authenticated', 'INSERT'),
  ('public.pantry_items', 'user_id', 'authenticated', 'UPDATE'),
  ('public.privacy_consents', 'accepted_at', 'authenticated', 'INSERT'),
  ('public.privacy_consents', 'created_at', 'authenticated', 'INSERT'),
  ('public.privacy_consents', 'notice_version', 'authenticated', 'INSERT'),
  ('public.privacy_consents', 'user_id', 'authenticated', 'INSERT')
    ),
    live as (
      select table_schema||'.'||table_name as object, column_name, grantee, privilege_type as privilege
      from information_schema.column_privileges
      where table_schema in ('public','private')
        and grantee in ('anon','authenticated')
        and privilege_type in ('INSERT','UPDATE','DELETE')
    )
    select 'extra:'||object||'|'||column_name||'|'||grantee||'|'||privilege from live
    except select 'extra:'||object||'|'||column_name||'|'||grantee||'|'||privilege from expected_column_grants
    union all
    select 'missing:'||object||'|'||column_name||'|'||grantee||'|'||privilege from expected_column_grants
    except select 'missing:'||object||'|'||column_name||'|'||grantee||'|'||privilege from live
  $$,
  'column write grants match database-access-matrix (anon/authenticated)'
);

-- (7) routine EXECUTE: live vs expected (anon/authenticated/service_role on public/private)
select is_empty(
  $$
    with expected_routines(object, grantee, privilege) as (values
  ('private.ai_jst_day(p_now timestamp with time zone)', 'anon', 'EXECUTE'),
  ('private.ai_jst_day(p_now timestamp with time zone)', 'authenticated', 'EXECUTE'),
  ('private.ai_jst_day(p_now timestamp with time zone)', 'service_role', 'EXECUTE'),
  ('private.ai_next_jst_midnight(p_now timestamp with time zone)', 'anon', 'EXECUTE'),
  ('private.ai_next_jst_midnight(p_now timestamp with time zone)', 'authenticated', 'EXECUTE'),
  ('private.ai_next_jst_midnight(p_now timestamp with time zone)', 'service_role', 'EXECUTE'),
  ('private.ai_request_payload(p_request private.ai_generation_requests, p_replayed boolean)', 'anon', 'EXECUTE'),
  ('private.ai_request_payload(p_request private.ai_generation_requests, p_replayed boolean)', 'authenticated', 'EXECUTE'),
  ('private.ai_request_payload(p_request private.ai_generation_requests, p_replayed boolean)', 'service_role', 'EXECUTE'),
  ('private.enforce_registered_member_allergy()', 'anon', 'EXECUTE'),
  ('private.enforce_registered_member_allergy()', 'authenticated', 'EXECUTE'),
  ('private.enforce_registered_member_allergy()', 'service_role', 'EXECUTE'),
  ('private.enforce_shopping_item_provenance()', 'anon', 'EXECUTE'),
  ('private.enforce_shopping_item_provenance()', 'authenticated', 'EXECUTE'),
  ('private.enforce_shopping_item_provenance()', 'service_role', 'EXECUTE'),
  ('private.handle_new_auth_user()', 'anon', 'EXECUTE'),
  ('private.handle_new_auth_user()', 'authenticated', 'EXECUTE'),
  ('private.handle_new_auth_user()', 'service_role', 'EXECUTE'),
  ('private.normalize_allergen_term(p_value text)', 'anon', 'EXECUTE'),
  ('private.normalize_allergen_term(p_value text)', 'authenticated', 'EXECUTE'),
  ('private.normalize_allergen_term(p_value text)', 'service_role', 'EXECUTE'),
  ('private.normalize_member_allergy()', 'anon', 'EXECUTE'),
  ('private.normalize_member_allergy()', 'authenticated', 'EXECUTE'),
  ('private.normalize_member_allergy()', 'service_role', 'EXECUTE'),
  ('private.prevent_last_registered_member_allergy_removal()', 'anon', 'EXECUTE'),
  ('private.prevent_last_registered_member_allergy_removal()', 'authenticated', 'EXECUTE'),
  ('private.prevent_last_registered_member_allergy_removal()', 'service_role', 'EXECUTE'),
  ('private.set_updated_at()', 'anon', 'EXECUTE'),
  ('private.set_updated_at()', 'authenticated', 'EXECUTE'),
  ('private.set_updated_at()', 'service_role', 'EXECUTE'),
  ('public.accept_menu_version(p_menu_id uuid)', 'authenticated', 'EXECUTE'),
  ('public.accept_menu_version(p_menu_id uuid)', 'service_role', 'EXECUTE'),
  ('public.add_custom_member_allergy(p_member_id uuid, p_custom_name text, p_custom_aliases text[])', 'authenticated', 'EXECUTE'),
  ('public.add_custom_member_allergy(p_member_id uuid, p_custom_name text, p_custom_aliases text[])', 'service_role', 'EXECUTE'),
  ('public.apply_shopping_draft(p_user_id uuid, p_menu_id uuid, p_mode text, p_active_list_id uuid, p_expected_list_version integer, p_safety_fingerprint text, p_idempotency_key uuid, p_request_hash text, p_draft jsonb)', 'service_role', 'EXECUTE'),
  ('public.apply_shopping_reconciliation(p_user_id uuid, p_list_id uuid, p_expected_list_version integer, p_source_menu_id uuid, p_source_menu_version integer, p_safety_fingerprint text, p_idempotency_key uuid, p_request_hash text, p_resolved_diff jsonb)', 'service_role', 'EXECUTE'),
  ('public.claim_auth_continuation(p_id uuid, p_state_hash bytea, p_secret_hash bytea, p_origin text, p_now timestamp with time zone)', 'service_role', 'EXECUTE'),
  ('public.cleanup_ai_generation_requests(p_before timestamp with time zone, p_user_id uuid)', 'service_role', 'EXECUTE'),
  ('public.cleanup_auth_continuations(p_now timestamp with time zone)', 'service_role', 'EXECUTE'),
  ('public.cleanup_stale_ai_generations(p_now timestamp with time zone)', 'service_role', 'EXECUTE'),
  ('public.complete_household_member(p_member_id uuid)', 'authenticated', 'EXECUTE'),
  ('public.complete_household_member(p_member_id uuid)', 'service_role', 'EXECUTE'),
  ('public.confirm_menu_label_confirmation(p_menu_id uuid, p_confirmation_id uuid, p_expected_safety_fingerprint text)', 'authenticated', 'EXECUTE'),
  ('public.create_auth_continuation(p_state_hash bytea, p_secret_hash bytea, p_origin text, p_return_to text, p_now timestamp with time zone, p_ttl_seconds integer)', 'service_role', 'EXECUTE'),
  ('public.delete_generation_draft(p_expected_revision bigint)', 'authenticated', 'EXECUTE'),
  ('public.delete_member_allergy(p_allergy_id uuid)', 'authenticated', 'EXECUTE'),
  ('public.delete_member_allergy(p_allergy_id uuid)', 'service_role', 'EXECUTE'),
  ('public.delete_menu_group(p_derivation_group_id uuid)', 'authenticated', 'EXECUTE'),
  ('public.delete_menu_group(p_derivation_group_id uuid)', 'service_role', 'EXECUTE'),
  ('public.deposit_auth_continuation(p_id uuid, p_state_hash bytea, p_origin text, p_ciphertext bytea, p_iv bytea, p_now timestamp with time zone)', 'service_role', 'EXECUTE'),
  ('public.finalize_ai_generation_conflict(p_request_id uuid, p_conflict_codes text[], p_now timestamp with time zone)', 'service_role', 'EXECUTE'),
  ('public.finalize_ai_generation_failure(p_request_id uuid, p_failure_code text, p_retry_at timestamp with time zone, p_now timestamp with time zone)', 'service_role', 'EXECUTE'),
  ('public.finalize_ai_generation_success(p_request_id uuid, p_menu jsonb, p_preference_snapshot jsonb, p_safety_snapshot jsonb, p_safety_fingerprint text, p_allergen_version text, p_food_rule_version text, p_target_members jsonb, p_expired_checks jsonb, p_source_menu_id uuid, p_change_reason text, p_change_reason_custom text, p_now timestamp with time zone)', 'service_role', 'EXECUTE'),
  ('public.get_ai_generation_regeneration_snapshot(p_request_id uuid, p_user_id uuid)', 'service_role', 'EXECUTE'),
  ('public.get_ai_generation_status(p_user_id uuid, p_idempotency_key uuid, p_user_limit integer, p_now timestamp with time zone)', 'service_role', 'EXECUTE'),
  ('public.get_ai_generation_submission_snapshot(p_request_id uuid, p_user_id uuid)', 'service_role', 'EXECUTE'),
  ('public.get_ai_usage_today(p_user_id uuid, p_now timestamp with time zone)', 'service_role', 'EXECUTE'),
  ('public.get_current_safety_snapshot(p_user_id uuid, p_target_member_ids uuid[])', 'service_role', 'EXECUTE'),
  ('public.get_shopping_mutation_replay(p_user_id uuid, p_idempotency_key uuid, p_request_hash text)', 'service_role', 'EXECUTE'),
  ('public.lookup_ai_generation_request(p_user_id uuid, p_idempotency_key uuid)', 'service_role', 'EXECUTE'),
  ('public.mark_ai_global_sent(p_request_id uuid, p_now timestamp with time zone)', 'service_role', 'EXECUTE'),
  ('public.mutate_shopping_item(p_list_id uuid, p_expected_list_version integer, p_expected_safety_fingerprint text, p_operation text, p_item_id uuid, p_idempotency_key uuid, p_payload jsonb)', 'authenticated', 'EXECUTE'),
  ('public.mutate_shopping_item(p_list_id uuid, p_expected_list_version integer, p_expected_safety_fingerprint text, p_operation text, p_item_id uuid, p_idempotency_key uuid, p_payload jsonb)', 'service_role', 'EXECUTE'),
  ('public.reconcile_menu_label_confirmations(p_user_id uuid, p_menu_id uuid, p_expected_safety_fingerprint text, p_requirements jsonb)', 'service_role', 'EXECUTE'),
  ('public.record_ai_generation_model(p_request_id uuid, p_model_id text, p_now timestamp with time zone)', 'service_role', 'EXECUTE'),
  ('public.refresh_shopping_list_safety(p_user_id uuid, p_list_id uuid, p_expected_fingerprint text, p_warnings jsonb)', 'service_role', 'EXECUTE'),
  ('public.reserve_ai_generation(p_user_id uuid, p_idempotency_key uuid, p_request_kind text, p_draft_id uuid, p_draft_revision bigint, p_source_menu_id uuid, p_replace_dish_id uuid, p_change_reason text, p_request_hmac_version text, p_request_hmac text, p_integrity_context jsonb, p_user_limit integer, p_global_limit integer, p_stale_after_seconds integer, p_now timestamp with time zone)', 'service_role', 'EXECUTE'),
  ('public.reserve_ai_repair_call(p_request_id uuid, p_global_limit integer, p_now timestamp with time zone)', 'service_role', 'EXECUTE'),
  ('public.save_generation_draft(p_expected_revision bigint, p_meal_type text, p_main_ingredients text[], p_cuisine_genre text, p_target_mode text, p_target_member_ids uuid[], p_servings smallint, p_time_limit_minutes smallint, p_budget_preference text, p_avoid_ingredients text[], p_memo text, p_pantry_selections jsonb)', 'authenticated', 'EXECUTE'),
  ('public.set_onboarding_status(p_status text)', 'authenticated', 'EXECUTE'),
  ('public.set_onboarding_status(p_status text)', 'service_role', 'EXECUTE'),
  ('public.shopping_list_safety_fingerprint(p_user_id uuid, p_list_id uuid)', 'service_role', 'EXECUTE'),
  ('public.shopping_safety_fingerprint(p_user_id uuid, p_menu_id uuid)', 'service_role', 'EXECUTE'),
  ('public.start_household_onboarding(p_sort_order integer)', 'authenticated', 'EXECUTE'),
  ('public.start_household_onboarding(p_sort_order integer)', 'service_role', 'EXECUTE')
    ),
    live as (
      select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as object,
             g.grantee,
             'EXECUTE'::text as privilege
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'),('authenticated'),('service_role')) as g(grantee)
      where n.nspname in ('public','private')
        and has_function_privilege(g.grantee, p.oid, 'EXECUTE')
    )
    select 'extra:'||object||'|'||grantee||'|'||privilege from live
    except select 'extra:'||object||'|'||grantee||'|'||privilege from expected_routines
    union all
    select 'missing:'||object||'|'||grantee||'|'||privilege from expected_routines
    except select 'missing:'||object||'|'||grantee||'|'||privilege from live
  $$,
  'routine EXECUTE grants match database-access-matrix'
);

-- (8) policies: live vs expected (public/private)
select is_empty(
  $$
    with expected_policies(object, policy_name, cmd) as (values
  ('public.allergen_aliases', 'allergen_aliases_authenticated_read', 'SELECT'),
  ('public.allergen_catalog', 'allergen_catalog_authenticated_read', 'SELECT'),
  ('public.dish_ingredients', 'dish_ingredients_owner_select', 'SELECT'),
  ('public.dishes', 'dishes_owner_select', 'SELECT'),
  ('public.food_safety_rules', 'food_safety_rules_authenticated_read', 'SELECT'),
  ('public.generation_drafts', 'generation_drafts_owner_select', 'SELECT'),
  ('public.generation_pantry_selections', 'generation_pantry_selections_owner_select', 'SELECT'),
  ('public.household_members', 'members_delete_own', 'DELETE'),
  ('public.household_members', 'members_insert_own', 'INSERT'),
  ('public.household_members', 'members_select_own', 'SELECT'),
  ('public.household_members', 'members_update_own', 'UPDATE'),
  ('public.member_allergies', 'allergies_insert_own', 'INSERT'),
  ('public.member_allergies', 'allergies_select_own', 'SELECT'),
  ('public.member_dislikes', 'dislikes_delete_own', 'DELETE'),
  ('public.member_dislikes', 'dislikes_insert_own', 'INSERT'),
  ('public.member_dislikes', 'dislikes_select_own', 'SELECT'),
  ('public.member_dislikes', 'dislikes_update_own', 'UPDATE'),
  ('public.menu_label_confirmations', 'menu_label_confirmations_owner_select', 'SELECT'),
  ('public.menu_member_adaptations', 'menu_member_adaptations_owner_select', 'SELECT'),
  ('public.menu_revalidations', 'menu_revalidations_select_own', 'SELECT'),
  ('public.menu_safety_actions', 'menu_safety_actions_owner_select', 'SELECT'),
  ('public.menu_target_members', 'menu_target_members_owner_select', 'SELECT'),
  ('public.menu_timeline_steps', 'menu_timeline_steps_owner_select', 'SELECT'),
  ('public.menus', 'menus_owner_select', 'SELECT'),
  ('public.menus', 'menus_owner_update_favorite', 'UPDATE'),
  ('public.pantry_items', 'pantry_items_owner_delete', 'DELETE'),
  ('public.pantry_items', 'pantry_items_owner_insert', 'INSERT'),
  ('public.pantry_items', 'pantry_items_owner_select', 'SELECT'),
  ('public.pantry_items', 'pantry_items_owner_update', 'UPDATE'),
  ('public.privacy_consents', 'consents_insert_own', 'INSERT'),
  ('public.privacy_consents', 'consents_select_own', 'SELECT'),
  ('public.profiles', 'profiles_select_own', 'SELECT'),
  ('public.recipe_steps', 'recipe_steps_owner_select', 'SELECT'),
  ('public.shopping_current_label_warnings', 'shopping_current_labels_select_own', 'SELECT'),
  ('public.shopping_item_sources', 'shopping_item_sources_select_own', 'SELECT'),
  ('public.shopping_items', 'shopping_items_select_own', 'SELECT'),
  ('public.shopping_label_confirmations', 'shopping_labels_select_own', 'SELECT'),
  ('public.shopping_list_sources', 'shopping_list_sources_select_own', 'SELECT'),
  ('public.shopping_lists', 'shopping_lists_select_own', 'SELECT')
    ),
    live as (
      select n.nspname||'.'||c.relname as object,
             pol.polname as policy_name,
             case pol.polcmd
               when 'r' then 'SELECT'
               when 'a' then 'INSERT'
               when 'w' then 'UPDATE'
               when 'd' then 'DELETE'
               when '*' then 'ALL'
             end as cmd
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public','private')
    )
    select 'extra:'||object||'|'||policy_name||'|'||cmd from live
    except select 'extra:'||object||'|'||policy_name||'|'||cmd from expected_policies
    union all
    select 'missing:'||object||'|'||policy_name||'|'||cmd from expected_policies
    except select 'missing:'||object||'|'||policy_name||'|'||cmd from live
  $$,
  'RLS policies match database-access-matrix'
);

select * from finish();
rollback;
