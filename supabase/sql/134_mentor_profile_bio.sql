-- --------------------------------------------------------------------------
-- 134_mentor_profile_bio.sql   (P2-24 · 멘토 상세 소개(bio) 저장 컬럼)
-- [적용됨 — ssambership-staging 에 2026-07-19 단일 트랜잭션(lock_timeout 3s, LOCK mentor_profiles) 적용.
--   구조 검증: bio 컬럼 text·nullable·default 없음. 원장 미기재 — 적용 이력: docs/audit/sql_apply_manifest.md]
-- 목적: 프로필 편집의 "상세 소개"(bio, 500자) 는 폼에 있으나 저장 컬럼이 없어 서버가 무시했다.
--   nullable bio text 컬럼을 추가해 웹 편집이 실제로 저장되도록 한다. intro_line(한줄 소개)과 별개.
-- 선행: mentor_profiles(001/가입 스키마). additive nullable, default 없음, CHECK 없음. 백필 불필요.
-- --------------------------------------------------------------------------

alter table public.mentor_profiles
  add column if not exists bio text;
