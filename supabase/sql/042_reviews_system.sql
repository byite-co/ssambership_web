-- 멘토 리뷰 (학생 작성, 멘토 답글 1회, 관리자 모더레이션)
-- P0-2 교정: 004(reviews base = author_id/body) 위 멱등 정합.
--   구 042형(student_id/content NOT NULL · unique(mentor_id,student_id) · idx_reviews_student ·
--   student_id 기반 정책)을 폐기한다. 정책은 033_* / 045_* / 126_reviews_rls_hardening.sql 정본이므로
--   여기서 재정의하지 않는다(특히 is_blinded 미검사 reviews_select_public 생성 금지).
--   실차감액/자격은 서버(RPC·check_review_eligibility)에서 검증.

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.users (id) on delete cascade,
  author_id uuid not null references public.users (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  body text not null,
  subscription_count integer,
  mentor_reply text,
  mentor_replied_at timestamptz,
  is_hidden boolean not null default false,
  is_blinded boolean not null default false,
  moderation_state text not null default 'visible',
  moderated_at timestamptz,
  moderated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- 004형 base 위 멱등 정합 (기존 설치가 author_id/body 최소형이면 부가 컬럼 보강)
alter table public.reviews add column if not exists author_id uuid;
alter table public.reviews add column if not exists body text;
alter table public.reviews add column if not exists subscription_count integer;
alter table public.reviews add column if not exists mentor_reply text;
alter table public.reviews add column if not exists mentor_replied_at timestamptz;
alter table public.reviews add column if not exists is_blinded boolean not null default false;
alter table public.reviews add column if not exists moderation_state text not null default 'visible';
alter table public.reviews add column if not exists moderated_at timestamptz;
alter table public.reviews add column if not exists moderated_by uuid;

create index if not exists idx_reviews_mentor_created on public.reviews (mentor_id, created_at desc);
create index if not exists idx_reviews_author on public.reviews (author_id);
create unique index if not exists uq_reviews_mentor_author on public.reviews (mentor_id, author_id);

alter table public.reviews enable row level security;
-- 정책 미정의(정본: 033_* / 045_* / 126_reviews_rls_hardening.sql).

comment on table public.reviews is '멘토 리뷰: 자격 검증(유료 2회+ 구독) 후 학생 작성, 본문 수정 불가, 멘토 답글 1회, 관리자 모더레이션';
