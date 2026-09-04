-- supabase/migrations/20260903122000_weekly_plan_maintenance_intents.sql
-- run_kondate_maintenance を再定義し、weekly_plan_intents の孤児回収を本体に加える。
-- クローン元: 20260801200000_share_claim_reaper_counts.sql（本文はそのままコピーし、
-- intent 削除のロジックだけ差し込む）。戻り jsonb のキー数は 9 のまま変えない
-- （intent の削除件数は既存 flyerLedgersDeleted に合算する）。

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

  -- 週献立 intent の孤児回収（N-C-3: 新しい戻りキーは足さず flyerLedgersDeleted に合算）。
  -- 対応 request が failed かつ 24h 経過、または succeeded かつ weekly_plans 行が既にある
  -- （delete 取りこぼし）ものだけを消す。succeeded で public 行が無い intent と
  -- processing の intent は persist 再試行用に残す。
  delete from private.weekly_plan_intents wpi
  where wpi.ctid in (
    select wpi2.ctid
    from private.weekly_plan_intents wpi2
    join private.flyer_weekly_requests fwr on fwr.id = wpi2.request_id
    where (
      (fwr.status = 'failed' and fwr.completed_at is not null and fwr.completed_at < p_now - interval '24 hours')
      or (
        fwr.status = 'succeeded'
        and exists (select 1 from public.weekly_plans wp where wp.request_id = wpi2.request_id)
      )
    )
    limit p_limit
  );
  get diagnostics v_chunk = row_count;
  v_flyer := v_flyer + v_chunk;

  -- 対応する request 行自体が無い intent は request の retention 削除に合わせて消す。
  delete from private.weekly_plan_intents wpi
  where wpi.ctid in (
    select wpi3.ctid
    from private.weekly_plan_intents wpi3
    where not exists (
      select 1 from private.flyer_weekly_requests fwr2 where fwr2.id = wpi3.request_id
    )
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
