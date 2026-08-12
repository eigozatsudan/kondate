-- H11: household_members の作成経路を SECURITY DEFINER RPC のみに寄せる。
--
-- 背景:
-- アプリは start_household_onboarding（既存 draft 再利用の原子 RPC）だけで
-- メンバーを作成する。一方で authenticated には table INSERT + members_insert_own
-- が残り、REST/JWT 直 INSERT で複数 draft 並立や add-scope 前提のすり抜けが
-- 可能だった（own-user のみ・IDOR ではないが onboarding 整合性の穴）。
--
-- 方針（shopping_items / member_allergies update|delete と同様）:
-- - authenticated から INSERT 権限を revoke
-- - 到達不能になる INSERT ポリシー自体も drop（将来の再付与で無自覚復活を防ぐ）
-- - SELECT / UPDATE / DELETE は従来どおり owner RLS
-- - service_role の ALL と SECURITY DEFINER RPC 内 insert は維持

drop policy if exists members_insert_own on public.household_members;

revoke insert on table public.household_members from authenticated;
