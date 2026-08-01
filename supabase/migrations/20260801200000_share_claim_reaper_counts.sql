-- Task 7a: claim を advisory lock で直列化し concurrent running cap を厳密化。
-- run_kondate_maintenance の reaper 件数を staleShareJobsReaped として独立キー化
-- （Task 3 では staleReservationsFinalized に加算していた。本マイグレーションで分離）。

-- ---------------------------------------------------------------------------
-- claim: トランザクション単位の advisory lock で over-claim を防ぐ
-- ---------------------------------------------------------------------------
create or replace function public.claim_share_generalization_jobs(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_limit integer;
  v_global_running integer;
  v_claimed jsonb := '[]'::jsonb;
  v_row private.share_generalization_jobs%rowtype;
  v_user_running integer;
  v_now timestamptz := clock_timestamp();
  -- shareQuota.maxGlobalRunning / maxPerUserRunning
  v_max_global constant integer := 4;
  v_max_per_user constant integer := 1;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception using errcode = '22023', message = 'invalid_claim_limit';
  end if;
  v_limit := p_limit;

  -- 同一 xact 内の claim を直列化。finish/reaper はロックを取らない（under-claim のみ許容、over-claim 禁止）。
  -- キーは固定（'claim_share_generalization_jobs' の hashtextextended）。
  perform pg_advisory_xact_lock(hashtextextended('claim_share_generalization_jobs', 0));

  select count(*)::integer into v_global_running
  from private.share_generalization_jobs
  where status = 'running';

  if v_global_running >= v_max_global then
    return jsonb_build_object('jobs', v_claimed);
  end if;

  for v_row in
    select *
    from private.share_generalization_jobs
    where status = 'pending'
    order by created_at asc
    for update skip locked
  loop
    exit when jsonb_array_length(v_claimed) >= v_limit;
    exit when v_global_running >= v_max_global;

    if v_row.contributor_user_id is not null then
      select count(*)::integer into v_user_running
      from private.share_generalization_jobs
      where status = 'running'
        and contributor_user_id = v_row.contributor_user_id;

      if v_user_running >= v_max_per_user then
        continue;
      end if;
    end if;

    update private.share_generalization_jobs
    set status = 'running',
        claimed_at = v_now,
        heartbeat_at = v_now
    where id = v_row.id
      and status = 'pending'
    returning * into v_row;

    if not found then
      continue;
    end if;

    v_global_running := v_global_running + 1;
    v_claimed := v_claimed || jsonb_build_array(
      jsonb_build_object(
        'id', v_row.id,
        'source_menu_id', v_row.source_menu_id,
        'contributor_user_id', v_row.contributor_user_id,
        'status', v_row.status,
        'claimed_at', v_row.claimed_at,
        'heartbeat_at', v_row.heartbeat_at,
        'created_at', v_row.created_at
      )
    );
  end loop;

  return jsonb_build_object('jobs', v_claimed);
end;
$function$;

revoke all on function public.claim_share_generalization_jobs(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_share_generalization_jobs(integer) to service_role;

-- ---------------------------------------------------------------------------
-- maintenance: share reaper 件数を閉じた 9 キー目として返す
-- ---------------------------------------------------------------------------
create or replace function public.run_kondate_maintenance(
  p_now timestamptz,
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_stale integer;
  v_ledgers integer;
  v_shopping integer;
  v_auth bigint;
  v_feedback integer;
  v_submissions integer;
  v_identity integer := 0;
  v_flyer integer := 0;
  v_share_reaped integer := 0;
  v_chunk integer;
  v_before timestamptz;
  v_identity_cutoff date;
  v_quality_month_cutoff date;
  v_flyer_week_cutoff date;
  v_flyer_stale integer;
begin
  if p_now is null or p_limit is null or p_limit < 1 or p_limit > 250 then
    raise exception using errcode = '22023', message = 'invalid_cleanup_batch';
  end if;

  v_before := p_now - interval '30 days';
  v_identity_cutoff := private.ai_jst_day(p_now) - 40;
  v_quality_month_cutoff := (
    date_trunc('month', private.ai_jst_day(p_now)::timestamp) - interval '1 month'
  )::date;
  v_flyer_week_cutoff := private.ai_jst_week_start(p_now) - 84;

  v_stale := public.cleanup_stale_ai_generations_batch(p_now, p_limit);
  v_flyer_stale := public.cleanup_stale_flyer_weekly_batch(p_now, p_limit);
  v_stale := v_stale + v_flyer_stale;
  -- 共有 job reaper: 件数は staleShareJobsReaped 専用（staleReservationsFinalized に混ぜない）
  v_share_reaped := public.reap_stale_share_jobs(p_now, p_limit);
  v_ledgers := public.cleanup_ai_generation_requests_batch(v_before, p_limit);
  v_shopping := private.cleanup_shopping_mutations(v_before, p_limit);
  v_auth := public.cleanup_auth_continuations_batch(p_now, p_limit);
  v_feedback := private.cleanup_user_feedback(v_before, p_limit);
  v_submissions := private.cleanup_generation_draft_submission_versions(v_before, p_limit);

  delete from private.ai_identity_daily_usage
  where ctid in (
    select ctid from private.ai_identity_daily_usage
    where usage_day < v_identity_cutoff
    limit p_limit
  );
  get diagnostics v_chunk = row_count;
  v_identity := v_identity + v_chunk;

  delete from private.ai_identity_daily_external_attempts
  where ctid in (
    select ctid from private.ai_identity_daily_external_attempts
    where usage_day < v_identity_cutoff
    limit p_limit
  );
  get diagnostics v_chunk = row_count;
  v_identity := v_identity + v_chunk;

  delete from private.ai_identity_quality_daily
  where ctid in (
    select ctid from private.ai_identity_quality_daily
    where usage_day < v_identity_cutoff
    limit p_limit
  );
  get diagnostics v_chunk = row_count;
  v_identity := v_identity + v_chunk;

  delete from private.ai_identity_quality_monthly
  where ctid in (
    select ctid from private.ai_identity_quality_monthly
    where usage_month < v_quality_month_cutoff
    limit p_limit
  );
  get diagnostics v_chunk = row_count;
  v_identity := v_identity + v_chunk;

  delete from private.ai_identity_flyer_weekly
  where ctid in (
    select ctid from private.ai_identity_flyer_weekly
    where week_start < v_flyer_week_cutoff
    limit p_limit
  );
  get diagnostics v_chunk = row_count;
  v_flyer := v_flyer + v_chunk;

  delete from private.ai_identity_flyer_weekly_tries
  where ctid in (
    select ctid from private.ai_identity_flyer_weekly_tries
    where week_start < v_flyer_week_cutoff
    limit p_limit
  );
  get diagnostics v_chunk = row_count;
  v_flyer := v_flyer + v_chunk;

  delete from private.flyer_weekly_requests
  where ctid in (
    select ctid from private.flyer_weekly_requests
    where status <> 'processing'
      and completed_at is not null
      and completed_at < v_before
    limit p_limit
  );
  get diagnostics v_chunk = row_count;
  v_flyer := v_flyer + v_chunk;

  return jsonb_build_object(
    'staleReservationsFinalized', v_stale,
    'generationLedgersDeleted', v_ledgers,
    'shoppingMutationsDeleted', v_shopping,
    'authContinuationsDeleted', v_auth,
    'userFeedbackDeleted', v_feedback,
    'draftSubmissionsDeleted', v_submissions,
    'identityLedgersDeleted', v_identity,
    'flyerLedgersDeleted', v_flyer,
    'staleShareJobsReaped', v_share_reaped
  );
end;
$function$;

revoke all on function public.run_kondate_maintenance(timestamptz, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.run_kondate_maintenance(timestamptz, integer)
  to kondate_maintenance_executor;
