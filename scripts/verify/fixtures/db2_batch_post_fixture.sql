-- db2_batch_post_fixture.sql — DB-2(193/194/195) 적용 후 실구동 assertion (오프라인 스크래치 PG 전용).
-- 전체가 단일 트랜잭션이며 마지막 ROLLBACK 으로 검증 쓰기를 전부 지운다(적용 상태는 그대로 남는다).
-- JWT 에뮬레이션: platform_stub 의 auth.uid() 는 request.jwt.claim.sub 를 읽는다. RLS·SECURITY INVOKER 가드는
--   `set local role anon|authenticated` 로 실제 클라이언트 역할을 재현한다(postgres 는 RLS 우회).
-- 규칙: 상태를 바꾸는 호출(RPC · UPDATE)과 그 결과를 읽는 스칼라 서브쿼리를 한 문장에 섞지 않는다 — 서브쿼리(InitPlan) 평가
--   순서에 기대면 변경 전 상태를 읽을 수 있다(실측). 변경은 한 문장, 확인은 다음 문장.
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
-- 예외 코드/메시지 캡처: 실행이 성공하면 'OK', 실패하면 SQLERRM 앞부분
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql; return 'OK';
exception when others then return left(sqlerrm, 80);
end $$;
-- 성공 시 영향 행 수를 돌려준다('ROWS=n') — RLS 로 0행이 되는 경우를 구분
create or replace function pg_temp.try_rows(p_sql text) returns text language plpgsql as $$
declare n int;
begin
  execute p_sql; get diagnostics n = row_count; return 'ROWS=' || n;
exception when others then return left(sqlerrm, 80);
end $$;

-- 고정 ID
\set admin '''9bf48819-1dd2-40dd-96a3-d64bcca2e60c'''
\set m1 '''00000000-0000-4000-8000-00000000d2a1'''
\set m2 '''00000000-0000-4000-8000-00000000d2a2'''
\set m3 '''00000000-0000-4000-8000-00000000d2a3'''
\set m4 '''00000000-0000-4000-8000-00000000d2a4'''
\set m5 '''00000000-0000-4000-8000-00000000d2a5'''
\set m6 '''00000000-0000-4000-8000-00000000d2a6'''
\set m7 '''00000000-0000-4000-8000-00000000d2a7'''
\set m8 '''00000000-0000-4000-8000-00000000d2a8'''
\set m9 '''00000000-0000-4000-8000-00000000d2a9'''
\set s1 '''00000000-0000-4000-8000-00000000d2b1'''
\set s2 '''00000000-0000-4000-8000-00000000d2b2'''
\set p1 '''00000000-0000-4000-8000-00000000d2c1'''
\set sf1 '''00000000-0000-4000-8000-00000000d2f1'''
\set sf2 '''00000000-0000-4000-8000-00000000d2f2'''
\set c1 '''00000000-0000-4000-8000-00000000d2e1'''
\set l2 '''00000000-0000-4000-8000-00000000d2e2'''
\set sc1 '''00000000-0000-4000-8000-00000000d2e3'''
\set sc2 '''00000000-0000-4000-8000-00000000d2e4'''

-- 재실행 대비(rollback 의 숨김 전환 · forward 기간 데이터 되돌림) — 이 트랜잭션 안에서만 유효
update public.shortform_posts set status = 'published', deleted_at = null, deleted_by = null where id = :sf2::uuid;

-- ═══ A-1. 폴백 ═══
select pg_temp.ok(public.school_tier_suggest('가천대학교') = '그외' and public.school_tier_suggest('계명대학교') = '그외'
                  and public.school_tier_suggest('') = '미분류' and public.school_tier_suggest('   ') = '미분류' and public.school_tier_suggest(null) = '미분류'
                  and public.school_tier_suggest('서울대학교') = '서연고' and public.school_tier_suggest('성균관대학교') = '서성한'
                  and public.school_tier_suggest('연세대학교 미래캠퍼스') = '서연고', 'A-1 폴백: 이름 있음 → 그외 · NULL/공백 → 미분류 · LIKE 13종 불변');

