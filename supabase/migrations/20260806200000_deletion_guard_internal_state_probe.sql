-- [S1-1 2026-08-06] QA-A1 — 개별질문 정산 지급 불가(403) 해소.
--
-- 증상: 학생이 '해결 완료(멘토에게 정산)'를 누르면 POST /rpc/release_individual_question
--       이 403 으로 실패하고 DB 오류 ACCOUNT_DELETION_PROBE_FORBIDDEN 이 남는다.
--       실기기 QA 2026-08-06 에서 3회 전부 재현, 묶인 금액 5,999원.
--
-- 원인: public.account_deletion_write_blocked(p_user_id) 가 두 책임을 겸직한다.
--   ① 앱용 self-probe 제한 — auth.uid() 와 다른 id 를 물으면 42501 로 거부
--      (타인의 탈퇴 진행 여부를 캐내는 오라클 방지)
--   ② 실제 상태 조회 — 그 사용자의 탈퇴 잡이 진행 중인가
--   트리거 가드 public.account_deletion_write_guard() 는 ② 만 필요한데,
--   NEW 행의 소유자 id(= 지급 대상 멘토)를 넘기므로 학생 세션에서는 ① 에 걸린다.
--   → cash_ledger INSERT(멘토 앞)와 cash_wallets UPDATE(멘토 잔액)가 모두 42501,
--     PostgREST 403, 트랜잭션 전체 롤백. **멘토에게 돈이 가는 모든 경로가 막힌다.**
--   그동안 안 터진 이유: 돈 이동이 전부 본인 계좌였고(충전 +, 구독 결제 −,
--   에스크로 보관 −) 타인 계좌 입금이 이번이 처음이다.
--
-- 수정: ② 전용 내부 함수를 분리하고 트리거 가드만 그쪽을 보게 한다.
--   - 앱 계약인 account_deletion_write_blocked 는 **시그니처·동작·권한 모두 불변**
--     (앱 부팅 프로필 로드가 이 RPC 를 쓴다 — 지도 A1-R9). 다른 호출부 16곳도
--     전부 본인 id 를 넘기는 self-check 라 영향 없음.
--   - 새 내부 함수는 아무에게도 EXECUTE 를 주지 않는다(REVOKE ALL). 트리거
--     함수가 SECURITY DEFINER 로 소유자 권한에서 호출하므로 grant 가 불필요하고,
--     grant 를 주면 ① 이 막던 '타인 탈퇴상태 조회 오라클'이 되살아난다.
--
-- 보존되는 보호: 대상 사용자의 탈퇴가 진행 중이면 종전대로
--   ACCOUNT_DELETION_IN_PROGRESS 로 차단된다(가드 6개 트리거 전부 동일).
--   탈퇴 워커의 우회(ssambership.deletion_worker='on')도 그대로다.

-- ── ② 전용: probe 제한 없는 상태 조회(내부 전용) ───────────────────────────
create or replace function public.account_deletion_state_blocked(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
      from public.account_deletion_jobs j
     where j.user_id = p_user_id
       and j.state in ('locked', 'purging', 'storage_purged', 'finalized', 'auth_soft_deleted')
  );
$function$;

comment on function public.account_deletion_state_blocked(uuid) is
  '내부 전용(트리거 가드) — 탈퇴 진행 여부만 반환한다. auth.uid() probe 제한이 '
  '없으므로 어떤 role 에도 EXECUTE 를 주지 않는다. 앱·웹은 반드시 '
  'account_deletion_write_blocked(자기 id 전용)를 쓴다.';

revoke all on function public.account_deletion_state_blocked(uuid) from public;
revoke all on function public.account_deletion_state_blocked(uuid) from anon;
revoke all on function public.account_deletion_state_blocked(uuid) from authenticated;

