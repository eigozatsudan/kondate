-- HR6: 他デバイスの dislike 追加を履歴再検証へ即時届ける。
-- household_members / member_allergies と同じ publication + replica identity full。
-- RLS / GRANT / quota は変えない。

do $block$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='member_dislikes') then
    execute 'alter publication supabase_realtime add table public.member_dislikes';
  end if;
end;
$block$;
alter table public.member_dislikes replica identity full;