-- ═══ A-3. 미분류 일괄 정정 ═══
select pg_temp.ok((select count(*) from public.mentor_school_verifications where status = 'approved' and school_tier = '미분류') = 1
                  and (select verified_university_name is null from public.mentor_school_verifications where mentor_id = :m4::uuid),
                  'A-3 미분류 approved 는 대학명 없는 M4 1건만 잔존');
select pg_temp.ok((select count(*) from public.mentor_school_verifications where status = 'approved' and school_tier = '그외') = 3
                  and (select bool_and(school_tier = '그외' and reviewed_by = :admin::uuid and verified_major_category = '메디컬')
                         from public.mentor_school_verifications where mentor_id in (:m1::uuid, :m2::uuid, :m3::uuid)),
                  'A-3 M1·M2·M3 → 그외 · reviewed_by 오너 admin · 계열 불변');
select pg_temp.ok((select (detail ->> 'count')::int = 3 and detail ->> 'note' = '폴백 규칙 변경(미분류→그외)에 따른 일괄 정정'
                          and detail ->> 'from_tier' = '미분류' and detail ->> 'to_tier' = '그외' and jsonb_array_length(detail -> 'rows') = 3 and admin_id = :admin::uuid
                     from public.admin_action_logs where action_type = 'school_tier_bulk_reassigned' order by created_at desc limit 1),
                  'A-3 admin_action_logs 기록(count 3 · note · rows 3 · admin_id)');
select pg_temp.ok((select reviewed_at from public.mentor_school_verifications where mentor_id = :m2::uuid)
                    = (select (detail ->> 'reviewed_at')::timestamptz from public.admin_action_logs where action_type = 'school_tier_bulk_reassigned' order by created_at desc limit 1)
                  and (select count(*) from public.mentor_school_verifications v join public.admin_action_logs l on l.action_type = 'school_tier_bulk_reassigned'
                        where v.reviewed_by = l.admin_id and v.reviewed_at = (l.detail ->> 'reviewed_at')::timestamptz and v.school_tier = '그외') = 3
                  and (select reviewed_at::text from public.mentor_school_verifications where mentor_id = :m2::uuid) <> (select val from db2_check.snapshot where key = 'msv_m2_reviewed_at'),
                  'A-3 개별 확정형 M2 도 일괄 시각으로 갱신 · 로그 reviewed_at 이 3행과 일치(롤백 대조 가능)');
select pg_temp.ok((select r ->> 'reviewed_at' from public.admin_action_logs l, jsonb_array_elements(l.detail -> 'rows') r
                     where l.action_type = 'school_tier_bulk_reassigned' and r ->> 'mentor_id' = '00000000-0000-4000-8000-00000000d2a2'
                     order by l.created_at desc limit 1)::timestamptz::text = (select val from db2_check.snapshot where key = 'msv_m2_reviewed_at'),
                  'A-3 로그 rows 에 M2 이전 reviewed_at 보존(롤백 정본)');
select pg_temp.ok((select status || '|' || school_tier || '|' || coalesce(reviewed_by::text, 'null') from public.mentor_school_verifications where mentor_id = :m6::uuid) = 'pending|미분류|null',
                  'A-3 pending 미분류(M6)는 제외');
select pg_temp.ok((select school_tier || '|' || reviewed_at::text from public.mentor_school_verifications where mentor_id = :m5::uuid) = '서연고|' || (select val from db2_check.snapshot where key = 'msv_m5_reviewed_at'),
                  'A-3 확정 서연고(M5) 불변');

-- ═══ A-2. 확정 RPC — 확정된 행 정정 ═══
select pg_temp.as_user(:m1::uuid, 'authenticated');
select pg_temp.ok(r like 'NOT_ADMIN%', 'A-2 멘토 JWT 는 NOT_ADMIN: ' || r) from (select pg_temp.try(format($q$ select public.approve_mentor_school_verification_admin(%L, '서울대학교', '서울대학교', '의예과', '메디컬', '서성한') $q$,
                                     (select id from public.mentor_school_verifications where mentor_id = :m5::uuid))) r) t;
