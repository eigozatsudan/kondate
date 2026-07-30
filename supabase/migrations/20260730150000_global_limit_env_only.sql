-- GLOBAL_DAILY_AI_LIMIT の上限は ENV のみが正本（製品 max 500）。
-- 既適用 DB の RPC から p_global_limit の SQL 範囲拒否を除去する。
-- 新規 migrate では先行 migration 本文も同様に直済みだが、ここは push 経路用の最終保証。

do $migrate$
declare
  v_oid oid;
  v_def text;
  v_before text;
begin
  for v_oid in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'reserve_ai_generation',
        'reserve_ai_repair_call',
        'get_ai_usage_today',
        'reserve_flyer_weekly'
      )
  loop
    v_def := pg_catalog.pg_get_functiondef(v_oid);
    v_before := v_def;

    -- reserve 系: global 範囲 + stale の複合チェック → stale のみ
    v_def := regexp_replace(
      v_def,
      'if p_global_limit is null or p_global_limit not between 1 and 200[[:space:]]+or p_stale_after_seconds < 30 then',
      'if p_stale_after_seconds < 30 then',
      'gi'
    );

    -- usage / repair / flyer: global 範囲チェックブロックを削除
    v_def := regexp_replace(
      v_def,
      '[[:space:]]*if p_global_limit is null or p_global_limit not between 1 and 200 then[[:space:]]+raise exception using errcode = ''22023'', message = ''invalid_quota_configuration'';[[:space:]]+end if;',
      E'\n',
      'gi'
    );

    if v_def is distinct from v_before then
      execute v_def;
    end if;
  end loop;
end;
$migrate$;
