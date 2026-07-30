-- =============================================================================
-- scripts/verify/s2_4_comments_author_label_baseline_convergence_verify.sql
-- S2-4 MC (20260730095436_comments_author_label_baseline_convergence)
-- 전용 반복 검증 스크립트 — 읽기 전용 (fixture DML 0 · DDL 0)
-- =============================================================================
-- 실행 전제:
--   * 격리 로컬 PostgreSQL 17.6 스크래치 클러스터 전용. 운영·staging 반입 금지.
--   * local-only 가드 — 러너가 같은 세션에서 먼저 실행해야 한다:
--       set s2_verify.allow_local = 'on';
--     미설정 시 즉시 중단(42501). 실사용 규모 데이터 감지 시에도 중단한다
--     (public.comments > 1,000행 또는 auth.users > 50행 — 로컬 fixture 규모 밖).
--   * 이 검증기는 MC forward/rollback 「실행 직후」 상태를 판정한다. MC 파일
--     실행·오류 캡처·사전 스냅샷 캡처는 러너 소관이며, 아래 GUC 로 전달한다.
--   * phase 스위치(s2_verify.mc_phase — 필수):
--       post_s1   : 드리프트 fixture 에 MC forward(S1) 적용 직후
--       post_s2   : baseline 정본 형상에서 MC 재실행(S2 no-op) 직후
--       post_s3   : M13 적용 후 MC 재실행(S3 no-op) 직후
--       s4_reject : 타입 불일치(S4) fixture 에 MC 시도·실패 직후
--       s5_reject : S5 fixture 에 MC 시도·실패 직후
--                   (s2_verify.mc_subcase = nullable|bad_default|partial_m13)
--       rb_ok     : pre-M13·pre-state 부재 경로 MC rollback 성공 직후
--       rb_reject : rollback 하드게이트 거부 직후
--                   (s2_verify.mc_subcase = nondefault_row|author_role|m13_fn|
--                    m13_trg|m4_view|ledger|shape)
--       rb_noop   : 컬럼 부재 상태에서 rollback 재실행(no-op) 직후
--   * 사전 스냅샷 GUC(러너가 해당 조작 「직전」 캡처 — 표현식은 본문 §0 정본과
--     문자 그대로 동일해야 한다. 부재 시 해당 테스트 FAIL — 무음 약화 금지):
--       set s2_verify.mc_pre_cnt          = '<comments count>';
--       set s2_verify.mc_pre_nontarget_md5 = '<md5|EMPTY>';   -- 드리프트 9컬럼
--       set s2_verify.mc_pre_cols_md5     = '<md5|EMPTY>';    -- 전체 컬럼 형상
--       set s2_verify.mc_pre_data_md5     = '<md5|EMPTY>';    -- 전행 to_jsonb
--       set s2_verify.mc_pre_trg_md5      = '<md5|EMPTY>';
--       set s2_verify.mc_pre_pol_md5      = '<md5|EMPTY>';
--       set s2_verify.mc_pre_idx_md5      = '<md5|EMPTY>';
--       set s2_verify.mc_pre_m13_md5      = '<md5|EMPTY>';    -- post_s3 전용
--       set s2_verify.mc_err              = '<실패 캡처 stderr>'; -- reject 계열 전용
--       set s2_verify.mc_op_ok            = '0|1';            -- 조작 exit 상태
--   * 원격 드리프트에는 comments.updated_at 이 없다 — 본 검증기는 해당 컬럼의
--     존재를 가정하지 않는다(전행 비교는 to_jsonb 동적 캡처 사용).
-- 판정: mc_results 임시 테이블에 PASS/FAIL 기록·표 출력 후 FAIL ≥ 1 이면
--   S2_4_MC_VERIFY_FAILED 예외로 종료(트랜잭션 abort).
-- 근거: S2-3 계약 §11(S1~S5)·§12(rollback 하드게이트)·§13(멱등성) ·
--   S2-4 지시 §8·§9·§11.2 (MC-S1-01 ~ MC-RB-08).
-- =============================================================================
-- §0 스냅샷 md5 정본 표현식 (러너 캡처식과 문자 그대로 동일해야 한다)
--   [nontarget] select coalesce(md5(string_agg(concat_ws('|', id, post_id, author_id,
--                parent_id, content, like_count, is_deleted, created_at,
--                legacy_comment_id), '~' order by id)), 'EMPTY') from public.comments;
--   [cols] select coalesce(md5(string_agg(concat_ws('|', column_name, data_type,
--          is_nullable, coalesce(column_default, '<none>'), is_generated,
--          is_identity), '~' order by ordinal_position)), 'EMPTY')
--          from information_schema.columns
--          where table_schema = 'public' and table_name = 'comments';
--   [data] select coalesce(md5(string_agg(to_jsonb(c)::text, '~' order by c.id)),
--          'EMPTY') from public.comments c;
--   [trg]  select coalesce(md5(string_agg(pg_get_triggerdef(t.oid), '~'
--          order by t.tgname)), 'EMPTY') from pg_trigger t
--          where t.tgrelid = 'public.comments'::regclass and not t.tgisinternal;
--   [pol]  select coalesce(md5(string_agg(concat_ws('|', policyname, cmd,
--          coalesce(roles::text, '-'), coalesce(qual, '-'),
--          coalesce(with_check, '-')), '~' order by policyname)), 'EMPTY')
--          from pg_policies where schemaname = 'public' and tablename = 'comments';
--   [idx]  select coalesce(md5(string_agg(indexdef, '~' order by indexname)),
--          'EMPTY') from pg_indexes
--          where schemaname = 'public' and tablename = 'comments';
--   [m13]  select coalesce(md5(concat_ws('#',
--            (select string_agg(pg_get_functiondef(p.oid), '~' order by p.proname)
--               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--              where n.nspname = 'public' and p.proname in
--                ('comments_set_author_label', 'community_comments_set_author_label')),
--            (select string_agg(pg_get_triggerdef(t.oid), '~' order by t.tgname)
--               from pg_trigger t where not t.tgisinternal and t.tgname in
--                ('trg_comments_set_author_label_ins', 'trg_comments_set_author_label_upd',
--                 'trg_community_comments_set_author_label_ins',
--                 'trg_community_comments_set_author_label_upd')))), 'EMPTY');
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. local-only 가드 + phase 결정
-- -----------------------------------------------------------------------------
do $$
declare
  v_allow text := current_setting('s2_verify.allow_local', true);
  v_phase text := nullif(current_setting('s2_verify.mc_phase', true), '');
  v_cnt bigint;
