-- C1: 誤 secret/state/origin の claim で行を焼かない（UUID 既知の pre-deposit DoS を閉じる）
-- C2: 所有者 secret 付き deposit は未 claim なら暗号文を上書き可（毒 first-wins の同ブラウザ回復）
-- C3: 成功 claim 後も TTL 内は ciphertext を保持し、同一資格情報での再 claim を冪等に返す

-- claimed 後も ciphertext を残すため、claimed_at と encrypted_code を結ぶ check を外す
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'private'
      and t.relname = 'auth_continuations'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%claimed_at%'
      and pg_get_constraintdef(c.oid) ilike '%encrypted_code%'
  loop
    execute format(
      'alter table private.auth_continuations drop constraint %I',
      constraint_name
    );
  end loop;
end;
$$;

-- C2: deposit に任意の secret_hash を追加（NULL = 匿名 first-wins、一致 = 所有者上書き）
drop function if exists public.deposit_auth_continuation(uuid, bytea, text, bytea, bytea, timestamptz);

create function public.deposit_auth_continuation(
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

  -- 所有者: secret 一致なら未 claim の暗号文を上書きできる（毒 first-wins 回復）
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

  -- 匿名（WebView 等）: 初回だけ書き込み。再送は暗号文を替えず true（同一リクエスト再送）
  update private.auth_continuations
  set encrypted_code = p_ciphertext,
      code_iv = p_iv,
      deposited_at = p_now
  where id = p_id
    and deposited_at is null
    and claimed_at is null;
  get diagnostics changed_count = row_count;
  if changed_count = 1 then
    return true;
  end if;
  return exists(
    select 1
    from private.auth_continuations
    where id = p_id
      and state_hash = p_state_hash
      and origin = p_origin
      and expires_at > p_now
      and deposited_at is not null
      and claimed_at is null
  );
end;
$$;

revoke all on function public.deposit_auth_continuation(uuid, bytea, text, bytea, bytea, timestamptz, bytea)
  from public, anon, authenticated;
grant execute on function public.deposit_auth_continuation(uuid, bytea, text, bytea, bytea, timestamptz, bytea)
  to service_role;

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
declare
  continuation private.auth_continuations%rowtype;
begin
  select * into continuation
  from private.auth_continuations
  where id = p_id
  for update;
  if not found then
    return;
  end if;

  -- C1: 資格情報・origin 不一致は行を消さない（UUID のみの消去 DoS を防ぐ）
  if continuation.state_hash <> p_state_hash
    or continuation.secret_hash <> p_secret_hash
    or continuation.origin <> p_origin then
    return;
  end if;

  -- 期限切れ: 掃除して空
  if continuation.expires_at <= p_now then
    delete from private.auth_continuations where id = p_id;
    return;
  end if;

  -- 未 deposit の正当待機: 削除も claimed_at 更新もせず空（ポーリング）
  if continuation.claimed_at is null and continuation.encrypted_code is null then
    return;
  end if;

  -- 成功済みの冪等再提示（C3）: 同一資格情報なら TTL 内で同じ ciphertext を返す
  if continuation.claimed_at is not null then
    if continuation.encrypted_code is null or continuation.code_iv is null then
      -- 旧行（burn 済み）は再提示不能。行は残さず消して 404 相当へ
      delete from private.auth_continuations where id = p_id;
      return;
    end if;
    return query
    select continuation.encrypted_code, continuation.code_iv, continuation.return_to;
    return;
  end if;

  -- 初回成功: claimed_at を立てるが ciphertext は TTL まで残す（C3 再提示用）
  update private.auth_continuations
  set claimed_at = p_now
  where id = p_id;
  return query
  select continuation.encrypted_code, continuation.code_iv, continuation.return_to;
end;
$$;

revoke all on function public.claim_auth_continuation(uuid, bytea, bytea, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_auth_continuation(uuid, bytea, bytea, text, timestamptz)
  to service_role;