-- ── 트리거 가드: 내부 함수를 보도록 교체(그 외 동작 불변) ──────────────────
create or replace function public.account_deletion_write_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_col text := TG_ARGV[0]; v_uid uuid;
begin
  if current_setting('ssambership.deletion_worker', true) = 'on' then
    return NEW;
  end if;
  v_uid := (to_jsonb(NEW) ->> v_col)::uuid;
  -- ★ account_deletion_write_blocked 가 아니라 내부 상태 함수를 쓴다.
  --   행 소유자가 세션 사용자와 다른 정당한 쓰기(멘토 정산 입금 등)를
  --   self-probe 제한이 막아버리던 회귀를 해소한다.
  if v_uid is not null and public.account_deletion_state_blocked(v_uid) then
    raise exception 'ACCOUNT_DELETION_IN_PROGRESS';
  end if;
  return NEW;
end $function$;

-- ── 가드 트리거를 BEFORE → AFTER 로 옮긴다(탈퇴상태 오라클 차단) ────────────
--
-- 왜 필요한가: 위에서 self-probe 제한을 뺐기 때문에 가드는 이제 **남의 id** 에
--   대해서도 탈퇴 상태를 판정한다. 그런데 BEFORE 트리거는 RLS WITH CHECK 보다
--   먼저 실행된다. 그래서 공격자가 소유자 컬럼에 임의의 uuid 를 넣고 INSERT 를
--   시도하면, 원래 RLS 가 42501 로 끝냈을 요청이
--     · 그 사용자가 탈퇴 진행 중 → P0001 ACCOUNT_DELETION_IN_PROGRESS
--     · 아니면                   → 42501 (RLS 거부)
--   로 갈라져 **임의 uuid 의 탈퇴 진행 여부를 알아내는 오라클**이 된다.
--   수정 전에는 self-probe 제한이 두 경우를 모두 42501 로 만들어 구분이 없었다.
--   (authenticated 가 INSERT 를 시도할 수 있는 payments · question_messages ·
--    shortform_posts 3개 테이블에서 실제로 재현된다.)
--
-- 어떻게 막는가: AFTER ROW 트리거는 RLS WITH CHECK 통과 **이후**에만 실행된다.
--   권한 없는 시도는 가드에 닿기 전에 42501 로 끝나 상태가 새지 않는다.
--   권한 있는 정당한 쓰기(멘토 정산 입금 등)는 종전대로 가드가 판정해
--   ACCOUNT_DELETION_IN_PROGRESS 로 막는다 — 보호 강도는 그대로다.
--
-- 안전성: 가드는 NEW 를 읽기만 하고 고치지 않으므로 BEFORE 일 이유가 없다
--   (AFTER 에서 반환값은 무시되지만 이 함수는 행을 바꾸지 않는다). 예외가 나면
--   문 전체가 롤백되므로 잠깐 들어갔다 사라지는 행도 남지 않는다.
--   워커 우회(ssambership.deletion_worker='on')와 대상 컬럼 인자(TG_ARGV[0])는 불변.
--
-- 멱등: 각 트리거를 drop if exists 후 재생성한다.

drop trigger if exists adg_cash_wallets on public.cash_wallets;
create trigger adg_cash_wallets after insert or update on public.cash_wallets
  for each row execute function public.account_deletion_write_guard('user_id');

drop trigger if exists adg_cash_ledger on public.cash_ledger;
create trigger adg_cash_ledger after insert on public.cash_ledger
  for each row execute function public.account_deletion_write_guard('user_id');

drop trigger if exists adg_payments on public.payments;
create trigger adg_payments after insert on public.payments
  for each row execute function public.account_deletion_write_guard('user_id');

drop trigger if exists adg_question_messages on public.question_messages;
create trigger adg_question_messages after insert on public.question_messages
  for each row execute function public.account_deletion_write_guard('author_id');

drop trigger if exists adg_community_posts on public.community_posts;
create trigger adg_community_posts after insert on public.community_posts
  for each row execute function public.account_deletion_write_guard('author_id');

drop trigger if exists adg_shortform_posts on public.shortform_posts;
create trigger adg_shortform_posts after insert on public.shortform_posts
  for each row execute function public.account_deletion_write_guard('author_id');
