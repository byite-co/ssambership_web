-- 169_iq_attachment_storage_delete_policy.sql
-- individual-question-attachments 버킷 조건부 DELETE 정책 신설 —
-- 업로드는 됐지만 등록(RPC)이 실패한 **미등록 객체**를 업로더 본인이 보상 삭제할 수 있게 한다.
-- 등록이 완료된 첨부는 계속 삭제 불가.
--
-- ⚠️ 이 파일은 웨이브 1(트랙 3)에서 **초안으로만** 작성되었다. staging 미적용.
--
-- 배경(2026-07-25 staging `lbeqxarxothkmzqvpudy` read-only 실조회):
--   - 버킷 실태: individual-question-attachments · public=false · file_size_limit=20971520(20MB) ·
--     allowed_mime_types 9종(png/jpeg/webp/gif, pdf, zip, docx, pptx, json).
--   - 이 버킷의 storage.objects 정책 3건 — 명명이 `iqa_storage_*` 이다.
--     ※ 명명 구분(2026-07-25 재실측): `iqa_select_party` 는 **실재하는 정책명**이지만
--        storage 가 아니라 **테이블 RLS** 정책이다
--        (public.individual_question_attachments · SELECT · authenticated ·
--         using: user_is_individual_question_party(question_id) — 이 테이블의 유일한 정책).
--        앱의 findRegistered(당사자 SELECT) 가 의존하는 것이 바로 이 테이블 정책이다.
--        storage 쪽 SELECT 정책명은 별개로 `iqa_storage_read_party` 이며,
--        아래 신설 DELETE 정책은 storage 쪽 실명 규약(`iqa_storage_*`)을 따른다.
--        이 스크립트는 테이블 RLS 정책 `iqa_select_party` 를 일절 건드리지 않는다.
--       · iqa_storage_read_party   (SELECT, authenticated)
--           using: bucket_id='individual-question-attachments'
--                  AND user_is_party_for_individual_question_storage_path(name)
--       · iqa_storage_insert_party (INSERT, authenticated) — with_check 동일 식
--       · iqa_storage_update_party_annotations (UPDATE, authenticated)
--           — split_part(name,'/',2)='annotations' 로 한정
--   - **DELETE 정책 0건** 재확인. storage.objects 전체의 DELETE 정책 6건을 전수 조회했고
--     (cpi_auth_delete_own, custom_order_message_attachments_storage_delete_uploader_or_adm,
--      pa_auth_delete_own, qra_storage_delete_unregistered_owner, sfv_mentor_delete_own,
--      student_id_images_delete_own) 이 버킷을 커버하는 항목은 **하나도 없다**.
--     → 현재 미등록 객체는 authenticated 경로로 영구 삭제 불가(고아 누적).
--   - 고아 실태: 버킷 객체 5건 중 등록 행이 없는 객체 **4건**. 반대로 등록 행은 있는데
--     객체가 없는 경우 0건. annotations 세그먼트 객체 0건. 서로 다른 첫 세그먼트 5개.
--
--   - ⚠️ 소유자 컬럼 실태(정책 설계의 핵심 제약):
--       이 버킷 5개 객체는 owner·owner_id 가 **전부 NULL/빈 문자열**이다.
--       반면 다른 7개 버킷(community-post-images 64, question-room-attachments 7,
--       custom-order-deliverables 2, custom-request-application-attachments 2,
--       custom-request-post-attachments 2, profile-avatars 1, student-id-images 1)은
--       owner_id NULL 이 **0건** — 즉 클라이언트 업로드 경로에서는 owner_id 가 정상 기록된다.
--       따라서 이 버킷의 NULL 은 systemic 결함이 아니라 **fixture/service_role 시드 흔적**으로
--       판단된다. 앞으로의 정상 업로드에는 owner_id 가 채워지므로 아래 owner_id 조건은 유효하다.
--       다만 **기존 5개 객체(고아 4건 포함)는 이 정책으로 삭제되지 않는다**(fail-closed).
--       그 4건의 처리는 자동 정리 대상이 아니며 오너·판정자 결정 사항이다
--       (docs/sql/wave1-iq-contract-plan.md §5).
--
-- 조치: DELETE 정책 1건만 신설. 기존 SELECT/INSERT/UPDATE 정책 3건과 버킷 설정은 일절 불변.
--   139(question-room-attachments 의 qra_storage_delete_unregistered_owner)와 동일한 패턴에
--   **당사자 조건을 하나 더 얹었다**. 139 는 (bucket + owner + 미등록) 3조건이지만, 여기서는
--   경로 첫 세그먼트가 question_id 인 구조를 살려 party 검사까지 요구한다 — 업로더가 사후에
--   질문 당사자 자격을 잃은 경우(멘토 claim 해제 등)까지 닫기 위함이다.
--
-- 선행: 070, 117, 139(패턴 원본). 167·168 과는 **독립**이다(적용 순서상 뒤에 두지만 의존은 아님).
--   단 "등록된 객체는 삭제 불가" 판정이 individual_question_attachments 를 참조하므로,
--   168 의 멱등 등록이 먼저 자리잡은 뒤 적용하는 편이 보상 삭제 경로의 의미가 분명하다.