select pg_temp.as_user(:admin::uuid, 'authenticated');
select pg_temp.ok(public.is_admin(), 'A-2 admin JWT 에서 is_admin() = true');
select pg_temp.ok((select r ->> 'status' = 'approved' and r ->> 'corrected' = 'true' and r ->> 'previous_school_tier' = '서연고' and r ->> 'previous_reviewed_by' = :admin and r ->> 'verification_id' is not null
                     from public.approve_mentor_school_verification_admin((select id from public.mentor_school_verifications where mentor_id = :m5::uuid),
                            '서울대학교', '서울대학교', '의예과', '메디컬', '서성한') r),
                  'A-2 확정된 approved(reviewed_by NOT NULL) 행 정정 성공 · corrected/previous_* 반환');
select pg_temp.ok((select school_tier || '|' || reviewed_by::text || '|' || (reviewed_at::text <> (select val from db2_check.snapshot where key = 'msv_m5_reviewed_at'))::text
                     from public.mentor_school_verifications where mentor_id = :m5::uuid) = '서성한|' || :admin || '|true',
                  'A-2 정정 결과: 서성한 · reviewed_by/at 새로 기록');
select pg_temp.ok((select count(*) from public.admin_action_logs where action_type = 'school_tier_corrected') = 1
                  and (select admin_id = :admin::uuid and target_id = (select id from public.mentor_school_verifications where mentor_id = :m5::uuid)
                              and detail -> 'previous' ->> 'school_tier' = '서연고' and detail -> 'previous' ->> 'reviewed_by' = :admin
                              and (detail -> 'previous' ->> 'reviewed_at')::timestamptz::text = (select val from db2_check.snapshot where key = 'msv_m5_reviewed_at')
                              and detail -> 'next' ->> 'school_tier' = '서성한' and detail ->> 'mentor_id' = '00000000-0000-4000-8000-00000000d2a5'
                         from public.admin_action_logs where action_type = 'school_tier_corrected'),
                  'A-2 감사 로그 school_tier_corrected: 이전 등급 · 이전 확정자 · 이전 확정 시각 · 다음 등급');
-- pending 행 확정은 정정이 아니다(로그 없음 · corrected=false) — RPC 호출과 사후 상태 확인은 문장을 나눈다(스칼라 서브쿼리 평가 순서 비의존)
select pg_temp.ok((select r ->> 'corrected' = 'false' and r ->> 'previous_school_tier' is null and r ->> 'status' = 'approved'
                     from public.approve_mentor_school_verification_admin((select id from public.mentor_school_verifications where mentor_id = :m6::uuid),
                            '원광대학교', '원광대학교', '의예과', '메디컬', '그외') r),
                  'A-2 pending 행 확정: corrected false · previous 없음');
select pg_temp.ok((select count(*) from public.admin_action_logs where action_type = 'school_tier_corrected') = 1, 'A-2 pending 행 확정은 정정 로그를 남기지 않는다(여전히 1건)');
select pg_temp.ok((select status || '|' || school_tier || '|' || reviewed_by::text from public.mentor_school_verifications where mentor_id = :m6::uuid) = 'approved|그외|' || :admin,
                  'A-2 pending 행 확정 결과: approved · 그외 · reviewed_by admin');
-- rejected · superseded 는 여전히 거부
select pg_temp.ok(r like 'NOT_REVIEWABLE: rejected%', 'A-2 rejected 는 NOT_REVIEWABLE: ' || r) from (select pg_temp.try(format($q$ select public.approve_mentor_school_verification_admin(%L, '고려대학교', '고려대학교', '통계학과', '자연', '서연고') $q$,
                                     (select id from public.mentor_school_verifications where mentor_id = :m7::uuid and status = 'rejected'))) r) t;
select pg_temp.as_user(null, null);
insert into public.mentor_school_verifications (mentor_id, status, school_tier, verified_major_category, verified_university_name)
values (:m7::uuid, 'superseded', '서연고', '자연', '고려대학교');
select pg_temp.as_user(:admin::uuid, 'authenticated');
select pg_temp.ok(r like 'NOT_REVIEWABLE: superseded%', 'A-2 superseded 는 NOT_REVIEWABLE: ' || r) from (select pg_temp.try(format($q$ select public.approve_mentor_school_verification_admin(%L, '고려대학교', '고려대학교', '통계학과', '자연', '서연고') $q$,
                                     (select id from public.mentor_school_verifications where mentor_id = :m7::uuid and status = 'superseded'))) r) t;
