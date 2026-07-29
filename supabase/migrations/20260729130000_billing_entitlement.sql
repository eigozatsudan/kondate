-- Plan: 2026-07-29 paid-plan-stripe Task 2
-- private billing 表 + SECURITY DEFINER 読取/書込 RPC（service_role のみ EXECUTE）。
-- 表への GRANT は一切なし（service_role 含む REVOKE ALL）。ADV-1 / r2 ロック。
-- 禁止: public.insert_billing_webhook_event を単独 claim RPC として export しない。
-- process_billing_stripe_event が claim + lock + order + project を単一 TX で実行する。

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- Stripe Customer ↔ Supabase user（1:1）
create table private.billing_customers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Webhook 正本の subscription 投影（ユーザー所有だが service_role のみ書込）
create table private.billing_subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_price_id text not null,
  status text not null
    check (status in (
      'trialing', 'active', 'past_due', 'canceled', 'unpaid',
      'incomplete', 'incomplete_expired', 'paused'
    )),
  cancel_at_period_end boolean not null default false,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  trial_end timestamptz null,
  past_due_since timestamptz null,
  -- 順序保護: この行を最後に更新した Stripe event.created（Unix 秒）
  last_stripe_event_created bigint not null default 0,
  last_stripe_event_id text null,
  updated_at timestamptz not null default now()
);

-- Webhook 冪等（event_id 単位。claim と投影は process RPC の同一 TX）
create table private.billing_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  stripe_event_created bigint not null,
  processed_at timestamptz not null default now()
);

-- トライアル消費履歴（user CASCADE 外。identity 残存）
create table private.billing_trial_history (
  identity_key text primary key check (identity_key ~ '^[a-f0-9]{64}$'),
  first_trial_at timestamptz not null default now()
);

-- Checkout 同時実行シリアライズ（lock_token で acquire → bind で session を CAS）
-- 設計の stripe_checkout_session_id NOT NULL を計画で上書き（NULL 許可）
create table private.billing_checkout_locks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  lock_token text not null unique,
  stripe_checkout_session_id text null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

revoke all on table private.billing_customers from public, anon, authenticated, service_role;
revoke all on table private.billing_subscriptions from public, anon, authenticated, service_role;
revoke all on table private.billing_webhook_events from public, anon, authenticated, service_role;
revoke all on table private.billing_trial_history from public, anon, authenticated, service_role;
revoke all on table private.billing_checkout_locks from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Private helpers
-- ---------------------------------------------------------------------------

-- timestamptz → ISO-8601 UTC（…Z、ミリ秒付き）。ADV-20
create or replace function private.billing_iso_z(p_ts timestamptz)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $function$
  select case
    when p_ts is null then null
    else to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  end;
$function$;

revoke all on function private.billing_iso_z(timestamptz)
  from public, anon, authenticated, service_role;

-- 終端性ランク（同一秒 merge 用）。大きいほど終端寄り。
-- canceled/unpaid/incomplete_expired > past_due > active/trialing > incomplete/paused
create or replace function private.billing_status_terminality_rank(p_status text)
returns integer
language sql
immutable
parallel safe
set search_path = pg_catalog
as $function$
  select case p_status
    when 'canceled' then 40
    when 'unpaid' then 40
    when 'incomplete_expired' then 40
    when 'past_due' then 30
    when 'active' then 20
    when 'trialing' then 20
    when 'incomplete' then 10
    when 'paused' then 10
    else 0
  end;
$function$;

revoke all on function private.billing_status_terminality_rank(text)
  from public, anon, authenticated, service_role;

