-- =============================================================================
-- full_convergence_m2_verify.sql — 수렴 M2 행위 검증 (로컬 스크래치 전용)
-- 전체 단일 트랜잭션 실행 후 rollback.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

-- [M2-1] 멘토 디렉토리: active+approved 만 · full_name 미노출 · guest=회원 동일
set local role anon;
do $$ declare v_ids uuid[]; begin
  select coalesce(array_agg(mentor_id order by mentor_id), '{}') into v_ids from api_web_v1.mentor_directory_v1;
  if v_ids <> array['33333333-3333-3333-3333-333333333333']::uuid[] then
    raise exception 'FAIL[M2-1a] directory ids: %', v_ids;
  end if;
  raise notice 'PASS M2-1a directory = approved+active only (suspended/pending/deletion excluded)';
end $$;
reset role;
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema='api_web_v1' and table_name='mentor_directory_v1'
                and column_name in ('full_name','email','birth_date')) then
    raise exception 'FAIL[M2-1b] private column exposed';
  end if;
  raise notice 'PASS M2-1b no full_name/email/birth_date in projection';
end $$;

-- [M2-2] legacy 멘토 RPC 실행 회수
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ begin
  begin
    perform * from public.mentor_directory_list_v2(10);
    raise exception 'FAIL[M2-2] legacy directory RPC still callable';
  exception when insufficient_privilege then
    raise notice 'PASS M2-2 legacy mentor RPC EXECUTE revoked';
  end;
end $$;

-- [M2-3] 신고 target allowlist
do $$ begin
  begin
    insert into public.content_reports (reporter_id, target_type, target_id, reason)
    values ('11111111-1111-1111-1111-111111111111','shortform','bbbb1111-0000-0000-0000-000000000001','spam');
    raise exception 'FAIL[M2-3a] ambiguous shortform accepted';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS M2-3a target=shortform rejected';
  end;
  begin
    insert into public.content_reports (reporter_id, target_type, target_id, reason)
    values ('11111111-1111-1111-1111-111111111111','comment','cccc1111-0000-0000-0000-000000000001','spam');
    raise exception 'FAIL[M2-3b] legacy comment accepted';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS M2-3b target=comment rejected';
  end;
  insert into public.content_reports (reporter_id, target_type, target_id, reason)
  values ('11111111-1111-1111-1111-111111111111','shortform_post','bbbb1111-0000-0000-0000-000000000001','spam');
  insert into public.content_reports (reporter_id, target_type, target_id, reason)
  values ('11111111-1111-1111-1111-111111111111','board_comment','cccc1111-0000-0000-0000-000000000001','spam');
  insert into public.content_reports (reporter_id, target_type, target_id, reason)
  values ('11111111-1111-1111-1111-111111111111','community_comment','cccc1111-0000-0000-0000-000000000001','spam');
  raise notice 'PASS M2-3c canonical five targets insertable';
  begin
    insert into public.content_reports (reporter_id, target_type, target_id, reason)
    values ('11111111-1111-1111-1111-111111111111','user','11111111-1111-1111-1111-111111111111','self');
    raise exception 'FAIL[M2-3d] self user report accepted';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS M2-3d self user report rejected';
  end;
  insert into public.content_reports (reporter_id, target_type, target_id, reason)
  values ('11111111-1111-1111-1111-111111111111','user','33333333-3333-3333-3333-333333333333','abuse');
  raise notice 'PASS M2-3e valid user report accepted';
end $$;

-- [M2-4] 숏폼 무결성 — 소유자 정상 수정 vs 보호 컬럼·status 전이·계정 게이트
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
do $$ begin
  update public.shortform_posts set title = '수정된 제목', description = '내용'
   where id = 'bbbb1111-0000-0000-0000-000000000001';
  raise notice 'PASS M2-4a owner content edit ok';
  begin
    update public.shortform_posts set view_count = 99999 where id = 'bbbb1111-0000-0000-0000-000000000001';
    raise exception 'FAIL[M2-4b] counter tamper allowed';
  exception when insufficient_privilege then
    raise notice 'PASS M2-4b view_count tamper blocked';
  end;
  begin
    update public.shortform_posts set author_id = '11111111-1111-1111-1111-111111111111'
     where id = 'bbbb1111-0000-0000-0000-000000000001';
    raise exception 'FAIL[M2-4c] author tamper allowed';
  exception when insufficient_privilege then
    raise notice 'PASS M2-4c author reassignment blocked';
  end;
  begin
    update public.shortform_posts set status = 'hidden' where id = 'bbbb1111-0000-0000-0000-000000000001';
    raise exception 'FAIL[M2-4d] arbitrary status transition allowed';
  exception when insufficient_privilege then
    raise notice 'PASS M2-4d status transition restricted to draft/published';
  end;
