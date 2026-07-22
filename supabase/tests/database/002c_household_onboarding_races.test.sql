\ir 000_helpers.sql
-- =============================================================================
-- Plan 7 Task 2 Step 2: set_onboarding_status / start_household_onboarding が
-- 同じ profiles 行を SELECT ... FOR UPDATE でロックする順序を dblink で開いた
-- 本当の別バックエンドセッションを使って検証する。
--
-- このファイルだけ既存の「begin;...rollback;」1トランザクション規約から外れ、
-- 明示的に commit する。理由は supabase/tests/database/shopping_lists_races.test.sql
-- と同じ: dblink で開くセッションは別バックエンドプロセスであり、read committed の下では
-- 外側トランザクションが未commitのfixture行を見ることができない。そのため、この
-- ファイルは各テストのfixtureを明示的にcommitしてから他セッションに触らせ、テスト
-- 終了時に自分で作った行だけを明示的に削除して後始末する。
--
-- また、dblink_exec は結果行を返す文（SELECTで値を返す関数呼び出しなど）を許可しない
-- （"statement returning results not allowed"）。そのため、値を返すすべての呼び出しは
-- dblink_send_query + dblink_is_busy によるポーリング + dblink_get_result による
-- 明示的な結果の取り出しで行う（shopping_lists_races.test.sqlと同じ非同期パターン）。
-- =============================================================================
select plan(2);

-- 前回実行が途中で失敗した場合に残った行を先に削除する（commit方式のため
-- rollbackに頼れない。auth.usersのcascade deleteでhousehold_members/
-- member_alleriesも含めて安全に削除できる）。
delete from auth.users where id in (
  'b1000000-0000-4000-8000-000000000101','b1000000-0000-4000-8000-000000000102'
);

-- dblink はスーパーユーザー以外の呼び出し元にパスワードを要求する固定ポリシーを持つ。
-- shopping_lists_races.test.sql 用のロールとは対象RPCが異なるため、この検証専用の
-- ロールを別途用意する（権限は set_onboarding_status / start_household_onboarding の
-- 実行のみに絞る。本番コードパス・本番データへの影響はない、テストDBのみで作成される
-- テスト専用ロール）。
do $block$
begin
  if not exists (select 1 from pg_roles where rolname = 'onboarding_pgtap_dblink_test') then
    create role onboarding_pgtap_dblink_test with login password 'onboarding_pgtap_dblink_test_only'
      nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end;
$block$;
revoke all on schema public from onboarding_pgtap_dblink_test;
grant usage on schema public to onboarding_pgtap_dblink_test;
grant execute on function public.set_onboarding_status(text) to onboarding_pgtap_dblink_test;
grant execute on function public.start_household_onboarding(integer) to onboarding_pgtap_dblink_test;

insert into auth.users (id,instance_id,aud,role,email) values
  ('b1000000-0000-4000-8000-000000000101','00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated','onboarding-race-owner-1@example.test'),
  ('b1000000-0000-4000-8000-000000000102','00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated','onboarding-race-owner-2@example.test');

-- fixture は psql のデフォルト autocommit により各insert文の直後にcommit済み
-- （このファイルではbegin;を開いていない）。dblinkの別セッションからは
-- 既にこの時点で見えている。

-- -----------------------------------------------------------------------------
-- Race 1: skipped から別セッションが complete、現在セッションが in_progress へ
-- 同時に遷移しようとする。set_onboarding_status が profiles 行を FOR UPDATE で
-- ロックしてから現在値を再読込するため、先にcommitした側の遷移だけが成立し、
-- 後からロックを取得した側は「ロック解放後に見える実際の現在値」に対して遷移可否を
-- 判定する。complete は遷移表の遷移元に含まれないため、後着のin_progress要求は
-- invalid_onboarding_transitionで拒否され、禁止された実効的なcomplete→in_progressが
-- 後勝ちで成立することはない。
-- -----------------------------------------------------------------------------
do $test$
declare
  v_owner constant uuid := 'b1000000-0000-4000-8000-000000000101';
  v_member constant uuid := 'b2000000-0000-4000-8000-000000000101';
  v_connstr constant text :=
    'host=db port=5432 dbname=postgres user=onboarding_pgtap_dblink_test '
    || 'password=onboarding_pgtap_dblink_test_only';
  v_raised boolean := false;
  v_attempt integer;
  v_drained integer;
  v_wait_event text;
