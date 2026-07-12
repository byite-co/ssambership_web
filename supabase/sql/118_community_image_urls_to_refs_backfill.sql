-- =============================================================================
-- 118: 커뮤니티 게시글 이미지 — 레거시 서명 URL → bucket/path ref 백필 (BUG-B)
-- =============================================================================
-- 배경: community_posts.image_urls[] 에 7일 서명 URL 이 그대로 저장돼 게시 7일 뒤
--   목록 썸네일·본문 이미지가 영구히 깨졌다. 코드 수정으로 신규 저장은 ref
--   (`community-post-images/<path>`)로 바뀌고, 조회는 표시 시점 1h 서명한다.
--   이 백필은 기존에 쌓인 서명 URL 을 ref 로 전환해 과거 게시물도 영구 복구한다.
--
-- 성격: 선택적·멱등. 코드가 조회 시 http URL 도 하위호환 처리하므로 미실행이어도
--   당장 깨지진 않으나(단, 그 http 는 7일 뒤 만료), 실행하면 과거분이 영구 복구된다.
-- 안전: http(s) 이고 `/object/sign/community-post-images/` 패턴을 포함하는 원소만
--   `community-post-images/<path>` 로 치환한다. 이미 ref 인 원소·비매칭 원소는 불변.
-- 재실행 안전: 이미 ref 로 바뀐 원소는 패턴 불일치라 그대로 둔다.
--
-- 검증(적용 전/후):
--   -- 전: 서명 URL 원소를 가진 게시물 수
--   select count(*) from public.community_posts
--    where exists (select 1 from unnest(image_urls) u where u like 'http%/object/sign/community-post-images/%');
--   -- 후: 위 카운트 0 기대. ref 원소 수 확인:
--   select count(*) from public.community_posts
--    where exists (select 1 from unnest(image_urls) u where u like 'community-post-images/%');
-- =============================================================================

update public.community_posts p
set image_urls = sub.new_urls,
    updated_at = now()
from (
  select
    c.id,
    array_agg(
      case
        when elem like 'http%/object/sign/community-post-images/%'
          then 'community-post-images/' ||
               split_part(
                 split_part(elem, '/object/sign/community-post-images/', 2),
                 '?', 1
               )
        else elem
      end
      order by ord
    ) as new_urls
  from public.community_posts c,
       lateral unnest(c.image_urls) with ordinality as t(elem, ord)
  where c.image_urls is not null
    and array_length(c.image_urls, 1) is not null
    and exists (
      select 1 from unnest(c.image_urls) u
      where u like 'http%/object/sign/community-post-images/%'
    )
  group by c.id
) as sub
where p.id = sub.id;

-- =============================================================================
-- 참고: 위 UPDATE 는 "서명 URL 원소를 하나라도 가진" 게시물만 대상으로 하며,
--   그 게시물의 image_urls 를 원소 순서 보존해 재구성한다(서명 URL→ref, 그 외 유지).
-- =============================================================================
