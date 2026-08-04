-- 20260729000000_public_defacl_functions_hardening.sql
-- public 스키마 '함수' 기본 권한의 hardened 전환 — postgres 소유 defacl 행 기준.
--
-- 근거(preview branch 실측, 2026-08-04):
--   * branch(부모 원장만 재생된 신규 프로젝트) defacl(f) =
--     {postgres=X, anon=X, authenticated=X, service_role=X}  ← permissive 원본
--   * 부모 '현재' defacl(f), grantor=postgres = {postgres=X}  ← hardened
--     (grantor=supabase_admin 행은 permissive 그대로 — 함수 소유자가 postgres 이므로
--      실제 신규 함수에 적용되는 것은 postgres 행이다)
--   * 원장 M13(20260730095438_comments_author_label_denormalize)의 자체 검사 ③ 는
--     신규 트리거 함수 2종에 anon/authenticated EXECUTE 가 **없어야** 통과한다.
--     그런데 그 파일의 하드닝은 `REVOKE ALL ... FROM PUBLIC` 뿐이라 명시 역할 부여를
--     제거하지 못한다 → permissive defacl 상태에서는 게이트가 구조적으로 통과 불가.
--   * 실측: branch 재생 중 037(M13)이 `S2_M13_SELFCHECK: ... (matched=0)` 로 실패.
--     따라서 이 전환은 **M13 이전**에 이미 적용돼 있었다(out-of-band, 정확 시각 UNRECOVERABLE).
--
-- ⚠️ UNVERIFIED_ON_REAL_PLATFORM: 이 배치·내용은 위 실패 증거로부터 도출했으나,
--    실제 branch 재생으로 재검증하지 못했다(브랜치 시간 상한). 신규 branch 1회로 확인 필요.
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated, service_role;
