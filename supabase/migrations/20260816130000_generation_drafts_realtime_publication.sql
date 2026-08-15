-- PE-R1: 緊急候補が購読する generation_drafts を supabase_realtime に載せる。
-- 家族表を触らない下書き対象追加を、他タブ／他端末へ postgres_changes で届ける。
-- RLS / GRANT / quota は変えない。replica identity full は user_id フィルタの UPDATE 用。

do $block$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='generation_drafts') then
    execute 'alter publication supabase_realtime add table public.generation_drafts';
  end if;
end;
$block$;
alter table public.generation_drafts replica identity full;
