-- =============================================================================
-- 116_user_blocks.sql
-- ⚠️ 라이브 미적용 — 플래그(NEXT_PUBLIC_FEATURE_USER_BLOCKS) ON 배포 시 적용 (114 패턴)
-- =============================================================================
-- 목적(스펙 docs/plans/user-blocks-spec.md): 사용자간 차단 — Google Play UGC 정책
-- (신고+차단 병존) 대응. 공유 DB이므로 앱·웹이 같은 목록을 사용한다.
-- 차단 = 노출 필터(차단한 사람의 뷰에만 적용). 상대 기능 제한 아님.
-- 신규 객체만 추가 — 기존 RLS/테이블 무수정. v1 적용 범위 = 커뮤니티 UGC.
-- 선행(적용 시): 001(users). ※ 115는 계정삭제 PR(feat/account-deletion)이 선점한 번호.
-- =============================================================================

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.users (id) on delete cascade,
  blocked_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists idx_user_blocks_blocker on public.user_blocks (blocker_id);

comment on table public.user_blocks is
  '116: 사용자 차단(노출 필터). blocker의 뷰에서 blocked의 커뮤니티 UGC를 숨긴다. 불변 쌍(UPDATE 정책 없음).';

alter table public.user_blocks enable row level security;

-- 본인 것만 조회·생성·해제 (self-block은 CHECK가 차단)
drop policy if exists ub_select_own on public.user_blocks;
create policy ub_select_own
  on public.user_blocks for select
  to authenticated
  using (blocker_id = (select auth.uid()));

drop policy if exists ub_insert_own on public.user_blocks;
create policy ub_insert_own
  on public.user_blocks for insert
  to authenticated
  with check (blocker_id = (select auth.uid()));

drop policy if exists ub_delete_own on public.user_blocks;
create policy ub_delete_own
  on public.user_blocks for delete
  to authenticated
  using (blocker_id = (select auth.uid()));

-- UPDATE 정책 없음 = 불변 쌍(차단은 생성/해제만).

-- 관리자 운영 조회
drop policy if exists ub_select_admin on public.user_blocks;
create policy ub_select_admin
  on public.user_blocks for select
  to authenticated
  using (public.is_admin());