-- 같은 행 재정정(정정의 정정)도 허용 · 로그 2건째
select pg_temp.ok((select r ->> 'corrected' = 'true' and r ->> 'previous_school_tier' = '서성한'
                     from public.approve_mentor_school_verification_admin((select id from public.mentor_school_verifications where mentor_id = :m5::uuid),
                            '서울대학교', '서울대학교', '의예과', '메디컬', '서연고') r),
                  'A-2 재정정 허용 · 이전 등급 서성한 반환');
select pg_temp.ok((select count(*) from public.admin_action_logs where action_type = 'school_tier_corrected') = 2
                  and exists (select 1 from public.admin_action_logs where action_type = 'school_tier_corrected'
                               and detail -> 'previous' ->> 'school_tier' = '서성한' and detail -> 'next' ->> 'school_tier' = '서연고'),
                  'A-2 재정정 로그 2건째(이전 등급 서성한 → 서연고)');
select pg_temp.as_user(null, null);

-- ═══ A-1 트리거 연동 — 승인 자동 생성 · 학적 변경 재판정이 새 폴백을 쓴다 ═══
update public.mentor_profiles set verification_status = 'approved' where user_id = :m8::uuid;   -- 관리자 승인(서비스 경로)
select pg_temp.ok((select status || '|' || coalesce(reviewed_by::text, 'null') || '|' || school_tier || '|' || verified_major_category
                     from public.mentor_school_verifications where mentor_id = :m8::uuid) = 'pending|null|그외|메디컬',
                  'A-1 가천대학교 승인 → pending · 잠정 · 그외(구 미분류)');
update public.mentor_profiles set university_name = '계명대학교' where user_id = :m9::uuid;      -- 학적 변경(서비스 경로 · B-4 재판정)
select pg_temp.ok((select status || '|' || coalesce(reviewed_by::text, 'null') || '|' || school_tier from public.mentor_school_verifications where mentor_id = :m9::uuid) = 'pending|null|그외',
                  'A-1 학적 변경 재판정: 연세대 → 계명대 = pending · 그외');
select pg_temp.ok(r = 'OK', 'A-1 공백 대학명 UPDATE 통과: ' || r) from (select pg_temp.try(format($q$ update public.mentor_profiles set university_name = %L where user_id = %L $q$, '   ', :m9::uuid)) r) t;
select pg_temp.ok((select school_tier || '|' || coalesce(verified_university_name, 'null') from public.mentor_school_verifications where mentor_id = :m9::uuid) = '미분류|null',
                  'A-1 학적 변경 재판정: 공백 대학명 = 미분류(대학명을 못 읽은 경우만)');

-- ═══ B-1. 컬럼 ═══
select pg_temp.ok((select count(*) from information_schema.columns where table_schema = 'public'
                    and ((table_name in ('shortform_posts', 'comments', 'community_comments') and column_name in ('deleted_at', 'deleted_by'))
                      or (table_name = 'community_posts' and column_name in ('deleted_at', 'deleted_by')))) = 8, 'B-1 deleted_at/deleted_by 컬럼 8');
select pg_temp.ok((select bool_and(is_nullable = 'YES' and column_default is null) from information_schema.columns where table_schema = 'public'
                    and table_name in ('shortform_posts', 'comments', 'community_comments', 'community_posts') and column_name in ('deleted_at', 'deleted_by')), 'B-1 전부 null 허용 · 기본값 없음');

