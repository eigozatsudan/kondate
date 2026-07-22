\ir 000_helpers.sql
-- =============================================================================
-- Plan 5 Task 2 Step 1: apply_shopping_draft / lock_and_check_shopping_safety の
-- 並行実行（race）を dblink で開いた本当の別バックエンドセッションを使って検証する。
--
-- このファイルだけ既存の「begin;...rollback;」1トランザクション規約から外れ、
-- 明示的に commit する。理由: dblink で開くセッションは別バックエンドプロセスであり、
-- read committed の下では、外側トランザクションがまだ commit していない fixture 行を
-- 見ることができない（実測: 未commit行への dblink UPDATE は "UPDATE 0" になる）。
-- そのため、このファイルは各テストの fixture を明示的に commit してから他セッションに
-- 触らせ、テスト終了時に自分で作った行だけを明示的に削除して後始末する。
-- 他の *.test.sql の「1ファイル1 begin/rollback」規約には影響しない。
-- =============================================================================
select plan(4);

-- 前回実行が途中で失敗した場合に残った行を先に削除する（commit方式のため
-- rollbackに頼れない。auth.usersのcascade deleteでhousehold_members/
-- member_alleriesも含めて安全に削除できる）。
delete from public.shopping_lists where user_id in (
  'a1000000-0000-4000-8000-000000000101','a1000000-0000-4000-8000-000000000102',
  'a1000000-0000-4000-8000-000000000103'
);
delete from auth.users where id in (
  'a1000000-0000-4000-8000-000000000101','a1000000-0000-4000-8000-000000000102',
  'a1000000-0000-4000-8000-000000000103'
);

insert into auth.users (id,instance_id,aud,role,email) values
  ('a1000000-0000-4000-8000-000000000101','00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated','shopping-race-owner-1@example.test'),
  ('a1000000-0000-4000-8000-000000000102','00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated','shopping-race-owner-2@example.test'),
  ('a1000000-0000-4000-8000-000000000103','00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated','shopping-race-owner-3@example.test');

insert into public.household_members (
  id,user_id,status,display_name,age_band,portion_size,spice_level,
  allergy_status,unsupported_diet_status
) values
  ('a2000000-0000-4000-8000-000000000101','a1000000-0000-4000-8000-000000000101',
    'draft','子ども1','age_6_8','regular','mild','registered','none'),
  ('a2000000-0000-4000-8000-000000000102','a1000000-0000-4000-8000-000000000102',
    'draft','子ども2','age_6_8','regular','mild','registered','none'),
  ('a2000000-0000-4000-8000-000000000103','a1000000-0000-4000-8000-000000000103',
    'draft','子ども3','age_6_8','regular','mild','registered','none');
insert into public.member_allergies (
  id,user_id,member_id,allergen_id,custom_name,custom_confirmed
) values
  ('a3000000-0000-4000-8000-000000000101','a1000000-0000-4000-8000-000000000101',
    'a2000000-0000-4000-8000-000000000101','wheat',null,false),
  ('a3000000-0000-4000-8000-000000000102','a1000000-0000-4000-8000-000000000102',
    'a2000000-0000-4000-8000-000000000102','wheat',null,false),
  ('a3000000-0000-4000-8000-000000000103','a1000000-0000-4000-8000-000000000103',
    'a2000000-0000-4000-8000-000000000103','wheat',null,false);
update public.household_members set status='complete'
  where id in ('a2000000-0000-4000-8000-000000000101','a2000000-0000-4000-8000-000000000102',
    'a2000000-0000-4000-8000-000000000103');

insert into public.menus (
  id,user_id,meal_type,cuisine_genre,servings,total_elapsed_minutes,
  preference_snapshot,safety_snapshot,safety_fingerprint,target_mode,allergen_dictionary_version,
  food_safety_rule_version,output_schema_version,derivation_group_id,version
) values
  ('a4000000-0000-4000-8000-000000000101','a1000000-0000-4000-8000-000000000101',
    'dinner','japanese',2,30,'{}','{}',repeat('a',64),'household','allergens-v1','food-v1','menu-v1',
    'a5000000-0000-4000-8000-000000000101',1),
  ('a4000000-0000-4000-8000-000000000102','a1000000-0000-4000-8000-000000000102',
    'dinner','japanese',2,30,'{}','{}',repeat('a',64),'household','allergens-v1','food-v1','menu-v1',
    'a5000000-0000-4000-8000-000000000102',1),
  ('a4000000-0000-4000-8000-000000000103','a1000000-0000-4000-8000-000000000103',
    'dinner','japanese',2,30,'{}','{}',repeat('a',64),'household','allergens-v1','food-v1','menu-v1',
    'a5000000-0000-4000-8000-000000000103',1);
