-- db3_batch_post_fixture.sql — DB-3(196/197/198) 적용 후 실구동 assertion (오프라인 스크래치 PG 전용).
-- 전체가 단일 트랜잭션이며 마지막 ROLLBACK 으로 검증 쓰기를 전부 지운다(적용 상태는 그대로 남는다).
-- JWT 에뮬레이션: platform_stub 의 auth.uid() 는 request.jwt.claim.sub 를 읽는다. RLS·SECURITY INVOKER 가드는
--   `set local role anon|authenticated|service_role` 로 실제 클라이언트 역할을 재현한다(postgres 는 RLS 우회).
-- Realtime 인가 에뮬레이션: Realtime 서버가 join 검사 트랜잭션에서 넣는 realtime.topic 을 set_config 로 넣고 SELECT/INSERT 를 시도한다.
-- 규칙: 상태를 바꾸는 호출과 그 결과를 읽는 스칼라 서브쿼리를 한 문장에 섞지 않는다(변경은 한 문장, 확인은 다음 문장).
begin;
set local search_path to public;

create or replace function pg_temp.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice 'POST ok   %', p_label;
  else raise exception 'POST FAIL %', p_label; end if;
end $$;
create or replace function pg_temp.as_user(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
end $$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql; return 'OK';
exception when others then return left(sqlerrm, 90);
end $$;
create or replace function pg_temp.try_rows(p_sql text) returns text language plpgsql as $$
declare n int;
begin
  execute p_sql; get diagnostics n = row_count; return 'ROWS=' || n;
exception when others then return left(sqlerrm, 90);
end $$;
create or replace function pg_temp.snap(p_key text) returns text language sql as $$ select val from db3_check.snapshot where key = p_key $$;

-- 고정 ID
\set admin '''9bf48819-1dd2-40dd-96a3-d64bcca2e60c'''
\set m1 '''00000000-0000-4000-8000-00000000d3a1'''
\set s1 '''00000000-0000-4000-8000-00000000d3b1'''
\set s2 '''00000000-0000-4000-8000-00000000d3b2'''
\set s3 '''00000000-0000-4000-8000-00000000d3b3'''
\set p1 '''00000000-0000-4000-8000-00000000d3c1'''
\set p2 '''00000000-0000-4000-8000-00000000d3c2'''
\set c1 '''00000000-0000-4000-8000-00000000d3e1'''
\set l2 '''00000000-0000-4000-8000-00000000d3e2'''
\set c3 '''00000000-0000-4000-8000-00000000d3e3'''
\set sc1 '''00000000-0000-4000-8000-00000000d3e4'''
\set sc2 '''00000000-0000-4000-8000-00000000d3e5'''
\set sc3 '''00000000-0000-4000-8000-00000000d3e6'''
\set c4 '''00000000-0000-4000-8000-00000000d3e7'''
\set sf1 '''00000000-0000-4000-8000-00000000d3f1'''
\set sf2 '''00000000-0000-4000-8000-00000000d3f2'''
\set sf3 '''00000000-0000-4000-8000-00000000d3f3'''
\set sf4 '''00000000-0000-4000-8000-00000000d3f4'''
\set nope '''00000000-0000-4000-8000-0000000000ff'''
\set t1 '''00000000-0000-4000-8000-00000000d3b9'''
\set sf9 '''00000000-0000-4000-8000-00000000d3f9'''
\set sc9 '''00000000-0000-4000-8000-00000000d3e9'''

-- 재실행 대비(forward 기간 데이터 되돌림 · 트랜잭션 안에서만)
update public.comments set deleted_at = null, deleted_by = null where id = :c1::uuid;

-- ═══ A-0. 적용 상태 ═══
select pg_temp.ok((select prosecdef and prorettype = 'void'::regtype from pg_proc where proname = 'soft_delete_own_content'), 'A-0 soft_delete_own_content: SECURITY DEFINER · void');
select pg_temp.ok(not has_function_privilege('anon', 'public.soft_delete_own_content(text, uuid)', 'EXECUTE')
                  and has_function_privilege('authenticated', 'public.soft_delete_own_content(text, uuid)', 'EXECUTE'), 'A-0 ACL: anon 금지 · authenticated 허용');
select pg_temp.ok((select count(*) from public.admin_action_logs)::text = pg_temp.snap('log_count'), 'A-0 적용 자체는 감사 로그를 남기지 않는다');

-- ═══ A-1. 게시판 댓글 — 현재 버그 해소 ═══
set local role anon;
select pg_temp.as_user(null, null);
select pg_temp.ok(r like 'permission denied for function soft_delete_own_content%', 'A-1 anon 은 호출 자체 거부: ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('board_comment', %L) $q$, :c1::uuid)) r) t;
reset role;
set local role authenticated;
select pg_temp.as_user(null, 'authenticated');
select pg_temp.ok(r like 'AUTH_REQUIRED%', 'A-1 JWT 없는 authenticated 는 AUTH_REQUIRED: ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('board_comment', %L) $q$, :c1::uuid)) r) t;
select pg_temp.as_user(:s1::uuid, 'authenticated');
-- 웹 D-CM-6 경로(직접 UPDATE … RETURNING)는 여전히 RLS 가 거부한다(pre fixture 와 동일) — 그래서 RPC 가 필요하다
select pg_temp.ok(r like 'new row violates row-level security policy%', 'A-1 직접 UPDATE is_deleted=true … RETURNING 은 여전히 RLS 거부(버그 원인 재현): ' || r)
  from (select pg_temp.try_rows(format($q$ update public.comments set is_deleted = true, content = '삭제된 댓글입니다.' where id = %L and author_id = %L returning id $q$, :c1::uuid, :s1::uuid)) r) t;
select pg_temp.ok(r like 'INVALID_KIND%', 'A-1 p_kind 밖은 INVALID_KIND: ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('comment', %L) $q$, :c1::uuid)) r) t;
select pg_temp.ok(r like 'CONTENT_NOT_FOUND%', 'A-1 없는 id 는 CONTENT_NOT_FOUND: ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('board_comment', %L) $q$, :nope::uuid)) r) t;
select pg_temp.ok(r like 'CONTENT_NOT_OWNED%', 'A-1 타인 댓글(C3)은 CONTENT_NOT_OWNED: ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('board_comment', %L) $q$, :c3::uuid)) r) t;
select pg_temp.ok(r = 'OK', 'A-1 ★ 작성자 S1 의 게시판 댓글 C1 삭제 성공(처음 동작): ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('board_comment', %L) $q$, :c1::uuid)) r) t;
select pg_temp.ok(r = 'OK', 'A-1 재호출 멱등(예외 없음): ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('board_comment', %L) $q$, :c1::uuid)) r) t;
select pg_temp.ok((select count(*) from public.comments where id = :c1::uuid) = 0, 'A-1 작성자 본인도 삭제 댓글 안 보임(RLS)');
select pg_temp.as_user(:s2::uuid, 'authenticated');
select pg_temp.ok(r like 'CONTENT_NOT_OWNED%', 'A-1 삭제된 타인 댓글도 CONTENT_NOT_OWNED(소유 판정이 멱등보다 앞): ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('board_comment', %L) $q$, :c1::uuid)) r) t;
select pg_temp.ok((select count(*) from public.comments where id = :c1::uuid) = 0, 'A-1 타인에게 안 보임');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((select deleted_at is not null and deleted_by = :s1::uuid and is_deleted and content = '정본 댓글 1' from public.comments where id = :c1::uuid),
                  'A-1 결과: deleted_at · deleted_by = 작성자 · is_deleted true(동기화 트리거) · 본문 보존');
select pg_temp.ok((select comment_count from public.community_posts where id = :p1::uuid) = 3, 'A-1 댓글 수 4 → 3(삭제 제외 재계산)');
select pg_temp.ok((select deleted_at is not null and deleted_by = :s1::uuid and status = 'visible' from public.community_comments where canonical_comment_id = :c1::uuid),
                  'A-1 레거시 미러(L1): deleted_at/deleted_by 전달 · status 불변');
select pg_temp.ok((select count(*) from public.admin_action_logs)::text = pg_temp.snap('log_count'), 'A-1 사용자 행위 — 감사 로그 0(관리자 삭제와 구분)');
set local role anon;
select pg_temp.ok((select count(*) from public.comments where post_id = :p1::uuid) = 3 and (select count(*) from api_web_v1.community_comments_v1 where post_id = :p1::uuid) = 3, 'A-1 anon: 정본·뷰 모두 삭제 댓글 제외');
reset role;
set local role authenticated;
select pg_temp.as_user(:admin::uuid, 'authenticated');
select pg_temp.ok((select deleted_by = author_id from public.comments where id = :c1::uuid), 'A-1 admin 에게 보임 · deleted_by = author_id → 관리자 화면 `작성자 삭제` 판정(PR-W3)');
reset role;
select pg_temp.as_user(null, null);

-- ═══ A-2. 계정 게이트 · moderation ═══
set local role authenticated;
select pg_temp.as_user(:s3::uuid, 'authenticated');
select pg_temp.ok(r like 'ACCOUNT_BANNED%', 'A-2 banned 계정은 본인 댓글(C4)도 ACCOUNT_BANNED: ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('board_comment', %L) $q$, :c4::uuid)) r) t;
reset role;
select pg_temp.as_user(null, null);
update public.comments set is_deleted = true where id = :c3::uuid;   -- 관리자 숨김(서비스 경로 · deleted_at NULL)
set local role authenticated;
select pg_temp.as_user(:s2::uuid, 'authenticated');
select pg_temp.ok(r like 'CONTENT_MODERATED%', 'A-2 관리자 숨김 게시판 댓글(C3)은 CONTENT_MODERATED: ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('board_comment', %L) $q$, :c3::uuid)) r) t;
reset role;
select pg_temp.as_user(null, null);
update public.comments set is_deleted = false where id = :c3::uuid;  -- 숨김 해제
select pg_temp.ok((select deleted_at is null and is_deleted = false from public.comments where id = :c3::uuid), 'A-2 거부된 시도는 흔적을 남기지 않는다');

-- ═══ A-3. 숏폼 댓글 ═══
set local role authenticated;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.ok(r like 'CONTENT_KIND_MISMATCH%', 'A-3 레거시 게시판 행(L2 · post_type board)을 shortform_comment 로 지우면 CONTENT_KIND_MISMATCH(소유 판정보다 앞): ' || r)
  from (select pg_temp.try(format($q$ select public.soft_delete_own_content('shortform_comment', %L) $q$, :l2::uuid)) r) t;
select pg_temp.ok(r like 'CONTENT_NOT_OWNED%', 'A-3 타인 숏폼 댓글(SC3)은 CONTENT_NOT_OWNED: ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('shortform_comment', %L) $q$, :sc3::uuid)) r) t;
select pg_temp.ok(r = 'OK', 'A-3 작성자 S1 숏폼 댓글 SC1 삭제: ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('shortform_comment', %L) $q$, :sc1::uuid)) r) t;
select pg_temp.as_user(:s2::uuid, 'authenticated');
select pg_temp.ok(r like 'CONTENT_MODERATED%', 'A-3 관리자 숨김 숏폼 댓글(SC2)은 CONTENT_MODERATED(community_comment_soft_delete_self 와 동일 규칙): ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('shortform_comment', %L) $q$, :sc2::uuid)) r) t;
-- 기존 앱 계약 RPC 는 그대로 동작한다
select pg_temp.ok((public.community_comment_soft_delete_self(:sc3::uuid) ->> 'idempotent_hit') = 'false', 'A-3 기존 community_comment_soft_delete_self 불변(앱 계약 · SC3 본인 삭제)');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((select deleted_at is not null and deleted_by = :s1::uuid and status = 'visible' from public.community_comments where id = :sc1::uuid), 'A-3 SC1: deleted_at/deleted_by = 작성자 · status 불변');
set local role anon;
select pg_temp.ok((select count(*) from public.community_comments where post_type = 'shortform' and post_id = :sf1::uuid) = 0, 'A-3 anon: SF1 댓글 전부 안 보임(삭제 2 · 숨김 1)');
reset role;

-- ═══ A-4. 숏폼 ═══
set local role authenticated;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.ok(r like 'CONTENT_NOT_OWNED%', 'A-4 학생 S1 은 숏폼 SF1 CONTENT_NOT_OWNED: ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('shortform', %L) $q$, :sf1::uuid)) r) t;
select pg_temp.as_user(:m1::uuid, 'authenticated');
select pg_temp.ok(r like 'new row violates row-level security policy%', 'A-4 작성자 직접 UPDATE soft delete 는 여전히 RLS 거부(194 · RPC 만 통과): ' || r)
  from (select pg_temp.try(format($q$ update public.shortform_posts set deleted_at = now(), deleted_by = %L where id = %L $q$, :m1::uuid, :sf1::uuid)) r) t;
select pg_temp.ok(r = 'OK', 'A-4 작성자 M1 숏폼 SF1 삭제: ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('shortform', %L) $q$, :sf1::uuid)) r) t;
select pg_temp.ok(r like 'CONTENT_MODERATED%', 'A-4 관리자 숨김 숏폼(SF2)은 CONTENT_MODERATED: ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('shortform', %L) $q$, :sf2::uuid)) r) t;
select pg_temp.as_user(:s2::uuid, 'authenticated');
select pg_temp.ok(r = 'OK', 'A-4 creator_id(S2) 도 본인(sf_update_own 과 같은 정의) — SF3 삭제: ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('shortform', %L) $q$, :sf3::uuid)) r) t;
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((select deleted_at is not null and deleted_by = :m1::uuid and status = 'published' from public.shortform_posts where id = :sf1::uuid)
                  and (select deleted_by = :s2::uuid from public.shortform_posts where id = :sf3::uuid), 'A-4 SF1 deleted_by = M1 · SF3 deleted_by = S2(creator)');
set local role anon;
select pg_temp.ok((select count(*) from public.shortform_posts where id in (:sf1::uuid, :sf3::uuid)) = 0 and (select count(*) from public.shortform_posts where id = :sf4::uuid) = 1, 'A-4 anon: 삭제 숏폼 안 보임 · 살아 있는 SF4 보임');
reset role;
set local role authenticated;
select pg_temp.as_user(:admin::uuid, 'authenticated');
select pg_temp.ok((select count(*) from public.shortform_posts where id in (:sf1::uuid, :sf3::uuid) and deleted_by = author_id) = 1
                  and (select count(*) from public.shortform_posts where id = :sf3::uuid and deleted_by <> author_id and deleted_by = creator_id) = 1,
                  'A-4 admin: SF1 은 작성자 삭제(deleted_by = author_id) · SF3 은 creator 삭제 — 관리자 화면 판정 근거');
reset role;
select pg_temp.as_user(null, null);

-- ═══ A-5. 게시판 글 ═══
set local role authenticated;
select pg_temp.as_user(:s2::uuid, 'authenticated');
select pg_temp.ok(r like 'CONTENT_NOT_OWNED%', 'A-5 타인 글(P1)은 CONTENT_NOT_OWNED: ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('board_post', %L) $q$, :p1::uuid)) r) t;
select pg_temp.ok(r like 'CONTENT_MODERATED%', 'A-5 관리자 숨김 본인 글(P2)은 CONTENT_MODERATED(F6 보다 엄격 — 웹 글 삭제는 F6 그대로): ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('board_post', %L) $q$, :p2::uuid)) r) t;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.ok(r = 'OK', 'A-5 작성자 S1 글 P1 삭제: ' || r) from (select pg_temp.try(format($q$ select public.soft_delete_own_content('board_post', %L) $q$, :p1::uuid)) r) t;
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((select deleted_at is not null and deleted_by = :s1::uuid from public.community_posts where id = :p1::uuid), 'A-5 P1 deleted_at/deleted_by = 작성자(194 community_posts.deleted_by)');
update public.community_posts set deleted_at = null, deleted_by = null where id = :p1::uuid;   -- 이후 검증을 위해 복원(서비스 경로)

-- ═══ B. Realtime — admin:* 토픽은 관리자만 ═══
select pg_temp.ok((select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages') = 2
                  and (select bool_and(roles = '{authenticated}'::name[]) from pg_policies where schemaname = 'realtime' and tablename = 'messages'), 'B-0 realtime.messages 정책 2종 · authenticated 만');
insert into realtime.messages (topic, extension, payload, private) values ('admin:mentor-approval', 'presence', '{}'::jsonb, true), ('question_thread_x', 'broadcast', '{}'::jsonb, true);
set local role anon;
select pg_temp.as_user(null, null);
select set_config('realtime.topic', 'admin:mentor-approval', true);
select pg_temp.ok(realtime.topic() = 'admin:mentor-approval', 'B-1 realtime.topic() 에뮬레이션');
select pg_temp.ok((select count(*) from realtime.messages) = 0, 'B-1 anon · admin:* 토픽: 수신(SELECT) 0');
select pg_temp.ok(r like 'new row violates row-level security policy%', 'B-1 anon · admin:* 토픽: 송신(INSERT) 거부: ' || r) from (select pg_temp.try($q$ insert into realtime.messages (topic, extension, payload, private) values ('admin:mentor-approval', 'presence', '{}', true) $q$) r) t;
reset role;
set local role authenticated;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select set_config('realtime.topic', 'admin:mentor-approval', true);
select pg_temp.ok((select count(*) from realtime.messages) = 0, 'B-1 비관리자(authenticated) · admin:* 토픽: 수신 0');
select pg_temp.ok(r like 'new row violates row-level security policy%', 'B-1 비관리자 · admin:* 토픽: presence track(INSERT) 거부: ' || r) from (select pg_temp.try($q$ insert into realtime.messages (topic, extension, payload, private) values ('admin:mentor-approval', 'presence', '{}', true) $q$) r) t;
select pg_temp.as_user(:admin::uuid, 'authenticated');
select pg_temp.ok(public.is_admin(), 'B-1 admin JWT 에서 is_admin() = true');
select pg_temp.ok((select count(*) from realtime.messages where topic = 'admin:mentor-approval') = 1, 'B-1 관리자 · admin:* 토픽: 수신 허용');
select pg_temp.ok(r = 'ROWS=1', 'B-1 관리자 · admin:* 토픽: presence track(INSERT) 허용: ' || r) from (select pg_temp.try_rows($q$ insert into realtime.messages (topic, extension, payload, private) values ('admin:mentor-approval', 'presence', '{}', true) $q$) r) t;
select set_config('realtime.topic', 'question_thread_x', true);
select pg_temp.ok((select count(*) from realtime.messages) = 0, 'B-2 관리자라도 그 외 토픽(question_thread_x)은 정책 없음 → private 채널 수신 0(현 동작 유지)');
select pg_temp.ok(r like 'new row violates row-level security policy%', 'B-2 그 외 토픽 송신 거부(정책 없음): ' || r) from (select pg_temp.try($q$ insert into realtime.messages (topic, extension, payload, private) values ('question_thread_x', 'broadcast', '{}', true) $q$) r) t;
select set_config('realtime.topic', '', true);
select pg_temp.ok(realtime.topic() is null and (select count(*) from realtime.messages) = 0, 'B-2 토픽 없음 → null → 정책 false');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((select count(*) from realtime.messages where topic = 'admin:mentor-approval') = 2, 'B-1 관리자 INSERT 1건 실제 기록(총 2)');

-- ═══ C. 하드 DELETE 차단 — 클라이언트 역할만 · service_role/postgres 통과 · cascade 통과 ═══
select pg_temp.ok((select count(*) from pg_trigger where tgname in ('trg_shortform_posts_no_delete', 'trg_comments_no_delete', 'trg_community_comments_no_delete')) = 3, 'C-0 no_delete 트리거 3종');
set local role authenticated;
select pg_temp.as_user(:s2::uuid, 'authenticated');
select pg_temp.ok(r like 'UGC_HARD_DELETE_FORBIDDEN%', 'C-1 작성자 S2 의 정본 댓글(C3) 하드 DELETE 거부(comments_delete_own 정책이 허용해도 트리거가 막는다): ' || r) from (select pg_temp.try(format($q$ delete from public.comments where id = %L $q$, :c3::uuid)) r) t;
select pg_temp.as_user(:m1::uuid, 'authenticated');
select pg_temp.ok(r like 'UGC_HARD_DELETE_FORBIDDEN%', 'C-1 작성자 M1 의 숏폼(SF4) 하드 DELETE 거부(sf_delete_own 정책이 허용해도): ' || r) from (select pg_temp.try(format($q$ delete from public.shortform_posts where id = %L $q$, :sf4::uuid)) r) t;
select pg_temp.as_user(:admin::uuid, 'authenticated');
select pg_temp.ok(r like 'UGC_HARD_DELETE_FORBIDDEN%', 'C-1 관리자 세션(authenticated)도 정본 댓글 하드 DELETE 거부(194 까지는 comments_write_guard 가 허용): ' || r) from (select pg_temp.try(format($q$ delete from public.comments where id = %L $q$, :c3::uuid)) r) t;
select pg_temp.ok(r like 'UGC_HARD_DELETE_FORBIDDEN%', 'C-1 관리자 세션 레거시/숏폼 댓글(SC3) 하드 DELETE 거부: ' || r) from (select pg_temp.try(format($q$ delete from public.community_comments where id = %L $q$, :sc3::uuid)) r) t;
select pg_temp.ok(r = 'ROWS=0', 'C-1 관리자 세션 숏폼(SF4) 하드 DELETE: 관리자 DELETE 정책이 없어 0행(트리거 이전 · 기존과 동일): ' || r) from (select pg_temp.try_rows(format($q$ delete from public.shortform_posts where id = %L $q$, :sf4::uuid)) r) t;
reset role;
set local role anon;
select pg_temp.as_user(null, null);
select 'POST info anon 정본 댓글 DELETE(정책 없음 — 트리거 전에 0행): ' || pg_temp.try_rows(format($q$ delete from public.comments where id = %L $q$, :c3::uuid));
reset role;
select pg_temp.ok((select count(*) from public.comments where id = :c3::uuid) = 1 and (select count(*) from public.shortform_posts where id = :sf4::uuid) = 1 and (select count(*) from public.community_comments where id = :sc3::uuid) = 1,
                  'C-1 거부된 DELETE 는 행을 남긴다');
-- service_role 통과(관리자 코어 · 배치용)
set local role service_role;
select pg_temp.as_user(null, null);
select pg_temp.ok(r = 'ROWS=1', 'C-2 service_role 정본 댓글(C3) 하드 DELETE 통과: ' || r) from (select pg_temp.try_rows(format($q$ delete from public.comments where id = %L $q$, :c3::uuid)) r) t;
select pg_temp.ok(r = 'ROWS=1', 'C-2 service_role 숏폼(SF4) 하드 DELETE 통과: ' || r) from (select pg_temp.try_rows(format($q$ delete from public.shortform_posts where id = %L $q$, :sf4::uuid)) r) t;
select pg_temp.ok(r = 'ROWS=1', 'C-2 service_role 숏폼 댓글(SC3) 하드 DELETE 통과: ' || r) from (select pg_temp.try_rows(format($q$ delete from public.community_comments where id = %L $q$, :sc3::uuid)) r) t;
reset role;
select pg_temp.ok((select deleted_at is not null from public.community_comments where canonical_comment_id = :c3::uuid), 'C-2 정본 DELETE 미러(comments_mirror_delete_to_legacy · 194) 불변 — 레거시 L3 deleted_at');
-- postgres(SECURITY DEFINER 내부 · pg_cron · 마이그레이션) 통과 + FK cascade 통과
select pg_temp.ok(r = 'ROWS=1', 'C-3 postgres: 글 P1 DELETE → comments cascade(C2·C4 잔존분) 통과: ' || r) from (select pg_temp.try_rows(format($q$ delete from public.community_posts where id = %L $q$, :p1::uuid)) r) t;
select pg_temp.ok((select count(*) from public.comments where post_id = :p1::uuid) = 0, 'C-3 cascade 로 P1 댓글 0');
-- auth.users 삭제(GoTrue 하드 삭제 경로 — supabase_auth_admin · 로컬은 postgres) → public.users(cascade) → shortform_posts.author_id(cascade) ·
-- community_comments.author_id(→ auth.users cascade). 대상은 일회용 계정 T1(숏폼 1 · 숏폼 댓글 1 — 게시판 댓글 브리지 행 없음: 레거시 행이 정본보다
-- 늦게 cascade 되면 cc_sync_board_delete_to_canonical 이 COMMENT_BRIDGE_TARGET_MISSING 을 내는 기존(163·194) 성질이라 이 검증 대상이 아니다).
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', :t1::uuid, 'authenticated', 'authenticated', 'db3-t1@test.local', '{"app_role":"mentor","full_name":"검증일회용"}'::jsonb, now(), now());
insert into public.shortform_posts (id, author_id, title, body, category, video_url, status, author_role)
values (:sf9::uuid, :t1::uuid, '검증 숏폼 9(일회용)', '숏폼 9', 'study', 'https://example.test/v9.mp4', 'published', 'mentor');
insert into public.community_comments (id, post_type, post_id, author_id, body) values (:sc9::uuid, 'shortform', :sf1::uuid, :t1::uuid, '숏폼 댓글 9(일회용)');
select pg_temp.ok(r = 'ROWS=1', 'C-3 postgres: auth.users T1 DELETE → public.users → shortform_posts · community_comments cascade 통과(no_delete 트리거는 클라이언트 역할만 본다): ' || r)
  from (select pg_temp.try_rows(format($q$ delete from auth.users where id = %L $q$, :t1::uuid)) r) t;
select pg_temp.ok(not exists (select 1 from public.shortform_posts where id = :sf9::uuid) and not exists (select 1 from public.community_comments where id = :sc9::uuid)
                  and not exists (select 1 from public.users where id = :t1::uuid), 'C-3 cascade 로 T1 숏폼 0 · 숏폼 댓글 0 · public.users 행 0');

-- ═══ D. 194 객체 불변 ═══
select pg_temp.ok(md5(pg_get_functiondef('public.comments_write_guard()'::regprocedure)) = pg_temp.snap('fn_cwg')
                  and md5(pg_get_functiondef('public.shortform_posts_protected_guard()'::regprocedure)) = pg_temp.snap('fn_spg')
                  and md5(pg_get_functiondef('public.community_comment_soft_delete_self(uuid)'::regprocedure)) = pg_temp.snap('fn_self_del')
                  and md5(pg_get_functiondef('public.comments_sync_deleted_flag()'::regprocedure)) = pg_temp.snap('fn_sync_flag'),
                  'D 194 가드 2종 · 본인 삭제 RPC · 동기화 트리거 함수 md5 불변');
select pg_temp.ok((select roles::text || '|' || qual from pg_policies where tablename = 'comments' and policyname = 'comments_select_visible') = pg_temp.snap('pol_c'), 'D comments_select_visible 불변');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') = pg_temp.snap('fn_count')::int + 2, 'D public 함수 +2(soft_delete_own_content · ugc_block_hard_delete)');

\echo DB3 POST FIXTURE PASS
rollback;
