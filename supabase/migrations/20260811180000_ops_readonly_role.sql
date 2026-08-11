-- ローカル運用管理コンソール用 SELECT 専用ロール。
-- LOGIN パスワードは scripts/provision-ops-readonly-role.sh / 本番管理者手順で付与する。
-- service_role や PostgREST 公開は拡大しない。

do $body$
begin
  if not exists (select 1 from pg_roles where rolname = 'kondate_ops_readonly') then
    create role kondate_ops_readonly
      nologin
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls;
  end if;
end
$body$;

alter role kondate_ops_readonly set statement_timeout = '15s';
alter role kondate_ops_readonly set default_transaction_read_only = on;

grant usage on schema public to kondate_ops_readonly;
grant usage on schema private to kondate_ops_readonly;

grant select on public.user_feedback to kondate_ops_readonly;
grant select on private.ai_generation_requests to kondate_ops_readonly;
grant select on private.ai_global_daily_usage to kondate_ops_readonly;
grant select on private.billing_subscriptions to kondate_ops_readonly;
grant select on private.billing_webhook_events to kondate_ops_readonly;
grant select on private.share_generalization_jobs to kondate_ops_readonly;

-- RLS 有効表は GRANT だけでは 0 行になる（policy 必須）
drop policy if exists user_feedback_ops_readonly_select on public.user_feedback;
create policy user_feedback_ops_readonly_select
  on public.user_feedback
  for select
  to kondate_ops_readonly
  using (true);

create index if not exists ai_generation_requests_ops_created_id_idx
  on private.ai_generation_requests (created_at desc, id desc);

create index if not exists user_feedback_ops_created_id_idx
  on public.user_feedback (created_at desc, id desc);