insert into public.menu_target_members (
  id,menu_id,user_id,household_member_id,household_member_user_id,
  anonymous_ref,member_display_name_snapshot
) values
  ('a6000000-0000-4000-8000-000000000101','a4000000-0000-4000-8000-000000000101',
    'a1000000-0000-4000-8000-000000000101','a2000000-0000-4000-8000-000000000101',
    'a1000000-0000-4000-8000-000000000101','member_1','子ども1'),
  ('a6000000-0000-4000-8000-000000000102','a4000000-0000-4000-8000-000000000102',
    'a1000000-0000-4000-8000-000000000102','a2000000-0000-4000-8000-000000000102',
    'a1000000-0000-4000-8000-000000000102','member_1','子ども2'),
  ('a6000000-0000-4000-8000-000000000103','a4000000-0000-4000-8000-000000000103',
    'a1000000-0000-4000-8000-000000000103','a2000000-0000-4000-8000-000000000103',
    'a1000000-0000-4000-8000-000000000103','member_1','子ども3');
insert into public.dishes (
  id,menu_id,user_id,role,position,name,description,cooking_time_minutes
) values
  ('a8000000-0000-4000-8000-000000000101','a4000000-0000-4000-8000-000000000101',
    'a1000000-0000-4000-8000-000000000101','main',1,'煮物','race検証用の煮物1です',20),
  ('a8000000-0000-4000-8000-000000000102','a4000000-0000-4000-8000-000000000102',
    'a1000000-0000-4000-8000-000000000102','main',1,'煮物','race検証用の煮物2です',20),
  ('a8000000-0000-4000-8000-000000000103','a4000000-0000-4000-8000-000000000103',
    'a1000000-0000-4000-8000-000000000103','main',1,'煮物','race検証用の煮物3です',20);
insert into public.dish_ingredients (
  id,menu_id,dish_id,user_id,position,name,quantity_value,quantity_text,unit,store_section
) values
  ('a7000000-0000-4000-8000-000000000101','a4000000-0000-4000-8000-000000000101',
    'a8000000-0000-4000-8000-000000000101','a1000000-0000-4000-8000-000000000101',
    1,'にんじん',1,'1本','本','produce'),
  ('a7000000-0000-4000-8000-000000000102','a4000000-0000-4000-8000-000000000102',
    'a8000000-0000-4000-8000-000000000102','a1000000-0000-4000-8000-000000000102',
    1,'にんじん',1,'1本','本','produce'),
  ('a7000000-0000-4000-8000-000000000103','a4000000-0000-4000-8000-000000000103',
    'a8000000-0000-4000-8000-000000000103','a1000000-0000-4000-8000-000000000103',
    1,'にんじん',1,'1本','本','produce');

-- fixture は psql のデフォルト autocommit により各insert文の直後にcommit済み
-- （このファイルではbegin;を開いていない）。dblinkの別セッションからは
-- 既にこの時点で見えている。

-- -----------------------------------------------------------------------------
-- Race 1: apply_shopping_draft が期待フィンガープリントを読んだ後、別セッションが
-- household_members のフィンガープリント対象フィールドを更新してコミットすると、
-- apply_shopping_draft は safety_fingerprint_changed で失敗し、shopping 関連の行を
-- 一切書き込まない。
-- -----------------------------------------------------------------------------
do $test$
declare
  v_owner constant uuid := 'a1000000-0000-4000-8000-000000000101';
  v_member constant uuid := 'a2000000-0000-4000-8000-000000000101';
  v_menu constant uuid := 'a4000000-0000-4000-8000-000000000101';
  v_dish constant uuid := 'a8000000-0000-4000-8000-000000000101';
  v_ingredient constant uuid := 'a7000000-0000-4000-8000-000000000101';
  v_connstr constant text :=
    'host=db port=5432 dbname=postgres user=shopping_pgtap_dblink_test password=shopping_pgtap_dblink_test_only';
  v_fingerprint text;
  v_draft jsonb;
  v_raised boolean := false;
