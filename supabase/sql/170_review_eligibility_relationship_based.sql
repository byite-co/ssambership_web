-- 170_review_eligibility_relationship_based.sql
-- 리뷰 자격 기준을 **결제 횟수(기준 A)** 에서 **관계 상태(기준 B + C)** 로 전환한다.
-- 오너 확정 1 (웨이브 2). 066 의 check_review_eligibility(uuid,uuid) 를 CREATE OR REPLACE 로 대체.
--
-- ⚠️ 시그니처·이름 불변(변경 금지):
--   126_reviews_rls_hardening.sql:57 의 INSERT 정책 reviews_insert_student 가
--     check_review_eligibility(mentor_id, (select auth.uid()))
--   로 **멘토를 첫 인자**로 넘긴다. 045:8-10 · 061:7-9 · 066:26-28 전부 동일하게
--   (p_mentor_id, p_student_id) 순서다. 인자 순서를 뒤집으면 INSERT 정책이 조용히
--   전건 false 가 되어 리뷰 작성이 전면 차단된다. 순서를 바꾸지 말 것.
--
-- ── 자격 기준 (둘 중 하나라도 성립하면 자격 있음) ──────────────────────────────
--   (B) 구독 관계: subscriptions.status ∈ {active, expired, cancel_scheduled}
--   (C) 완료된 개별질문: individual_questions.status ∈ {answered, released}
--       멘토 식별 = coalesce(claimed_mentor_id, designated_mentor_id)
--
-- ── 제외(문면 명시) ────────────────────────────────────────────────────────────
--   구독: pending(시작 전) · past_due(hold) · canceled · refunded
--   IQ  : escrowed · assigned · open · claimed · expired · refunded · canceled (나머지 7종)
--
--   "결제 실패 제외"는 별도 조건으로 남기지 않는다. 기준이 **결제 횟수에서 관계 상태로**
--   바뀌면서 상태 매핑에 자연 흡수되기 때문이다 — 결제가 실패하면 구독은 애초에
--   active/expired/cancel_scheduled 로 진입하지 못하고 pending·past_due 에 머무르며,
--   환불된 건은 refunded 로 빠진다. 즉 제외 대상은 상태 집합의 여집합으로 이미 닫혀 있다.
--
-- ── 실 enum 고정 (staging 실측 CHECK 제약 · 2026-07-25) ────────────────────────
--   subscriptions_status_check:
--     pending · active · past_due · cancel_scheduled · canceled · expired · refunded (7종)
--   individual_questions_status_check:
--     escrowed · assigned · open · claimed · answered · released · expired · refunded · canceled (9종)
--   ⚠️ 'confirmed' · 'completed' 는 **두 테이블 어디에도 없다**. 사용하면 영구 매칭 0 이다.
--
-- ── 폐기되는 구 로직 (066) ────────────────────────────────────────────────────
--   subscription_billing_events 2건 집계 → cash_ledger 폴백 → payments 폴백의
--   3경로 카운팅을 전부 제거한다. 관계 상태만으로 판정하므로 집계 경로가 필요 없고,
--   집계 실패(일시적 DB 오류)가 자격 박탈로 이어지던 취약점도 함께 사라진다.
--
-- 관례 계승(066 동일): plpgsql · stable · security definer · search_path=public ·
--   revoke all from public, anon · grant execute to authenticated.
--
-- 선행: 064, 066, 126(이 함수를 참조하는 INSERT 정책). 후속: 171(작성자 수정 경로).

create or replace function public.check_review_eligibility(
  p_mentor_id uuid,
  p_student_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_mentor_id is null or p_student_id is null then
    return false;
  end if;

  -- (B) 구독 관계 — 시작된 적이 있고 환불·취소로 무효화되지 않은 상태
  if exists (
    select 1
    from public.subscriptions s
    where s.student_id = p_student_id
      and s.mentor_id = p_mentor_id
      and s.status in ('active', 'expired', 'cancel_scheduled')
  ) then
    return true;
  end if;

  -- (C) 완료된 개별질문 — 멘토 식별은 claim 우선, 없으면 지정 멘토
  if exists (
    select 1
    from public.individual_questions q
    where q.student_id = p_student_id
      and coalesce(q.claimed_mentor_id, q.designated_mentor_id) = p_mentor_id
      and q.status in ('answered', 'released')
  ) then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.check_review_eligibility(uuid, uuid) from public, anon;
grant execute on function public.check_review_eligibility(uuid, uuid) to authenticated;

comment on function public.check_review_eligibility(uuid, uuid) is
  'Review eligibility (relationship-based, wave2 owner decision 1): eligible when the pair has a subscription in {active, expired, cancel_scheduled} OR a completed individual question in {answered, released} (mentor = coalesce(claimed_mentor_id, designated_mentor_id)). Replaces the legacy 2-paid-events counting rule. Argument order (p_mentor_id, p_student_id) is fixed by 126 reviews_insert_student.';

-- ── §V 검증 SELECT (적용 후 별도 실행) ──
-- 자격 쌍 수 판정 쿼리(적용 전후 동일 쿼리로 비교):
-- select count(*) as eligible_pairs
-- from (
--   select distinct student_id, mentor_id from (
--     select s.student_id, s.mentor_id from public.subscriptions s
--     union
--     select q.student_id, coalesce(q.claimed_mentor_id, q.designated_mentor_id)
--       from public.individual_questions q
--      where coalesce(q.claimed_mentor_id, q.designated_mentor_id) is not null
--   ) p
-- ) pairs
-- where public.check_review_eligibility(pairs.mentor_id, pairs.student_id);
-- 기대: 적용 전 0 → 적용 후 1 (staging 2026-07-25 기준)
--
-- ── ROLLBACK 절차 ──
-- 066_review_eligibility_billing_events.sql 을 그대로 재적용하면 구 기준으로 복귀한다
-- (같은 시그니처의 create or replace 이므로 무손실).
-- 주의: 171 이 적용된 상태에서 170 만 되돌려도 트리거·정책은 계속 동작한다
--   (171 은 이 함수를 호출하지 않는다 — 수정 시 자격 재검사를 하지 않는 것이 정본이다).
--   전체 롤백 순서는 171 → 170 → 169 → 168 → 167.