begin;
set local lock_timeout = '5s';

-- ── 0. 사전 검증: 이 버킷을 커버하는 DELETE 정책이 정말 없는지 재확인 ──
--    (있다면 중복·상충 위험 — 조용히 덮지 않고 중단한다.)
do $$
declare
  v_existing text;
begin
  select string_agg(policyname, ', ')
    into v_existing
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and cmd in ('DELETE', 'ALL')
    and coalesce(qual, '') like '%individual-question-attachments%'
    and policyname <> 'iqa_storage_delete_unregistered_owner';

  if v_existing is not null then
    raise exception
      'ABORT_169: 이 버킷을 커버하는 기존 DELETE/ALL 정책 발견 (%). 상충 검토 없이 신설 금지.',
      v_existing;
  end if;

  raise notice '169 preflight OK: 기존 DELETE 정책 0건 확인.';
end $$;

-- ── 1. 조건부 DELETE 정책 신설(멱등 — 재적용 안전) ──
--    4조건 AND:
--      (a) 이 버킷일 것
--      (b) 업로더 본인 소유일 것            → 타인 객체 삭제 차단
--      (c) 경로가 가리키는 질문의 당사자일 것 → 사후 자격 상실 차단
--      (d) 등록 행이 없을 것                → 등록 완료 첨부는 삭제 불가(감사 추적 보존)
drop policy if exists iqa_storage_delete_unregistered_owner on storage.objects;
create policy iqa_storage_delete_unregistered_owner on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'individual-question-attachments'
    and owner_id = (select auth.uid())::text
    and public.user_is_party_for_individual_question_storage_path(name)
    and not exists (
      select 1
      from public.individual_question_attachments a
      where a.storage_path = storage.objects.name
    )
  );

commit;

-- ── §V 검증 SELECT (적용 후 별도 실행) ──
-- select policyname, cmd, roles::text, qual
--   from pg_policies
--  where schemaname='storage' and tablename='objects'
--    and policyname='iqa_storage_delete_unregistered_owner';
-- 기대: DELETE | {authenticated} | 위 4조건 AND 식
--
-- select count(*) from pg_policies
--  where schemaname='storage' and tablename='objects' and policyname like 'iqa_storage_%';
-- 기대: 4 (read_party, insert_party, update_party_annotations, delete_unregistered_owner)
--
-- ── ROLLBACK 절차 ──
-- 추가형 단일 정책이므로 되돌림이 무손실이다(기존 3정책·버킷 설정 무변경).
--   drop policy if exists iqa_storage_delete_unregistered_owner on storage.objects;
-- 되돌리면 DELETE 정책 0건 상태(=현행 baseline)로 정확히 복귀한다.
--
-- ── 적용 보류 조건 ──
-- §0 검증이 기존 DELETE/ALL 정책을 발견하면 중단한다. 또한 적용 시점에 이 버킷의
-- owner_id NULL 객체 비율이 여전히 100% 라면, 정책은 신설하되 **보상 삭제 경로가 실제로
-- 동작하는지는 신규 업로드 픽스처로 확인**해야 한다(기존 5객체로는 검증 불가 — plan 문서 §3).
