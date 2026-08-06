-- [S1-5 2026-08-06] QA-C11 — 탈퇴 시 스토리지 파일 삭제 누락.
--
-- QA 는 "주석 파일이 scan-annotations 버킷에만 있고 scan_annotations 테이블
-- 색인이 없다"를 원인으로 봤으나, 실측 결과 **원인도 대상도 다르다**.
--
-- 실제 구조: 탈퇴 워커의 수집 함수 account_deletion_storage_owner_refs 는
--   버킷과 무관하게 storage.objects.owner_id = uid 로만 수집한다. 색인 테이블
--   유무는 삭제 여부를 좌우하지 않고, **owner_id 기록 여부**가 좌우한다.
--
-- 실측(2026-08-06) owner_id NULL 객체:
--   · individual-question-attachments  4 / 7
--   · student-id-images                2 / 6
--   · shortform-videos                 1 / 1
--   · scan-annotations                 0 / 7   ← QA 가 지목한 버킷은 오히려 무혐의
--   · question-room-attachments        0 / 17
--   · community-post-images            0 / 3
--
-- 패턴: 파일명이 `<uuid>-_.ext` 인 객체만 owner_id 가 비어 있고, 앱이 올린
--   `<epoch>-<hash>.ext` 는 전부 채워져 있다. 즉 **서버 사이드(service role)
--   업로드 경로가 소유자를 남기지 않는다**. 근본 수정은 그 업로드 경로가
--   업로더를 기록하게 하는 것이며 이 migration 범위 밖(웹)이다.
--
-- 더 나쁜 사실: individual_question_attachments 의 같은 4건은 **author_id 까지
--   NULL** 이다. 이 4건은 DB 안에 소유자 단서가 전혀 없어 소급 구제가 불가능하다
--   — 웹 업로드 경로 수정 후에도 기존 4건은 수동 판정이 필요하다(후속 과제).
--
-- 이 migration 이 하는 일: 수집을 owner_id 단일 근거에서 **3중 근거**로 넓혀,
--   owner_id 가 비어도 소유자를 알 수 있는 객체는 탈퇴 시 함께 지워지게 한다.
--     ① storage.objects.owner_id = uid                     (기존)
--     ② 도메인 테이블의 author_id = uid 인 첨부의 storage_path
--        (question_attachments · individual_question_attachments)
--     ③ `<uid>/...` 경로 규약이 성립하는 **버킷 한정** 접두 매칭
--        (student-id-images · shortform-videos — 실측으로 첫 세그먼트가
--         사용자 id 임을 확인한 버킷만. IQ 첨부는 첫 세그먼트가 question_id
--         라 이 규칙을 적용하면 남의 파일을 지울 수 있어 **제외**한다.)
--
-- 반환 계약(bucket_id, name)과 호출부는 그대로다. 중복은 union 으로 제거된다.
--
-- ★ 이 migration 만으로는 QA-C11 이 닫히지 않는다(적대적 검증 2026-08-06) ★
--   워커는 181 로 귀속을 넓힌 직후 183(account_deletion_verify_object_owners)의
--   verdict 를 덮어쓴다. owner_id 가 비어 있는 객체는 183 이 'none' 을 돌려주고,
--   종전 TS 매핑은 그 값을 **null 로 덮어** 여기서 넓힌 귀속 근거를 지웠다.
--   그러면 buildDeletionPlan 이 그 객체를 `unattributable` 로 분류하고, 계획이
--   오염 판정돼 탈퇴 워커가 real-run 을 아예 시작하지 못한다(§3-4).
--   그래서 짝이 되는 수정이 함께 들어간다:
--     lib/account/accountDeletionPurgePlan.ts — applyOwnerVerdicts 의 'none' 은
--     "storage 소유자 기록 부재"라는 사실일 뿐이므로 base 의 대상 귀속을 덮지 않는다.
--   계약 테스트: lib/account/__contract__/accountDeletionOwnerRefsMapping.contract.test.ts
--   (S1-5 3건 — 귀속 유지 · 무근거 객체의 null 유지 · 'other' 우선 불변).

create or replace function public.account_deletion_storage_owner_refs(p_user_id uuid)
returns table(bucket_id text, name text)
language sql
stable
security definer
set search_path to ''
as $function$
  -- ① 스토리지 소유자 기록(정본)
  select o.bucket_id, o.name
    from storage.objects o
   where o.owner_id = p_user_id::text

  union

  -- ② 질문방 첨부 — 도메인 테이블이 작성자를 안다
  select 'question-room-attachments'::text, a.storage_path
    from public.question_attachments a
   where a.author_id = p_user_id
     and a.storage_path is not null

  union

  -- ② 개별질문 첨부 — 동일
  select 'individual-question-attachments'::text, a.storage_path
    from public.individual_question_attachments a
   where a.author_id = p_user_id
     and a.storage_path is not null

  union

  -- ③ `<uid>/` 경로 규약이 성립하는 버킷 한정(실측 확인분만)
  select o.bucket_id, o.name
    from storage.objects o
   where o.bucket_id in ('student-id-images', 'shortform-videos')
     and o.name like p_user_id::text || '/%'
$function$;

comment on function public.account_deletion_storage_owner_refs(uuid) is
  'S1-5/QA-C11: 탈퇴 대상 사용자의 스토리지 객체를 3중 근거로 수집한다 — '
  '① owner_id ② 첨부 도메인 테이블의 author_id ③ <uid>/ 경로 규약이 확인된 '
  '버킷 한정 접두 매칭. 서버 사이드 업로드가 owner_id 를 남기지 않아 수집에서 '
  '누락되던 객체를 덮는다. IQ 첨부는 첫 경로 세그먼트가 question_id 라 ③ 대상이 '
  '아니다(타인 파일 오삭제 방지).';
