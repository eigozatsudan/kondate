-- B-I5: 裸の return_to='/' を許可し RootEntry へ戻せるようにする。
-- '//' で始まる protocol-relative は従来どおり拒否（旧 '^/[^/]' は / 単体を弾いていた）。

do $$
declare
  return_to_check_count integer;
begin
  select count(*)::integer into return_to_check_count
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
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
end
$$;

alter table private.auth_continuations
  add constraint auth_continuations_return_to_check
  check (
    char_length(return_to) <= 500
    and (
      return_to = '/'
      or (
        return_to ~ '^/[^/]'
        and return_to !~ '^//'
      )
    )
  );
