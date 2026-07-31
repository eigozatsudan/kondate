-- U1-M2: return_to に埋め込み '//' を許さない（Function Zod と揃える）。
-- 先頭 protocol-relative '^//' 拒否は既存。'/planner//x' も拒否する。

do $$
declare
  return_to_check_count integer;
begin
  select count(*)::integer into return_to_check_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class t on t.oid = c.conrelid
  join pg_catalog.pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'private'
    and t.relname = 'auth_continuations'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%return_to%';

  if return_to_check_count <> 1 then
    raise exception 'expected exactly one return_to check constraint, found %',
      return_to_check_count;
  end if;

  alter table private.auth_continuations
    drop constraint auth_continuations_return_to_check;

  alter table private.auth_continuations
    add constraint auth_continuations_return_to_check
    check (
      char_length(return_to) <= 500
      and (
        return_to = '/'
        or (
          return_to ~ '^/[^/]'
          and return_to !~ '^//'
          and position('//' in return_to) = 0
        )
      )
    );
end
$$;
