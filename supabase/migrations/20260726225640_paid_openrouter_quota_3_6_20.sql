-- Plan 8 Task 3: AI 日次クォータを成功3 / attempt6 / global20 へ引き下げる。
-- 短期窓 4/600s と締切 20s/50s/180s は不変。HMAC/integrity 引数は巻き戻さない。
--
-- CHECK 引き下げは upgrade-safe:
-- - 過去日カウンタは削除（当日枠のリセットではない）
-- - 当日の active reservation が新上限を超えるなら migration を中止（進行中生成を壊さない）
-- - 当日・予約なしで旧合法の超過行（success 4–5 / attempt 7–12）は **clamp/0 化しない**
--   （枠の復活＝quota reset になるため）。CHECK は NOT VALID で追加し既存超過行を保持。
-- - 新規 INSERT/UPDATE と RPC の p_user_limit=3 / attempt 6 が以降の消費を抑止する。

-- ---------------------------------------------------------------------------
-- 1. table CHECK（upgrade-safe データ準備 + 制約差し替え）
-- ---------------------------------------------------------------------------
create or replace function private.upgrade_ai_daily_quota_checks_to_3_6()
returns void
language plpgsql
security definer
set search_path = ''
as $upgrade$
declare
  v_today date := private.ai_jst_day(pg_catalog.clock_timestamp());
  v_success_conname text;
  v_attempt_conname text;
  v_has_over_success boolean;
  v_has_over_attempt boolean;
begin
  -- 旧 5/12 writer との check/ALTER TOCTOU を閉じる:
  -- 2 テーブルを固定順で十分強く lock してから active 検査・制約差し替えを行う。
  -- SHARE ROW EXCLUSIVE は ROW EXCLUSIVE（INSERT/UPDATE）と衝突し、reserve 経路を待機させる。
  lock table private.ai_user_daily_usage
    in share row exclusive mode;
  lock table private.ai_user_daily_external_attempts
    in share row exclusive mode;

  -- 過去日: 無条件 delete しない。JST 日跨ぎ中の processing が参照する行を保持する。
  -- reserved=0 かつ live reference（user_quota_reserved / user_attempt_reserved）無しだけ purge。
  delete from private.ai_user_daily_usage u
  where u.usage_day < v_today
    and u.reserved_count = 0
    and not exists (
      select 1
      from private.ai_generation_requests r
      where r.user_id = u.user_id
        and r.user_usage_day = u.usage_day
        and coalesce(r.user_quota_reserved, false)
    );
  delete from private.ai_user_daily_external_attempts a
  where a.usage_day < v_today
    and a.reserved_count = 0
    and not exists (
      select 1
      from private.ai_generation_requests r
      where r.user_id = a.user_id
        and r.user_attempt_day = a.usage_day
        and coalesce(r.user_attempt_reserved, false)
    );

  -- lock 保持下で active 検査をやり直す（日を問わず。日跨ぎ past-day reserved も含む）
  if exists (
    select 1
    from private.ai_user_daily_usage u
    where u.reserved_count > 0
      and u.reserved_count + u.success_count > 3
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'quota_upgrade_blocked_active_success_reservation';
  end if;

  if exists (
    select 1
    from private.ai_user_daily_external_attempts a
    where a.reserved_count > 0
      and a.reserved_count + a.sent_count > 6
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'quota_upgrade_blocked_active_attempt_reservation';
  end if;

  -- 旧 <=5 success CHECK を drop（pg_get_constraintdef の括弧差を吸収）
  select c.conname into v_success_conname
  from pg_catalog.pg_constraint c
  where c.conrelid = 'private.ai_user_daily_usage'::regclass
    and c.contype = 'c'
    and pg_catalog.pg_get_constraintdef(c.oid) ~ 'reserved_count.*success_count.*<=[[:space:]]*5'
  limit 1;
  if v_success_conname is not null then
    execute format(
      'alter table private.ai_user_daily_usage drop constraint %I',
      v_success_conname
    );
  end if;

  -- 旧 <=12 attempt CHECK を drop
  select c.conname into v_attempt_conname
  from pg_catalog.pg_constraint c
  where c.conrelid = 'private.ai_user_daily_external_attempts'::regclass
    and c.contype = 'c'
    and pg_catalog.pg_get_constraintdef(c.oid) ~ 'reserved_count.*sent_count.*<=[[:space:]]*12'
  limit 1;
  if v_attempt_conname is not null then
    execute format(
      'alter table private.ai_user_daily_external_attempts drop constraint %I',
      v_attempt_conname
    );
  end if;

  -- 既存超過行の有無（clamp せず保持 → NOT VALID）
  select exists (
    select 1 from private.ai_user_daily_usage
    where reserved_count + success_count > 3
  ) into v_has_over_success;

  select exists (
    select 1 from private.ai_user_daily_external_attempts
    where reserved_count + sent_count > 6
  ) into v_has_over_attempt;

  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'private.ai_user_daily_usage'::regclass
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) ~ 'reserved_count.*success_count.*<=[[:space:]]*3'
  ) then
    if v_has_over_success then
      -- 旧合法の超過行を残す。新規行・更新は CHECK 対象。
      alter table private.ai_user_daily_usage
        add constraint ai_user_daily_usage_reserved_success_le_3
        check (reserved_count + success_count <= 3) not valid;
    else
      alter table private.ai_user_daily_usage
        add constraint ai_user_daily_usage_reserved_success_le_3
        check (reserved_count + success_count <= 3);
    end if;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'private.ai_user_daily_external_attempts'::regclass
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) ~ 'reserved_count.*sent_count.*<=[[:space:]]*6'
  ) then
    if v_has_over_attempt then
      alter table private.ai_user_daily_external_attempts
        add constraint ai_user_daily_external_attempts_reserved_sent_le_6
        check (reserved_count + sent_count <= 6) not valid;
    else
      alter table private.ai_user_daily_external_attempts
        add constraint ai_user_daily_external_attempts_reserved_sent_le_6
        check (reserved_count + sent_count <= 6);
    end if;
  end if;
