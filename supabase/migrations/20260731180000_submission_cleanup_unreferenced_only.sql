-- OPS-1: freeze 提出の age 削除は、台帳 FK が残る行を除外する。
-- menu に紐づく terminal ledger は 30 日超でも保持されるため、参照中 freeze を
-- DELETE すると 23503 で run_kondate_maintenance 全体がロールバックしていた。

create or replace function private.cleanup_generation_draft_submission_versions(
  p_before timestamptz,
  p_limit integer
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  deleted_count integer;
begin
  if p_before is null or p_limit is null or p_limit < 1 or p_limit > 250 then
    raise exception using errcode = '22023', message = 'invalid_cleanup_batch';
  end if;

  -- 参照されていない（台帳が draft_id/revision を指していない）ものだけ消す。
  -- menu 保持中の new_menu ledger が指す freeze は残し、メンテ全体の abort を防ぐ。
  with doomed as (
    select version.draft_id, version.user_id, version.draft_revision
    from private.generation_draft_submission_versions version
    where version.captured_at < p_before
      and not exists (
        select 1
        from private.ai_generation_requests request
        where request.draft_id = version.draft_id
          and request.user_id = version.user_id
          and request.draft_revision = version.draft_revision
      )
    order by version.captured_at asc, version.draft_id asc, version.draft_revision asc
    limit p_limit
    for update of version skip locked
  )
  delete from private.generation_draft_submission_versions submission_version
  using doomed
  where submission_version.draft_id = doomed.draft_id
    and submission_version.user_id = doomed.user_id
    and submission_version.draft_revision = doomed.draft_revision;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function private.cleanup_generation_draft_submission_versions(timestamptz, integer)
  from public, anon, authenticated, service_role, kondate_maintenance_executor;
