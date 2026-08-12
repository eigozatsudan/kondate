-- ops_readonly: postgres からの SET ROLE を許可（pgTAP / ローカル診断）
-- 20260811180000 適用済み環境向け。greenfield は同内容を原 migration にも持つ。

do $body$
begin
  if not exists (select 1 from pg_roles where rolname = 'kondate_ops_readonly') then
    raise exception 'kondate_ops_readonly missing; apply 20260811180000 first';
  end if;
end
$body$;

-- 既存 membership を SET 可能に更新（PG16 grant option）
grant kondate_ops_readonly to postgres with inherit false, set true;
