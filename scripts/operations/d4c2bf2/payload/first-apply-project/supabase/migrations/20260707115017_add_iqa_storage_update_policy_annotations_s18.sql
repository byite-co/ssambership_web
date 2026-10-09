-- S18: 개별질문 첨삭 ink.json 재저장(upsert=UPDATE)용 스토리지 정책
-- 스코프: annotations/ 프리픽스 한정 — 원본 첨부 덮어쓰기는 계속 불가(원본 불변 규약).
create policy iqa_storage_update_party_annotations on storage.objects
  for update to authenticated
  using (
    bucket_id = 'individual-question-attachments'
    and split_part(name, '/', 2) = 'annotations'
    and public.user_is_party_for_individual_question_storage_path(name)
  )
  with check (
    bucket_id = 'individual-question-attachments'
    and split_part(name, '/', 2) = 'annotations'
    and public.user_is_party_for_individual_question_storage_path(name)
  );