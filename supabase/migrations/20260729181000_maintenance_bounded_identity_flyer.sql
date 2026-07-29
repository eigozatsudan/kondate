-- maintenance: identity / flyer 台帳削除を p_limit で有界化し、20s トランザクション内で
-- 部分進捗できるようにする（無界 DELETE が全件 rollback するのを防ぐ）。

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
  v_before timestamptz;
  v_identity_cutoff date;
  v_flyer_week_cutoff date;
  v_flyer_stale integer;
begin
  if p_now is null or p_limit is null or p_limit < 1 or p_limit > 250 then
    raise exception using errcode = '22023', message = 'invalid_cleanup_batch';
  end if;

  v_before := p_now - interval '30 days';
  v_identity_cutoff := private.ai_jst_day(p_now) - 40;
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
  delete from private.ai_identity_daily_external_attempts
  where ctid in (
    select ctid from private.ai_identity_daily_external_attempts
    where usage_day < v_identity_cutoff
    limit p_limit
  );

  -- flyer 台帳 12 週より古い週を p_limit 件ずつ削除
  delete from private.ai_identity_flyer_weekly
  where ctid in (
    select ctid from private.ai_identity_flyer_weekly
    where week_start < v_flyer_week_cutoff
    limit p_limit
  );
  delete from private.ai_identity_flyer_weekly_tries
  where ctid in (
    select ctid from private.ai_identity_flyer_weekly_tries
    where week_start < v_flyer_week_cutoff
    limit p_limit
  );
  -- 終端 flyer request も 30 日 retention（generation と同型・有界）
  delete from private.flyer_weekly_requests
  where ctid in (
    select ctid from private.flyer_weekly_requests
    where status <> 'processing'
      and completed_at is not null
      and completed_at < v_before
    limit p_limit
  );

  return jsonb_build_object(
    'staleReservationsFinalized', v_stale,
    'generationLedgersDeleted', v_ledgers,
    'shoppingMutationsDeleted', v_shopping,
    'authContinuationsDeleted', v_auth,
    'userFeedbackDeleted', v_feedback,
    'draftSubmissionsDeleted', v_submissions
  );
end;
$function$;

revoke all on function public.run_kondate_maintenance(timestamptz, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.run_kondate_maintenance(timestamptz, integer)
  to kondate_maintenance_executor;
