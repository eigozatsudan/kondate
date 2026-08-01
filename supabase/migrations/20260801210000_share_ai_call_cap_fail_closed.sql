-- 共有 AI 枠を fail-closed にする。
-- 1) share_increment_ai_calls: cap 超過時も LEAST(500, +n) で pin（499+2→500 の凍結バグ修正）
-- 2) try_enqueue_share_job: pending/running の予約枠を見込んで app_cap
-- 3) skip_reason に app_ai_cap / denylist_precheck を追加
-- 4) share_app_ai_budget_remaining: worker の Pass 前ゲート用

-- ---------------------------------------------------------------------------
-- skip_reason CHECK を拡張（app_ai_cap / denylist_precheck）
-- ---------------------------------------------------------------------------
do $skip_ck$
declare
  v_conname text;
begin
  -- 値集合 CHECK のみを対象にする（status ⇔ skip_reason の同時存在 CHECK は触らない）
  select c.conname into v_conname
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'private'
    and t.relname = 'share_generalization_jobs'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%not_emergency_duration%'
    and pg_get_constraintdef(c.oid) like '%daily_success_cap%'
  limit 1;

  if v_conname is not null then
    execute format(
      'alter table private.share_generalization_jobs drop constraint %I',
      v_conname
    );
  end if;

  -- 同名が残っていれば先に落とす（再適用・部分失敗後の安全）
  if exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'private'
      and t.relname = 'share_generalization_jobs'
      and c.conname = 'share_generalization_jobs_skip_reason_check'
  ) then
    alter table private.share_generalization_jobs
      drop constraint share_generalization_jobs_skip_reason_check;
  end if;

  alter table private.share_generalization_jobs
    add constraint share_generalization_jobs_skip_reason_check
    check (
      skip_reason is null
      or skip_reason in (
        'not_emergency_duration',
        'pantry_bound',
        'consent_revoked',
        'ineligible_structure',
        'daily_success_cap',
        -- worker: 日次 AI 呼び出し cap 到達（OpenRouter 前に skip）
        'app_ai_cap',
        -- worker: canonical 直後・Pass 前の denylist ヒット
        'denylist_precheck'
      )
    );
end;
$skip_ck$;

