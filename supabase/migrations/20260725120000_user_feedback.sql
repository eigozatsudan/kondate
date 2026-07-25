-- 利用者からの機能改善・不具合報告。本文は free-form だがログへは出さない。
-- 本人 insert/select のみ。運営読取は service_role（RLS 外）を想定。

create table public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  category text not null
    check (category in ('feature_request', 'bug_report', 'other')),
  body text not null
    check (char_length(btrim(body)) between 10 and 2000),
  client_path text
    check (client_path is null or char_length(client_path) between 1 and 200),
  created_at timestamptz not null default now()
);

create index user_feedback_user_created_idx
  on public.user_feedback (user_id, created_at desc);

alter table public.user_feedback enable row level security;

create policy user_feedback_insert_own
  on public.user_feedback
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy user_feedback_select_own
  on public.user_feedback
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.user_feedback from public;
grant select, insert on public.user_feedback to authenticated;
grant all on public.user_feedback to service_role;
