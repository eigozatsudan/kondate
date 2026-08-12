-- admin 共有レシピ閲覧: ops に pool / origins の SELECT と title 関数 EXECUTE のみ付与。
-- service_role / authenticated / anon への表 GRANT は拡大しない。

grant select on private.shared_emergency_recipes to kondate_ops_readonly;
grant select on private.shared_emergency_recipe_origins to kondate_ops_readonly;

grant execute on function private.share_recipe_title_from_payload(jsonb)
  to kondate_ops_readonly;

create index if not exists shared_emergency_recipes_ops_created_id_idx
  on private.shared_emergency_recipes (created_at desc, id desc);