end
$upgrade$;

revoke all on function private.upgrade_ai_daily_quota_checks_to_3_6()
  from public, anon, authenticated;

select private.upgrade_ai_daily_quota_checks_to_3_6();

-- ---------------------------------------------------------------------------
-- 2. reserve_ai_generation（権威: generation_command_v2。数値のみ 3/6/20）
-- ---------------------------------------------------------------------------
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
  if p_user_limit <> 3 then
    raise exception using errcode = '22023', message = 'release_quota_mismatch';
  end if;
  if p_global_limit is null or p_global_limit not between 1 and 20
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

  if v_attempts.reserved_count + v_attempts.sent_count >= 6 then
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
-- 3. reserve_ai_repair_call（権威: ai_control_and_quota 最終定義）
-- ---------------------------------------------------------------------------
create or replace function public.reserve_ai_repair_call(
  p_request_id uuid, p_global_limit integer,
  p_now timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_request private.ai_generation_requests;
  v_usage private.ai_global_daily_usage;
  v_attempts private.ai_user_daily_external_attempts;
  v_day date := private.ai_jst_day(p_now);
begin
  if p_global_limit is null or p_global_limit not between 1 and 20 then
    raise exception using errcode = '22023', message = 'invalid_quota_configuration';
  end if;
  select * into v_request from private.ai_generation_requests where id = p_request_id for update;
  if not found or v_request.status <> 'processing' or v_request.repair_attempted
     or v_request.global_reserved_day is not null
     or v_request.user_attempt_reserved then
    raise exception using errcode = '55000', message = 'repair_not_available';
  end if;
  insert into private.ai_global_daily_usage(usage_day) values (v_day) on conflict do nothing;
  insert into private.ai_user_daily_external_attempts(user_id, usage_day)
  values (v_request.user_id, v_day) on conflict do nothing;
  select * into v_usage from private.ai_global_daily_usage where usage_day = v_day for update;
  select * into v_attempts from private.ai_user_daily_external_attempts
    where user_id = v_request.user_id and usage_day = v_day for update;
  -- repair_attempted は枠不足でも立て、二重 repair を防ぐ
  update private.ai_generation_requests set repair_attempted = true, updated_at = p_now
    where id = p_request_id;
  -- deny 形は reserved/retry_at のみ（repository の .strict() が code を拒否するため）
  if v_attempts.reserved_count + v_attempts.sent_count >= 6 then
    return jsonb_build_object(
      'reserved', false,
      'retry_at', private.ai_next_jst_midnight(p_now)
    );
  end if;
  if v_usage.sent_count + v_usage.reserved_count >= p_global_limit then
    return jsonb_build_object('reserved', false, 'retry_at', private.ai_next_jst_midnight(p_now));
  end if;
  update private.ai_global_daily_usage set reserved_count = reserved_count + 1, updated_at = p_now
    where usage_day = v_day;
  update private.ai_user_daily_external_attempts
  set reserved_count = reserved_count + 1, updated_at = p_now
  where user_id = v_request.user_id and usage_day = v_day;
  update private.ai_generation_requests
  set global_reserved_day = v_day,
      user_attempt_reserved = true,
      user_attempt_day = v_day,
      updated_at = p_now
    where id = p_request_id;
  return jsonb_build_object('reserved', true, 'retry_at', null);
end;
$$;

revoke all on function public.reserve_ai_repair_call(uuid, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_repair_call(uuid, integer, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. get_ai_generation_status（p_user_limit <> 3）
-- ---------------------------------------------------------------------------
create or replace function public.get_ai_generation_status(
  p_user_id uuid,p_idempotency_key uuid,p_user_limit integer,
  p_now timestamptz default clock_timestamp()
) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_request private.ai_generation_requests; v_success integer := 0; v_reserved integer := 0;
  v_day date := private.ai_jst_day(p_now);
begin
  if p_user_limit <> 3 then
    raise exception using errcode = '22023', message = 'release_quota_mismatch';
  end if;
  perform public.cleanup_stale_ai_generations(p_now);
  select * into v_request from private.ai_generation_requests
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
  select coalesce(success_count,0),coalesce(reserved_count,0) into v_success,v_reserved
    from private.ai_user_daily_usage where user_id = p_user_id and usage_day = v_day;
  if not found then v_success := 0; v_reserved := 0; end if;
  if v_request.id is null then
    return jsonb_build_object('status','not_started','idempotency_key',p_idempotency_key,
      'remaining',greatest(p_user_limit-v_success-v_reserved,0),'user_daily_limit',p_user_limit,
      'consumed',false,'retry_at',null);
  end if;
  return private.ai_request_payload(v_request,false) || jsonb_build_object(
    'remaining',greatest(p_user_limit-v_success-v_reserved,0),
    'user_daily_limit',p_user_limit,'consumed',v_request.status='succeeded',
    'terminal_details',v_request.terminal_details,'actual_model_ids',v_request.actual_model_ids,
    'started_at',v_request.started_at,'completed_at',v_request.completed_at
  );
end;
$$;

revoke all on function public.get_ai_generation_status(uuid, uuid, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_ai_generation_status(uuid, uuid, integer, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. get_ai_usage_today（default/max 20、success 3、attempt 6）
-- ---------------------------------------------------------------------------
create or replace function public.get_ai_usage_today(
  p_user_id uuid,
  p_now timestamptz default clock_timestamp(),
  p_global_limit integer default 20
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_day date := private.ai_jst_day(p_now);
  v_window_started_at timestamptz := to_timestamp(
    floor(extract(epoch from p_now) / 600.0) * 600.0
  );
  v_success_count integer := 0;
  v_success_reserved integer := 0;
  v_attempt_sent integer := 0;
  v_attempt_reserved integer := 0;
  v_window_sent integer := 0;
  v_global_sent integer := 0;
  v_global_reserved integer := 0;
  v_success_consumed integer;
  v_attempt_used integer;
  v_success_remaining integer;
  v_attempt_remaining integer;
  v_window_remaining integer;
  v_global_available boolean;
  v_success_retry timestamptz;
  v_attempt_retry timestamptz;
  v_window_retry timestamptz;
  v_global_retry timestamptz;
  v_retry_at timestamptz;
  v_global_limit integer;
begin
  if p_global_limit is null or p_global_limit not between 1 and 20 then
    raise exception using errcode = '22023', message = 'invalid_quota_configuration';
  end if;
  v_global_limit := p_global_limit;

  select coalesce(success_count, 0), coalesce(reserved_count, 0)
    into v_success_count, v_success_reserved
  from private.ai_user_daily_usage
  where user_id = p_user_id and usage_day = v_day;
  if not found then
    v_success_count := 0;
    v_success_reserved := 0;
  end if;

  select coalesce(sent_count, 0), coalesce(reserved_count, 0)
    into v_attempt_sent, v_attempt_reserved
  from private.ai_user_daily_external_attempts
  where user_id = p_user_id and usage_day = v_day;
  if not found then
    v_attempt_sent := 0;
    v_attempt_reserved := 0;
  end if;

  select coalesce(sent_count, 0) into v_window_sent
  from private.ai_user_rate_windows
  where user_id = p_user_id and window_started_at = v_window_started_at;
  if not found then
    v_window_sent := 0;
  end if;

  select coalesce(sent_count, 0), coalesce(reserved_count, 0)
    into v_global_sent, v_global_reserved
  from private.ai_global_daily_usage
  where usage_day = v_day;
  if not found then
    v_global_sent := 0;
    v_global_reserved := 0;
  end if;

  v_success_consumed := v_success_count + v_success_reserved;
  v_attempt_used := v_attempt_sent + v_attempt_reserved;
  v_success_remaining := greatest(3 - v_success_consumed, 0);
  v_attempt_remaining := greatest(6 - v_attempt_used, 0);
  v_window_remaining := greatest(4 - v_window_sent, 0);
  v_global_available := (v_global_sent + v_global_reserved) < v_global_limit;

  v_success_retry := case when v_success_remaining = 0
    then private.ai_next_jst_midnight(p_now) else null end;
  v_attempt_retry := case when v_attempt_remaining = 0
    then private.ai_next_jst_midnight(p_now) else null end;
  v_window_retry := case when v_window_remaining = 0
    then v_window_started_at + interval '10 minutes' else null end;
  v_global_retry := case when not v_global_available
    then private.ai_next_jst_midnight(p_now) else null end;

  select min(candidate) into v_retry_at
  from (values (v_success_retry), (v_attempt_retry), (v_window_retry), (v_global_retry))
    as retries(candidate)
  where candidate is not null;

  return jsonb_build_object(
    'success', jsonb_build_object(
      'consumed', v_success_consumed,
      'limit', 3,
      'remaining', v_success_remaining
    ),
    'attempts', jsonb_build_object(
      'sent', v_attempt_used,
      'limit', 6,
      'remaining', v_attempt_remaining
    ),
    'shortWindow', jsonb_build_object(
      'sent', v_window_sent,
      'limit', 4,
      'remaining', v_window_remaining,
      'retryAt', v_window_retry
    ),
    'globalAvailable', v_global_available,
    'retryAt', v_retry_at
  );
end;
$$;

revoke all on function public.get_ai_usage_today(uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.get_ai_usage_today(uuid, timestamptz, integer)
  to service_role;
