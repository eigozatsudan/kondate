-- C2 residual: 匿名 deposit の毒 first-wins を閉じる。
-- 未 claim なら秘密無し deposit も暗号文を上書きできる（正当 WebView が後着でも回復）。
-- claim 後の上書きは引き続き不可。所有者 secret 付き上書きは従来どおり。
-- R1 residual-intentional: 正当 deposit 後の後着毒（可用性 DoS）も last-wins 側に残る。
-- first non-null wins に戻すと C2 が再発するため、本 RPC では last-wins を維持する。

create or replace function public.deposit_auth_continuation(
  p_id uuid,
  p_state_hash bytea,
  p_origin text,
  p_ciphertext bytea,
  p_iv bytea,
  p_now timestamptz,
  p_secret_hash bytea default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  continuation private.auth_continuations%rowtype;
  changed_count bigint;
begin
  select * into continuation
  from private.auth_continuations
  where id = p_id
  for update;
  if not found then
    return false;
  end if;

  if continuation.state_hash <> p_state_hash
    or continuation.origin <> p_origin
    or continuation.expires_at <= p_now
    or continuation.claimed_at is not null then
    return false;
  end if;

  -- 所有者: secret 一致なら未 claim の暗号文を上書きできる
  if p_secret_hash is not null then
    if continuation.secret_hash <> p_secret_hash then
      return false;
    end if;
    update private.auth_continuations
    set encrypted_code = p_ciphertext,
        code_iv = p_iv,
        deposited_at = p_now
    where id = p_id
      and claimed_at is null;
    get diagnostics changed_count = row_count;
    return changed_count = 1;
  end if;

  -- 匿名（WebView 等）: 未 claim なら上書き可（毒 first-wins を閉じる / R1 後着毒は許容）。
  -- 再送・後着の正当 code が観測者のゴミ code を覆せる。claim 後は上のガードで拒否。
  update private.auth_continuations
  set encrypted_code = p_ciphertext,
      code_iv = p_iv,
      deposited_at = p_now
  where id = p_id
    and claimed_at is null;
  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

revoke all on function public.deposit_auth_continuation(uuid, bytea, text, bytea, bytea, timestamptz, bytea)
  from public, anon, authenticated;
grant execute on function public.deposit_auth_continuation(uuid, bytea, text, bytea, bytea, timestamptz, bytea)
  to service_role;
