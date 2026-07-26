-- B-I2: claim 失敗時も code と continuation を消去する（設計 §5 / §475）

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
  if not found then
    return;
  end if;

  -- 成功条件を満たさない場合は行ごと削除してから空を返す（再試行不能・仕様どおり厳格）
  if continuation.state_hash <> p_state_hash
    or continuation.secret_hash <> p_secret_hash
    or continuation.origin <> p_origin
    or continuation.expires_at <= p_now
    or continuation.claimed_at is not null
    or continuation.encrypted_code is null then
    delete from private.auth_continuations where id = p_id;
    return;
  end if;

  update private.auth_continuations
  set claimed_at = p_now, encrypted_code = null, code_iv = null
  where id = p_id;
  return query select continuation.encrypted_code, continuation.code_iv, continuation.return_to;
end;
$$;

revoke all on function public.claim_auth_continuation(uuid, bytea, bytea, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_auth_continuation(uuid, bytea, bytea, text, timestamptz)
  to service_role;
