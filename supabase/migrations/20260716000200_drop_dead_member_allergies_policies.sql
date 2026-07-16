-- serialize_member_allergy_deletion で update/delete 権限自体を authenticated から
-- revoke 済みのため、旧来の所有者スコープ RLS ポリシーは到達不能なまま残っていた。
-- 将来 update/delete 権限を再付与した際に、検証されていないこのポリシーが
-- 無自覚に復活しないよう、ポリシー自体を削除する。
drop policy if exists allergies_update_own on public.member_allergies;
drop policy if exists allergies_delete_own on public.member_allergies;
