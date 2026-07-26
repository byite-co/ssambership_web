-- mentor_school_verification_approval_174_fixture.sql
-- SQL 174 계약 검증 — rollback-only. 판정 DO 블록이 성공 시에도 예외를 던져
-- 트랜잭션을 강제 abort 시킨다(잔여 0 보증). 결과는 예외 메시지로 회수한다.
--
-- 실행: 174 적용 후 이 스크립트 전문을 단일 트랜잭션으로 실행.
-- fixture 사용자/객체/행은 전부 이 트랜잭션 안에서만 존재한다.

begin;
set local lock_timeout = '5s';

-- ── fixture: auth 사용자 3명(관리자·멘토A·학생) ──
-- public.users 는 on_auth_user_created 트리거가 자동 생성하므로 upsert 로 보정한다.
insert into auth.users (id, email)
values
  ('a0000000-0000-4000-8000-000000000001', 'w4a-admin@fixture.local'),
  ('b0000000-0000-4000-8000-000000000002', 'w4a-mentor@fixture.local'),
  ('c0000000-0000-4000-8000-000000000003', 'w4a-student@fixture.local')
on conflict (id) do nothing;

insert into public.users (id, role)
values
  ('a0000000-0000-4000-8000-000000000001', 'admin'),
  ('b0000000-0000-4000-8000-000000000002', 'mentor'),
  ('c0000000-0000-4000-8000-000000000003', 'student')
on conflict (id) do update set role = excluded.role;

-- ── fixture: 멘토 소유 Storage 객체 1건(실재 확인 대상) ──
insert into storage.objects (id, bucket_id, name, owner_id)
values (
  'd0000000-0000-4000-8000-000000000004',
  'student-id-images',
  'b0000000-0000-4000-8000-000000000002/school-verifications/1784560000000-deadbeef.png',
  'b0000000-0000-4000-8000-000000000002'
);

-- ── fixture: 인증 요청 행들 ──
-- V1 정상(객체 실재) · V2 서류 ref NULL · V3 객체 부재 · V4 재승인용 정상 · V5 타인 소유 경로
insert into public.mentor_school_verifications (id, mentor_id, status, document_storage_ref)
values
  ('e0000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000002', 'pending',
   'student-id-images/b0000000-0000-4000-8000-000000000002/school-verifications/1784560000000-deadbeef.png'),
  ('e0000000-0000-4000-8000-000000000012', 'b0000000-0000-4000-8000-000000000002', 'pending', null),
  ('e0000000-0000-4000-8000-000000000013', 'b0000000-0000-4000-8000-000000000002', 'pending',
   'student-id-images/b0000000-0000-4000-8000-000000000002/school-verifications/9999999999999-nosuchfile.png'),
  ('e0000000-0000-4000-8000-000000000014', 'b0000000-0000-4000-8000-000000000002', 'pending',
   'student-id-images/b0000000-0000-4000-8000-000000000002/school-verifications/1784560000000-deadbeef.png'),
  ('e0000000-0000-4000-8000-000000000015', 'b0000000-0000-4000-8000-000000000002', 'pending',
   'student-id-images/c0000000-0000-4000-8000-000000000003/school-verifications/1784560000000-deadbeef.png');

do $fixture$
declare
  r   text := '';
  ok  boolean;
  v   jsonb;
  st  text;
  cnt integer;
  sqlst text;
  msg text;

  c_admin   constant text := 'a0000000-0000-4000-8000-000000000001';
  c_mentor  constant text := 'b0000000-0000-4000-8000-000000000002';
  c_student constant text := 'c0000000-0000-4000-8000-000000000003';
  c_v1 constant uuid := 'e0000000-0000-4000-8000-000000000011';
  c_v2 constant uuid := 'e0000000-0000-4000-8000-000000000012';
  c_v3 constant uuid := 'e0000000-0000-4000-8000-000000000013';
  c_v4 constant uuid := 'e0000000-0000-4000-8000-000000000014';
  c_v5 constant uuid := 'e0000000-0000-4000-8000-000000000015';
