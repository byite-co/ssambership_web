-- 122_content_reports_status_moderation.sql
-- content_reports.status CHECK 확장 — 모더레이션 결과 상태('hidden','removed') 허용.
--
-- 배경: lib/admin/adminReportActions.ts 의 updateContentReportModerationAction 은 콘텐츠를
--   숨김/삭제한 뒤 신고 행 status 를 statusMap({hidden->'hidden', deleted->'removed',
--   restored->'resolved'})으로 갱신한다. 그러나 032_p1_admin_content_reports.sql 의
--   content_reports_status_allowed CHECK 는 pending/reviewing/resolved/rejected/dismissed
--   만 허용해, '숨김'/'삭제' 처리는 항상 23514(check_violation)로 실패했다. 그 결과
--   콘텐츠는 이미 변경됐는데 신고는 pending 으로 남고, 감사 로그·노트·revalidate 가
--   errUrl redirect 로 전부 건너뛰어졌다.
--
-- 조치: CHECK 제약을 재정의해 'hidden','removed' 를 허용 집합에 추가한다. 이로써 신고 행이
--   모더레이션 결과(콘텐츠 상태)를 그대로 반영하게 되어 코드의 statusMap 의도가 성립한다.
--   (대안으로 코드 statusMap 을 'resolved' 로 통일할 수도 있으나, 신고 목록/필터가 hidden·
--    removed 를 구분 표시하도록 설계돼 있으므로 스키마 쪽을 확장한다.)
--
-- 실행: 검토 후 Supabase SQL Editor 에서 전체 실행. (idempotent)

alter table public.content_reports
  drop constraint if exists content_reports_status_allowed;

alter table public.content_reports
  add constraint content_reports_status_allowed check (
    status in ('pending', 'reviewing', 'resolved', 'rejected', 'dismissed', 'hidden', 'removed')
  );
