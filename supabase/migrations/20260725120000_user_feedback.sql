-- 利用者からの機能改善・不具合報告。本文は free-form だがログへは出さない。
-- ブラウザ（authenticated/anon）からは直接触れない。
-- 書き込みは Netlify Function が service_role 経由でのみ行い、rate limit も Function 側。

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

-- RLS は有効のまま（ポリシー無し = authenticated/anon は deny）。
-- ブラウザ向け policy/grant は置かず、service_role のみが Data API 外で操作する。
alter table public.user_feedback enable row level security;

revoke all on public.user_feedback from public;
revoke all on public.user_feedback from anon;
revoke all on public.user_feedback from authenticated;
grant all on public.user_feedback to service_role;
