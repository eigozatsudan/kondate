-- B-I2 精緻化: claim 失敗は行を消去するが、未 deposit の正当ポーリングは副作用なし
-- （正しい state/secret/origin・未期限・未 claim・encrypted_code IS NULL のとき行を残す）

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

  -- 未 deposit の正当待機: 資格情報は正しいが WebView がまだ code を置いていない。
  -- 元ブラウザのポーリングを壊さないよう、削除も claimed_at 更新も行わず空を返す。
  if continuation.state_hash = p_state_hash
    and continuation.secret_hash = p_secret_hash
    and continuation.origin = p_origin
    and continuation.expires_at > p_now
    and continuation.claimed_at is null
    and continuation.encrypted_code is null then
    return;
  end if;

  -- 成功条件を満たさない場合（誤資格情報・期限切れ・再 claim 等）は行ごと削除して空を返す
  if continuation.state_hash <> p_state_hash
    or continuation.secret_hash <> p_secret_hash
    or continuation.origin <> p_origin
    or continuation.expires_at <= p_now
    or continuation.claimed_at is not null
    or continuation.encrypted_code is null then
    delete from private.auth_continuations where id = p_id;
    return;
  end if;

  -- 成功: ciphertext を一度だけ返し、code を消去して claimed_at を立てる
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
