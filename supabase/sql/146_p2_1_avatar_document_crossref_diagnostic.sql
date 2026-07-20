-- 146_p2_1_avatar_document_crossref_diagnostic.sql
-- Phase 2-1 진단(READ-ONLY). 적용(apply)하지 않는다 — DDL·DML 없음.
--
-- 목적: avatar(profile_image_url)와 인증서류(student_id_image_url)가 동일 객체를 가리키는
--   교차 오염 행을 "탐지만" 한다. 자동 수정·덮어쓰기·삭제 금지(기존 실제 문서 객체 보존).
--   결과가 있으면 user_id 만 보고하고 수기 판단한다.
-- 코드 계약(빌더 payload 가 문서 컬럼을 절대 만들지 않음)은
--   lib/mentor/mentorProfilePayload.ts + lib/mentor/__contract__/mentorProfilePayload.contract.test.ts 로 강제.
-- staging(lbeqxarxothkmzqvpudy) 실행 결과: 0행(교차 ref 없음).

select user_id,
       profile_image_url,
       student_id_image_url
from public.mentor_profiles
where profile_image_url is not null
  and student_id_image_url is not null
  and btrim(profile_image_url) <> ''
  and btrim(student_id_image_url) <> ''
  and (
    profile_image_url = student_id_image_url
    or regexp_replace(profile_image_url, '^.*/(student-id-images|mentor-avatars)/', '') =
       regexp_replace(student_id_image_url, '^.*/(student-id-images|mentor-avatars)/', '')
  );
