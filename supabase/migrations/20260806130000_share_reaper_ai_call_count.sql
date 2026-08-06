-- PE4: reap_stale_share_jobs が lease_expired 終端時に AI 台帳を載せない undercount を閉じる。
-- worker process / outer catch が finish 前に死んだ場合、Pass は最大 2 回まで実施済みの可能性がある。
-- 正常 finish/publish 済み job は status≠running のため reaper 対象外 → 二重計上しない。
-- 事前 AI=0 の running 残留に +2 する過計上は fail-closed（appDailyAiCallCap 側）を優先する。

create or replace function public.reap_stale_share_jobs(
  p_now timestamptz default clock_timestamp(),
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
declare
  v_now timestamptz;
  v_limit integer;
  v_threshold timestamptz;
  v_count integer := 0;
  v_day date;
  v_i integer;
begin
  v_now := coalesce(p_now, clock_timestamp());
  if p_limit is null or p_limit < 1 or p_limit > 250 then
    raise exception using errcode = '22023', message = 'invalid_reap_limit';
  end if;
  v_limit := p_limit;
  -- jobLeaseMinutes = 15
  v_threshold := v_now - interval '15 minutes';

  with stale as (
    select id
    from private.share_generalization_jobs
    where status = 'running'
      and coalesce(heartbeat_at, claimed_at) < v_threshold
    order by coalesce(heartbeat_at, claimed_at) asc
    for update skip locked
    limit v_limit
  )
  update private.share_generalization_jobs j
  set status = 'failed',
      failure_code = 'lease_expired',
      skip_reason = null,
      finished_at = v_now
  from stale
  where j.id = stale.id;

  get diagnostics v_count = row_count;

  -- 回収 1 件あたり Pass 上限 2 を保守計上（share_increment_ai_calls は 1 呼び出し ≤2）
  if v_count > 0 then
    v_day := private.ai_jst_day(v_now);
    for v_i in 1..v_count loop
      perform private.share_increment_ai_calls(v_day, 2);
    end loop;
  end if;

  return v_count;
end;
$function$;

revoke all on function public.reap_stale_share_jobs(timestamptz, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.reap_stale_share_jobs(timestamptz, integer) to service_role;
