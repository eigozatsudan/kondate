-- RLS-C1: 本番 migration チェーンに載っていた pgTAP 専用ロールを撤去する。
-- shopping_pgtap_dblink_test は LOGIN + BYPASSRLS + 固定パスワード付きで
-- household_members / member_allergies への書込権限を持っていた。
-- 本番パスは dblink を使わない。race 用ロールは pgTAP テスト SQL 内でのみ再作成する。

do $block$
begin
  if exists (select 1 from pg_roles where rolname = 'shopping_pgtap_dblink_test') then
    revoke all on table public.household_members, public.member_allergies from shopping_pgtap_dblink_test;
    revoke all on schema public from shopping_pgtap_dblink_test;
    drop role shopping_pgtap_dblink_test;
  end if;
end;
$block$;