-- ═══ B-2. 숏폼 — anon 안 보임 · 타인·작성자 안 보임 · admin 보임 · 복원 ═══
update public.shortform_posts set deleted_at = now(), deleted_by = :admin::uuid where id = :sf1::uuid;   -- 관리자 삭제(서비스 경로)
set local role anon;
select pg_temp.as_user(null, null);
select pg_temp.ok((select count(*) from public.shortform_posts where id = :sf1::uuid) = 0, 'B-2 anon: 삭제된 숏폼 안 보임');
select pg_temp.ok((select count(*) from public.shortform_posts where id = :sf2::uuid) = 1, 'B-2 anon: 살아 있는 숏폼 보임');
reset role;
set local role authenticated;
select pg_temp.as_user(:s2::uuid, 'authenticated');
select pg_temp.ok((select count(*) from public.shortform_posts where id = :sf1::uuid) = 0, 'B-2 타인(authenticated): 삭제된 숏폼 안 보임');
select pg_temp.as_user(:m1::uuid, 'authenticated');
select pg_temp.ok((select count(*) from public.shortform_posts where id = :sf1::uuid) = 0, 'B-2 작성자 본인: 삭제된 숏폼 안 보임(숨김과 달리)');
select pg_temp.as_user(:admin::uuid, 'authenticated');
select pg_temp.ok((select count(*) from public.shortform_posts where id = :sf1::uuid and deleted_at is not null and deleted_by = :admin::uuid) = 1, 'B-2 admin: 삭제된 숏폼 보임(복원용)');
reset role;
select pg_temp.as_user(null, null);
-- 삭제된 숏폼은 조회수 미계수 · 신고 대상 아님
select pg_temp.ok(rls_private.report_target_content_valid('shortform_post', :sf1::uuid) = false and rls_private.report_target_content_valid('shortform_post', :sf2::uuid) = true,
                  'B-3 RPC report_target_content_valid: 삭제된 숏폼 false · 살아 있는 숏폼 true');
select pg_temp.ok(r like 'POST_NOT_FOUND%', 'B-3 RPC shortform_view_record_v2: 삭제된 숏폼 POST_NOT_FOUND: ' || r) from (select pg_temp.try(format($q$ select public.shortform_view_record_v2(%L, %L) $q$, :sf1::uuid, gen_random_uuid())) r) t;
select public.increment_shortform_post_view(:sf1::uuid);
select pg_temp.ok((select view_count from public.shortform_posts where id = :sf1::uuid) = 0, 'B-3 RPC increment_shortform_post_view: 삭제된 숏폼 미계수');
select pg_temp.ok((public.shortform_view_record_v2(:sf2::uuid, gen_random_uuid()) ->> 'incremented') = 'true', 'B-3 RPC 살아 있는 숏폼은 계수');
select pg_temp.ok((select view_count from public.shortform_posts where id = :sf2::uuid) = 1, 'B-3 RPC 살아 있는 숏폼 view_count 1');
update public.shortform_posts set deleted_at = null, deleted_by = null where id = :sf1::uuid;   -- 복원(서비스 경로)
set local role anon;
select pg_temp.ok((select count(*) from public.shortform_posts where id = :sf1::uuid) = 1, 'B-2 복원 후 anon 보임');
reset role;

-- ═══ B-3. 게시판 댓글 — 정본·레거시 동기화 · 댓글 수 · 뷰 · RLS ═══
select pg_temp.ok((select comment_count from public.community_posts where id = :p1::uuid) = 2, 'B-3 초기 댓글 수 2(C1·C2)');
update public.comments set deleted_at = now(), deleted_by = :admin::uuid where id = :c1::uuid;   -- 정본 삭제(서비스 경로)
select pg_temp.ok((select is_deleted from public.comments where id = :c1::uuid) = true, 'B-3 정본 삭제 → is_deleted true(동기화 트리거)');
select pg_temp.ok((select comment_count from public.community_posts where id = :p1::uuid) = 1, 'B-3 댓글 수 재계산(삭제 제외 · deleted_at 변경으로 발화)');
select pg_temp.ok((select status || '|' || (deleted_at is not null)::text || '|' || coalesce(deleted_by::text, 'null') from public.community_comments where canonical_comment_id = :c1::uuid) = 'visible|true|' || :admin,
                  'B-3 레거시 미러(L1): deleted_at/deleted_by 전달 · status 는 숨김 전용(visible 유지)');
