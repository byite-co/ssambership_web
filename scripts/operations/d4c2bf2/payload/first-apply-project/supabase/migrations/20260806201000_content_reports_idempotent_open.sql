-- [S1-3 2026-08-06] QA-B4 — 중복 신고가 무제한으로 저장된다.
--
-- 증상: 동일 신고자·동일 대상·동일 사유가 그대로 중복 저장된다.
--       DB 실측: content_reports 3건 중 (reporter, target_type, target_id, reason)
--       distinct 2 — 같은 사용자를 external_contact 로 1분 30초 간격 2회 신고한
--       조합이 그대로 남아 있다.
--
-- 원인: content_reports 에 중복 방지 장치가 없다(제약 = pkey + fk 2 + check 2,
--       유니크 인덱스 0, 나머지 인덱스도 전부 비유니크).
--
-- 결정(오너 판단 2026-08-06): **차단이 아니라 멱등 처리**.
--   재신고를 오류로 되돌리면 앱이 실패 문구를 띄워야 하고, 사용자는 자기 신고가
--   접수되지 않았다고 오해한다. 대신 조용히 기존 신고를 갱신하고 새 행을 만들지
--   않는다 — 사용자 경험은 '접수됨' 그대로이고 모더레이션 큐에는 중복이 쌓이지
--   않는다. 앱은 direct INSERT(community_write_repository.dart:423)만 하고
--   반환 행을 검사하지 않으므로 **앱 수정 없이** 적용된다.
--
-- 중복 판정 범위: **아직 처리 중인 신고(pending·reviewing)** 에 한한다.
--   이미 처리(resolved/dismissed/rejected/hidden/removed)된 뒤의 재신고는
--   새 사건으로 보고 정상 접수한다 — 시간이 지나 재발한 행위를 신고할 수
--   없게 되면 모더레이션 신호를 잃는다.
--   ※ 이 범위를 '영구'로 바꾸려면 아래 status 조건만 제거하면 된다.
--
-- 기존 중복 1쌍은 삭제하지 않는다 — 사용자 신고 기록을 지시 없이 지우지 않으며,
-- 멱등 방식은 유니크 인덱스와 달리 기존 데이터 정리를 요구하지 않는다.
--
-- ★ 본인성 게이트(적대적 검증 2026-08-06 에서 발견한 RLS 우회를 막는 핵심) ★
--   BEFORE INSERT 트리거는 RLS WITH CHECK **보다 먼저** 실행되고, 트리거가
--   NULL 을 반환하면 WITH CHECK 는 아예 평가되지 않는다. 그래서 reporter_id 를
--   가리지 않고 개입하면 이 SECURITY DEFINER 함수가 INSERT 정책
--   (content_reports_insert_reporter: reporter_id = auth.uid() · status='pending' ·
--    대상 실존 검증)과 admin 전용 UPDATE 정책을 **통째로 우회**한다 —
--   공격자가 reporter_id 에 남의 uuid 를 넣어 그 사람의 신고 본문을 덮어쓸 수 있다
--   (실제로 재현했다: 사용자 C 가 사용자 A 의 신고 description 을 교체).
--   따라서 **세션 사용자 본인의 신고에만** 개입하고, 그 외에는 손대지 않고
--   RLS 가 판정하게 넘긴다. auth.uid() 가 없는 세션(service_role·워커·마이그레이션)도
--   동일하게 통과시킨다 — 그 경로는 애초에 중복 방지 대상이 아니다.
--
-- ★ 동시성: lookup → INSERT 사이에는 TOCTOU 창이 있어, 같은 신고를 동시에 두 번
--   보내면 양쪽 다 "없음"을 보고 둘 다 삽입된다. 기존 중복 1쌍 때문에 부분 유니크
--   인덱스는 만들 수 없으므로(생성 자체가 실패) 트랜잭션 advisory lock 으로
--   같은 키의 동시 삽입을 직렬화한다.

create or replace function public.content_reports_dedupe_open()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_existing uuid;
begin
  -- ① 본인 신고가 아니면 개입하지 않는다 → RLS WITH CHECK 가 정상 평가된다.
  if v_uid is null or NEW.reporter_id is distinct from v_uid then
    return NEW;
  end if;

  -- ② 같은 (신고자·대상·사유) 키의 동시 삽입 직렬화 — 먼저 온 트랜잭션이
  --    커밋될 때까지 뒤 트랜잭션이 대기하므로 ③ 의 lookup 이 최신 상태를 본다.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'content_reports_dedupe_open|' || v_uid::text
        || '|' || coalesce(NEW.target_type, '')
        || '|' || coalesce(NEW.target_id::text, '')
        || '|' || coalesce(NEW.reason, ''),
      0
    )
  );

  -- ③ 열려 있는 본인 신고만 찾는다(reporter_id = 세션 사용자로 고정).
  select r.id
    into v_existing
    from public.content_reports r
   where r.reporter_id = v_uid
     and r.target_type = NEW.target_type
     and r.target_id is not distinct from NEW.target_id
     and r.reason is not distinct from NEW.reason
     and r.status in ('pending', 'reviewing')
   order by r.created_at desc
   limit 1;

  if v_existing is null then
    return NEW;                       -- 첫 신고(또는 이전 건이 처리 완료) → 정상 삽입
  end if;

  -- ④ 열려 있는 같은 신고가 있다 → 새로 쓰지 않고 기존 건을 갱신(멱등).
  --    새 설명이 있으면 살리고, 없으면 기존 설명을 보존한다.
  --    WHERE 에 reporter_id 를 한 번 더 건다 — ①·③ 이 무너져도 남의 행에
  --    UPDATE 가 닿지 않도록 하는 이중 방어다.
  update public.content_reports
     set description = coalesce(nullif(btrim(coalesce(NEW.description, '')), ''), description),
         updated_at  = now()
   where id = v_existing
     and reporter_id = v_uid;

  return null;                        -- 삽입 생략 — 클라이언트에는 성공으로 보인다
end
$function$;

comment on function public.content_reports_dedupe_open() is
  'S1-3/QA-B4: 처리 중(pending·reviewing)인 **본인** 신고가 있으면 새 행을 만들지 '
  '않고 기존 건을 갱신한다(멱등). reporter_id 가 auth.uid() 와 다르거나 세션이 '
  '없으면 아무것도 하지 않고 그대로 통과시킨다 — BEFORE 트리거의 return null 이 '
  'RLS WITH CHECK 평가를 건너뛰므로, 본인성 게이트가 없으면 이 함수가 INSERT·UPDATE '
  '정책을 우회하는 통로가 된다. 동시 중복은 advisory xact lock 으로 직렬화한다.';

drop trigger if exists content_reports_dedupe_open_before_insert on public.content_reports;
create trigger content_reports_dedupe_open_before_insert
  before insert on public.content_reports
  for each row execute function public.content_reports_dedupe_open();

-- 조회 효율(중복 판정 lookup) — 유니크가 아니다.
create index if not exists content_reports_dedupe_lookup_idx
  on public.content_reports (reporter_id, target_type, target_id, reason)
  where status in ('pending', 'reviewing');
