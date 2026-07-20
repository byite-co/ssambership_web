-- 멘토 리뷰 (학생 작성, 멘토 답글 1회) — 코어 스키마
-- P0-2 교정: 004(reviews base = author_id/body, body nullable, mentor_id/author_id→users) 위 멱등 정합.
--   구 042형(student_id/content NOT NULL · unique(mentor_id,student_id) · idx_reviews_student ·
--   mentor_id→mentor_profiles · student_id 정책)을 폐기하고 정본으로 수렴한다.
--   ⚠️ 모더레이션 컬럼(is_blinded/moderation_state/moderated_at/moderated_by)과 그 FK
--      (moderated_by→auth.users)는 033_p1_admin_reviews_moderation.sql 정본이므로 여기서 추가하지 않는다
--      (042가 먼저 add하면 033의 add-column-if-not-exists가 no-op 되어 FK가 유실됨).
--   ⚠️ 정책(SELECT/INSERT/UPDATE)은 033_*/045_*/126_reviews_rls_hardening.sql 정본 —
--      여기서 재정의하지 않음(is_blinded 미검사 reviews_select_public 생성 금지).
-- 선행: 004(reviews base). 후행 의존: 033_p1(모더레이션 컬럼·FK)·045(자격 INSERT)·126(정책 하드닝).

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.users (id) on delete cascade,
  author_id uuid not null references public.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text not null,
  subscription_count integer,
  mentor_reply text,
  mentor_replied_at timestamptz,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);

-- 004형 base(author_id/body 최소형) 위 멱등 코어 컬럼 정합 (모더레이션 컬럼 제외 — 033 소유)
alter table public.reviews add column if not exists author_id uuid;
alter table public.reviews add column if not exists body text;
alter table public.reviews add column if not exists subscription_count integer;
alter table public.reviews add column if not exists mentor_reply text;
alter table public.reviews add column if not exists mentor_replied_at timestamptz;
alter table public.reviews add column if not exists is_hidden boolean not null default false;

-- body 정본 NOT NULL (004 base는 nullable; 클린설치는 데이터 없음 → 안전, NULL 있으면 스킵)
do $$
begin
  if not exists (select 1 from public.reviews where body is null) then
    alter table public.reviews alter column body set not null;
  end if;
end $$;

-- 정본 FK 수렴 (구 042형은 mentor_id→mentor_profiles 였음 → users 로 강제).
--   mentor_id/author_id 컬럼의 기존 FK를 이름 불문 전부 제거 후 정본으로 재생성.
--   (moderated_by FK 는 033 소유이므로 여기서 건드리지 않음.)
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.reviews'::regclass and con.contype = 'f'
      and con.conkey && (
        select coalesce(array_agg(attnum), '{}')
        from pg_attribute
        where attrelid = 'public.reviews'::regclass
          and attname in ('mentor_id','author_id'))
  loop
    execute format('alter table public.reviews drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.reviews
  add constraint reviews_mentor_id_fkey foreign key (mentor_id) references public.users (id) on delete cascade,
  add constraint reviews_author_id_fkey foreign key (author_id) references public.users (id) on delete cascade;

create index if not exists idx_reviews_mentor_created on public.reviews (mentor_id, created_at desc);
create index if not exists idx_reviews_author on public.reviews (author_id);
create unique index if not exists uq_reviews_mentor_author on public.reviews (mentor_id, author_id);

alter table public.reviews enable row level security;
-- 정책 미정의(정본: 033_*/045_*/126_reviews_rls_hardening.sql).

comment on table public.reviews is '멘토 리뷰: 자격 검증(유료 2회+ 구독) 후 학생 작성, 본문 수정 불가, 멘토 답글 1회, 관리자 모더레이션(033/126)';