set local role anon;
select pg_temp.ok((select count(*) from api_web_v1.community_comments_v1 where post_id = :p1::uuid) = 1, 'B-3 뷰 community_comments_v1: 삭제 댓글 제외');
select pg_temp.ok((select count(*) from public.comments where post_id = :p1::uuid) = 1, 'B-3 anon comments RLS: 삭제 댓글 제외');
select pg_temp.ok((select count(*) from public.community_comments where post_type = 'board' and post_id = :p1::uuid) = 1, 'B-3 anon 레거시 RLS: 삭제 댓글 제외');
reset role;
set local role authenticated;
select pg_temp.as_user(:admin::uuid, 'authenticated');
select pg_temp.ok((select count(*) from public.comments where post_id = :p1::uuid) = 2 and (select count(*) from public.community_comments where post_type = 'board' and post_id = :p1::uuid) = 2,
                  'B-3 admin: 정본·레거시 삭제 댓글도 보임');
reset role;
select pg_temp.as_user(null, null);
update public.comments set is_deleted = false where id = :c1::uuid;                              -- 삭제된 행의 숨김 해제 시도
select pg_temp.ok((select is_deleted from public.comments where id = :c1::uuid) = true, 'B-3 삭제된 행은 is_deleted 를 false 로 되돌릴 수 없다(삭제 > 숨김)');
update public.comments set deleted_at = null, deleted_by = null where id = :c1::uuid;             -- 복원
select pg_temp.ok((select is_deleted = false and deleted_at is null from public.comments where id = :c1::uuid)
                  and (select comment_count from public.community_posts where id = :p1::uuid) = 2
                  and (select status || '|' || (deleted_at is null)::text from public.community_comments where canonical_comment_id = :c1::uuid) = 'visible|true',
                  'B-3 정본 복원 → is_deleted false · 댓글 수 2 · 레거시 deleted_at NULL');
update public.comments set is_deleted = true where id = :c1::uuid;                               -- 관리자 숨김(기존 경로)
select pg_temp.ok((select deleted_at is null from public.comments where id = :c1::uuid)
                  and (select comment_count from public.community_posts where id = :p1::uuid) = 1
                  and (select status from public.community_comments where canonical_comment_id = :c1::uuid) = 'hidden',
                  'B-3 숨김 경로 불변: deleted_at NULL · 댓글 수 1 · 레거시 hidden');
update public.comments set is_deleted = false where id = :c1::uuid;                              -- 숨김 해제
select pg_temp.ok((select comment_count from public.community_posts where id = :p1::uuid) = 2
                  and (select status from public.community_comments where canonical_comment_id = :c1::uuid) = 'visible', 'B-3 숨김 해제 → 댓글 수 2 · 레거시 visible');
update public.community_comments set deleted_at = now(), deleted_by = :admin::uuid where id = :l2::uuid;   -- 레거시 삭제(서비스 경로)
select pg_temp.ok((select is_deleted and deleted_at is not null and deleted_by = :admin::uuid from public.comments where legacy_comment_id = :l2::uuid)
                  and (select comment_count from public.community_posts where id = :p1::uuid) = 1,
                  'B-3 레거시 삭제 → 정본 deleted_at·deleted_by·is_deleted · 댓글 수 1');
update public.community_comments set deleted_at = null, deleted_by = null where id = :l2::uuid;   -- 레거시 복원
select pg_temp.ok((select is_deleted = false and deleted_at is null from public.comments where legacy_comment_id = :l2::uuid)
                  and (select comment_count from public.community_posts where id = :p1::uuid) = 2, 'B-3 레거시 복원 → 정본 복원 · 댓글 수 2');

-- ═══ B-3. 숏폼 댓글 — 본인 삭제 RPC · RLS ═══
set local role authenticated;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.ok((public.community_comment_soft_delete_self(:sc1::uuid) ->> 'idempotent_hit') = 'false', 'B-3 RPC community_comment_soft_delete_self: 본인 삭제');
select pg_temp.ok((public.community_comment_soft_delete_self(:sc1::uuid) ->> 'idempotent_hit') = 'true', 'B-3 RPC 재호출 멱등');
select pg_temp.as_user(:s2::uuid, 'authenticated');
select pg_temp.ok(r like 'COMMENT_MODERATED%', 'B-3 RPC 관리자 숨김 댓글은 본인 삭제 불가(기존): ' || r) from (select pg_temp.try(format($q$ select public.community_comment_soft_delete_self(%L) $q$, :sc2::uuid)) r) t;
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((select deleted_at is not null and deleted_by = :s1::uuid and status = 'visible' from public.community_comments where id = :sc1::uuid),
                  'B-3 본인 삭제 = deleted_at/deleted_by(status 불변 — 구 status=deleted 는 CHECK 가 막던 경로)');