-- ---------------------------------------------------------------------------
-- AI 呼び出し台帳: 常に LEAST(500, current + delta) で pin
-- ---------------------------------------------------------------------------
create or replace function private.share_increment_ai_calls(
  p_usage_day date,
  p_ai_call_count integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
begin
  if p_ai_call_count is null or p_ai_call_count <= 0 then
    return;
  end if;
  if p_ai_call_count > 2 then
    raise exception using errcode = '22023', message = 'invalid_share_ai_call_count';
  end if;

  insert into private.share_app_daily_usage (usage_day, success_count, ai_call_count, updated_at)
  values (p_usage_day, 0, 0, clock_timestamp())
  on conflict (usage_day) do nothing;

  -- FOR UPDATE で日次行を掴み、cap 超過分も pin して silent-return しない
  -- （旧実装は 499+2>500 で return し 499 に凍結 → 以降 enqueue が永遠に通る fail-open）
  update private.share_app_daily_usage
  set ai_call_count = least(500, ai_call_count + p_ai_call_count),
      updated_at = clock_timestamp()
  where usage_day = p_usage_day;
end;
$function$;

revoke all on function private.share_increment_ai_calls(date, integer)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- enqueue: 実消費 + inflight 予約（pending/running × 2）+ 本 job の 2 が 500 超なら app_cap
-- ---------------------------------------------------------------------------
create or replace function public.try_enqueue_share_job(p_menu_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_menu public.menus%rowtype;
  v_contributor uuid;
  v_day date;
  v_user_attempt integer := 0;
  v_user_success integer := 0;
  v_app_success integer := 0;
  v_app_ai integer := 0;
  v_inflight integer := 0;
  v_job_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_menu_id is null then
    raise exception using errcode = '22023', message = 'invalid_menu_id';
  end if;

  select * into v_menu from public.menus where id = p_menu_id;
  if not found then
    return jsonb_build_object('enqueued', false, 'reason', 'menu_not_found');
  end if;

  v_contributor := v_menu.user_id;
  v_day := private.ai_jst_day(v_now);

  -- 同意（現行版・未 revoke）
  if not private.share_consent_is_valid(v_contributor) then
    return jsonb_build_object('enqueued', false, 'reason', 'no_consent');
  end if;

  -- ユーザー日次 cap（行ロックで競合シリアライズ）
  insert into private.share_user_daily_usage (
    contributor_user_id, usage_day, attempt_count, success_count, updated_at
  ) values (v_contributor, v_day, 0, 0, v_now)
  on conflict (contributor_user_id, usage_day) do nothing;

  select attempt_count, success_count
  into v_user_attempt, v_user_success
  from private.share_user_daily_usage
  where contributor_user_id = v_contributor and usage_day = v_day
  for update;

  if v_user_attempt >= 2 or v_user_success >= 1 then
    return jsonb_build_object('enqueued', false, 'reason', 'user_cap');
  end if;

  -- アプリ日次 cap（success / 実 AI 消費）
  insert into private.share_app_daily_usage (usage_day, success_count, ai_call_count, updated_at)
  values (v_day, 0, 0, v_now)
  on conflict (usage_day) do nothing;

  select success_count, ai_call_count
  into v_app_success, v_app_ai
  from private.share_app_daily_usage
  where usage_day = v_day
  for update;

  if v_app_success >= 200 or v_app_ai >= 500 then
    return jsonb_build_object('enqueued', false, 'reason', 'app_cap');
  end if;

  -- pending/running を 1 job = 最大 2 OpenRouter 呼び出しとして予約計上
  -- （finish 前の backlog が 500 を突き抜けないよう fail-closed）
  select count(*)::integer into v_inflight
  from private.share_generalization_jobs
  where status in ('pending', 'running')
    and private.ai_jst_day(created_at) = v_day;

  if v_app_ai + (v_inflight * 2) + 2 > 500 then
    return jsonb_build_object('enqueued', false, 'reason', 'app_cap');
  end if;

  -- 抽選 20%（外れは attempt 不消費）
  if (random() * 100.0) >= 20.0 then
    return jsonb_build_object('enqueued', false, 'reason', 'lottery');
  end if;

  -- unique job insert → 成功後に attempt++
  begin
    insert into private.share_generalization_jobs (
      source_menu_id,
      contributor_user_id,
      status,
      created_at
    ) values (
      p_menu_id,
      v_contributor,
      'pending',
      v_now
    )
    returning id into v_job_id;
  exception
    when unique_violation then
      return jsonb_build_object('enqueued', false, 'reason', 'duplicate');
  end;

  update private.share_user_daily_usage
  set attempt_count = attempt_count + 1,
      updated_at = v_now
  where contributor_user_id = v_contributor and usage_day = v_day;

  return jsonb_build_object(
    'enqueued', true,
    'job_id', v_job_id,
    'contributor_user_id', v_contributor
  );
end;
$function$;

revoke all on function public.try_enqueue_share_job(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.try_enqueue_share_job(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- finish: 新 skip_reason を受理
-- ---------------------------------------------------------------------------
create or replace function public.finish_share_generalization_job(
  p_job_id uuid,
  p_status text,
  p_code text default null,
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
  v_row private.share_generalization_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_day date;
begin
  if p_job_id is null then
    raise exception using errcode = '22023', message = 'invalid_job_id';
  end if;
  if p_status is null or p_status not in ('failed', 'skipped') then
    raise exception using errcode = '22023', message = 'invalid_finish_status';
  end if;
  if p_status = 'failed' and (
    p_code is null
    or p_code not in ('lease_expired', 'server_gate_failed', 'openrouter_failed')
  ) then
    raise exception using errcode = '22023', message = 'invalid_failure_code';
  end if;
  if p_status = 'skipped' and (
    p_code is null
    or p_code not in (
      'not_emergency_duration',
      'pantry_bound',
      'consent_revoked',
      'ineligible_structure',
      'daily_success_cap',
      'app_ai_cap',
      'denylist_precheck'
    )
  ) then
    raise exception using errcode = '22023', message = 'invalid_skip_reason';
  end if;
  if p_ai_call_count is null or p_ai_call_count < 0 or p_ai_call_count > 2 then
    raise exception using errcode = '22023', message = 'invalid_share_ai_call_count';
  end if;

  select * into v_row
  from private.share_generalization_jobs
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_row.status is distinct from 'running' then
    return jsonb_build_object('ok', false, 'reason', 'not_running', 'status', v_row.status);
  end if;

  update private.share_generalization_jobs
  set status = p_status,
      skip_reason = case when p_status = 'skipped' then p_code else null end,
      failure_code = case when p_status = 'failed' then p_code else null end,
      pass1_model = coalesce(p_pass1_model, pass1_model),
      pass2_model = coalesce(p_pass2_model, pass2_model),
      finished_at = v_now
  where id = p_job_id
  returning * into v_row;

  v_day := private.ai_jst_day(v_now);
  perform private.share_increment_ai_calls(v_day, p_ai_call_count);

  return jsonb_build_object(
    'ok', true,
    'job_id', v_row.id,
    'status', v_row.status,
    'code', p_code
  );
end;
$function$;

revoke all on function public.finish_share_generalization_job(uuid, text, text, integer, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.finish_share_generalization_job(uuid, text, text, integer, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- worker Pass 前: 当日 AI 残り枠（0 なら app_ai_cap skip）
-- ---------------------------------------------------------------------------
create or replace function public.share_app_ai_budget_remaining()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_day date := private.ai_jst_day(clock_timestamp());
  v_count integer := 0;
begin
  select ai_call_count into v_count
  from private.share_app_daily_usage
  where usage_day = v_day;

  -- 行無しは未消費 → 全枠
  return greatest(0, 500 - coalesce(v_count, 0));
end;
$function$;

revoke all on function public.share_app_ai_budget_remaining()
  from public, anon, authenticated, service_role;
grant execute on function public.share_app_ai_budget_remaining() to service_role;