end $$;
-- 유효 suspended 멘토는 INSERT 불가 (ugc gate)
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
do $$ begin
  begin
    insert into public.shortform_posts (author_id, creator_id, title, status)
    values ('55555555-5555-5555-5555-555555555555','55555555-5555-5555-5555-555555555555','정지자 글','published');
    raise exception 'FAIL[M2-4e] suspended mentor insert allowed';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS M2-4e suspended mentor shortform insert blocked (ugc gate)';
  end;
end $$;

-- [M2-5] view v2 멱등 + legacy 회수
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ declare v jsonb; v_before int; v_after int; v_key uuid := gen_random_uuid(); begin
  select view_count into v_before from public.shortform_posts where id='bbbb1111-0000-0000-0000-000000000001';
  v := public.shortform_view_record_v2('bbbb1111-0000-0000-0000-000000000001', v_key);
  if not (v->>'incremented')::boolean then raise exception 'FAIL[M2-5a] first event not counted'; end if;
  v := public.shortform_view_record_v2('bbbb1111-0000-0000-0000-000000000001', v_key);
  if (v->>'incremented')::boolean then raise exception 'FAIL[M2-5b] duplicate event counted'; end if;
  select view_count into v_after from public.shortform_posts where id='bbbb1111-0000-0000-0000-000000000001';
  if v_after <> v_before + 1 then raise exception 'FAIL[M2-5c] count delta %', v_after - v_before; end if;
  raise notice 'PASS M2-5 view v2 idempotent (+1 exactly once)';
  begin
    perform public.increment_shortform_post_view('bbbb1111-0000-0000-0000-000000000001');
    raise exception 'FAIL[M2-5d] legacy increment still callable';
  exception when insufficient_privilege then
    raise notice 'PASS M2-5d legacy increment revoked';
  end;
end $$;

-- [M2-6] 숏폼 댓글 — 서버 파생 라벨 + 본인 soft-delete
do $$ declare v_id uuid; v_label text; v jsonb; begin
  insert into public.community_comments (post_type, post_id, author_id, author_label, body, status)
  values ('shortform','bbbb1111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','조작라벨','새 댓글','visible')
  returning id, author_label into v_id, v_label;
  if v_label <> '학생일' then raise exception 'FAIL[M2-6a] label not server-derived: %', v_label; end if;
  raise notice 'PASS M2-6a shortform comment label server-derived';
  v := public.community_comment_soft_delete_self(v_id);
  if not (v->>'ok')::boolean or (v->>'idempotent_hit')::boolean then raise exception 'FAIL[M2-6b] %', v; end if;
  if not exists (select 1 from public.community_comments where id = v_id and status = 'deleted') then
    raise exception 'FAIL[M2-6b] not soft-deleted';
  end if;
  v := public.community_comment_soft_delete_self(v_id);
  if not (v->>'idempotent_hit')::boolean then raise exception 'FAIL[M2-6c] not idempotent'; end if;
  raise notice 'PASS M2-6b/c own shortform comment soft-delete + idempotent';
end $$;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
do $$ begin
  begin
    perform public.community_comment_soft_delete_self('cccc1111-0000-0000-0000-000000000001');
    raise exception 'FAIL[M2-6d] foreign comment delete allowed';
  exception when others then
    if sqlerrm not like '%COMMENT_NOT_OWNED%' then raise exception 'FAIL[M2-6d] wrong code: %', sqlerrm; end if;
    raise notice 'PASS M2-6d foreign comment delete -> COMMENT_NOT_OWNED';
  end;
end $$;