begin
  if v_allow is distinct from 'on' then
    raise exception 'S2_VERIFY_LOCAL_GUARD: s2_verify.allow_local=on 이 설정되지 않았다. 이 스크립트는 격리 로컬 스택 전용이며 운영·staging 에서 실행을 금지한다.'
      using errcode = '42501';
  end if;
  if v_phase is null or v_phase not in
     ('post_s1', 'post_s2', 'post_s3', 's4_reject', 's5_reject', 'rb_ok', 'rb_reject', 'rb_noop') then
    raise exception 'S2_MC_VERIFY_PHASE: s2_verify.mc_phase 는 post_s1|post_s2|post_s3|s4_reject|s5_reject|rb_ok|rb_reject|rb_noop 이어야 한다 (현재 %)', coalesce(v_phase, '<unset>');
  end if;
  if to_regclass('public.comments') is null then
    raise exception 'S2_MC_VERIFY: public.comments 부재 — 검증 대상 환경이 아니다';
  end if;
  select count(*) into v_cnt from public.comments;
  if v_cnt > 1000 then
    raise exception 'S2_VERIFY_LOCAL_GUARD: comments % 행 — 실사용 규모 데이터가 감지되어 중단한다(로컬 fixture 아님).', v_cnt
      using errcode = '42501';
  end if;
  if to_regclass('auth.users') is not null then
    execute 'select count(*) from auth.users' into v_cnt;
    if v_cnt > 50 then
      raise exception 'S2_VERIFY_LOCAL_GUARD: auth.users % 행 — 실사용 규모 감지, 중단.', v_cnt
        using errcode = '42501';
    end if;
  end if;
end $$;

create temporary table mc_results (
  seq    serial primary key,
  grp    text not null,
  test   text not null,
  pass   boolean not null,
  detail text
);

