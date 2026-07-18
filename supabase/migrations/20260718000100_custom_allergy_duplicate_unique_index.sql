-- add_custom_member_allergyのEXISTSチェックは同時実行下でTOCTOU競合になり得るため、
-- 標準アレルゲン側のmember_allergies_standard_uniqueと同じ形でDB制約による最終防波堤を追加する。
create unique index member_allergies_custom_name_unique
  on public.member_allergies(member_id, private.normalize_allergen_term(custom_name))
  where allergen_id is null;