begin
  v_fingerprint := public.shopping_safety_fingerprint(v_owner, v_menu);
  v_draft := jsonb_build_object(
    'items', jsonb_build_array(jsonb_build_object(
      'key','carrot-race-1','displayName','にんじん','normalizedName','にんじん',
      'storeSection','produce','quantityValue',1,'quantityText','1本','unit','本',
      'pantryCheckRequired',false,
      'sourceIngredients', jsonb_build_array(jsonb_build_object(
        'ingredientId',v_ingredient,'dishId',v_dish,'dishName','煮物','name','にんじん',
        'quantityValue',1,'quantityText','1本','unit','本','storeSection','produce'
      )),
      'labelWarnings','[]'::jsonb
    )),
    'listLabelWarnings','[]'::jsonb
  );

  -- 他セッション（別バックエンドプロセス）が household_members のフィンガープリント
  -- 構成フィールド（required_safety_constraints）を更新してコミットする。これは
  -- apply_shopping_draft 呼び出しより前に完了しており、RPC内部の
  -- lock_and_check_shopping_safety がロック取得後に再計算する値と、呼び出し時に
  -- 渡した v_fingerprint（更新前の値）を食い違わせる。
  perform extensions.dblink_exec(v_connstr,
    format(
      'update public.household_members set required_safety_constraints=array[%L]::text[] where id=%L::uuid',
      'remove_bones', v_member
    )
  );

  begin
    perform public.apply_shopping_draft(
      v_owner, v_menu, 'new', null, null, v_fingerprint,
      'a9000000-0000-4000-8000-000000000101'::uuid,
      encode(extensions.digest(convert_to('creation-race-1','UTF8'),'sha256'),'hex'),
      v_draft
    );
  exception when others then
    if sqlerrm = 'safety_fingerprint_changed' then
      v_raised := true;
    else
      raise;
    end if;
  end;
  if not v_raised then
    raise exception 'apply_shopping_draft unexpectedly succeeded with a stale fingerprint';
  end if;
  if exists(select 1 from public.shopping_lists where user_id = v_owner) then
    raise exception 'race 1: a stale-fingerprint draft wrote shopping rows';
  end if;
end;
$test$;

select ok(
  not exists(select 1 from public.shopping_lists
    where user_id = 'a1000000-0000-4000-8000-000000000101'::uuid),
  'race 1: a household change committed between fingerprint read and RPC apply '
  || 'raises safety_fingerprint_changed with zero shopping rows written'
);

-- -----------------------------------------------------------------------------
-- Race 2: private.lock_and_check_shopping_safety が対象 household_members 行に
-- FOR UPDATE ロックを保持している間、他セッションの member_allergies 挿入は
-- その親FKでブロックされ、ロック保持セッションがコミットするまで完了しない。
-- -----------------------------------------------------------------------------
do $test$
declare
  v_owner constant uuid := 'a1000000-0000-4000-8000-000000000102';
  v_member constant uuid := 'a2000000-0000-4000-8000-000000000102';
  v_connstr constant text :=
    'host=db port=5432 dbname=postgres user=shopping_pgtap_dblink_test password=shopping_pgtap_dblink_test_only';
  v_new_allergy constant uuid := 'a3000000-0000-4000-8000-000000000199';
  v_wait_event text;
  v_wait_pid integer;
  v_attempt integer;
  v_completed_before_commit boolean := false;
