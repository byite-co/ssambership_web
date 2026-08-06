-- [backfill 2026-08-06] staging 직접 적용분 역반영(원장 20260806033556).
--
-- C7: 게시판 조회수 RPC(increment_community_post_view)는 멱등키가 없어
-- 같은 진입의 재시도·재빌드마다 무한 가산됐다. 숏폼 v2 규약
-- (shortform_view_record_v2 — (post, event_key) 멱등)을 게시판에 그대로
-- 복제한다. 구 RPC 는 구버전 앱 호환을 위해 유지(정리 별도 과제).
--
-- ★ 한계 문서화(파일 주석 — 함수 본문은 as-applied 와 바이트 동일 유지):
--   event_key 는 클라이언트 생성이라 악의적 조회수 부풀리기(새 키 남발)를
--   막는 구조는 아니다 — 멱등의 목적은 정상 클라이언트의 재시도·재진입
--   중복 가산 제거다(숏폼 v2 와 동일한 수용 리스크).
create table public.community_post_view_events (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  event_key uuid not null,
  viewer_user_id uuid,
  created_at timestamptz not null default now(),
  primary key (post_id, event_key)
);
-- 정의자 함수만 쓴다 — RLS on + 정책 0개(직접 접근 전면 차단).
alter table public.community_post_view_events enable row level security;

create or replace function public.community_post_view_record_v2(
  p_post_id uuid, p_event_key uuid
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_inserted boolean := false;
begin
  if p_post_id is null or p_event_key is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  -- 게시 상태 공개 글만 계수(숏폼 v2 와 동일 규약)
  if not exists (select 1 from public.community_posts cp
                  where cp.id = p_post_id and cp.status = 'published'
                    and cp.deleted_at is null) then
    raise exception 'POST_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.community_post_view_events (post_id, event_key, viewer_user_id)
  values (p_post_id, p_event_key, v_uid)
  on conflict (post_id, event_key) do nothing;
  v_inserted := found;

  if v_inserted then
    update public.community_posts
       set view_count = view_count + 1
     where id = p_post_id;
  end if;

  -- 중복 key 는 idempotent success (계수 증가 없음)
  return jsonb_build_object('ok', true, 'contract_version', 1, 'incremented', v_inserted);
end
$function$;

revoke all on function public.community_post_view_record_v2(uuid, uuid) from public;
grant execute on function public.community_post_view_record_v2(uuid, uuid) to anon, authenticated;
