-- 성격: 조회 전용 — 단일 SELECT. LOCK·DDL·DML 없음.
-- 읽기 전용. storage.objects 정책 qra_storage_insert_party 의 현재 정의
-- 적용 전 기대 with_check: ((bucket_id = 'question-room-attachments'::text) AND user_is_room_party_for_qra_path(name) AND qra_thread_writable_for_path(name) AND qra_uploader_allowed_for_path(name) AND qra_path_upload_eligible(name) AND (NOT account_deletion_write_blocked(auth.uid())))
-- 적용 후 기대 with_check: ((bucket_id = 'question-room-attachments'::text) AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND qra_path_upload_eligible(name))
-- 두 경우 모두 polcmd = a, roles = {authenticated}, 정확히 1행. 42501 롤백 뒤에는 '적용 전' 정의가 그대로여야 한다.
SELECT p.polname, p.polcmd,
       (SELECT array_agg(rolname ORDER BY rolname) FROM pg_roles WHERE oid = ANY(p.polroles)) AS roles,
       pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass AND p.polname='qra_storage_insert_party';