begin
  -- 他セッションでトランザクションを開始し、member_allergies への insert を
  -- 非同期に送信する（このinsertはmember_idの親FKでhousehold_membersを参照する）。
  -- dblink_send_query は名前付き接続を要求するため、まず明示的に dblink_connect する。
  perform extensions.dblink_connect('shopping_race2', v_connstr);
  perform extensions.dblink_exec('shopping_race2', 'begin');
  perform extensions.dblink_send_query('shopping_race2',
    format(
      'insert into public.member_allergies(id,user_id,member_id,allergen_id,custom_name,custom_confirmed) '
      || 'values (%L::uuid,%L::uuid,%L::uuid,%L,null,false)',
      v_new_allergy, v_owner, v_member, 'soy'
    )
  );

  -- 現在のセッションのトランザクション内で household_members 行を FOR UPDATE
  -- ロックする（private.lock_and_check_shopping_safety の該当句と同じロック種別）。
  perform 1 from public.household_members where id = v_member for update;

  -- 他セッションのinsertがブロックされたままであることを最大1秒間ポーリングで確認する。
  for v_attempt in 1..20 loop
    perform pg_sleep(0.05);
    select wait_event, pid into v_wait_event, v_wait_pid from pg_stat_activity
      where wait_event_type = 'Lock'
        and query ilike '%member_allergies%'
        and query ilike '%' || v_new_allergy::text || '%'
      limit 1;
    if v_wait_event is not null then
      exit;
    end if;
    if exists(select 1 from public.member_allergies where id = v_new_allergy) then
      v_completed_before_commit := true;
      exit;
    end if;
  end loop;

  if v_completed_before_commit then
    raise exception 'race 2: other session insert completed before the lock was released '
      '(no blocking observed; race was not exercised)';
  end if;
  if v_wait_event is null then
    raise exception 'race 2: other session insert did not block on the parent FK lock as expected';
  end if;

  -- ロックを保持したまま、他セッションがまだブロックされていることを再確認してから
  -- 現在のトランザクションをコミットしてロックを解放する。
  if exists(select 1 from public.member_allergies where id = v_new_allergy) then
    raise exception 'race 2: other session insert completed while the lock was still held';
  end if;
  commit;

  -- ロック解放後、他セッションのinsertが完了するまで待つ。
  for v_attempt in 1..20 loop
    perform pg_sleep(0.05);
    exit when extensions.dblink_is_busy('shopping_race2') = 0;
  end loop;
  -- dblink_send_query の非同期結果を明示的に取得して消費してからでないと、
  -- 同じ名前付き接続へ次のコマンドを送れない。libpqのPQgetResultと同様、
  -- 結果が尽きるまで（0行になるまで）繰り返し呼ぶ必要がある
  -- （1回目でinsertの結果行、2回目で終端のNULLを消費する）。
  loop
    declare
      v_drained integer;
    begin
      select count(*) into v_drained
        from extensions.dblink_get_result('shopping_race2') as t(status text);
      exit when v_drained = 0;
    end;
  end loop;
  perform extensions.dblink_exec('shopping_race2', 'commit');
  perform extensions.dblink_disconnect('shopping_race2');

  if not exists(select 1 from public.member_allergies where id = v_new_allergy) then
    raise exception 'race 2: other session insert did not complete after the lock was released';
  end if;
end;
$test$;

select ok(
  exists(select 1 from public.member_allergies
    where id = 'a3000000-0000-4000-8000-000000000199'::uuid),
  'race 2: a concurrent member_allergies insert blocks on the parent FK while '
  || 'household_members is FOR UPDATE locked, and completes only after the lock releases'
);

-- -----------------------------------------------------------------------------
-- Race 3a（設計書 Task4 Step3）: ブラウザが再検証してリスト安全性 fingerprint を
-- 受け取ったあと、別セッションがアレルギーを追加してコミットした場合、その
-- fingerprint を使った mutate_shopping_item は
-- private.lock_and_check_shopping_list_safety に阻まれて
-- shopping_safety_fingerprint_changed で失敗し、項目もリストversionも変わらない。
-- （「別セッションが先にコミットしたなら、項目変更は拒否される」側の証明。）
-- -----------------------------------------------------------------------------
-- 先に買い物リストを作ってコミットしておく。apply_shopping_draft は
-- private.lock_and_check_shopping_safety 経由で household_members 行に FOR UPDATE を
-- 取り、そのロックはトランザクション終了まで残る。同じトランザクション内から
-- dblink でアレルギーを insert すると、その insert が自分自身のロック待ちになり
-- 自己デッドロックするため、fixture 作成と race 本体はトランザクションを分ける。
do $test$
declare
  v_owner constant uuid := 'a1000000-0000-4000-8000-000000000103';
  v_menu constant uuid := 'a4000000-0000-4000-8000-000000000103';
  v_dish constant uuid := 'a8000000-0000-4000-8000-000000000103';
  v_ingredient constant uuid := 'a7000000-0000-4000-8000-000000000103';
  v_fingerprint text;
  v_draft jsonb;
begin
  v_fingerprint := public.shopping_safety_fingerprint(v_owner, v_menu);
  v_draft := jsonb_build_object(
    'items', jsonb_build_array(jsonb_build_object(
      'key','carrot-race-3','displayName','にんじん','normalizedName','にんじん',
      'storeSection','produce','quantityValue',1,'quantityText','1本','unit','本',
      'pantryCheckRequired',false,
      'sourceIngredients', jsonb_build_array(jsonb_build_object(
        'ingredientId',v_ingredient,'dishId',v_dish,'dishName','煮物','name','にんじん',
        'quantityValue',1,'quantityText','1本','unit','本','storeSection','produce'
      )),
      'labelWarnings','[]'::jsonb
    )),
    'listLabelWarnings','[]'::jsonb
  );
  perform public.apply_shopping_draft(
    v_owner, v_menu, 'new', null, null, v_fingerprint,
    'a9000000-0000-4000-8000-000000000103'::uuid,
    encode(extensions.digest(convert_to('creation-race-3','UTF8'),'sha256'),'hex'),
    v_draft
  );
