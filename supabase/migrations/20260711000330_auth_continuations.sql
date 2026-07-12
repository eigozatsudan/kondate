create table private.auth_continuations (
  id uuid primary key default gen_random_uuid(),
  state_hash bytea not null check (octet_length(state_hash) = 32),
  secret_hash bytea not null check (octet_length(secret_hash) = 32),
  origin text not null check (origin ~ '^https?://[^/]+$'),
  return_to text not null check (return_to ~ '^/[^/]' and char_length(return_to) <= 500),
  encrypted_code bytea,
  code_iv bytea check (code_iv is null or octet_length(code_iv) = 12),
  deposited_at timestamptz,
  claimed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  check ((encrypted_code is null) = (code_iv is null)),
  check (claimed_at is null or encrypted_code is null)
);

revoke all on private.auth_continuations from public, anon, authenticated;

create or replace function public.cleanup_auth_continuations(p_now timestamptz)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare deleted_count bigint;
begin
  delete from private.auth_continuations where expires_at <= p_now;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.create_auth_continuation(
  p_state_hash bytea,
  p_secret_hash bytea,
  p_origin text,
  p_return_to text,
  p_now timestamptz,
  p_ttl_seconds integer
)
returns table(id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ttl_seconds <> 300 then
    raise exception 'invalid continuation ttl' using errcode = '22023';
  end if;
  perform public.cleanup_auth_continuations(p_now);
  return query
  insert into private.auth_continuations as continuation (
    state_hash, secret_hash, origin, return_to, created_at, expires_at
  ) values (
    p_state_hash, p_secret_hash, p_origin, p_return_to, p_now,
    p_now + make_interval(secs => p_ttl_seconds)
  ) returning continuation.id, continuation.expires_at;
end;
$$;

create or replace function public.deposit_auth_continuation(
  p_id uuid,
  p_state_hash bytea,
  p_origin text,
  p_ciphertext bytea,
  p_iv bytea,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare changed_count bigint;
begin
  update private.auth_continuations
  set encrypted_code = p_ciphertext, code_iv = p_iv, deposited_at = p_now
  where id = p_id and state_hash = p_state_hash and origin = p_origin and expires_at > p_now
    and claimed_at is null and deposited_at is null;
  get diagnostics changed_count = row_count;
  if changed_count = 1 then return true; end if;
  -- 再送では既存の暗号文を維持し、認証コードの上書きを許可しない。
  return exists(
    select 1 from private.auth_continuations
    where id = p_id and state_hash = p_state_hash and origin = p_origin and expires_at > p_now
      and deposited_at is not null and claimed_at is null
  );
end;
$$;

create or replace function public.claim_auth_continuation(
  p_id uuid,
  p_state_hash bytea,
  p_secret_hash bytea,
  p_origin text,
  p_now timestamptz
)
returns table(encrypted_code bytea, code_iv bytea, return_to text)
language plpgsql
security definer
set search_path = ''
as $$
declare continuation private.auth_continuations%rowtype;
begin
  select * into continuation from private.auth_continuations where id = p_id for update;
  if not found or continuation.state_hash <> p_state_hash or continuation.secret_hash <> p_secret_hash
    or continuation.origin <> p_origin or continuation.expires_at <= p_now
    or continuation.claimed_at is not null or continuation.encrypted_code is null then
    return;
  end if;
  update private.auth_continuations
  set claimed_at = p_now, encrypted_code = null, code_iv = null
  where id = p_id;
  return query select continuation.encrypted_code, continuation.code_iv, continuation.return_to;
end;
$$;

revoke all on function public.cleanup_auth_continuations(timestamptz),
  public.create_auth_continuation(bytea, bytea, text, text, timestamptz, integer),
  public.deposit_auth_continuation(uuid, bytea, text, bytea, bytea, timestamptz),
  public.claim_auth_continuation(uuid, bytea, bytea, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.cleanup_auth_continuations(timestamptz),
  public.create_auth_continuation(bytea, bytea, text, text, timestamptz, integer),
  public.deposit_auth_continuation(uuid, bytea, text, bytea, bytea, timestamptz),
  public.claim_auth_continuation(uuid, bytea, bytea, text, timestamptz)
  to service_role;
