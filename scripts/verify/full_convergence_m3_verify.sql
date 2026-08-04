-- =============================================================================
-- full_convergence_m3_verify.sql — 수렴 M3 행위 검증 (로컬 스크래치 전용)
-- 전체 단일 트랜잭션 실행 후 rollback.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

-- [M3-1] publication 7테이블
do $$ begin
  if (select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'
       and tablename in ('question_threads','question_messages','question_attachments',
                         'notifications','individual_questions','individual_question_messages',
                         'individual_question_attachments')) <> 7 then
    raise exception 'FAIL[M3-1]';
  end if;
  raise notice 'PASS M3-1 realtime publication = qna 3 + notifications + IQ 3';
end $$;

-- [M3-2] backfill: legacy read=true -> is_read=true · read_at 채움 · 미러 일치
do $$ begin
  if not exists (select 1 from public.notifications where id='eeee1111-0000-0000-0000-000000000002' and is_read = true) then
    raise exception 'FAIL[M3-2a] legacy read backfill missing';
  end if;
  if exists (select 1 from public.notifications where is_read = true and read_at is null) then
    raise exception 'FAIL[M3-2b] read_at backfill incomplete';
  end if;
  if exists (select 1 from public.notifications where read is distinct from is_read) then
    raise exception 'FAIL[M3-2c] mirror mismatch';
  end if;
  raise notice 'PASS M3-2 read-state backfill + mirror';
end $$;

-- [M3-3] unread count — 앱 제외 타입 제외 · 사용자별 정확
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ declare v jsonb; begin
  v := public.notification_unread_count_self();
  -- evt-1 만 unread (evt-2/3 은 backfill 로 읽음 · evt-4 는 new_order_message 제외 · evt-5 는 타인)
  if (v->>'count')::int <> 1 then raise exception 'FAIL[M3-3] count %', v; end if;
  raise notice 'PASS M3-3 unread count = 1 (excluded types + other users filtered)';
end $$;

-- [M3-4] 개별 읽음 RPC — 정상·멱등·비수신자 거부 · count 연동
do $$ declare v jsonb; begin
  v := public.mark_notification_read('eeee1111-0000-0000-0000-000000000001');
  if (v->>'idempotent_hit')::boolean then raise exception 'FAIL[M3-4a]'; end if;
  v := public.mark_notification_read('eeee1111-0000-0000-0000-000000000001');
  if not (v->>'idempotent_hit')::boolean then raise exception 'FAIL[M3-4b]'; end if;
  v := public.notification_unread_count_self();
  if (v->>'count')::int <> 0 then raise exception 'FAIL[M3-4c] count %', v; end if;
  raise notice 'PASS M3-4 mark one + idempotent + count sync';
end $$;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
do $$ begin
  begin
    perform public.mark_notification_read('eeee1111-0000-0000-0000-000000000001');
    raise exception 'FAIL[M3-4d] foreign mark allowed';
  exception when others then
    if sqlerrm not like '%NOT_RECIPIENT%' then raise exception 'FAIL[M3-4d] wrong code: %', sqlerrm; end if;
    raise notice 'PASS M3-4d non-recipient mark -> NOT_RECIPIENT';
  end;
end $$;

-- [M3-5] 미러 트리거 — 어느 쪽을 갱신해도 수렴 (기존 배포 클라이언트 호환)
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
do $$ begin
  update public.notifications set read = true
   where id = 'eeee1111-0000-0000-0000-000000000005';
  if not exists (select 1 from public.notifications
                  where id='eeee1111-0000-0000-0000-000000000005' and is_read = true and read_at is not null) then
    raise exception 'FAIL[M3-5] legacy read update not converged';
  end if;
  raise notice 'PASS M3-5 legacy `read` update converges to is_read/read_at';
end $$;

-- [M3-6] record_domain_notification — push disabled 시 outbox 미적재 (인앱은 생성)
reset role;
do $$ declare v jsonb; v_outbox_before int; v_outbox_after int; begin
  select count(*) into v_outbox_before from public.notification_outbox;
  v := public.record_domain_notification('11111111-1111-1111-1111-111111111111',
        'evt-new-1', 'dk-new-1', 'question_answered', '제목', '본문', null, '{}'::jsonb, '{}'::jsonb);
  if not (v->>'notification_created')::boolean then raise exception 'FAIL[M3-6a] %', v; end if;
  if (v->>'outbox_created')::boolean or (v->'outbox_id') is not null and (v->>'outbox_id') is not null then
    raise exception 'FAIL[M3-6b] outbox created while push disabled: %', v;
  end if;
  select count(*) into v_outbox_after from public.notification_outbox;
  if v_outbox_after <> v_outbox_before then raise exception 'FAIL[M3-6c] outbox count changed'; end if;
  raise notice 'PASS M3-6 in-app row created, outbox not accumulated (push disabled)';
  -- 전송로 활성 시에는 outbox 생성 (service-role 설정 경로 시뮬레이션)
  update public.notification_transport_config set push_transport_enabled = true, updated_at = now() where id is true;
  v := public.record_domain_notification('11111111-1111-1111-1111-111111111111',
        'evt-new-2', 'dk-new-2', 'question_answered', '제목', '본문', null, '{}'::jsonb, '{}'::jsonb);
  if not (v->>'outbox_created')::boolean then raise exception 'FAIL[M3-6d] outbox not created while enabled: %', v; end if;
  update public.notification_transport_config set push_transport_enabled = false, updated_at = now() where id is true;
  raise notice 'PASS M3-6d transport flag controls outbox creation';
end $$;

-- [M3-7] 기존 pending suppress — 총행수 불변 · pending 0
do $$ declare v_supp int; v_pend int; begin
  select count(*) filter (where status='suppressed' and last_error='PUSH_TRANSPORT_DISABLED'),
         count(*) filter (where status='pending' and dedup_key in ('dk-1','dk-2','dk-5'))
    into v_supp, v_pend
    from public.notification_outbox;
  if v_supp <> 3 or v_pend <> 0 then raise exception 'FAIL[M3-7] supp % pend %', v_supp, v_pend; end if;
  raise notice 'PASS M3-7 seeded pending -> suppressed (rows preserved)';
end $$;

-- [M3-8] notification_enabled 제거 · register_device_token 회수
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='users' and column_name='notification_enabled') then
    raise exception 'FAIL[M3-8a]';
  end if;
  raise notice 'PASS M3-8a users.notification_enabled dropped';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ begin
  begin
    perform public.register_device_token('tok', 'android');
    raise exception 'FAIL[M3-8b] device token registration allowed';
  exception when insufficient_privilege then
    raise notice 'PASS M3-8b register_device_token revoked (OS push disabled)';
  end;
end $$;

rollback;
select '=== full_convergence_m3_verify: ALL PASS' as result;