-- [M2-7] IQ answer 게이트 — banned 멘토·차단 쌍 거부, 정상 멘토 answered 전이
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
do $$ begin
  begin
    perform * from public.answer_individual_question('dddd1111-0000-0000-0000-000000000002', '답변');
    raise exception 'FAIL[M2-7a] banned mentor answer allowed';
  exception when others then
    if sqlerrm not like '%ACCOUNT_BANNED%' then raise exception 'FAIL[M2-7a] wrong code: %', sqlerrm; end if;
    raise notice 'PASS M2-7a banned mentor -> ACCOUNT_BANNED';
  end;
end $$;
reset role;
insert into public.user_blocks (blocker_id, blocked_id) values
  ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333');
set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
do $$ begin
  begin
    perform * from public.answer_individual_question('dddd1111-0000-0000-0000-000000000001', '답변');
    raise exception 'FAIL[M2-7b] blocked pair answer allowed';
  exception when others then
    if sqlerrm not like '%BLOCKED%' then raise exception 'FAIL[M2-7b] wrong code: %', sqlerrm; end if;
    raise notice 'PASS M2-7b blocked pair -> BLOCKED';
  end;
end $$;
reset role;
delete from public.user_blocks
 where blocker_id='11111111-1111-1111-1111-111111111111' and blocked_id='33333333-3333-3333-3333-333333333333';
set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
do $$ declare v_status text; begin
  perform * from public.answer_individual_question('dddd1111-0000-0000-0000-000000000001', '정상 답변');
  select status into v_status from public.individual_questions where id='dddd1111-0000-0000-0000-000000000001';
  if v_status <> 'answered' then raise exception 'FAIL[M2-7c] status %', v_status; end if;
  raise notice 'PASS M2-7c approved active mentor answer -> answered';
end $$;

-- [M2-8] IQ 첨부 — 신규 등록 Storage fail-closed · 멱등 보존
do $$ declare v jsonb; begin
  v := public.add_individual_question_attachment('dddd1111-0000-0000-0000-000000000001',
        'dddd1111-0000-0000-0000-000000000001/file-a.png', 'file-a.png', 'image/png', null);
  if (v->>'status') <> 'created' then raise exception 'FAIL[M2-8a] %', v; end if;
  v := public.add_individual_question_attachment('dddd1111-0000-0000-0000-000000000001',
        'dddd1111-0000-0000-0000-000000000001/file-a.png', 'file-a.png', 'image/png', null);
  if (v->>'status') <> 'existing' or not (v->>'idempotent_hit')::boolean then raise exception 'FAIL[M2-8b] %', v; end if;
  raise notice 'PASS M2-8a/b owned object registered + idempotent replay';
  begin
    perform public.add_individual_question_attachment('dddd1111-0000-0000-0000-000000000001',
        'dddd1111-0000-0000-0000-000000000001/file-b.png', 'file-b.png', 'image/png', null);
    raise exception 'FAIL[M2-8c] foreign-owned object registered';
  exception when others then
    if sqlerrm not like '%STORAGE_OBJECT_NOT_OWNED%' then raise exception 'FAIL[M2-8c] wrong code: %', sqlerrm; end if;
    raise notice 'PASS M2-8c foreign-owned object -> STORAGE_OBJECT_NOT_OWNED';
  end;
  begin
    perform public.add_individual_question_attachment('dddd1111-0000-0000-0000-000000000001',
        'dddd1111-0000-0000-0000-000000000001/no-such.png', 'no-such.png', 'image/png', null);
    raise exception 'FAIL[M2-8d] missing object registered';
  exception when others then
    if sqlerrm not like '%STORAGE_OBJECT_NOT_FOUND%' then raise exception 'FAIL[M2-8d] wrong code: %', sqlerrm; end if;
    raise notice 'PASS M2-8d missing object -> STORAGE_OBJECT_NOT_FOUND';
  end;
end $$;