end;
$test$;

do $test$
declare
  v_owner constant uuid := 'a1000000-0000-4000-8000-000000000103';
  v_member constant uuid := 'a2000000-0000-4000-8000-000000000103';
  v_connstr constant text :=
    'host=db port=5432 dbname=postgres user=shopping_pgtap_dblink_test password=shopping_pgtap_dblink_test_only';
  v_list_id uuid;
  v_item_id uuid;
  v_list_fingerprint text;
  v_raised boolean := false;
begin
  select id into v_list_id from public.shopping_lists
    where user_id = v_owner and status = 'active';
  select id into v_item_id from public.shopping_items where list_id = v_list_id limit 1;

  -- ブラウザの再検証が受け取ったトークン（この時点の値）。
  v_list_fingerprint := public.shopping_list_safety_fingerprint(v_owner, v_list_id);

  -- 別セッション（別バックエンドプロセス）がアレルギーを追加してコミットする。
  perform extensions.dblink_exec(v_connstr,
    format(
      'insert into public.member_allergies(id,user_id,member_id,allergen_id,custom_name,custom_confirmed) '
      || 'values (%L::uuid,%L::uuid,%L::uuid,%L,null,false)',
      'a3000000-0000-4000-8000-000000000193', v_owner, v_member, 'soy'
    )
  );

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  begin
    perform public.mutate_shopping_item(
      v_list_id, 1, v_list_fingerprint, 'set_checked', v_item_id,
      'a9000000-0000-4000-8000-000000000113'::uuid, jsonb_build_object('isChecked', true)
    );
  exception when others then
    if sqlerrm = 'shopping_safety_fingerprint_changed' then
      v_raised := true;
    else
      raise;
    end if;
  end;
  reset role;

  if not v_raised then
    raise exception 'race 3a: a stale-fingerprint item mutation unexpectedly succeeded';
  end if;
  if exists(select 1 from public.shopping_items where id = v_item_id and is_checked) then
    raise exception 'race 3a: a rejected mutation changed the item anyway';
  end if;
  if (select version from public.shopping_lists where id = v_list_id) <> 1 then
    raise exception 'race 3a: a rejected mutation advanced the list version';
  end if;
end;
$test$;

select ok(
  exists(select 1 from public.shopping_items i join public.shopping_lists l on l.id = i.list_id
    where l.user_id = 'a1000000-0000-4000-8000-000000000103'::uuid and not i.is_checked)
  and exists(select 1 from public.member_allergies
    where id = 'a3000000-0000-4000-8000-000000000193'::uuid),
  'race 3a: an allergy committed by another session after revalidation makes the item '
  || 'mutation fail with shopping_safety_fingerprint_changed and leaves the item unchanged'
);

-- -----------------------------------------------------------------------------
-- Race 3b（設計書 Task4 Step3）: 逆順のケース。mutate_shopping_item が
-- private.lock_and_check_shopping_list_safety の FOR UPDATE ロックを保持している間、
-- 別セッションのアレルギー追加は親FKでブロックされ、項目変更がコミットするまで
-- 完了しない。つまり「先にコミットして項目変更を拒否する」か「項目変更のコミットを
-- 待つ」かのどちらかであり、1つの古い fingerprint の下で両方が起きることはない。
-- -----------------------------------------------------------------------------
do $test$
declare
  v_owner constant uuid := 'a1000000-0000-4000-8000-000000000103';
  v_connstr constant text :=
    'host=db port=5432 dbname=postgres user=shopping_pgtap_dblink_test password=shopping_pgtap_dblink_test_only';
  v_new_allergy constant uuid := 'a3000000-0000-4000-8000-000000000194';
  v_list_id uuid;
  v_item_id uuid;
  v_list_fingerprint text;
  v_response jsonb;
  v_wait_event text;
  v_attempt integer;
  v_completed_before_commit boolean := false;
