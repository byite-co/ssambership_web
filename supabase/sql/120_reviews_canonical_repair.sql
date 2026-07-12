-- =============================================================================
-- 120: reviews 3중정의 수렴 보정 — 042 형태로 컬럼·유니크 보장 (BUG-C)
-- =============================================================================
-- 배경(BUG-C): public.reviews 가 세 곳에서 서로 다른 형태로 정의된다.
--   · 002:584  draft(kitchen-sink: reviewee_id/score/stars/comment/body …)
--   · 004:150  draft(author_id/rating/body)
--   · 042      정본(student_id/subscription_count/content/mentor_reply/
--              mentor_replied_at/is_hidden + unique(mentor_id, student_id))
--   전부 create table if not exists 라 "먼저 실행된 쪽이 형태를 고착"하고
--   나머지는 조용히 no-op 된다. 신규 환경에서 번호순 실행 시 002 가 선점해
--   042 정본이 무력화되는 재발 구조 → 002·004 의 해당 블록은 이번 커밋에서
--   "-- superseded by 042 (see 120)" 무력화 주석 처리했다(이동·분할 아님).
--
-- 이 파일의 조치: 어떤 형태로 고착된 DB 든 042 가 기대하는 컬럼·유니크가
--   존재하도록 **순수 추가형으로 수렴**시킨다. 컬럼 삭제·데이터 변경·정책 변경
--   없음(멱등·비파괴). 기존 042 형태 DB 에서는 전 구문 no-op.
--
-- ⚠️ 현행 실계약 주의 (수렴 후에도 042 를 재실행하지 말 것):
--   앱(lib/reviews/reviewQueries.ts)은 리뷰 작성 시 author_id 를 쓰고,
--   045 가 insert 정책 reviews_insert_student 를 author_id + 자격검증 기준으로
--   재정의했다(042 이후의 현행 정본). 042 를 재실행하면 이 정책이 student_id
--   기준으로 되돌아가 앱 리뷰 작성이 즉시 깨진다. 042 재실행 금지.
--
-- 사전 조건: public.reviews 존재(002/004/042 중 무엇으로 생성됐든 무관).
-- 검증 쿼리: 파일 하단 §V (§V-0 은 실행 '전' 확인).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. 042 형태 수렴 — 누락 가능 컬럼 추가 (있으면 no-op)
--    (제약은 정본과 달리 완화 상태로 추가한다: 기존 행이 있는 DB 에서
--     not null 승격은 데이터 확인 후 별도 결정)
-- -----------------------------------------------------------------------------
alter table public.reviews add column if not exists student_id uuid;
alter table public.reviews add column if not exists content text;
alter table public.reviews add column if not exists subscription_count integer;
alter table public.reviews add column if not exists mentor_reply text;
alter table public.reviews add column if not exists mentor_replied_at timestamptz;
alter table public.reviews add column if not exists is_hidden boolean default false;

-- -----------------------------------------------------------------------------
-- B. 1멘토-1학생 1리뷰 유니크 보장
--    042 경로로 만들어진 DB 는 동명 constraint(백킹 인덱스 reviews_one_per_pair)가
--    이미 있어 no-op. draft 경로 DB 는 student_id 가 방금 추가돼 전부 null 이므로
--    (nulls distinct) 기존 행과 충돌 없이 생성된다. §V-0 중복 사전점검 참조.
-- -----------------------------------------------------------------------------
create unique index if not exists reviews_one_per_pair
  on public.reviews (mentor_id, student_id);

-- =============================================================================
-- §V. 검증 (Supabase SQL Editor 수동 실행)
-- =============================================================================
-- §V-0. 실행 '전' — 유니크 생성이 막힐 중복 pair 없는지 (0행 기대.
--        student_id 컬럼이 아직 없는 DB 면 이 쿼리는 에러 → 중복 불가이므로 통과 간주):
--   select mentor_id, student_id, count(*)
--     from public.reviews
--    where student_id is not null
--    group by 1, 2
--   having count(*) > 1;
--
-- §V-1. 실행 '후' — 042 기대 컬럼 6종 존재 (6행 기대):
--   select column_name
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'reviews'
--      and column_name in ('student_id','content','subscription_count',
--                          'mentor_reply','mentor_replied_at','is_hidden')
--    order by 1;
--
-- §V-2. 유니크 존재 (1행 기대 — constraint 경로든 index 경로든 pg_indexes 에 잡힘):
--   select indexname from pg_indexes
--    where schemaname = 'public' and tablename = 'reviews'
--      and indexname = 'reviews_one_per_pair';
--
-- §V-3. (관찰·후속 판단용) reviews 에 걸린 정책 전수 — 004 잔존 draft 정책
--        (rev_select/rev_ins/rev_update_own)이 보이면 후속 정리 대상이다.
--        특히 rev_select 는 using(true) 라 042·033 의 is_hidden 숨김을 OR 로
--        무력화하고, rev_ins 는 045 의 자격검증 정책을 우회한다(본 파일은
--        비파괴 원칙상 drop 하지 않음 — 별도 건으로 결정할 것):
--   select policyname, cmd, qual, with_check
--     from pg_policies
--    where schemaname = 'public' and tablename = 'reviews'
--    order by policyname;
-- =============================================================================
