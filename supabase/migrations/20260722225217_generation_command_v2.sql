-- Plan 7 Task 4: generation-command.v2 と request-bound regeneration snapshot。
-- Task 3 の household-only 14 引数 reserve ブリッジを 15 引数 v2 へ原子的に置換する。
-- 旧版 command reader / v1 HMAC は未デプロイのため移行せず、v2 だけを許可する。

-- ---------------------------------------------------------------------------
-- 1. request HMAC version CHECK を v2 専用へ置換
-- ---------------------------------------------------------------------------
alter table private.ai_generation_requests
  drop constraint if exists ai_generation_requests_request_hmac_version_check;

alter table private.ai_generation_requests
  add constraint ai_generation_requests_request_hmac_version_check
  check (request_hmac_version = 'generation-command.v2');

-- snapshot の owner 複合 FK 用。(id) は PK なので (id,user_id) UNIQUE を追加する。
alter table private.ai_generation_requests
  add constraint ai_generation_requests_id_user_id_key unique (id, user_id);

-- ---------------------------------------------------------------------------
-- 2. 対象家族配列の immutable 検証 helper
-- ---------------------------------------------------------------------------
create or replace function private.is_valid_generation_target_member_ids(
  p_value uuid[],
  p_target_mode text
) returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    p_value is not null
    -- 空配列は array_ndims が NULL になるため 0 件を先に許可する
    and (
      pg_catalog.cardinality(p_value) = 0
      or pg_catalog.array_ndims(p_value) is not distinct from 1
    )
    and pg_catalog.array_position(p_value, null) is null
    -- 重複 ID は count(distinct) と cardinality の不一致で拒否する
    and pg_catalog.cardinality(p_value) = (
      select pg_catalog.count(distinct member_id)::integer
      from pg_catalog.unnest(p_value) as members(member_id)
    )
    and (
      (p_target_mode = 'household' and pg_catalog.cardinality(p_value) between 1 and 20)
      or (p_target_mode = 'idea' and pg_catalog.cardinality(p_value) = 0)
    );
$$;

