-- maintenance: identity / quality / flyer 台帳の削除件数を返却 JSON と safeLog で可視化する（S8）。
-- 既存 6 カウンタに identityLedgersDeleted / flyerLedgersDeleted を追加（厳密 8 キー）。

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
  -- 月次: 現在 JST 月の 1 日 − 1 ヶ月（= 現在月と前月だけ残し、それより古い usage_month を削除）
  v_quality_month_cutoff := (
    date_trunc('month', private.ai_jst_day(p_now)::timestamp) - interval '1 month'
  )::date;
  v_flyer_week_cutoff := private.ai_jst_week_start(p_now) - 84; -- 12 週 × 7 日

  v_stale := public.cleanup_stale_ai_generations_batch(p_now, p_limit);
  v_flyer_stale := public.cleanup_stale_flyer_weekly_batch(p_now, p_limit);
  v_stale := v_stale + v_flyer_stale;
  v_ledgers := public.cleanup_ai_generation_requests_batch(v_before, p_limit);
  v_shopping := private.cleanup_shopping_mutations(v_before, p_limit);
  v_auth := public.cleanup_auth_continuations_batch(p_now, p_limit);
  v_feedback := private.cleanup_user_feedback(v_before, p_limit);
  v_submissions := private.cleanup_generation_draft_submission_versions(v_before, p_limit);

  -- identity 日次: 古い行を p_limit 件ずつ削除（無界 DELETE 禁止）
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

  -- quality identity: daily は 40 JST 日、monthly は現在+前月以外
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

  -- flyer 台帳 12 週より古い週を p_limit 件ずつ削除
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

  -- 終端 flyer request も 30 日 retention（generation と同型・有界）
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
    'flyerLedgersDeleted', v_flyer
  );
end;
$function$;

revoke all on function public.run_kondate_maintenance(timestamptz, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.run_kondate_maintenance(timestamptz, integer)
  to kondate_maintenance_executor;