begin
  insert into public.household_members (
    id, user_id, status, age_band, allergy_status, unsupported_diet_status
  ) values (
    v_member, v_owner, 'complete', 'adult', 'none', 'none'
  );
  update public.profiles
  set onboarding_status = 'skipped', onboarding_completed_at = statement_timestamp()
  where user_id = v_owner;
  commit;

  -- 別セッション（別バックエンドプロセス）を開き、auth.uid()相当のJWTクレームを
  -- 設定した上で set_onboarding_status('complete') をトランザクション内で送るが
  -- まだコミットしない。
  perform extensions.dblink_connect('onboarding_race1', v_connstr);
  perform extensions.dblink_exec('onboarding_race1', 'begin');

  perform extensions.dblink_send_query('onboarding_race1',
    format('select set_config(''request.jwt.claim.sub'', %L, false)', v_owner::text));
  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    exit when extensions.dblink_is_busy('onboarding_race1') = 0;
  end loop;
  loop
    select count(*) into v_drained
      from extensions.dblink_get_result('onboarding_race1') as t(status text);
    exit when v_drained = 0;
  end loop;

  perform extensions.dblink_send_query('onboarding_race1',
    format('select set_config(''request.jwt.claims'', %L, false)',
      jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text));
  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    exit when extensions.dblink_is_busy('onboarding_race1') = 0;
  end loop;
  loop
    select count(*) into v_drained
      from extensions.dblink_get_result('onboarding_race1') as t(status text);
    exit when v_drained = 0;
  end loop;

  perform extensions.dblink_send_query('onboarding_race1',
    $sql$ select public.set_onboarding_status('complete') $sql$
  );

  -- セッションAが profiles 行の FOR UPDATE ロックを取得しコミット待ちであることを
  -- 待ってから、セッションB（別の名前付きdblink接続）で同じ行への
  -- set_onboarding_status('in_progress') を非同期に試みる。両方とも別バックエンド
  -- プロセスなので、片方が自分のcommitを待って相手をブロックする自己デッドロックが
  -- 起きない。
  perform extensions.dblink_connect('onboarding_race1b', v_connstr);
  perform extensions.dblink_exec('onboarding_race1b', 'begin');

  perform extensions.dblink_send_query('onboarding_race1b',
    format('select set_config(''request.jwt.claim.sub'', %L, false)', v_owner::text));
  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    exit when extensions.dblink_is_busy('onboarding_race1b') = 0;
  end loop;
  loop
    select count(*) into v_drained
      from extensions.dblink_get_result('onboarding_race1b') as t(status text);
    exit when v_drained = 0;
  end loop;

  perform extensions.dblink_send_query('onboarding_race1b',
    format('select set_config(''request.jwt.claims'', %L, false)',
      jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text));
  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    exit when extensions.dblink_is_busy('onboarding_race1b') = 0;
  end loop;
  loop
    select count(*) into v_drained
      from extensions.dblink_get_result('onboarding_race1b') as t(status text);
    exit when v_drained = 0;
  end loop;

  -- セッションAがまだロックを保持していることを確認してから、セッションBの
  -- set_onboarding_status('in_progress')を非同期に送る。
  perform pg_sleep(0.2);
  perform extensions.dblink_send_query('onboarding_race1b',
    $sql$ select public.set_onboarding_status('in_progress') $sql$
  );

  -- セッションBが実際にセッションAの保持するprofiles行ロックでブロックしたことを
  -- pg_stat_activityで確認してから先に進む（Race 2と同じ検証パターン）。単なる
  -- 固定sleepでは、セッションAが既にコミット待ちで行ロックを取得している保証が
  -- なく、セッションBが競合ゼロでコミット済みの'complete'を読んだだけでも
  -- invalid_onboarding_transitionという同じ結果になり得るため、このポーリングが
  -- 「本当にロック競合を経由した」ことを担保する。
  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    select wait_event into v_wait_event from pg_stat_activity
      where wait_event_type = 'Lock'
        and query ilike '%set_onboarding_status%'
      limit 1;
    if v_wait_event is not null then
      exit;
    end if;
  end loop;
  if v_wait_event is null then
    raise exception 'race 1: session B set_onboarding_status(''in_progress'') call did not '
      'block on the profiles row lock held by session A set_onboarding_status(''complete'') '
      'as expected';
  end if;

  -- セッションAをコミットしてロックを解放する。
  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    exit when extensions.dblink_is_busy('onboarding_race1') = 0;
  end loop;
  loop
    select count(*) into v_drained
      from extensions.dblink_get_result('onboarding_race1') as t(status public.profiles);
    exit when v_drained = 0;
  end loop;
  perform extensions.dblink_exec('onboarding_race1', 'commit');
  perform extensions.dblink_disconnect('onboarding_race1');

  -- セッションBの結果を取得する。invalid_onboarding_transitionで拒否されるはず。
  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    exit when extensions.dblink_is_busy('onboarding_race1b') = 0;
  end loop;
  begin
    loop
      select count(*) into v_drained
        from extensions.dblink_get_result('onboarding_race1b') as t(status public.profiles);
      exit when v_drained = 0;
    end loop;
  exception when others then
    if sqlerrm = 'invalid_onboarding_transition' then
      v_raised := true;
    else
      raise;
    end if;
  end;
  -- dblink_get_result はエラー行を例外として送出したあとも終端の空行がまだ
  -- 残っている場合があるため、commitを送る前にもう一度ドレインしておく
  -- （残りが無ければ即座に0件でループを抜ける）。
  begin
    loop
      select count(*) into v_drained
        from extensions.dblink_get_result('onboarding_race1b') as t(status public.profiles);
      exit when v_drained = 0;
    end loop;
  exception when others then
    null;
  end;
  perform extensions.dblink_exec('onboarding_race1b', 'commit');
  perform extensions.dblink_disconnect('onboarding_race1b');

  if not v_raised then
    raise exception 'race 1: the in_progress request unexpectedly succeeded against a '
      'concurrently completed profile (stale-read complete->in_progress regression)';
  end if;
  if (select onboarding_status from public.profiles where user_id = v_owner) <> 'complete' then
    raise exception 'race 1: the final onboarding_status is not complete, got %',
      (select onboarding_status from public.profiles where user_id = v_owner);
  end if;