-- -----------------------------------------------------------------------------
-- 1. 현재 상태 실측 → phase 별 판정
-- -----------------------------------------------------------------------------
do $$
declare
  v_phase   text := current_setting('s2_verify.mc_phase', true);
  v_sub     text := coalesce(nullif(current_setting('s2_verify.mc_subcase', true), ''), '-');
  g_pre_cnt text := nullif(current_setting('s2_verify.mc_pre_cnt', true), '');
  g_pre_nt  text := nullif(current_setting('s2_verify.mc_pre_nontarget_md5', true), '');
  g_pre_co  text := nullif(current_setting('s2_verify.mc_pre_cols_md5', true), '');
  g_pre_da  text := nullif(current_setting('s2_verify.mc_pre_data_md5', true), '');
  g_pre_tr  text := nullif(current_setting('s2_verify.mc_pre_trg_md5', true), '');
  g_pre_po  text := nullif(current_setting('s2_verify.mc_pre_pol_md5', true), '');
  g_pre_ix  text := nullif(current_setting('s2_verify.mc_pre_idx_md5', true), '');
  g_pre_m13 text := nullif(current_setting('s2_verify.mc_pre_m13_md5', true), '');
  g_err     text := coalesce(current_setting('s2_verify.mc_err', true), '');
  g_op_ok   text := coalesce(nullif(current_setting('s2_verify.mc_op_ok', true), ''), '<unset>');
  -- 현재 실측
  v_cnt     bigint;
  v_nt      text;
  v_cols    text;
  v_data    text;
  v_trg     text;
  v_pol     text;
  v_idx     text;
  v_m13     text;
  v_lbl_type text; v_lbl_null text; v_lbl_def text;
  v_lbl_ex  boolean; v_role_ex boolean; v_upd_ex boolean;
  v_catalog_same boolean;
  v_err_hit boolean;