-- jsonb の timestamptz 候補をパース（timestamptz 文字列 / ISO-Z）
create or replace function private.billing_payload_timestamptz(p_value jsonb)
returns timestamptz
language plpgsql
immutable
set search_path = pg_catalog
as $function$
begin
  if p_value is null or p_value = 'null'::jsonb then
    return null;
  end if;
  if jsonb_typeof(p_value) = 'string' then
    return (p_value #>> '{}')::timestamptz;
  end if;
  raise exception using errcode = '22023', message = 'invalid_billing_timestamptz';
end;
$function$;

revoke all on function private.billing_payload_timestamptz(jsonb)
  from public, anon, authenticated, service_role;

-- A6 判定: 行 + now → entitlement JSON（last_stripe_event_* は返さない）
create or replace function private.billing_entitlement_json(
  p_status text,
  p_cancel_at_period_end boolean,
  p_current_period_end timestamptz,
  p_trial_end timestamptz,
  p_past_due_since timestamptz,
  p_now timestamptz
)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog, private
as $function$
declare
  v_plus boolean := false;
  v_grace boolean := false;
  v_status text;
begin
  if p_status is null then
    return jsonb_build_object(
      'plan', 'free',
      'status', 'none',
      'plus_entitled', false,
      'past_due_grace', false,
      'current_period_end', null,
      'cancel_at_period_end', false,
      'trial_end', null,
      'db_plus_entitled', false,
      'past_due_since', null
    );
  end if;

  v_status := p_status;

  if v_status in ('trialing', 'active') then
    v_plus := true;
    v_grace := false;
  elsif v_status = 'past_due' then
    -- A6: past_due_since NULL は fail-closed（無限 Plus を作らない）
    if p_past_due_since is null then
      v_plus := false;
      v_grace := false;
    elsif p_now < p_past_due_since + interval '72 hours' then
      v_plus := true;
      v_grace := true;
    else
      v_plus := false;
      v_grace := false;
    end if;
  elsif v_status = 'canceled' then
    -- 期間末まで Plus 維持
    if p_current_period_end is not null and p_now < p_current_period_end then
      v_plus := true;
    else
      v_plus := false;
    end if;
    v_grace := false;
  else
    -- unpaid / incomplete / incomplete_expired / paused
    v_plus := false;
    v_grace := false;
  end if;

  return jsonb_build_object(
    'plan', case when v_plus then 'plus' else 'free' end,
    'status', v_status,
    'plus_entitled', v_plus,
    'past_due_grace', v_grace,
    'current_period_end', private.billing_iso_z(p_current_period_end),
    'cancel_at_period_end', coalesce(p_cancel_at_period_end, false),
    'trial_end', private.billing_iso_z(p_trial_end),
    'db_plus_entitled', v_plus,
    'past_due_since', private.billing_iso_z(p_past_due_since)
  );
end;
$function$;

revoke all on function private.billing_entitlement_json(
  text, boolean, timestamptz, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

-- subscription 投影の共通実装（process / upsert 共用）
-- p_force_apply=true は reconcile 用（順序無視で上書き）
create or replace function private.project_billing_subscription(
  p_user_id uuid,
  p_payload jsonb,
  p_force_apply boolean default false
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $function$
declare
  v_row private.billing_subscriptions%rowtype;
  v_has_row boolean := false;
  v_event_created bigint;
  v_event_id text;
  v_status text;
  v_price_id text;
  v_sub_id text;
  v_cancel boolean;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_trial_end timestamptz;
  v_past_due_since timestamptz;
  v_clear_past_due boolean;
  v_retrieved jsonb;
  v_new_rank integer;
  v_old_rank integer;
  v_apply boolean := false;
  v_outcome text;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_user_id';
  end if;

  v_event_id := nullif(p_payload ->> 'stripe_event_id', '');
  v_event_created := coalesce((p_payload ->> 'stripe_event_created')::bigint, 0);
  v_sub_id := nullif(p_payload ->> 'stripe_subscription_id', '');
  v_price_id := nullif(p_payload ->> 'stripe_price_id', '');
  v_status := nullif(p_payload ->> 'status', '');
  v_cancel := coalesce((p_payload ->> 'cancel_at_period_end')::boolean, false);
  v_period_start := private.billing_payload_timestamptz(p_payload -> 'current_period_start');
  v_period_end := private.billing_payload_timestamptz(p_payload -> 'current_period_end');
  v_trial_end := private.billing_payload_timestamptz(p_payload -> 'trial_end');
  v_past_due_since := private.billing_payload_timestamptz(p_payload -> 'past_due_since');
  v_clear_past_due := coalesce((p_payload ->> 'clear_past_due_since')::boolean, false);
  v_retrieved := p_payload -> 'retrieved_subscription';
  if v_retrieved is not null and v_retrieved = 'null'::jsonb then
    v_retrieved := null;
  end if;

  -- 行ロック（無ければ後続 insert）
  select * into v_row
  from private.billing_subscriptions
  where user_id = p_user_id
  for update;

  if found then
    v_has_row := true;
  end if;

  if not p_force_apply and v_has_row then
    if v_event_created < v_row.last_stripe_event_created then
      return 'stale_ignored';
    end if;

    if v_event_created = v_row.last_stripe_event_created then
      if v_event_id is not null and v_event_id = v_row.last_stripe_event_id then
        -- claim 段階で duplicate になるはずだが防御
        return 'duplicate_processed';
      end if;

      -- 同一秒: retrieved_subscription を正とする（Function が事前 retrieve）
      if v_retrieved is not null then
        v_status := coalesce(nullif(v_retrieved ->> 'status', ''), v_status);
        v_price_id := coalesce(nullif(v_retrieved ->> 'stripe_price_id', ''), v_price_id);
        v_sub_id := coalesce(nullif(v_retrieved ->> 'stripe_subscription_id', ''), v_sub_id);
        if v_retrieved ? 'cancel_at_period_end' then
          v_cancel := coalesce((v_retrieved ->> 'cancel_at_period_end')::boolean, v_cancel);
        end if;
        if v_retrieved ? 'current_period_start' then
          v_period_start := private.billing_payload_timestamptz(v_retrieved -> 'current_period_start');
        end if;
        if v_retrieved ? 'current_period_end' then
          v_period_end := private.billing_payload_timestamptz(v_retrieved -> 'current_period_end');
        end if;
        if v_retrieved ? 'trial_end' then
          v_trial_end := private.billing_payload_timestamptz(v_retrieved -> 'trial_end');
        end if;
        v_apply := true;
        v_outcome := 'applied';
      else
        -- retrieve 無し: 終端性優先。下がる遷移は skip
        v_new_rank := private.billing_status_terminality_rank(v_status);
        v_old_rank := private.billing_status_terminality_rank(v_row.status);
        if v_new_rank > v_old_rank
           or (
             v_period_end is not null
             and v_row.current_period_end is not null
             and v_period_end > v_row.current_period_end
           ) then
          v_apply := true;
          v_outcome := 'applied';
        else
          return 'same_second_skip';
        end if;
      end if;
    else
      -- event.created > last → 適用
      v_apply := true;
      v_outcome := 'applied';
    end if;
  else
    -- 行無し or force_apply
    v_apply := true;
    v_outcome := 'applied';
  end if;

  if not v_apply then
    return coalesce(v_outcome, 'same_second_skip');
  end if;

  if v_sub_id is null or v_price_id is null or v_status is null
     or v_period_start is null or v_period_end is null then
    raise exception using errcode = '22023', message = 'invalid_subscription_projection';
  end if;

  -- past_due_since 遷移
  if v_clear_past_due or v_status in ('active', 'trialing') then
    v_past_due_since := null;
  elsif v_status = 'past_due' then
    if v_has_row then
      v_past_due_since := coalesce(
        v_row.past_due_since,
        v_past_due_since,
        clock_timestamp()
      );
    else
      v_past_due_since := coalesce(v_past_due_since, clock_timestamp());
    end if;
  elsif v_has_row and not v_clear_past_due then
    -- 他 status は入力優先、無ければ既存維持（canceled 等でクリアしない）
    v_past_due_since := coalesce(v_past_due_since, v_row.past_due_since);
  end if;

  if v_has_row then
    update private.billing_subscriptions set
      stripe_subscription_id = v_sub_id,
      stripe_price_id = v_price_id,
      status = v_status,
      cancel_at_period_end = v_cancel,
      current_period_start = v_period_start,
      current_period_end = v_period_end,
      trial_end = v_trial_end,
      past_due_since = v_past_due_since,
      last_stripe_event_created = case
        when p_force_apply then greatest(coalesce(v_event_created, 0), last_stripe_event_created)
        when v_event_created > last_stripe_event_created then v_event_created
        else last_stripe_event_created
      end,
      last_stripe_event_id = coalesce(v_event_id, last_stripe_event_id),
      updated_at = clock_timestamp()
    where user_id = p_user_id;
  else
    insert into private.billing_subscriptions (
      user_id,
      stripe_subscription_id,
      stripe_price_id,
      status,
      cancel_at_period_end,
      current_period_start,
      current_period_end,
      trial_end,
      past_due_since,
      last_stripe_event_created,
      last_stripe_event_id,
      updated_at
    ) values (
      p_user_id,
      v_sub_id,
      v_price_id,
      v_status,
      v_cancel,
      v_period_start,
      v_period_end,
      v_trial_end,
      v_past_due_since,
      coalesce(v_event_created, 0),
      v_event_id,
      clock_timestamp()
    );
  end if;

  return coalesce(v_outcome, 'applied');
end;
$function$;

revoke all on function private.project_billing_subscription(uuid, jsonb, boolean)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Public RPCs
-- ---------------------------------------------------------------------------

create or replace function public.get_billing_entitlement_for_user(
  p_user_id uuid,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $function$
declare
  v_row private.billing_subscriptions%rowtype;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_user_id';
  end if;

  select * into v_row
  from private.billing_subscriptions
  where user_id = p_user_id;

  if not found then
    return private.billing_entitlement_json(
      null, false, null, null, null, coalesce(p_now, clock_timestamp())
    );
  end if;

  return private.billing_entitlement_json(
    v_row.status,
    v_row.cancel_at_period_end,
    v_row.current_period_end,
    v_row.trial_end,
    v_row.past_due_since,
    coalesce(p_now, clock_timestamp())
  );
end;
$function$;

create or replace function public.ensure_billing_customer(
  p_user_id uuid,
  p_stripe_customer_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $function$
declare
  v_row private.billing_customers%rowtype;
begin
  if p_user_id is null or p_stripe_customer_id is null or length(trim(p_stripe_customer_id)) = 0 then
    raise exception using errcode = '22023', message = 'invalid_billing_customer';
  end if;

  insert into private.billing_customers (user_id, stripe_customer_id, created_at, updated_at)
  values (p_user_id, p_stripe_customer_id, clock_timestamp(), clock_timestamp())
  on conflict (user_id) do update
    set stripe_customer_id = excluded.stripe_customer_id,
        updated_at = clock_timestamp()
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_row.user_id,
    'stripe_customer_id', v_row.stripe_customer_id
  );
end;
$function$;

-- Webhook 唯一の投影境界（crash-safe 単一 TX）
create or replace function public.process_billing_stripe_event(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $function$
declare
  v_event_id text;
  v_event_type text;
  v_event_created bigint;
  v_user_id uuid;
  v_skip boolean;
  v_outcome text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_billing_payload';
  end if;

  v_event_id := nullif(p_payload ->> 'stripe_event_id', '');
  v_event_type := coalesce(nullif(p_payload ->> 'event_type', ''), 'unknown');
  v_event_created := coalesce((p_payload ->> 'stripe_event_created')::bigint, 0);
  v_user_id := nullif(p_payload ->> 'user_id', '')::uuid;
  v_skip := coalesce((p_payload ->> 'skip_subscription_projection')::boolean, false);

  if v_event_id is null then
    raise exception using errcode = '22023', message = 'invalid_stripe_event_id';
  end if;

  -- 1. claim event（衝突 = 成功完了済みの再送のみ）
  begin
    insert into private.billing_webhook_events (
      stripe_event_id, event_type, stripe_event_created, processed_at
    ) values (
      v_event_id, v_event_type, v_event_created, clock_timestamp()
    );
  exception
    when unique_violation then
      return jsonb_build_object('ok', true, 'outcome', 'duplicate_processed');
  end;

  -- customer.* 等: event 記録のみ
  if v_skip then
    return jsonb_build_object('ok', true, 'outcome', 'event_only');
  end if;

  if v_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_user_id';
  end if;

  -- 2–4. lock + order + project（同一 TX）
  v_outcome := private.project_billing_subscription(v_user_id, p_payload, false);

  -- 5. mark processed = claim 行がこの TX に含まれコミットされること
  return jsonb_build_object('ok', true, 'outcome', v_outcome);
end;
$function$;

-- reconcile / 手動 runbook 専用（event claim なし）
create or replace function public.upsert_billing_subscription_from_stripe(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $function$
declare
  v_user_id uuid;
  v_outcome text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_billing_payload';
  end if;

  v_user_id := nullif(p_payload ->> 'user_id', '')::uuid;
  if v_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_user_id';
  end if;

  v_outcome := private.project_billing_subscription(v_user_id, p_payload, true);

  return jsonb_build_object('ok', true, 'outcome', v_outcome);
end;
$function$;

create or replace function public.insert_billing_trial_history(p_identity_key text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $function$
declare
  v_row_count integer := 0;
begin
  if p_identity_key is null or p_identity_key !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_identity_key';
  end if;

  insert into private.billing_trial_history (identity_key, first_trial_at)
  values (p_identity_key, clock_timestamp())
  on conflict (identity_key) do nothing;

  get diagnostics v_row_count = row_count;
  -- row_count は insert された行数（conflict 時 0）
  return jsonb_build_object(
    'ok', true,
    'inserted', (v_row_count > 0),
    'identity_key', p_identity_key
  );
end;
$function$;

create or replace function public.has_billing_trial_history(p_identity_key text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $function$
begin
  if p_identity_key is null or p_identity_key !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_identity_key';
  end if;

  return exists (
    select 1
    from private.billing_trial_history
    where identity_key = p_identity_key
  );
end;
$function$;

create or replace function public.acquire_billing_checkout_lock(
  p_user_id uuid,
  p_lock_token text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $function$
declare
  v_existing private.billing_checkout_locks%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_user_id is null
     or p_lock_token is null
     or length(trim(p_lock_token)) = 0
     or p_expires_at is null then
    raise exception using errcode = '22023', message = 'invalid_checkout_lock';
  end if;

  select * into v_existing
  from private.billing_checkout_locks
  where user_id = p_user_id
  for update;

  if found then
    if v_existing.expires_at > v_now then
      return jsonb_build_object(
        'ok', false,
        'failure_code', 'billing_checkout_in_progress'
      );
    end if;
    -- 期限切れ lock は上書き再取得
    delete from private.billing_checkout_locks where user_id = p_user_id;
  end if;

  -- lock_token UNIQUE 衝突も in_progress 扱い
  begin
    insert into private.billing_checkout_locks (
      user_id, lock_token, stripe_checkout_session_id, expires_at, created_at
    ) values (
      p_user_id, p_lock_token, null, p_expires_at, v_now
    );
  exception
    when unique_violation then
      return jsonb_build_object(
        'ok', false,
        'failure_code', 'billing_checkout_in_progress'
      );
  end;

  return jsonb_build_object('ok', true, 'lock_token', p_lock_token);
end;
$function$;

create or replace function public.bind_billing_checkout_session(
  p_user_id uuid,
  p_lock_token text,
  p_stripe_checkout_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $function$
declare
  v_row private.billing_checkout_locks%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_user_id is null
     or p_lock_token is null
     or p_stripe_checkout_session_id is null
     or length(trim(p_stripe_checkout_session_id)) = 0 then
    raise exception using errcode = '22023', message = 'invalid_checkout_bind';
  end if;

  select * into v_row
  from private.billing_checkout_locks
  where user_id = p_user_id
  for update;

  if not found
     or v_row.lock_token is distinct from p_lock_token
     or v_row.expires_at <= v_now then
    return jsonb_build_object(
      'ok', false,
      'failure_code', 'billing_checkout_bind_failed'
    );
  end if;

  -- 他 session が既 bind、または異なる session への上書きは失敗
  if v_row.stripe_checkout_session_id is not null
     and v_row.stripe_checkout_session_id is distinct from p_stripe_checkout_session_id then
    return jsonb_build_object(
      'ok', false,
      'failure_code', 'billing_checkout_bind_failed'
    );
  end if;

  update private.billing_checkout_locks
  set stripe_checkout_session_id = p_stripe_checkout_session_id
  where user_id = p_user_id
    and lock_token = p_lock_token;

  return jsonb_build_object(
    'ok', true,
    'lock_token', p_lock_token,
    'stripe_checkout_session_id', p_stripe_checkout_session_id
  );
end;
$function$;

create or replace function public.release_billing_checkout_lock(
  p_user_id uuid,
  p_lock_token text default null,
  p_stripe_checkout_session_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $function$
declare
  v_deleted integer := 0;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_user_id';
  end if;

  -- 両方 null は no-op（user 単独での解放を禁止）
  if p_lock_token is null and p_stripe_checkout_session_id is null then
    return jsonb_build_object('ok', true, 'released', false);
  end if;

  delete from private.billing_checkout_locks
  where user_id = p_user_id
    and (
      (p_lock_token is not null and lock_token = p_lock_token)
      or (
        p_stripe_checkout_session_id is not null
        and stripe_checkout_session_id = p_stripe_checkout_session_id
      )
    );

  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'ok', true,
    'released', (v_deleted > 0)
  );
end;
$function$;

create or replace function public.get_billing_customer_by_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $function$
declare
  v_customer_id text;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_user_id';
  end if;

  select stripe_customer_id into v_customer_id
  from private.billing_customers
  where user_id = p_user_id;

  if not found then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object('stripe_customer_id', v_customer_id);
end;
$function$;

create or replace function public.get_billing_customer_by_stripe_id(p_stripe_customer_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $function$
declare
  v_user_id uuid;
begin
  if p_stripe_customer_id is null or length(trim(p_stripe_customer_id)) = 0 then
    raise exception using errcode = '22023', message = 'invalid_stripe_customer_id';
  end if;

  select user_id into v_user_id
  from private.billing_customers
  where stripe_customer_id = p_stripe_customer_id;

  if not found then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'user_id', v_user_id,
    'stripe_customer_id', p_stripe_customer_id
  );
end;
$function$;

-- dual-sub: DB 行を keep 側 subscription id に揃える（Stripe cancel は Function 側）
create or replace function public.mark_billing_subscription_dual_cancel_keep(
  p_user_id uuid,
  p_keep_stripe_subscription_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $function$
declare
  v_row private.billing_subscriptions%rowtype;
begin
  if p_user_id is null
     or p_keep_stripe_subscription_id is null
     or length(trim(p_keep_stripe_subscription_id)) = 0 then
    raise exception using errcode = '22023', message = 'invalid_dual_cancel_keep';
  end if;

  select * into v_row
  from private.billing_subscriptions
  where user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'failure_code', 'billing_subscription_missing'
    );
  end if;

  update private.billing_subscriptions
  set stripe_subscription_id = p_keep_stripe_subscription_id,
      updated_at = clock_timestamp()
  where user_id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'stripe_subscription_id', p_keep_stripe_subscription_id
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Grants: public RPCs → service_role only
-- ---------------------------------------------------------------------------

revoke all on function public.get_billing_entitlement_for_user(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_billing_entitlement_for_user(uuid, timestamptz)
  to service_role;

revoke all on function public.ensure_billing_customer(uuid, text)
  from public, anon, authenticated;
grant execute on function public.ensure_billing_customer(uuid, text)
  to service_role;

revoke all on function public.process_billing_stripe_event(jsonb)
  from public, anon, authenticated;
grant execute on function public.process_billing_stripe_event(jsonb)
  to service_role;

revoke all on function public.upsert_billing_subscription_from_stripe(jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_billing_subscription_from_stripe(jsonb)
  to service_role;

revoke all on function public.insert_billing_trial_history(text)
  from public, anon, authenticated;
grant execute on function public.insert_billing_trial_history(text)
  to service_role;

revoke all on function public.has_billing_trial_history(text)
  from public, anon, authenticated;
grant execute on function public.has_billing_trial_history(text)
  to service_role;

revoke all on function public.acquire_billing_checkout_lock(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.acquire_billing_checkout_lock(uuid, text, timestamptz)
  to service_role;

revoke all on function public.bind_billing_checkout_session(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.bind_billing_checkout_session(uuid, text, text)
  to service_role;

revoke all on function public.release_billing_checkout_lock(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.release_billing_checkout_lock(uuid, text, text)
  to service_role;

revoke all on function public.get_billing_customer_by_user(uuid)
  from public, anon, authenticated;
grant execute on function public.get_billing_customer_by_user(uuid)
  to service_role;

revoke all on function public.get_billing_customer_by_stripe_id(text)
  from public, anon, authenticated;
grant execute on function public.get_billing_customer_by_stripe_id(text)
  to service_role;

revoke all on function public.mark_billing_subscription_dual_cancel_keep(uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_billing_subscription_dual_cancel_keep(uuid, text)
  to service_role;
