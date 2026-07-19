-- --------------------------------------------------------------------------
-- 129_shortform_author_label.sql   (P0-3 · 숏폼 작성자 라벨 컬럼 정본화)
-- [DRAFT — DB 미적용]  (staging 적용은 오너 승인 후 · 적용 이력은 docs/audit/sql_apply_manifest.md)
-- 목적: shortform_posts 에 작성자 표시 라벨 author_label(text, nullable) 컬럼을 추가해,
--   웹 writer(insertShortformPost/updateShortformPost)가 이미 payload 로 기록하는 필드와
--   스키마 계약을 일치시킨다. 현재 컬럼 부재로 정상 INSERT 가 실패 → 폴백 INSERT(video_url·status
--   누락, status default 'published' 로 강제공개)로 빠지는 P0-3 결함의 "스키마측 원인"을 제거한다.
--   (코드측 폴백 삭제·Storage 보상은 웹 변경에서 별도 처리.)
-- 선행: 038  (038_p1_shortform_v2.sql = shortform_posts v2 정본 형태[video_url·status CHECK·tags 등].
--            최초 테이블 draft 는 002_app_core_schema_draft.sql / 004_p0_cash_disputes_admin_draft.sql,
--            author_role 은 017, likes 는 082. author_label 은 커뮤니티 게시판(037)·댓글(016)에만
--            존재했고 shortform_posts 에는 부재였음 — 본 파일에서 최초 추가.)
-- 계약: community_posts(037)·community_comments(016) 의 author_label 은 NOT NULL + default 이지만,
--   숏폼 표시는 resolveCommunityAuthorLabel(저장 라벨 → users 조회 → 브랜드 라벨) 폴백이 있어
--   NOT NULL/DEFAULT/길이 CHECK 를 강제하지 않는다(오너 지시). nullable text 단일 컬럼만 추가한다.
--   기존 데이터 백필 불필요(staging 0행). 표시 폴백이 미저장 행을 그대로 처리한다.
-- --------------------------------------------------------------------------

alter table public.shortform_posts
  add column if not exists author_label text;
