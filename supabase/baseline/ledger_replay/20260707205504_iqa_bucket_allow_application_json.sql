-- S19: individual-question-attachments 버킷 mime 화이트리스트에 application/json 1개 추가
-- (앱 레포 supabase/migrations/20260707T1510_iqa_bucket_allow_application_json.sql 과 동일 본문)

update storage.buckets
set allowed_mime_types = allowed_mime_types || array['application/json']
where id = 'individual-question-attachments'
  and allowed_mime_types is not null
  and not ('application/json' = any(allowed_mime_types));