begin
  select count(*) into v_cnt from public.comments;
  select coalesce(md5(string_agg(concat_ws('|', id, post_id, author_id, parent_id, content, like_count, is_deleted, created_at, legacy_comment_id), '~' order by id)), 'EMPTY')
    into v_nt from public.comments;
  select coalesce(md5(string_agg(concat_ws('|', column_name, data_type, is_nullable, coalesce(column_default, '<none>'), is_generated, is_identity), '~' order by ordinal_position)), 'EMPTY')
    into v_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'comments';
  select coalesce(md5(string_agg(to_jsonb(c)::text, '~' order by c.id)), 'EMPTY')
    into v_data from public.comments c;
  select coalesce(md5(string_agg(pg_get_triggerdef(t.oid), '~' order by t.tgname)), 'EMPTY')
    into v_trg from pg_trigger t
   where t.tgrelid = 'public.comments'::regclass and not t.tgisinternal;
  select coalesce(md5(string_agg(concat_ws('|', policyname, cmd, coalesce(roles::text, '-'), coalesce(qual, '-'), coalesce(with_check, '-')), '~' order by policyname)), 'EMPTY')
    into v_pol from pg_policies where schemaname = 'public' and tablename = 'comments';
  select coalesce(md5(string_agg(indexdef, '~' order by indexname)), 'EMPTY')
    into v_idx from pg_indexes where schemaname = 'public' and tablename = 'comments';
  select coalesce(md5(concat_ws('#',
           (select string_agg(pg_get_functiondef(p.oid), '~' order by p.proname)
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname in
               ('comments_set_author_label', 'community_comments_set_author_label')),
           (select string_agg(pg_get_triggerdef(t.oid), '~' order by t.tgname)
              from pg_trigger t where not t.tgisinternal and t.tgname in
               ('trg_comments_set_author_label_ins', 'trg_comments_set_author_label_upd',
                'trg_community_comments_set_author_label_ins',
                'trg_community_comments_set_author_label_upd')))), 'EMPTY')
    into v_m13;

  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'comments' and column_name = 'author_label')
    into v_lbl_ex;
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'comments' and column_name = 'author_role')
    into v_role_ex;
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'comments' and column_name = 'updated_at')
    into v_upd_ex;
  select data_type, is_nullable, column_default into v_lbl_type, v_lbl_null, v_lbl_def
    from information_schema.columns
   where table_schema = 'public' and table_name = 'comments' and column_name = 'author_label';

  v_catalog_same := (g_pre_co is not null and v_cols = g_pre_co)
                    and (g_pre_tr is not null and v_trg = g_pre_tr)
                    and (g_pre_po is not null and v_pol = g_pre_po)
                    and (g_pre_ix is not null and v_idx = g_pre_ix)
                    and (g_pre_da is not null and v_data = g_pre_da);
  v_err_hit := position('BATCH_B_BASELINE_OBJECT_MISMATCH' in g_err) > 0;

  -- ---------------------------------------------------------------------------
  if v_phase = 'post_s1' then
    insert into mc_results(grp, test, pass, detail) values
      ('MC-S1', '01 컬럼 부재 상태에서 정확한 컬럼 추가',
       v_lbl_ex and v_lbl_type = 'text' and v_lbl_null = 'NO'
         and v_lbl_def = '''쌤버십 회원''::text' and not v_role_ex and not v_upd_ex,
       'type=' || coalesce(v_lbl_type, '<none>') || ' null=' || coalesce(v_lbl_null, '-')
         || ' def=' || coalesce(v_lbl_def, '<none>') || ' role=' || v_role_ex || ' upd=' || v_upd_ex),
      ('MC-S1', '02 기존 행 수 불변',
       g_pre_cnt is not null and v_cnt = g_pre_cnt::bigint,
       'rows ' || coalesce(g_pre_cnt, '<unset>') || '→' || v_cnt),
      ('MC-S1', '03 비대상 컬럼 hash 불변',
       g_pre_nt is not null and v_nt = g_pre_nt,
       case when g_pre_nt is null then 'GUC 미제공' when v_nt = g_pre_nt then 'same' else 'DIFF' end),
      ('MC-S1', '04 트리거·정책·인덱스 불변',
       g_pre_tr is not null and v_trg = g_pre_tr
         and g_pre_po is not null and v_pol = g_pre_po
         and g_pre_ix is not null and v_idx = g_pre_ix,
       'trg=' || case when v_trg = g_pre_tr then 'same' else 'DIFF' end
         || ' pol=' || case when v_pol = g_pre_po then 'same' else 'DIFF' end
         || ' idx=' || case when v_idx = g_pre_ix then 'same' else 'DIFF' end);

  -- ---------------------------------------------------------------------------
  elsif v_phase = 'post_s2' then
    insert into mc_results(grp, test, pass, detail) values
      ('MC-S2', '01 baseline 정본 형상 재실행 no-op (형상 유지 + 실행 성공)',
       g_op_ok = '1' and v_lbl_ex and v_lbl_type = 'text' and v_lbl_null = 'NO'
         and v_lbl_def = '''쌤버십 회원''::text' and not v_role_ex,
       'op_ok=' || g_op_ok || ' def=' || coalesce(v_lbl_def, '<none>') || ' role=' || v_role_ex),
      ('MC-S2', '02 catalog·data 불변',
       v_catalog_same,
       'cols=' || case when v_cols = g_pre_co then 'same' else 'DIFF' end
         || ' data=' || case when v_data = g_pre_da then 'same' else 'DIFF' end
         || ' trg/pol/idx=' || case when v_trg = g_pre_tr and v_pol = g_pre_po and v_idx = g_pre_ix then 'same' else 'DIFF' end);

  -- ---------------------------------------------------------------------------
  elsif v_phase = 'post_s3' then
    insert into mc_results(grp, test, pass, detail) values
      ('MC-S3', '01 M13 적용 후 재실행 no-op (catalog·data 불변 + 실행 성공)',
       g_op_ok = '1' and v_catalog_same,
       'op_ok=' || g_op_ok || ' cols=' || case when v_cols = g_pre_co then 'same' else 'DIFF' end
         || ' data=' || case when v_data = g_pre_da then 'same' else 'DIFF' end),
      ('MC-S3', '02 default ''쌤버십 사용자'' 유지',
       v_lbl_def = '''쌤버십 사용자''::text' and v_lbl_null = 'NO' and v_lbl_type = 'text',
       'def=' || coalesce(v_lbl_def, '<none>')),
      ('MC-S3', '03 author_role 및 M13 객체 불변',
       v_role_ex and g_pre_m13 is not null and v_m13 = g_pre_m13 and v_m13 <> 'EMPTY',
       'role=' || v_role_ex || ' m13=' || case when v_m13 = g_pre_m13 then 'same' else coalesce('DIFF', '-') end);

  -- ---------------------------------------------------------------------------
  elsif v_phase = 's4_reject' then
    insert into mc_results(grp, test, pass, detail) values
      ('MC-S4', '01 잘못된 타입 거부 (BATCH_B_BASELINE_OBJECT_MISMATCH)',
       g_op_ok = '0' and v_err_hit,
       'op_ok=' || g_op_ok || ' err=' || left(g_err, 120)),
      ('MC-S4', '02 실패 후 수정 0건',
       v_catalog_same,
       'cols=' || case when v_cols = g_pre_co then 'same' else 'DIFF' end
         || ' data=' || case when v_data = g_pre_da then 'same' else 'DIFF' end);

  -- ---------------------------------------------------------------------------
  elsif v_phase = 's5_reject' then
    if v_sub not in ('nullable', 'bad_default', 'partial_m13') then
      raise exception 'S2_MC_VERIFY_PHASE: s5_reject 는 mc_subcase = nullable|bad_default|partial_m13 필요 (현재 %)', v_sub;
    end if;
    insert into mc_results(grp, test, pass, detail) values
      ('MC-S5', case v_sub when 'nullable' then '01 nullable 형상 거부'
                           when 'bad_default' then '02 예상 밖 default 거부'
                           else '03 부분 M13 형상 거부' end,
       g_op_ok = '0' and v_err_hit,
       'subcase=' || v_sub || ' op_ok=' || g_op_ok || ' err=' || left(g_err, 120)),
      ('MC-S5', '04 실패 후 수정 0건 (' || v_sub || ')',
       v_catalog_same,
       'cols=' || case when v_cols = g_pre_co then 'same' else 'DIFF' end
         || ' data=' || case when v_data = g_pre_da then 'same' else 'DIFF' end);

  -- ---------------------------------------------------------------------------
  elsif v_phase = 'rb_ok' then
    insert into mc_results(grp, test, pass, detail) values
      ('MC-RB', '01 pre-M13·pre-state absent 경로 rollback 성공',
       g_op_ok = '1' and not v_lbl_ex,
       'op_ok=' || g_op_ok || ' label_present=' || v_lbl_ex),
      ('MC-RB', '02 rollback 후 원래 컬럼 부재 상태 복원 (catalog·data 왕복 일치)',
       not v_lbl_ex and v_catalog_same,
       'cols=' || case when v_cols = g_pre_co then 'same' else 'DIFF' end
         || ' data=' || case when v_data = g_pre_da then 'same' else 'DIFF' end
         || ' trg/pol/idx=' || case when v_trg = g_pre_tr and v_pol = g_pre_po and v_idx = g_pre_ix then 'same' else 'DIFF' end);

  -- ---------------------------------------------------------------------------
  elsif v_phase = 'rb_reject' then
    if v_sub not in ('nondefault_row', 'author_role', 'm13_fn', 'm13_trg', 'm4_view', 'ledger', 'shape') then
      raise exception 'S2_MC_VERIFY_PHASE: rb_reject 는 mc_subcase = nondefault_row|author_role|m13_fn|m13_trg|m4_view|ledger|shape 필요 (현재 %)', v_sub;
    end if;
    insert into mc_results(grp, test, pass, detail) values
      ('MC-RB', case v_sub
                  when 'nondefault_row' then '03 비default 라벨 행 존재 시 rollback 거부'
                  when 'author_role'    then '04 author_role 존재 시 rollback 거부'
                  when 'm13_fn'         then '05 M13 함수 존재 시 rollback 거부'
                  when 'm13_trg'        then '05b M13 트리거 존재 시 rollback 거부'
                  when 'm4_view'        then '06 M4 View 존재 시 rollback 거부'
                  when 'ledger'         then '07 M13 ledger 이력 존재 시 rollback 거부'
                  else                       '03b 형상 불일치(nullable/default) rollback 거부' end,
       g_op_ok = '0' and v_err_hit
         and (v_sub <> 'ledger' or position('M13_APPLIED_FORWARD_FIX_ONLY' in g_err) > 0),
       'subcase=' || v_sub || ' op_ok=' || g_op_ok || ' err=' || left(g_err, 120)),
      ('MC-RB', 'RJ 실패 후 수정 0건 (' || v_sub || ')',
       v_catalog_same and v_lbl_ex,
       'label=' || v_lbl_ex || ' cols=' || case when v_cols = g_pre_co then 'same' else 'DIFF' end
         || ' data=' || case when v_data = g_pre_da then 'same' else 'DIFF' end);

  -- ---------------------------------------------------------------------------
  elsif v_phase = 'rb_noop' then
    insert into mc_results(grp, test, pass, detail) values
      ('MC-RB', '08 이미 컬럼 부재 상태에서 재실행 no-op',
       g_op_ok = '1' and not v_lbl_ex and v_catalog_same,
       'op_ok=' || g_op_ok || ' label_present=' || v_lbl_ex
         || ' cols=' || case when v_cols = g_pre_co then 'same' else 'DIFF' end
         || ' data=' || case when v_data = g_pre_da then 'same' else 'DIFF' end);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. 결과 출력 + 판정
-- -----------------------------------------------------------------------------
select grp, test, case when pass then 'PASS' else 'FAIL' end as verdict, detail
  from mc_results order by seq;

select count(*) filter (where pass) || '/' || count(*) as passed from mc_results;

do $$
declare
  v_fail int;
  v_phase text := current_setting('s2_verify.mc_phase', true);
begin
  select count(*) into v_fail from mc_results where not pass;
  if v_fail > 0 then
    raise exception 'S2_4_MC_VERIFY_FAILED: phase=% FAIL %건 — 위 표를 확인하라', v_phase, v_fail;
  end if;
  raise notice 'S2_4_MC_VERIFY: ALL PASS (phase=%)', v_phase;
end $$;

rollback;
