-- C9: return_to の CHECK を Function Zod / client isSafeAuthReturnTo と同型に揃える。
-- 既存は '//' と長さ中心。'\' と制御文字 (U+0000–U+001F, U+007F) も DB 単体で拒否する。
-- 正当な return_to は '/' 始まりの相対パスのみのため、既存正当データは落ちない。

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
      -- C9: '\' と制御文字は常に拒否（'/' 単体・相対パス双方。JS isSafeAuthReturnTo と同型）
      and position(E'\\' in return_to) = 0
      and return_to !~ E'[\\x00-\\x1f\\x7f]'
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