begin
  -- ===== T0. 헬퍼 파싱 규칙(웹 parseStudentIdImageStorageRef 동치) =====
  r := r || format('T0a bucket-prefix=%s; ',
    coalesce(public.mentor_school_verification_storage_path('student-id-images/u/f.png'), '<null>'));
  r := r || format('T0b absolute-url=%s; ',
    coalesce(public.mentor_school_verification_storage_path('https://x.supabase.co/storage/v1/object/student-id-images/u/f.png?token=zz'), '<null>'));
  r := r || format('T0c bare-path=%s; ',
    coalesce(public.mentor_school_verification_storage_path('u/f.png'), '<null>'));
  r := r || format('T0d single-token=%s; ',
    coalesce(public.mentor_school_verification_storage_path('nofilepath'), '<null>'));
  r := r || format('T0e empty=%s; ',
    coalesce(public.mentor_school_verification_storage_path('   '), '<null>'));

  -- ===== T6. 비관리자 거부 (mentor / student / anon) =====
  perform set_config('request.jwt.claim.sub', c_mentor, true);
  begin
    v := public.approve_mentor_school_verification_admin(c_v1, 'A대', 'a-dae', '수학교육과', '교육', '서연고');
    r := r || 'T6-mentor=UNEXPECTED_SUCCESS; ';
  exception when others then
    get stacked diagnostics sqlst = returned_sqlstate, msg = message_text;
    r := r || format('T6-mentor=REJECTED(%s/%s); ', sqlst, msg);
  end;

  perform set_config('request.jwt.claim.sub', c_student, true);
  begin
    v := public.approve_mentor_school_verification_admin(c_v1, 'A대', 'a-dae', '수학교육과', '교육', '서연고');
    r := r || 'T6-student=UNEXPECTED_SUCCESS; ';
  exception when others then
    get stacked diagnostics sqlst = returned_sqlstate, msg = message_text;
    r := r || format('T6-student=REJECTED(%s/%s); ', sqlst, msg);
  end;

  perform set_config('request.jwt.claim.sub', '', true);
  begin
    v := public.approve_mentor_school_verification_admin(c_v1, 'A대', 'a-dae', '수학교육과', '교육', '서연고');
    r := r || 'T6-anon=UNEXPECTED_SUCCESS; ';
  exception when others then
    get stacked diagnostics sqlst = returned_sqlstate, msg = message_text;
    r := r || format('T6-anon=REJECTED(%s/%s); ', sqlst, msg);
  end;

  -- 비관리자 시도 뒤 승인 0건이어야 한다.
  select count(*) into cnt from public.mentor_school_verifications where status = 'approved';
  r := r || format('T6-approved_after_nonadmin=%s; ', cnt);

  -- ===== 이후는 관리자 세션 =====
  perform set_config('request.jwt.claim.sub', c_admin, true);

  -- ===== T1. 서류 ref 없음 → 거부 =====
  begin
    v := public.approve_mentor_school_verification_admin(c_v2, 'A대', 'a-dae', '수학교육과', '교육', '서연고');
    r := r || 'T1=UNEXPECTED_SUCCESS; ';
  exception when others then
    get stacked diagnostics sqlst = returned_sqlstate, msg = message_text;
    r := r || format('T1=REJECTED(%s/%s); ', sqlst, msg);
  end;

  -- ===== T2. storage 객체 부재 → 거부 =====
  begin
    v := public.approve_mentor_school_verification_admin(c_v3, 'A대', 'a-dae', '수학교육과', '교육', '서연고');
    r := r || 'T2=UNEXPECTED_SUCCESS; ';
  exception when others then
    get stacked diagnostics sqlst = returned_sqlstate, msg = message_text;
    r := r || format('T2=REJECTED(%s/%s); ', sqlst, msg);
  end;

  -- ===== T8. 타인 소유 경로 → 거부 =====
  begin
    v := public.approve_mentor_school_verification_admin(c_v5, 'A대', 'a-dae', '수학교육과', '교육', '서연고');
    r := r || 'T8=UNEXPECTED_SUCCESS; ';
  exception when others then
    get stacked diagnostics sqlst = returned_sqlstate, msg = message_text;
    r := r || format('T8=REJECTED(%s/%s); ', sqlst, msg);
  end;

  -- 거부 3종 뒤에도 승인 0 · 대상 행 상태 무변동(부분 반영 없음)
  select count(*) into cnt from public.mentor_school_verifications where status <> 'pending';
  r := r || format('T7-nonpending_after_rejects=%s; ', cnt);

  -- ===== T3. 정상 신규 승인 =====
  v := public.approve_mentor_school_verification_admin(c_v1, 'A대', 'a-dae', '수학교육과', '교육', '서연고');
  select status into st from public.mentor_school_verifications where id = c_v1;
  r := r || format('T3=ok(status=%s,superseded=%s,reviewed_by_set=%s); ',
        st, v->>'superseded_count',
        (select reviewed_by is not null from public.mentor_school_verifications where id = c_v1));

  -- ===== T4. 재승인 → 이전 approved 종료 + 신규 approved =====
  v := public.approve_mentor_school_verification_admin(c_v4, 'B대', 'b-dae', '물리학과', '자연', '서성한');
  r := r || format('T4=ok(v1=%s,v4=%s,superseded_count=%s); ',
        (select status from public.mentor_school_verifications where id = c_v1),
        (select status from public.mentor_school_verifications where id = c_v4),
        v->>'superseded_count');

  -- ===== T5. 멘토별 approved 2건 불가(부분 UNIQUE 인덱스) =====
  begin
    update public.mentor_school_verifications set status = 'approved' where id = c_v1;
    r := r || 'T5=UNEXPECTED_SUCCESS; ';
  exception when others then
    get stacked diagnostics sqlst = returned_sqlstate, msg = message_text;
    r := r || format('T5=REJECTED(%s); ', sqlst);
  end;

  -- ===== T9. 이미 approved 인 행 재승인 시도 → NOT_REVIEWABLE =====
  begin
    v := public.approve_mentor_school_verification_admin(c_v4, 'C대', 'c-dae', '화학과', '자연', '중경외시');
    r := r || 'T9=UNEXPECTED_SUCCESS; ';
  exception when others then
    get stacked diagnostics sqlst = returned_sqlstate, msg = message_text;
    r := r || format('T9=REJECTED(%s/%s); ', sqlst, msg);
  end;

  -- ===== 최종 불변식 =====
  select count(*) into cnt from public.mentor_school_verifications where status = 'approved';
  r := r || format('FINAL-approved_total=%s; ', cnt);
  select count(*) into cnt from public.mentor_school_verifications where status = 'superseded';
  r := r || format('FINAL-superseded_total=%s; ', cnt);

  -- 성공/실패와 무관하게 트랜잭션을 abort 시켜 fixture 잔여 0 을 보증한다.
  raise exception 'SQL174_FIXTURE_RESULT :: %', r;
end
$fixture$;

rollback;
