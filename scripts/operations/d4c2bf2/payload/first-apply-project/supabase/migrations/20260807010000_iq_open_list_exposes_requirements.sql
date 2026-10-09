-- [S3-1 2026-08-07] QA-B6 — 공개형 대기 목록에 요구 조건이 보이지 않는다.
--
-- 증상: 멘토가 공개형 대기 질문을 "조건을 못 본 채" 수락해야 한다.
--       과목·요구 학교·요구 계열이 화면 어디에도 없다(웹은 정상 표시).
--
-- 원인 분해: QA 는 앱 결함으로 봤고 실제로 앱 모델에 필드가 없는 것도 맞다.
--   다만 그것만 고쳐도 **대기 목록은 여전히 못 본다** —
--   list_open_individual_questions_for_mentor 의 반환 계약이
--   (id, subject, topic, title, price_cents, expires_at, created_at) 7종이라
--   required_school_tier·required_major_category 가 애초에 내려오지 않는다.
--   앱은 없는 값을 그릴 수 없다. 그래서 서버·앱을 같이 고친다.
--
-- 노출 판단: 이 두 값은 **학생이 "누가 답변할 수 있는지"를 정한 조건**이다.
--   대상 멘토에게 보여주는 것이 이 값의 존재 이유이며, 학생 개인정보가 아니다.
--   이 RPC 의 위생 규칙(본문·학생 식별자 미노출)은 그대로다 — 두 조건 컬럼만 더한다.
--   웹은 이미 같은 값을 멘토에게 보여주고 있다(표시 계약 일치).
--
-- 그 외 동작(승인 멘토 게이트 · 담당 과목 필터 · 정렬 · limit 클램프)은 불변.
-- 반환 컬럼이 늘어나므로 create or replace 로는 바꿀 수 없다(42P13) — drop 후 재생성한다.
-- 멱등: drop if exists.

drop function if exists public.list_open_individual_questions_for_mentor(integer);

create function public.list_open_individual_questions_for_mentor(p_limit integer default 50)
returns table(
  id uuid,
  subject text,
  topic text,
  title text,
  price_cents integer,
  expires_at timestamp with time zone,
  created_at timestamp with time zone,
  required_school_tier text,
  required_major_category text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_subjects text[];
begin
  if not public.individual_question_user_is_approved_mentor((select auth.uid())) then
    return;
  end if;

  -- 멘토 담당 과목(teaching_subjects)만 노출. 과목 없는(null) 질문은 일반 질문으로 모두에게 노출.
  select mp.teaching_subjects into v_subjects
  from public.mentor_profiles mp
  where mp.user_id = (select auth.uid());

  return query
    select
      q.id,
      q.subject,
      q.topic,
      q.title,
      q.price_cents,
      q.expires_at,
      q.created_at,
      q.required_school_tier,
      q.required_major_category
    from public.individual_questions q
    where q.question_type = 'open'
      and q.status = 'open'
      and q.claimed_mentor_id is null
      and (q.expires_at is null or q.expires_at > now())
      and (q.subject is null or q.subject = any(coalesce(v_subjects, array[]::text[])))
    order by q.created_at desc
    limit v_limit;
end;
$function$;

comment on function public.list_open_individual_questions_for_mentor(integer) is
  'S3-1/QA-B6: 공개형 대기 질문 목록(위생 RPC). 멘토가 수락 전에 조건을 볼 수 있도록 '
  'required_school_tier·required_major_category 를 반환에 포함한다 — 학생이 정한 '
  '답변 자격 조건이며 개인정보가 아니다. 본문·학생 식별자 미노출 규칙은 그대로다.';

-- 실행 권한 재부여 — drop 으로 ACL 이 함께 사라진다.
revoke all on function public.list_open_individual_questions_for_mentor(integer) from public;
revoke all on function public.list_open_individual_questions_for_mentor(integer) from anon;
grant execute on function public.list_open_individual_questions_for_mentor(integer) to authenticated;
grant execute on function public.list_open_individual_questions_for_mentor(integer) to service_role;
