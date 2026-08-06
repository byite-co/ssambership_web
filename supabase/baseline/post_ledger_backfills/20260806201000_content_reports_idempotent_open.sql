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

create or replace function public.content_reports_dedupe_open()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing uuid;
begin
  select r.id
    into v_existing
    from public.content_reports r
   where r.reporter_id is not distinct from NEW.reporter_id
     and r.target_type = NEW.target_type
     and r.target_id is not distinct from NEW.target_id
     and r.reason is not distinct from NEW.reason
     and r.status in ('pending', 'reviewing')
   order by r.created_at desc
   limit 1;

  if v_existing is null then
    return NEW;                       -- 첫 신고(또는 이전 건이 처리 완료) → 정상 삽입
  end if;

  -- 열려 있는 같은 신고가 있다 → 새로 쓰지 않고 기존 건을 갱신(멱등).
  -- 새 설명이 있으면 살리고, 없으면 기존 설명을 보존한다.
  update public.content_reports
     set description = coalesce(nullif(btrim(coalesce(NEW.description, '')), ''), description),
         updated_at  = now()
   where id = v_existing;

  return null;                        -- 삽입 생략 — 클라이언트에는 성공으로 보인다
end
$function$;

comment on function public.content_reports_dedupe_open() is
  'S1-3/QA-B4: 처리 중(pending·reviewing)인 동일 신고가 있으면 새 행을 만들지 '
  '않고 기존 건을 갱신한다(멱등). reporter_id 가 일치하는 본인 신고만 건드리므로 '
  '타인 신고를 수정할 수 없다.';

drop trigger if exists content_reports_dedupe_open_before_insert on public.content_reports;
create trigger content_reports_dedupe_open_before_insert
  before insert on public.content_reports
  for each row execute function public.content_reports_dedupe_open();

-- 조회 효율(중복 판정 lookup) — 유니크가 아니다.
create index if not exists content_reports_dedupe_lookup_idx
  on public.content_reports (reporter_id, target_type, target_id, reason)
  where status in ('pending', 'reviewing');
