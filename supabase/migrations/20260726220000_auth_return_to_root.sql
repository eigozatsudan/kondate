-- B-I5: 裸の return_to='/' を許可し RootEntry へ戻せるようにする。
-- '//' で始まる protocol-relative は従来どおり拒否（旧 '^/[^/]' は / 単体を弾いていた）。

do $$
declare
  constraint_name text;
begin
  select c.conname into constraint_name
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'private'
    and t.relname = 'auth_continuations'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%return_to%';
  limit 1;

  if constraint_name is not null then
    execute format(
      'alter table private.auth_continuations drop constraint %I',
      constraint_name
    );
  end if;
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
