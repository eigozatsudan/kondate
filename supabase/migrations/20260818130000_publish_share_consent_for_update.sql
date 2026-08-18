-- AP2: publish の同意再確認を user_share_consents FOR UPDATE に上げる。
-- 公開シグネチャは据え置き。revoke が台帳待ちのあいだに COMMIT しても掲載しない。

create or replace function public.publish_shared_emergency_recipe(
  p_job_id uuid,
  p_payload jsonb,
  p_meal_type text,
  p_total_elapsed integer,
  p_standard_allergen_ids text[],
  p_eligible_age_bands text[],
  p_ai_call_count integer default 0,
  p_pass1_model text default null,
  p_pass2_model text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_job private.share_generalization_jobs%rowtype;
  v_recipe_id uuid;
  v_now timestamptz := clock_timestamp();
  v_day date;
  v_contributor uuid;
  v_user_success integer := 0;
  v_app_success integer := 0;
  v_consent_version text;
  v_consent_revoked_at timestamptz;
begin
  if p_job_id is null then
    raise exception using errcode = '22023', message = 'invalid_job_id';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'invalid_share_payload';
  end if;
  if p_meal_type is null or p_meal_type not in ('breakfast', 'lunch', 'dinner') then
    raise exception using errcode = '22023', message = 'invalid_meal_type';
  end if;
  if p_total_elapsed is null or p_total_elapsed < 1 or p_total_elapsed > 15 then
    raise exception using errcode = '22023', message = 'invalid_total_elapsed';
  end if;
  if p_standard_allergen_ids is null then
    raise exception using errcode = '22023', message = 'invalid_standard_allergen_ids';
  end if;
  if p_eligible_age_bands is null or cardinality(p_eligible_age_bands) < 1 then
    raise exception using errcode = '22023', message = 'invalid_eligible_age_bands';
  end if;
  if p_ai_call_count is null or p_ai_call_count < 0 or p_ai_call_count > 2 then
    raise exception using errcode = '22023', message = 'invalid_share_ai_call_count';
  end if;

  select * into v_job
  from private.share_generalization_jobs
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_job.status is distinct from 'running' then
    return jsonb_build_object('ok', false, 'reason', 'not_running', 'status', v_job.status);
  end if;

  v_contributor := v_job.contributor_user_id;
  v_day := private.ai_jst_day(v_now);

  -- 既に撤回済みなら台帳ロック前に終端（fast-path。権威判定は後段 FOR UPDATE）
  if v_contributor is null or not private.share_consent_is_valid(v_contributor) then
    update private.share_generalization_jobs
    set status = 'skipped',
        skip_reason = 'consent_revoked',
        failure_code = null,
        pass1_model = coalesce(p_pass1_model, pass1_model),
        pass2_model = coalesce(p_pass2_model, pass2_model),
        finished_at = v_now
    where id = p_job_id;

    perform private.share_increment_ai_calls(v_day, p_ai_call_count);

    return jsonb_build_object(
      'ok', true,
      'published', false,
      'reason', 'consent_revoked',
      'job_id', p_job_id
    );
  end if;

  -- 日次 success 台帳を ensure → FOR UPDATE（enqueue と同じ user→app 順で deadlock 回避）
  insert into private.share_user_daily_usage (
    contributor_user_id, usage_day, attempt_count, success_count, updated_at
  ) values (v_contributor, v_day, 0, 0, v_now)
  on conflict (contributor_user_id, usage_day) do nothing;

  insert into private.share_app_daily_usage (
    usage_day, success_count, ai_call_count, updated_at
  ) values (v_day, 0, 0, v_now)
  on conflict (usage_day) do nothing;

  select success_count
  into v_user_success
  from private.share_user_daily_usage
  where contributor_user_id = v_contributor and usage_day = v_day
  for update;

  select success_count
  into v_app_success
  from private.share_app_daily_usage
  where usage_day = v_day
  for update;

  -- fail-closed: attempt cap(2) でも success cap(1/200) 超過後の 2 本目 pool INSERT を禁止
  if v_user_success >= 1 or v_app_success >= 200 then
    update private.share_generalization_jobs
    set status = 'skipped',
        skip_reason = 'daily_success_cap',
        failure_code = null,
        pass1_model = coalesce(p_pass1_model, pass1_model),
        pass2_model = coalesce(p_pass2_model, pass2_model),
        finished_at = v_now
    where id = p_job_id;

    perform private.share_increment_ai_calls(v_day, p_ai_call_count);

    return jsonb_build_object(
      'ok', true,
      'published', false,
      'reason', 'daily_success_cap',
      'job_id', p_job_id
    );
  end if;

  -- AP2: success 加算 / pool INSERT 直前に同意行を FOR UPDATE。
  -- 台帳待ちのあいだに upsert_my_share_consent(false) が COMMIT していても掲載しない。
  select c.consent_version, c.revoked_at
  into v_consent_version, v_consent_revoked_at
  from public.user_share_consents c
  where c.user_id = v_contributor
  for update;

  if not found
     or v_consent_version is distinct from private.share_current_consent_version()
     or v_consent_revoked_at is not null then
    update private.share_generalization_jobs
    set status = 'skipped',
        skip_reason = 'consent_revoked',
        failure_code = null,
        pass1_model = coalesce(p_pass1_model, pass1_model),
        pass2_model = coalesce(p_pass2_model, pass2_model),
        finished_at = v_now
    where id = p_job_id;

    perform private.share_increment_ai_calls(v_day, p_ai_call_count);

    return jsonb_build_object(
      'ok', true,
      'published', false,
      'reason', 'consent_revoked',
      'job_id', p_job_id
    );
  end if;

  -- ロック下で success を先に確定してから pool/origin を書く（soft WHERE 禁止）
  update private.share_user_daily_usage
  set success_count = success_count + 1,
      updated_at = v_now
  where contributor_user_id = v_contributor and usage_day = v_day;

  update private.share_app_daily_usage
  set success_count = success_count + 1,
      updated_at = v_now
  where usage_day = v_day;

  insert into private.shared_emergency_recipes (
    menu_payload,
    meal_type,
    total_elapsed_minutes,
    status,
    standard_allergen_ids,
    eligible_age_bands,
    created_at
  ) values (
    p_payload,
    p_meal_type,
    p_total_elapsed::smallint,
    'active',
    p_standard_allergen_ids,
    p_eligible_age_bands,
    v_now
  )
  returning id into v_recipe_id;

  insert into private.shared_emergency_recipe_origins (
    recipe_id,
    contributor_user_id,
    source_menu_id,
    created_at
  ) values (
    v_recipe_id,
    v_contributor,
    v_job.source_menu_id,
    v_now
  );

  perform private.share_increment_ai_calls(v_day, p_ai_call_count);

  update private.share_generalization_jobs
  set status = 'succeeded',
      skip_reason = null,
      failure_code = null,
      pass1_model = coalesce(p_pass1_model, pass1_model),
      pass2_model = coalesce(p_pass2_model, pass2_model),
      finished_at = v_now
  where id = p_job_id;

  return jsonb_build_object(
    'ok', true,
    'published', true,
    'recipe_id', v_recipe_id,
    'job_id', p_job_id
  );
end;
$function$;

revoke all on function public.publish_shared_emergency_recipe(
  uuid, jsonb, text, integer, text[], text[], integer, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.publish_shared_emergency_recipe(
  uuid, jsonb, text, integer, text[], text[], integer, text, text
) to service_role;