revoke all on function private.is_valid_generation_target_member_ids(uuid[], text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. request-bound regeneration snapshot（immutable・owner 複合 FK・cascade）
-- ---------------------------------------------------------------------------
create table private.generation_regeneration_snapshots (
  request_id uuid primary key,
  user_id uuid not null,
  kind text not null check (kind in ('regenerate_menu', 'regenerate_dish')),
  source_menu_id uuid not null,
  source_menu_version integer not null check (source_menu_version > 0),
  replace_dish_id uuid,
  target_mode text not null check (target_mode in ('household', 'idea')),
  servings integer not null check (servings between 1 and 20),
  target_member_ids uuid[] not null default '{}',
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key (request_id, user_id)
    references private.ai_generation_requests(id, user_id) on delete cascade,
  check ((kind = 'regenerate_dish') = (replace_dish_id is not null)),
  check (private.is_valid_generation_target_member_ids(target_member_ids, target_mode))
);

create or replace function private.reject_generation_regeneration_snapshot_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'generation_regeneration_snapshot_immutable';
end;
$$;

create trigger generation_regeneration_snapshots_immutable
  before update on private.generation_regeneration_snapshots
  for each row execute function private.reject_generation_regeneration_snapshot_update();

revoke all on table private.generation_regeneration_snapshots
  from public, anon, authenticated;
revoke all on function private.reject_generation_regeneration_snapshot_update()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. integrity_context jsonb の検証 helper
-- ---------------------------------------------------------------------------
create or replace function private.is_valid_generation_integrity_context(
  p_context jsonb,
  p_request_kind text
) returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    p_context is not null
    and pg_catalog.jsonb_typeof(p_context) = 'object'
    and p_context->>'kind' is not distinct from p_request_kind
    and p_context->>'target_mode' in ('household', 'idea')
    and (
      select pg_catalog.count(*)::integer
      from pg_catalog.jsonb_object_keys(p_context) as keys(key)
    ) = 5
    and (p_context ? 'kind')
    and (p_context ? 'target_mode')
    and (p_context ? 'servings')
    and (p_context ? 'target_member_ids')
    and (p_context ? 'source_menu_version')
    and pg_catalog.jsonb_typeof(p_context->'target_member_ids') = 'array'
    and private.is_valid_generation_target_member_ids(
      coalesce(
        (
          select pg_catalog.array_agg(elem::uuid order by ordinality)
          from pg_catalog.jsonb_array_elements_text(p_context->'target_member_ids')
            with ordinality as elements(elem, ordinality)
        ),
        array[]::uuid[]
      ),
      p_context->>'target_mode'
    )
    and (
      (
        p_request_kind = 'new_menu'
        and p_context->'source_menu_version' = 'null'::jsonb
        and (
          (
            p_context->>'target_mode' = 'household'
            and p_context->'servings' = 'null'::jsonb
          )
          or (
            p_context->>'target_mode' = 'idea'
            and pg_catalog.jsonb_typeof(p_context->'servings') = 'number'
            and (p_context->>'servings')::integer between 1 and 20
          )
        )
      )
      or (
        p_request_kind in ('regenerate_menu', 'regenerate_dish')
        and pg_catalog.jsonb_typeof(p_context->'source_menu_version') = 'number'
        and (p_context->>'source_menu_version')::integer > 0
        and pg_catalog.jsonb_typeof(p_context->'servings') = 'number'
        and (p_context->>'servings')::integer between 1 and 20
      )
    );
$$;

revoke all on function private.is_valid_generation_integrity_context(jsonb, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. lookup_ai_generation_request: owner-bound hit/miss（live draft/menu を読まない）
-- ---------------------------------------------------------------------------
create or replace function public.lookup_ai_generation_request(
  p_user_id uuid,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request private.ai_generation_requests;
  v_submission private.generation_draft_submission_versions;
  v_snapshot private.generation_regeneration_snapshots;
  v_integrity jsonb;
begin
  select * into v_request
  from private.ai_generation_requests
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if not found then
    return pg_catalog.jsonb_build_object('kind', 'miss');
  end if;

  if v_request.request_hmac_version is distinct from 'generation-command.v2' then
    raise exception using errcode = '22023', message = 'invalid_request_hmac';
  end if;

  if v_request.request_kind = 'new_menu' then
    select * into v_submission
    from private.generation_draft_submission_versions
    where draft_id = v_request.draft_id
      and user_id = v_request.user_id
      and draft_revision = v_request.draft_revision;
    if not found then
      raise exception using errcode = 'P0002', message = 'submission_snapshot_missing';
    end if;
    v_integrity := pg_catalog.jsonb_build_object(
      'kind', 'new_menu',
      'target_mode', v_submission.target_mode,
      'servings', to_jsonb(v_submission.servings),
      'target_member_ids', to_jsonb(v_submission.target_member_ids),
      'source_menu_version', 'null'::jsonb
    );
  else
    select * into v_snapshot
    from private.generation_regeneration_snapshots
    where request_id = v_request.id and user_id = v_request.user_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'regeneration_snapshot_missing';
    end if;
    v_integrity := pg_catalog.jsonb_build_object(
      'kind', v_snapshot.kind,
      'target_mode', v_snapshot.target_mode,
      'servings', v_snapshot.servings,
      'target_member_ids', to_jsonb(v_snapshot.target_member_ids),
      'source_menu_version', v_snapshot.source_menu_version
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'kind', 'hit',
    'request_id', v_request.id,
    'request_hmac_version', v_request.request_hmac_version,
    'integrity', v_integrity
  );
end;
$$;

revoke all on function public.lookup_ai_generation_request(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.lookup_ai_generation_request(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. reserve_ai_generation: 14 引数を drop し 15 引数 v2 を create
-- ---------------------------------------------------------------------------
drop function if exists public.reserve_ai_generation(
  uuid, uuid, text, uuid, bigint, uuid, uuid, text,
  text, text, integer, integer, integer, timestamptz
);

create or replace function public.reserve_ai_generation(
  p_user_id uuid,
  p_idempotency_key uuid,
  p_request_kind text,
  p_draft_id uuid,
  p_draft_revision bigint,
  p_source_menu_id uuid,
  p_replace_dish_id uuid,
  p_change_reason text,
  p_request_hmac_version text,
  p_request_hmac text,
  p_integrity_context jsonb,
  p_user_limit integer,
  p_global_limit integer,
  p_stale_after_seconds integer default 180,
  p_now timestamptz default pg_catalog.clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := private.ai_jst_day(p_now);
  v_request private.ai_generation_requests;
  v_active private.ai_generation_requests;
  v_draft public.generation_drafts;
  v_menu public.menus;
  v_user private.ai_user_daily_usage;
  v_global private.ai_global_daily_usage;
  v_attempts private.ai_user_daily_external_attempts;
  v_member_ids uuid[];
  v_expected_mode text;
  v_expected_servings integer;
  v_expected_source_version integer;
  v_dish_id uuid;
begin
  -- v2 HMAC 以外は台帳を触らず拒否
  if p_request_hmac_version is distinct from 'generation-command.v2'
     or p_request_hmac is null
     or p_request_hmac !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_request_hmac';
  end if;
  if p_user_limit <> 5 then
    raise exception using errcode = '22023', message = 'release_quota_mismatch';
  end if;
  if p_global_limit is null or p_global_limit not between 1 and 45
     or p_stale_after_seconds < 30 then
    raise exception using errcode = '22023', message = 'invalid_quota_configuration';
  end if;
  if p_request_kind not in ('new_menu', 'regenerate_menu', 'regenerate_dish') then
    raise exception using errcode = '22023', message = 'invalid_request_kind';
  end if;
  if not private.is_valid_generation_integrity_context(p_integrity_context, p_request_kind) then
    raise exception using errcode = '22023', message = 'invalid_integrity_context';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || p_idempotency_key::text, 0)
  );

  -- ledger lookup を transaction 内で再実行。hit は live draft/menu を読まず replay。
  select * into v_request from private.ai_generation_requests
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_request.request_hmac_version is distinct from p_request_hmac_version
       or v_request.request_hmac is distinct from p_request_hmac then
      raise exception using errcode = '22023', message = 'idempotency_payload_mismatch';
    end if;
    return private.ai_request_payload(v_request, true);
  end if;

  -- 真の miss だけ draft/source を lock し、resolver 値と完全一致を再検査する
  if p_request_kind = 'new_menu' then
    if p_source_menu_id is not null or p_replace_dish_id is not null
       or p_change_reason is not null then
      raise exception using errcode = '22023', message = 'invalid_request_kind';
    end if;
    select * into v_draft
    from public.generation_drafts
    where id = p_draft_id and user_id = p_user_id and revision = p_draft_revision
      and deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'draft_unavailable';
    end if;
    if v_draft.target_mode is null
       or v_draft.target_mode is distinct from (p_integrity_context->>'target_mode') then
      raise exception using errcode = 'P0001', message = 'draft_revision_conflict';
    end if;
    if v_draft.target_mode = 'household' then
      if v_draft.servings is not null
         or p_integrity_context->'servings' is distinct from 'null'::jsonb then
        raise exception using errcode = 'P0001', message = 'draft_revision_conflict';
      end if;
    else
      if v_draft.servings is distinct from (p_integrity_context->>'servings')::integer then
        raise exception using errcode = 'P0001', message = 'draft_revision_conflict';
      end if;
    end if;
    if v_draft.target_member_ids is distinct from (
      select coalesce(
        (
          select pg_catalog.array_agg(elem::uuid order by ordinality)
          from pg_catalog.jsonb_array_elements_text(p_integrity_context->'target_member_ids')
            with ordinality as elements(elem, ordinality)
        ),
        array[]::uuid[]
      )
    ) then
      raise exception using errcode = 'P0001', message = 'draft_revision_conflict';
    end if;
    if not private.is_valid_generation_target_member_ids(
      v_draft.target_member_ids, v_draft.target_mode
    ) then
      raise exception using errcode = '22023', message = 'invalid_integrity_context';
    end if;
    -- request 行の draft 複合 FK を満たすため、quota 判定より前に凍結提出を作る
    insert into private.generation_draft_submission_versions(
      draft_id, user_id, draft_revision, meal_type, main_ingredients, cuisine_genre,
      target_mode, target_member_ids, servings, time_limit_minutes, budget_preference,
      avoid_ingredients, memo, pantry_selections, captured_at
    ) values (
      v_draft.id, v_draft.user_id, v_draft.revision, v_draft.meal_type,
      v_draft.main_ingredients, v_draft.cuisine_genre,
      v_draft.target_mode, v_draft.target_member_ids, v_draft.servings,
      v_draft.time_limit_minutes, v_draft.budget_preference,
      v_draft.avoid_ingredients, v_draft.memo, v_draft.pantry_selections, p_now
    ) on conflict (draft_id, user_id, draft_revision) do nothing;
  else
    if p_draft_id is not null or p_draft_revision is not null then
      raise exception using errcode = '22023', message = 'invalid_draft_reference';
    end if;
    if p_source_menu_id is null then
      raise exception using errcode = 'P0002', message = 'source_menu_not_found';
    end if;
    select * into v_menu
    from public.menus
    where id = p_source_menu_id and user_id = p_user_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'source_menu_not_found';
    end if;
    v_expected_mode := p_integrity_context->>'target_mode';
    v_expected_servings := (p_integrity_context->>'servings')::integer;
    v_expected_source_version := (p_integrity_context->>'source_menu_version')::integer;
    if v_menu.target_mode is distinct from v_expected_mode
       or v_menu.servings is distinct from v_expected_servings
       or v_menu.version is distinct from v_expected_source_version then
      raise exception using errcode = 'P0001', message = 'source_menu_changed';
    end if;

    -- 並び順に依存しないよう sort して比較する
    select coalesce(
      (
        select pg_catalog.array_agg(mid order by mid)
        from (
          select mtm.household_member_id as mid
          from public.menu_target_members mtm
          where mtm.menu_id = v_menu.id and mtm.user_id = p_user_id
        ) members
      ),
      array[]::uuid[]
    ) into v_member_ids;
    if v_member_ids is distinct from (
      select coalesce(
        (
          select pg_catalog.array_agg(mid order by mid)
          from (
            select elem::uuid as mid
            from pg_catalog.jsonb_array_elements_text(p_integrity_context->'target_member_ids')
              as elements(elem)
          ) payload
        ),
        array[]::uuid[]
      )
    ) then
      raise exception using errcode = 'P0001', message = 'source_menu_changed';
    end if;

    if p_request_kind = 'regenerate_dish' then
      if p_replace_dish_id is null then
        raise exception using errcode = 'P0002', message = 'replace_dish_not_found';
      end if;
      select d.id into v_dish_id
      from public.dishes d
      where d.id = p_replace_dish_id
        and d.menu_id = p_source_menu_id
        and d.user_id = p_user_id;
      if v_dish_id is null then
        raise exception using errcode = 'P0002', message = 'replace_dish_not_found';
      end if;
    elsif p_replace_dish_id is not null then
      raise exception using errcode = '22023', message = 'invalid_request_kind';
    end if;
  end if;

  perform public.cleanup_stale_ai_generations(p_now);

  -- owner に processing があれば永続行を作らず安定 code を返す。
  -- request_id は新規行ではなく既存 active の id を載せ、POST 応答が
  -- GenerationStatusData（failed は requestId/completedAt 必須）へ直接写せるようにする。
  select * into v_active from private.ai_generation_requests
  where user_id = p_user_id and status = 'processing';
  if found then
    select * into v_user from private.ai_user_daily_usage
    where user_id = p_user_id and usage_day = v_day;
    return pg_catalog.jsonb_build_object(
      'request_id', v_active.id,
      'idempotency_key', p_idempotency_key,
      'status', 'failed',
      'failure_code', 'generation_in_progress',
      'retry_at', v_active.processing_expires_at,
      'processing_expires_at', v_active.processing_expires_at,
      'completed_menu_id', null,
      'started_at', v_active.started_at,
      'completed_at', p_now,
      'remaining', greatest(
        p_user_limit
          - coalesce(v_user.success_count, 0)
          - coalesce(v_user.reserved_count, 0),
        0
      ),
      'user_daily_limit', p_user_limit,
      'consumed', false,
      'replayed', false
    );
  end if;

  insert into private.ai_user_daily_usage(user_id, usage_day)
  values (p_user_id, v_day) on conflict do nothing;
  insert into private.ai_global_daily_usage(usage_day)
  values (v_day) on conflict do nothing;
  insert into private.ai_user_daily_external_attempts(user_id, usage_day)
  values (p_user_id, v_day) on conflict do nothing;
  select * into v_user from private.ai_user_daily_usage
    where user_id = p_user_id and usage_day = v_day for update;
  select * into v_global from private.ai_global_daily_usage
    where usage_day = v_day for update;
  select * into v_attempts from private.ai_user_daily_external_attempts
    where user_id = p_user_id and usage_day = v_day for update;

  if v_user.success_count + v_user.reserved_count >= p_user_limit then
    insert into private.ai_generation_requests(
      user_id, idempotency_key, request_kind, status, draft_id, draft_revision,
      source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      user_usage_day, failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_idempotency_key, p_request_kind, 'failed', p_draft_id,
      p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      v_day, 'user_daily_limit',
      private.ai_next_jst_midnight(p_now), p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;

  if v_attempts.reserved_count + v_attempts.sent_count >= 12 then
    insert into private.ai_generation_requests(
      user_id, idempotency_key, request_kind, status, draft_id, draft_revision,
      source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      user_usage_day, failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_idempotency_key, p_request_kind, 'failed', p_draft_id,
      p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      v_day, 'user_attempt_limit',
      private.ai_next_jst_midnight(p_now), p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;

  if v_global.sent_count + v_global.reserved_count >= p_global_limit then
    insert into private.ai_generation_requests(
      user_id, idempotency_key, request_kind, status, draft_id, draft_revision,
      source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      user_usage_day, failure_code, retry_at, started_at, completed_at
    ) values (
      p_user_id, p_idempotency_key, p_request_kind, 'failed', p_draft_id,
      p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      v_day, 'global_daily_limit',
      private.ai_next_jst_midnight(p_now), p_now, p_now
    ) returning * into v_request;
    return private.ai_request_payload(v_request, false);
  end if;

  begin
    update private.ai_user_daily_usage set reserved_count = reserved_count + 1, updated_at = p_now
    where user_id = p_user_id and usage_day = v_day;
    update private.ai_user_daily_external_attempts
    set reserved_count = reserved_count + 1, updated_at = p_now
    where user_id = p_user_id and usage_day = v_day;
    update private.ai_global_daily_usage set reserved_count = reserved_count + 1, updated_at = p_now
    where usage_day = v_day;

    insert into private.ai_generation_requests(
      user_id, idempotency_key, request_kind, status, draft_id, draft_revision,
      source_menu_id, replace_dish_id, change_reason,
      request_hmac_version, request_hmac,
      user_usage_day, user_quota_reserved, user_attempt_reserved, user_attempt_day,
      global_reserved_day, processing_expires_at, started_at
    ) values (
      p_user_id, p_idempotency_key, p_request_kind, 'processing', p_draft_id,
      p_draft_revision, p_source_menu_id, p_replace_dish_id, p_change_reason,
      p_request_hmac_version, p_request_hmac,
      v_day, true, true, v_day,
      v_day, p_now + pg_catalog.make_interval(secs => p_stale_after_seconds), p_now
    ) returning * into v_request;

    -- 再生成は request と同一 transaction で snapshot を凍結する
    if p_request_kind in ('regenerate_menu', 'regenerate_dish') then
      insert into private.generation_regeneration_snapshots(
        request_id, user_id, kind, source_menu_id, source_menu_version,
        replace_dish_id, target_mode, servings, target_member_ids, created_at
      ) values (
        v_request.id, p_user_id, p_request_kind, p_source_menu_id,
        (p_integrity_context->>'source_menu_version')::integer,
        p_replace_dish_id,
        p_integrity_context->>'target_mode',
        (p_integrity_context->>'servings')::integer,
        coalesce(
          (
            select pg_catalog.array_agg(elem::uuid order by ordinality)
            from pg_catalog.jsonb_array_elements_text(p_integrity_context->'target_member_ids')
              with ordinality as elements(elem, ordinality)
          ),
          array[]::uuid[]
        ),
        p_now
      );
    end if;
  exception
    when unique_violation then
      -- owner 単位 processing 制約の競合を安定 code へ写す（request/quota/snapshot を残さない）。
      -- サブトランザクション巻き戻し後に勝者の processing 行を読み、early path と同じ形へ揃える。
      select * into v_active from private.ai_generation_requests
      where user_id = p_user_id and status = 'processing';
      select * into v_user from private.ai_user_daily_usage
      where user_id = p_user_id and usage_day = v_day;
      return pg_catalog.jsonb_build_object(
        'request_id', coalesce(v_active.id, p_idempotency_key),
        'idempotency_key', p_idempotency_key,
        'status', 'failed',
        'failure_code', 'generation_in_progress',
        'retry_at', v_active.processing_expires_at,
        'processing_expires_at', v_active.processing_expires_at,
        'completed_menu_id', null,
        'started_at', coalesce(v_active.started_at, p_now),
        'completed_at', p_now,
        'remaining', greatest(
          p_user_limit
            - coalesce(v_user.success_count, 0)
            - coalesce(v_user.reserved_count, 0),
          0
        ),
        'user_daily_limit', p_user_limit,
        'consumed', false,
        'replayed', false
      );
  end;

  perform public.cleanup_ai_generation_requests(
    p_now - interval '30 days',
    p_user_id
  );
  return private.ai_request_payload(v_request, false);
end;
$$;

revoke all on function public.reserve_ai_generation(
  uuid, uuid, text, uuid, bigint, uuid, uuid, text, text, text, jsonb, integer, integer, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.reserve_ai_generation(
  uuid, uuid, text, uuid, bigint, uuid, uuid, text, text, text, jsonb, integer, integer, integer, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- 7. finalize_ai_generation_success: source snapshot を lock 順で再検査
--    request FOR UPDATE → source menu FOR SHARE（owner+version）
-- ---------------------------------------------------------------------------
create or replace function public.finalize_ai_generation_success(
  p_request_id uuid,p_menu jsonb,p_preference_snapshot jsonb,p_safety_snapshot jsonb,
  p_safety_fingerprint text,p_allergen_version text,p_food_rule_version text,
  p_target_members jsonb,p_expired_checks jsonb,
  p_source_menu_id uuid,p_change_reason text,p_change_reason_custom text,
  p_now timestamptz default pg_catalog.clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_request private.ai_generation_requests;
  v_menu_id uuid;
  v_submission_target_mode text;
  v_snapshot private.generation_regeneration_snapshots;
  v_source public.menus;
begin
  -- lock 順: request → source（または draft submission）→ usage は後続 update
  select * into v_request from private.ai_generation_requests where id = p_request_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'request_not_found'; end if;
  if v_request.status <> 'processing' then return private.ai_request_payload(v_request, true); end if;
  if not v_request.user_quota_reserved then
    raise exception using errcode = '23514', message = 'user_reservation_missing';
  end if;

  if v_request.request_kind = 'new_menu' then
    if v_request.draft_id is not null and v_request.draft_revision is not null then
      select target_mode into v_submission_target_mode
      from private.generation_draft_submission_versions
      where draft_id = v_request.draft_id
        and user_id = v_request.user_id
        and draft_revision = v_request.draft_revision;
      if v_submission_target_mode is null then
        raise exception using errcode = 'P0002', message = 'submission_snapshot_missing';
      end if;
    else
      raise exception using errcode = 'P0002', message = 'submission_snapshot_missing';
    end if;
  elsif v_request.request_kind in ('regenerate_menu', 'regenerate_dish') then
    select * into v_snapshot
    from private.generation_regeneration_snapshots
    where request_id = v_request.id and user_id = v_request.user_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'regeneration_snapshot_missing';
    end if;
    -- source menu を owner+version 付き FOR SHARE で再検査
    select * into v_source
    from public.menus
    where id = v_snapshot.source_menu_id
      and user_id = v_request.user_id
      and version = v_snapshot.source_menu_version
    for share;
    if not found then
      -- 送信後不一致: menu を作らず success 枠は返却、attempt は送信済みなら消費済みのまま終端化
      return public.finalize_ai_generation_failure(
        p_request_id, 'source_menu_changed', null, p_now
      );
    end if;
    if p_source_menu_id is distinct from v_snapshot.source_menu_id then
      raise exception using errcode = 'P0001', message = 'source_menu_changed';
    end if;
    v_submission_target_mode := v_snapshot.target_mode;
  end if;

  -- Task 4: household finalize は現行安全 fingerprint を維持。idea 安全境界は Task 5。
  if v_submission_target_mode = 'household' then
    perform private.lock_and_assert_current_safety_fingerprint(
      v_request.user_id,
      array(select (target->>'householdMemberId')::uuid
        from pg_catalog.jsonb_array_elements(p_target_members) as targets(target)),
      p_safety_fingerprint
    );
  end if;

  v_menu_id := private.persist_validated_menu(
    v_request,p_menu,p_preference_snapshot,p_safety_snapshot,p_safety_fingerprint,
    p_allergen_version,p_food_rule_version,v_submission_target_mode,p_target_members,p_expired_checks
  );
  perform private.assign_regeneration_lineage(
    v_request.user_id,p_source_menu_id,v_menu_id,p_change_reason,p_change_reason_custom
  );
  if v_request.draft_id is not null and v_request.draft_revision is not null then
    perform private.soft_delete_generation_draft(
      v_request.user_id,
      v_request.draft_id,
      v_request.draft_revision
    );
  end if;
  update private.ai_user_daily_usage set
    reserved_count = reserved_count - 1, success_count = success_count + 1, updated_at = p_now
  where user_id = v_request.user_id and usage_day = v_request.user_usage_day and reserved_count > 0;
  if not found then raise exception using errcode = '23514', message = 'user_reservation_corrupt'; end if;
  if v_request.user_attempt_reserved and v_request.user_attempt_day is not null then
    update private.ai_user_daily_external_attempts
    set reserved_count = greatest(reserved_count - 1, 0), updated_at = p_now
    where user_id = v_request.user_id and usage_day = v_request.user_attempt_day;
  end if;
  if v_request.global_reserved_day is not null then
    update private.ai_global_daily_usage set reserved_count = reserved_count - 1, updated_at = p_now
    where usage_day = v_request.global_reserved_day and reserved_count > 0;
  end if;
  update private.ai_generation_requests set
    status = 'succeeded',completed_menu_id = v_menu_id,user_quota_reserved = false,
    user_attempt_reserved = false,user_attempt_day = null,global_reserved_day = null,
    completed_at = p_now,updated_at = p_now,
    duration_ms = greatest(
      0, pg_catalog.floor(extract(epoch from (p_now - started_at)) * 1000)::integer
    )
  where id = p_request_id returning * into v_request;
  return private.ai_request_payload(v_request, false);
end;
$$;

revoke all on function public.finalize_ai_generation_success(
  uuid,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb,uuid,text,text,timestamptz
) from public,anon,authenticated;
grant execute on function public.finalize_ai_generation_success(
  uuid,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb,uuid,text,text,timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- 8. regeneration snapshot 読取 RPC（service_role のみ）
-- ---------------------------------------------------------------------------
create or replace function public.get_ai_generation_regeneration_snapshot(
  p_request_id uuid,
  p_user_id uuid
) returns table (
  request_id uuid,
  user_id uuid,
  kind text,
  source_menu_id uuid,
  source_menu_version integer,
  replace_dish_id uuid,
  target_mode text,
  servings integer,
  target_member_ids uuid[],
  created_at timestamptz
) language sql stable security definer
set search_path = ''
as $$
  select
    snapshot.request_id,
    snapshot.user_id,
    snapshot.kind,
    snapshot.source_menu_id,
    snapshot.source_menu_version,
    snapshot.replace_dish_id,
    snapshot.target_mode,
    snapshot.servings,
    snapshot.target_member_ids,
    snapshot.created_at
  from private.generation_regeneration_snapshots as snapshot
  join private.ai_generation_requests as request
    on request.id = snapshot.request_id
   and request.user_id = snapshot.user_id
  where snapshot.request_id = p_request_id
    and snapshot.user_id = p_user_id
    and request.request_kind in ('regenerate_menu', 'regenerate_dish')
$$;

revoke all on function public.get_ai_generation_regeneration_snapshot(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_ai_generation_regeneration_snapshot(uuid, uuid)
  to service_role;