set local role anon;
select pg_temp.ok((select count(*) from public.community_comments where post_type = 'shortform' and post_id = :sf1::uuid) = 0, 'B-3 anon: 삭제·숨김 숏폼 댓글 0');
reset role;
set local role authenticated;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.ok((select count(*) from public.community_comments where post_type = 'shortform' and post_id = :sf1::uuid) = 0, 'B-3 작성자 본인도 삭제 댓글 안 보임');
select pg_temp.as_user(:s2::uuid, 'authenticated');
select pg_temp.ok((select count(*) from public.community_comments where post_type = 'shortform' and post_id = :sf1::uuid) = 1, 'B-3 숨김 댓글은 작성자 본인에게 보임(기존)');
select pg_temp.as_user(:admin::uuid, 'authenticated');
select pg_temp.ok((select count(*) from public.community_comments where post_type = 'shortform' and post_id = :sf1::uuid) = 2, 'B-3 admin: 삭제·숨김 숏폼 댓글 전부');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok(rls_private.report_target_content_valid('community_comment', :sc1::uuid) = false, 'B-3 삭제된 숏폼 댓글은 신고 대상 아님');

-- ═══ B-3. 쓰기 가드 + RLS — 작성자 본인의 직접 UPDATE soft delete 는 RLS 가 거부한다(UPDATE 의 새 행도 SELECT 정책을 통과해야 한다 —
--        community_posts 와 같은 성질 · 본인 삭제는 SECURITY DEFINER RPC 경로). 가드는 그 앞단의 심층 방어(deleted_by 위조·단독 변경 거부). ═══
set local role authenticated;
select pg_temp.as_user(:m1::uuid, 'authenticated');
select pg_temp.ok((select auth.uid()) = :m1::uuid and current_user = 'authenticated' and (select public.ugc_write_allowed()), 'B-3 가드 전제: authenticated 역할 · auth.uid() = M1 · ugc_write_allowed');
select pg_temp.ok(r like 'SHORTFORM_DELETED_BY_MISMATCH%', 'B-3 숏폼 가드: deleted_by 위조 거부: ' || r) from (select pg_temp.try(format($q$ update public.shortform_posts set deleted_at = now(), deleted_by = %L where id = %L $q$, :s2::uuid, :sf2::uuid)) r) t;
select pg_temp.ok(r like 'SHORTFORM_PROTECTED_COLUMNS%', 'B-3 숏폼 가드: deleted_by 단독 변경 거부: ' || r) from (select pg_temp.try(format($q$ update public.shortform_posts set deleted_by = %L where id = %L $q$, :s2::uuid, :sf2::uuid)) r) t;
select pg_temp.ok(r like 'new row violates row-level security policy%', 'B-3 숏폼: 작성자 직접 UPDATE soft delete 는 RLS 가 거부(새 행이 SELECT 정책 불통과 — 본인 삭제는 RPC 경로): ' || r)
  from (select pg_temp.try(format($q$ update public.shortform_posts set deleted_at = now(), deleted_by = %L where id = %L $q$, :m1::uuid, :sf2::uuid)) r) t;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.ok(r like 'COMMENT_PROTECTED_FIELDS_IMMUTABLE%', 'B-3 댓글 가드: deleted_by 단독 변경 거부: ' || r) from (select pg_temp.try(format($q$ update public.comments set deleted_by = %L where id = %L $q$, :s2::uuid, :c1::uuid)) r) t;