begin
  select id into v_list_id from public.shopping_lists
    where user_id = v_owner and status = 'active';
  select id into v_item_id from public.shopping_items where list_id = v_list_id limit 1;
  -- Race 3a でアレルギーが増えているため、ここで取り直した値が現在のトークン。
  v_list_fingerprint := public.shopping_list_safety_fingerprint(v_owner, v_list_id);

  -- 先に項目変更を実行してロックを取得する（このトランザクションはまだコミットしない）。
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_response := public.mutate_shopping_item(
    v_list_id, 1, v_list_fingerprint, 'set_checked', v_item_id,
    'a9000000-0000-4000-8000-000000000123'::uuid, jsonb_build_object('isChecked', true)
  );
  reset role;
  if (v_response->>'version')::integer <> 2 then
    raise exception 'race 3b: the item mutation should advance the list version to 2, got %',
      v_response->>'version';
  end if;

  -- ロックを保持したまま、別セッションがアレルギー追加を非同期に送る。
  perform extensions.dblink_connect('shopping_race3b', v_connstr);
  perform extensions.dblink_exec('shopping_race3b', 'begin');
  perform extensions.dblink_send_query('shopping_race3b',
    format(
      'insert into public.member_allergies(id,user_id,member_id,allergen_id,custom_name,custom_confirmed) '
      || 'values (%L::uuid,%L::uuid,%L::uuid,%L,null,false)',
      v_new_allergy, v_owner, 'a2000000-0000-4000-8000-000000000103', 'egg'
    )
  );

  for v_attempt in 1..20 loop
    perform pg_sleep(0.05);
    select wait_event into v_wait_event from pg_stat_activity
      where wait_event_type = 'Lock'
        and query ilike '%member_allergies%'
        and query ilike '%' || v_new_allergy::text || '%'
      limit 1;
    if v_wait_event is not null then
      exit;
    end if;
    if exists(select 1 from public.member_allergies where id = v_new_allergy) then
      v_completed_before_commit := true;
      exit;
    end if;
  end loop;

  if v_completed_before_commit then
    raise exception 'race 3b: the allergy change completed while the item mutation still held '
      'its locks (both sides happened under one stale fingerprint)';
  end if;
  if v_wait_event is null then
    raise exception 'race 3b: the allergy change did not block on the mutation locks as expected';
  end if;
  commit;

  for v_attempt in 1..20 loop
    perform pg_sleep(0.05);
    exit when extensions.dblink_is_busy('shopping_race3b') = 0;
  end loop;
  -- dblink_send_query の非同期結果は尽きるまで取得しないと接続を再利用できない。
  loop
    declare
      v_drained integer;
    begin
      select count(*) into v_drained
        from extensions.dblink_get_result('shopping_race3b') as t(status text);
      exit when v_drained = 0;
    end;
  end loop;
  perform extensions.dblink_exec('shopping_race3b', 'commit');
  perform extensions.dblink_disconnect('shopping_race3b');

  if not exists(select 1 from public.member_allergies where id = v_new_allergy) then
    raise exception 'race 3b: the allergy change did not complete after the mutation committed';
  end if;
  if not exists(select 1 from public.shopping_items where id = v_item_id and is_checked) then
    raise exception 'race 3b: the item mutation did not persist';
  end if;
end;
$test$;

select ok(
  exists(select 1 from public.member_allergies
    where id = 'a3000000-0000-4000-8000-000000000194'::uuid)
  and exists(select 1 from public.shopping_items i join public.shopping_lists l on l.id = i.list_id
    where l.user_id = 'a1000000-0000-4000-8000-000000000103'::uuid and i.is_checked),
  'race 3b: an allergy change raised after the item mutation took its safety locks blocks '
  || 'until that mutation commits, so it never lands under the same stale fingerprint'
);

select * from finish();

-- 後始末: commit方式のため、rollbackに依存せず作成した行を明示的に削除する。
-- shopping_* テーブルは menus/dish_ingredients に対して on delete set null のため、
-- auth.users の cascade delete だけでは消えない。household_members/member_allergies は
-- auth.users からの on delete cascade で自動的に削除されるため、個別削除は不要
-- （直接削除すると "member_registered_allergy_required" トリガーに抵触するため
-- auth.users 経由のcascadeに委ねるのが安全）。
begin;
delete from public.shopping_lists where user_id in (
  'a1000000-0000-4000-8000-000000000101','a1000000-0000-4000-8000-000000000102',
  'a1000000-0000-4000-8000-000000000103'
);
delete from auth.users where id in (
  'a1000000-0000-4000-8000-000000000101','a1000000-0000-4000-8000-000000000102',
  'a1000000-0000-4000-8000-000000000103'
);
commit;