-- [M2-9] 경고 3회 자동정지 원자 계약
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', true);
do $$ declare v jsonb; begin
  v := public.admin_issue_user_warning('22222222-2222-2222-2222-222222222222', '사유1', 'normal');
  if (v->>'active_warning_count')::int <> 1 or (v->>'auto_suspended')::boolean then raise exception 'FAIL[M2-9a] %', v; end if;
  v := public.admin_issue_user_warning('22222222-2222-2222-2222-222222222222', '사유2', 'normal');
  v := public.admin_issue_user_warning('22222222-2222-2222-2222-222222222222', '사유3', 'severe');
  if (v->>'active_warning_count')::int <> 3 or not (v->>'auto_suspended')::boolean then raise exception 'FAIL[M2-9b] %', v; end if;
  if not exists (select 1 from public.users where id='22222222-2222-2222-2222-222222222222'
                  and status='suspended' and suspended_until > now() + interval '6 days') then
    raise exception 'FAIL[M2-9c] auto suspension not applied';
  end if;
  raise notice 'PASS M2-9 three warnings -> atomic 7-day suspension';
  begin
    perform public.admin_issue_user_warning('77777777-7777-7777-7777-777777777777', '자기 경고', 'normal');
    raise exception 'FAIL[M2-9d] self warning allowed';
  exception when others then
    if sqlerrm not like '%SELF_WARNING_FORBIDDEN%' then raise exception 'FAIL[M2-9d] wrong code: %', sqlerrm; end if;
    raise notice 'PASS M2-9d self warning forbidden';
  end;
end $$;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ begin
  begin
    perform public.admin_issue_user_warning('22222222-2222-2222-2222-222222222222', '비관리자', 'normal');
    raise exception 'FAIL[M2-9e] non-admin warning allowed';
  exception when others then
    if sqlerrm not like '%ADMIN_ONLY%' then raise exception 'FAIL[M2-9e] wrong code: %', sqlerrm; end if;
    raise notice 'PASS M2-9e non-admin -> ADMIN_ONLY';
  end;
end $$;

-- [M2-10] 금융 ACL — 잉여 write 회수 · 인가 쓰기 유지
do $$ begin
  begin
    update public.cash_wallets set balance_cents = 999999 where user_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL[M2-10a] wallet update allowed';
  exception when insufficient_privilege then
    raise notice 'PASS M2-10a cash_wallets UPDATE revoked';
  end;
  begin
    insert into public.cash_ledger (user_id, delta_cents, reason) values ('11111111-1111-1111-1111-111111111111', 1, 'x');
    raise exception 'FAIL[M2-10b] ledger insert allowed';
  exception when insufficient_privilege then
    raise notice 'PASS M2-10b cash_ledger INSERT revoked';
  end;
  insert into public.payments (user_id, status) values ('11111111-1111-1111-1111-111111111111', 'pending');
  raise notice 'PASS M2-10c payments pending intent INSERT preserved';
end $$;

-- [M2-11] favorites 정책 3개 (영문 정본만)
do $$ begin
  if (select count(*) from pg_policies where schemaname='public' and tablename='favorites') <> 3 then
    raise exception 'FAIL[M2-11]';
  end if;
  raise notice 'PASS M2-11 favorites single policy set';
end $$;

-- [M2-12] 계정 삭제 self v2 — 서버 고정값 · 구 RPC 회수
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
do $$ declare v jsonb; begin
  begin
    perform public.account_deletion_request_self(0, true);
    raise exception 'FAIL[M2-12a] legacy self RPC still callable';
  exception when insufficient_privilege then
    raise notice 'PASS M2-12a legacy account_deletion_request_self revoked';
  end;
  begin
    perform public.account_deletion_request_self_consented(525600, true, 0);
    raise exception 'FAIL[M2-12b] legacy consented RPC still callable';
  exception when insufficient_privilege then
    raise notice 'PASS M2-12b legacy consented RPC revoked';
  end;
  v := public.account_deletion_request_self_v2();
  if not (v->>'ok')::boolean or (v->>'cancelable_minutes')::int <> 30 or (v->>'dry_run')::boolean then
    raise exception 'FAIL[M2-12c] v2 not server-fixed: %', v;
  end if;
  -- 중복 요청 멱등 (기존 활성 job 재사용)
  v := public.account_deletion_request_self_v2();
  raise notice 'PASS M2-12abc legacy revoked + v2 server-fixed 30min/no-dry-run';
end $$;
reset role;
do $$ begin
  if (select count(*) from public.account_deletion_jobs
       where user_id='22222222-2222-2222-2222-222222222222' and state='pending') <> 1 then
    raise exception 'FAIL[M2-12d] v2 job creation not idempotent-single';
  end if;
  raise notice 'PASS M2-12d v2 created exactly one pending job (idempotent)';
end $$;
set local role authenticated;

rollback;
select '=== full_convergence_m2_verify: ALL PASS' as result;