select pg_temp.ok(r like 'COMMENT_DELETED_BY_MISMATCH%', 'B-3 댓글 가드: deleted_by 위조 거부: ' || r) from (select pg_temp.try(format($q$ update public.comments set deleted_at = now(), deleted_by = %L where id = %L $q$, :s2::uuid, :c1::uuid)) r) t;
select pg_temp.ok(r like 'new row violates row-level security policy%', 'B-3 댓글: 작성자 직접 UPDATE soft delete 도 RLS 가 거부: ' || r)
  from (select pg_temp.try(format($q$ update public.comments set deleted_at = now(), deleted_by = %L where id = %L $q$, :s1::uuid, :c1::uuid)) r) t;
-- (관측 · assert 아님) 기존 웹의 게시판 댓글 본인 삭제(is_deleted=true 직접 UPDATE · D-CM-6)도 같은 성질인지 — comments_select_visible(is_deleted=false)은 194 이전부터 그랬다
select 'POST info 기존 is_deleted=true 직접 UPDATE(작성자): ' || pg_temp.try(format($q$ update public.comments set is_deleted = true, content = '삭제된 댓글입니다.' where id = %L and author_id = %L $q$, :c1::uuid, :s1::uuid));
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((select deleted_at is null and is_deleted = false from public.comments where id = :c1::uuid) and (select deleted_at is null from public.shortform_posts where id = :sf2::uuid), 'B-3 거부된 시도는 흔적을 남기지 않는다');
-- 관리자 세션(authenticated + admin JWT · service_role 아님)의 soft delete·복원은 허용된다(가드 조기 통과 · sf_update_admin · 관리자는 삭제 행도 읽는다)
set local role authenticated;
select pg_temp.as_user(:admin::uuid, 'authenticated');
select pg_temp.ok(r = 'ROWS=1', 'B-3 관리자 세션 soft delete 허용: ' || r) from (select pg_temp.try_rows(format($q$ update public.shortform_posts set deleted_at = now(), deleted_by = %L where id = %L $q$, :admin::uuid, :sf2::uuid)) r) t;
select pg_temp.as_user(:m1::uuid, 'authenticated');
select pg_temp.ok(r = 'ROWS=0', 'B-3 작성자 복원 불가(RLS 가 삭제 행을 숨긴다 → 0행): ' || r) from (select pg_temp.try_rows(format($q$ update public.shortform_posts set deleted_at = null where id = %L $q$, :sf2::uuid)) r) t;
select pg_temp.as_user(:admin::uuid, 'authenticated');
select pg_temp.ok(r = 'ROWS=1', 'B-3 관리자 세션 복원 허용: ' || r) from (select pg_temp.try_rows(format($q$ update public.shortform_posts set deleted_at = null, deleted_by = null where id = %L $q$, :sf2::uuid)) r) t;
select pg_temp.ok(r = 'ROWS=1', 'B-3 관리자 세션 댓글 soft delete 허용: ' || r) from (select pg_temp.try_rows(format($q$ update public.comments set deleted_at = now(), deleted_by = %L where id = %L $q$, :admin::uuid, :c1::uuid)) r) t;
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((select is_deleted and deleted_by = :admin::uuid from public.comments where id = :c1::uuid)
                  and (select comment_count from public.community_posts where id = :p1::uuid) = 1
                  and (select deleted_at is not null from public.community_comments where canonical_comment_id = :c1::uuid),
                  'B-3 관리자 세션 삭제 결과: is_deleted · 댓글 수 1 · 레거시 deleted_at');
set local role anon;
select pg_temp.ok((select count(*) from public.shortform_posts where id = :sf2::uuid) = 1, 'B-3 복원된 숏폼 anon 보임');
reset role;
update public.comments set deleted_at = null, deleted_by = null where id = :c1::uuid;
select pg_temp.ok((select comment_count from public.community_posts where id = :p1::uuid) = 2, 'B-3 복원(서비스 경로) → 댓글 수 2');

-- ═══ C. 매핑 테이블 ═══
select pg_temp.ok(to_regclass('public.school_tier_mappings') is null, 'C school_tier_mappings 제거');
select pg_temp.ok((select count(*) from public.school_tier_catalog) = 6 and (select count(*) from public.major_category_catalog) = 8, 'C 카탈로그 불변(6 · 8)');

\echo DB2 POST FIXTURE PASS
rollback;