end;
$test$;

select ok(
  (select onboarding_status from public.profiles
    where user_id = 'b1000000-0000-4000-8000-000000000101'::uuid) = 'complete',
  'race 1: a concurrently completed profile wins, and the rejected in_progress request '
  || 'never regresses it back'
);

-- -----------------------------------------------------------------------------
-- Race 2: start_household_onboarding が profiles 行を FOR UPDATE でロックして
-- 保持している間、set_onboarding_status は同じロックで直列化されて待たされ、
-- ロック解放後にだけ in_progress -> complete へ進む。両RPCが同じ行を最初にロック
-- する順序を共有していることを検証する。
-- -----------------------------------------------------------------------------
do $test$
declare
  v_owner constant uuid := 'b1000000-0000-4000-8000-000000000102';
  v_member constant uuid := 'b2000000-0000-4000-8000-000000000102';
  v_connstr constant text :=
    'host=db port=5432 dbname=postgres user=onboarding_pgtap_dblink_test '
    || 'password=onboarding_pgtap_dblink_test_only';
  v_wait_event text;
  v_attempt integer;
  v_drained integer;
begin
  insert into public.household_members (
    id, user_id, status, age_band, allergy_status, unsupported_diet_status
  ) values (
    v_member, v_owner, 'complete', 'adult', 'none', 'none'
  );
  update public.profiles
  set onboarding_status = 'in_progress', onboarding_completed_at = null
  where user_id = v_owner;
  commit;

  -- 別セッションAで start_household_onboarding を呼び、profiles行のFOR UPDATEロックを
  -- 取得したままコミットしない。
  perform extensions.dblink_connect('onboarding_race2a', v_connstr);
  perform extensions.dblink_exec('onboarding_race2a', 'begin');

  perform extensions.dblink_send_query('onboarding_race2a',
    format('select set_config(''request.jwt.claim.sub'', %L, false)', v_owner::text));
  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    exit when extensions.dblink_is_busy('onboarding_race2a') = 0;
  end loop;
  loop
    select count(*) into v_drained
      from extensions.dblink_get_result('onboarding_race2a') as t(status text);
    exit when v_drained = 0;
  end loop;

  perform extensions.dblink_send_query('onboarding_race2a',
    format('select set_config(''request.jwt.claims'', %L, false)',
      jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text));
  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    exit when extensions.dblink_is_busy('onboarding_race2a') = 0;
  end loop;
  loop
    select count(*) into v_drained
      from extensions.dblink_get_result('onboarding_race2a') as t(status text);
    exit when v_drained = 0;
  end loop;

  perform extensions.dblink_send_query('onboarding_race2a',
    format('select public.start_household_onboarding(%L)', 3));
  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    exit when extensions.dblink_is_busy('onboarding_race2a') = 0;
  end loop;
  loop
    select count(*) into v_drained
      from extensions.dblink_get_result('onboarding_race2a') as t(status public.household_members);
    exit when v_drained = 0;
  end loop;

  -- 別セッションBで set_onboarding_status('complete') を非同期に送る。セッションAが
  -- 同じprofiles行のFOR UPDATEロックをまだ保持しているため、この呼び出しはブロックする
  -- はずである（start_household_onboardingとset_onboarding_statusが同じロック順序を
  -- 共有していることの検証）。
  perform extensions.dblink_connect('onboarding_race2b', v_connstr);
  perform extensions.dblink_exec('onboarding_race2b', 'begin');

  perform extensions.dblink_send_query('onboarding_race2b',
    format('select set_config(''request.jwt.claim.sub'', %L, false)', v_owner::text));
  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    exit when extensions.dblink_is_busy('onboarding_race2b') = 0;
  end loop;
  loop
    select count(*) into v_drained
      from extensions.dblink_get_result('onboarding_race2b') as t(status text);
    exit when v_drained = 0;
  end loop;

  perform extensions.dblink_send_query('onboarding_race2b',
    format('select set_config(''request.jwt.claims'', %L, false)',
      jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text));
  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    exit when extensions.dblink_is_busy('onboarding_race2b') = 0;
  end loop;
  loop
    select count(*) into v_drained
      from extensions.dblink_get_result('onboarding_race2b') as t(status text);
    exit when v_drained = 0;
  end loop;

  perform extensions.dblink_send_query('onboarding_race2b',
    $sql$ select public.set_onboarding_status('complete') $sql$
  );

  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    select wait_event into v_wait_event from pg_stat_activity
      where wait_event_type = 'Lock'
        and query ilike '%set_onboarding_status%'
      limit 1;
    if v_wait_event is not null then
      exit;
    end if;
  end loop;
  if v_wait_event is null then
    raise exception 'race 2: session B set_onboarding_status call did not block on the '
      'profiles row lock held by session A start_household_onboarding as expected';
  end if;

  -- セッションAをコミットしてロックを解放する。
  perform extensions.dblink_exec('onboarding_race2a', 'commit');
  perform extensions.dblink_disconnect('onboarding_race2a');

  -- ロック解放後、セッションBのset_onboarding_status呼び出しが完了するまで待つ。
  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    exit when extensions.dblink_is_busy('onboarding_race2b') = 0;
  end loop;
  loop
    select count(*) into v_drained
      from extensions.dblink_get_result('onboarding_race2b') as t(status public.profiles);
    exit when v_drained = 0;
  end loop;
  perform extensions.dblink_exec('onboarding_race2b', 'commit');
  perform extensions.dblink_disconnect('onboarding_race2b');

  if (select onboarding_status from public.profiles where user_id = v_owner) <> 'complete' then
    raise exception 'race 2: the profile did not reach complete after the lock released, got %',
      (select onboarding_status from public.profiles where user_id = v_owner);
  end if;
end;
$test$;

select ok(
  (select onboarding_status from public.profiles
    where user_id = 'b1000000-0000-4000-8000-000000000102'::uuid) = 'complete',
  'race 2: start_household_onboarding and set_onboarding_status serialize on the same '
  || 'profiles row lock, so the completion lands cleanly once the lock releases'
);

select * from finish();

-- 後始末: commit方式のため、rollbackに依存せず作成した行を明示的に削除する。
begin;
delete from auth.users where id in (
  'b1000000-0000-4000-8000-000000000101','b1000000-0000-4000-8000-000000000102'
);
commit;
