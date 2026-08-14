-- AP4: 改変クライアントが未出荷の notice_version を先書きできないようにする。
-- 旧版行は残してよい（版上げ再同意の履歴）。新規 INSERT だけ現行版に制限する。
-- 表 CHECK だと既存の旧版行が壊れるため、INSERT ポリシーの WITH CHECK で閉じる。

drop policy if exists consents_insert_own on public.privacy_consents;

create policy consents_insert_own on public.privacy_consents
for insert
to authenticated
with check (
  user_id = auth.uid()
  and notice_version = '2026-07-29.v1'
);
