-- 今週の献立（週献立）の保存先。チラシ週次の request_id を正とし FK は張らない
-- （private.flyer_weekly_requests は別スキーマで retention が別サイクルのため）。

create table public.weekly_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  source text not null check (source in ('household')),
  request_id uuid not null unique,
  preference_snapshot jsonb not null,
  safety_fingerprint text not null check (safety_fingerprint ~ '^[a-f0-9]{64}$'),
  days jsonb not null,
  created_at timestamptz not null default now()
);

create index weekly_plans_user_created_idx on public.weekly_plans (user_id, created_at desc);

alter table public.weekly_plans enable row level security;
revoke all on public.weekly_plans from anon, authenticated;
grant select on public.weekly_plans to authenticated;
create policy weekly_plans_owner_select on public.weekly_plans
  for select to authenticated using ((select auth.uid()) = user_id);
-- Function の admin insert が本番で 42501 にならないよう明示（user_feedback / user_share_consents と同型）。
grant all on table public.weekly_plans to service_role;
