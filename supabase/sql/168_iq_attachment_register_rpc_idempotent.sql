-- 168_iq_attachment_register_rpc_idempotent.sql
-- add_individual_question_attachment 명시적 멱등 계약 — 재시도·중복 제출이 행을 늘리지 않고,
-- 호출자가 "신규 등록 / 멱등 히트 / 실패" 3상태를 구분할 수 있게 반환 계약을 명문화한다.
--
-- ⚠️ 이 파일은 웨이브 1(트랙 3)에서 **초안으로만** 작성되었다. staging 미적용.
--
-- ⚠️ 의존성(필수): 167 이 먼저 적용되어야 한다.
--    167 의 UNIQUE (question_id, storage_path) 가 없으면 아래 ON CONFLICT 의 arbiter 를
--    추론할 수 없어 런타임에 42P10 (there is no unique or exclusion constraint matching the
--    ON CONFLICT specification) 로 **모든 등록이 실패**한다. 168 만 단독 적용하면 멱등이
--    성립하지 않는 정도가 아니라 기능이 정지한다. 적용 순서 167 → 168 은 선택이 아니다.
--
-- 배경(2026-07-25 staging `lbeqxarxothkmzqvpudy` read-only 실조회 — pg_get_functiondef 전문 대조):
--   - 현행 시그니처: add_individual_question_attachment(uuid, text, text, text, uuid)
--       = (p_question_id, p_storage_path, p_file_name, p_mime_type, p_message_id DEFAULT null)
--   - 현행 반환: uuid (신규 행 id). plpgsql · SECURITY DEFINER · search_path='public' · volatile.
--   - 현행 본문: 가드 4종 후 **plain INSERT** — ON CONFLICT 절 없음, 멱등 인자 없음.
--     → 같은 (question_id, storage_path) 로 재호출하면 행이 계속 늘어난다(재시도 = 중복 생성).
--   - 실효 EXECUTE(has_function_privilege): anon=false · authenticated=true · service_role=true.
--     proacl = {postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}.
--
-- 조치:
--   1) 반환 타입을 uuid → jsonb 로 바꾼다. PostgreSQL 은 CREATE OR REPLACE 로 반환 타입을
--      변경할 수 없으므로 **DROP 후 CREATE** 한다(인자 시그니처는 이름·타입·기본값까지 동일 유지).
--      DROP 은 OID 와 함께 기존 GRANT 를 소멸시키므로 아래에서 실측 ACL 과 동일하게 재부여한다.
--   2) INSERT 에 ON CONFLICT (question_id, storage_path) DO NOTHING 을 붙이고, 미삽입 시
--      기존 행을 조회해 멱등 히트로 반환한다.
--   3) 저장 직전 storage_path 를 btrim 한다(167 주석의 정규화 한계 보완 — 미trim 유입 차단).
--
-- 의도적 비변경(스코프 밖 — 이 스크립트가 건드리지 않는 것):
--   - 기존 가드 4종의 조건·예외 메시지·SQLSTATE 를 **한 글자도 바꾸지 않는다**.
--     v19·v20 클라이언트가 이 토큰들로 분기하고 있으므로 문자열 안정성이 계약의 일부다.
--   - 139(question-room-attachments) 처럼 storage 객체 존재·owner_id 대조를 추가하지 **않는다**.
--     staging 실측상 individual-question-attachments 버킷 5개 객체는 owner·owner_id 가 전부
--     NULL 이라(다른 7개 버킷은 100% 채워져 있음 — fixture 시드 흔적), 지금 그 검사를 넣으면
--     정상 경로까지 막힌다. 업로더 소유 판정은 169 에서 별도로 다룬다.
--   - individual_question_attachments 의 기존 행·컬럼·인덱스·FK 를 변경하지 않는다.
--
-- 선행: 070, 117, 167(필수). 후속: 169(조건부 DELETE 정책), App-A3(앱 배선 — 아래 반환 계약이 정본).

begin;
set local lock_timeout = '5s';

-- ── 0. 사전 검증: 167 의 arbiter 제약 존재 확인. 없으면 중단(168 단독 적용 방지) ──
-- UNIQUE constraint 든 독립 UNIQUE index 든 pg_index 에 indisunique 행이 생기므로,
-- 컬럼 집합을 직접 대조해 한 번에 판정한다(제약/인덱스 어느 형태로 적용됐든 통과).
do $$
declare
  v_q  smallint := (select attnum from pg_attribute
                     where attrelid = 'public.individual_question_attachments'::regclass
                       and attname = 'question_id' and not attisdropped);
  v_sp smallint := (select attnum from pg_attribute
                     where attrelid = 'public.individual_question_attachments'::regclass
                       and attname = 'storage_path' and not attisdropped);
begin
  if not exists (
    select 1
    from pg_index i
    where i.indrelid = 'public.individual_question_attachments'::regclass
      and i.indisunique
      and i.indisvalid
      and i.indpred is null                     -- partial 인덱스는 arbiter 로 부적합
      and i.indnatts = 2
      and i.indkey::smallint[] @> array[v_q, v_sp]
  ) then
    raise exception
      'ABORT_168: (question_id, storage_path) UNIQUE arbiter 부재 — 167 을 먼저 적용하라. 이 상태로 168 을 적용하면 모든 등록이 42P10 으로 실패한다.';
  end if;

  raise notice '168 preflight OK: (question_id, storage_path) UNIQUE arbiter 확인됨.';
end $$;

-- ── 1. 기존 함수 제거(반환 타입 변경 때문 — 인자 시그니처는 동일하게 재생성) ──
drop function if exists public.add_individual_question_attachment(uuid, text, text, text, uuid);

-- ── 2. 멱등 등록 RPC 재생성 ──
create function public.add_individual_question_attachment(
  p_question_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_message_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid  uuid := (select auth.uid());
  v_path text;
  v_id   uuid;
  v_existing_message_id uuid;
  v_created boolean := false;
begin
  -- 가드 1: 인증 (기존 토큰·SQLSTATE 유지)
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  -- 가드 2: 경로 필수 (기존 토큰·SQLSTATE 유지). 정규화는 여기서 1회 확정한다.
  v_path := btrim(coalesce(p_storage_path, ''));
  if v_path = '' then
    raise exception 'INVALID_INPUT: storage_path is required' using errcode = '22023';
  end if;

  -- 가드 3: 당사자(질문 학생 또는 배정·claim 멘토, admin)만 등록 가능 (기존 유지)
  if not public.user_is_individual_question_party(p_question_id) then
    raise exception 'NOT_QUESTION_PARTY' using errcode = '42501';
  end if;

  -- 가드 4: 경로 위조 차단 — 첫 세그먼트가 이 질문의 uuid 여야 한다 (기존 유지)
  if split_part(v_path, '/', 1) <> p_question_id::text then
    raise exception 'STORAGE_PATH_MISMATCH' using errcode = '22023';
  end if;

  -- 가드 5: 메시지 소속 검증 — 다른 질문의 메시지를 이 질문 첨부로 묶는 것 차단 (기존 유지)
  if p_message_id is not null and not exists (
    select 1
    from public.individual_question_messages m
    where m.id = p_message_id
      and m.question_id = p_question_id
  ) then
    raise exception 'MESSAGE_NOT_IN_QUESTION' using errcode = '22023';
  end if;

  -- 멱등 INSERT: 167 의 UNIQUE (question_id, storage_path) 를 arbiter 로 사용.
  insert into public.individual_question_attachments
    (question_id, message_id, storage_path, file_name, mime_type)
  values
    (p_question_id, p_message_id, v_path, p_file_name, p_mime_type)
  on conflict (question_id, storage_path) do nothing
  returning id into v_id;

  if v_id is not null then
    v_created := true;
  else
    -- 멱등 히트: 기존 행을 조회해 동일한 attachment_id 를 반환한다.
    -- 기존 행은 **절대 UPDATE 하지 않는다** — file_name·mime_type·message_id 는 최초 등록값을
    -- 정본으로 보존한다(재시도가 메타데이터를 덮어쓰는 사고 방지).
    select a.id, a.message_id
      into v_id, v_existing_message_id
    from public.individual_question_attachments a
    where a.question_id = p_question_id
      and a.storage_path = v_path;

    -- 방어: 경합으로 행이 사라진 극단 케이스(FK CASCADE 등)에서는 조용히 null 을 반환하지 않는다.
    if v_id is null then
      raise exception 'REGISTER_CONFLICT_UNRESOLVED' using errcode = '40001';
    end if;
  end if;

  return jsonb_build_object(
    'ok',            true,
    'status',        case when v_created then 'created' else 'existing' end,
    'idempotent_hit', not v_created,
    'attachment_id', v_id,
    'question_id',   p_question_id,
    'storage_path',  v_path,
    -- 멱등 히트인데 호출자가 보낸 message_id 가 저장된 값과 다를 때만 true.
    -- 호출자에게 "요청은 반영되지 않았고 최초 등록값이 유지됐다"를 알리는 신호.
    'message_id_mismatch',
      case when v_created then false
           else coalesce(v_existing_message_id, '00000000-0000-0000-0000-000000000000'::uuid)
                is distinct from coalesce(p_message_id, '00000000-0000-0000-0000-000000000000'::uuid)
      end
  );
end;
$function$;

-- ── 3. ACL 재부여(DROP 으로 소멸된 GRANT 복원 — staging 실측 proacl 과 동일하게) ──
--    실측: anon=false / authenticated=true / service_role=true
revoke all on function public.add_individual_question_attachment(uuid, text, text, text, uuid)
  from public, anon;
grant execute on function public.add_individual_question_attachment(uuid, text, text, text, uuid)
  to authenticated, service_role;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- §반환 계약 (App-A3 앱 배선의 정본)
-- ═══════════════════════════════════════════════════════════════════════════
-- 반환 타입: jsonb (구 uuid 스칼라에서 **파괴적 변경**).
--   구 호출자는 반환값을 uuid 로 직접 읽었다 → 신 호출자는 `.attachment_id` 를 읽어야 한다.
--   이 변경은 168 적용과 앱 배선(App-A3)이 **함께** 나가야 함을 뜻한다.
--
-- 성공 — 신규 등록:
--   { "ok": true, "status": "created",  "idempotent_hit": false,
--     "attachment_id": "<uuid>", "question_id": "<uuid>", "storage_path": "<text>",
--     "message_id_mismatch": false }
--
-- 성공 — 멱등 히트(이미 같은 (question_id, storage_path) 행이 존재):
--   { "ok": true, "status": "existing", "idempotent_hit": true,
--     "attachment_id": "<기존 행 uuid>", "question_id": "<uuid>", "storage_path": "<text>",
--     "message_id_mismatch": true|false }
--   - attachment_id 는 최초 등록 행의 id — 재시도해도 같은 값이 돌아온다(멱등의 관측 가능한 증거).
--   - 기존 행의 file_name·mime_type·message_id 는 갱신되지 않는다.
--   - message_id_mismatch=true 는 "보낸 message_id 가 저장값과 달라 무시됐다"는 뜻이다.
--     앱은 이를 오류로 처리하지 말고(등록 자체는 성공), 필요 시 로깅·재조회로만 다룬다.
--
-- 실패 — 예외(raise)로만 전달된다. 반환값에 ok:false 형태는 존재하지 않는다.
--   SQLSTATE  | 메시지 토큰                        | 의미
--   ----------|-----------------------------------|------------------------------------------
--   28000     | AUTH_REQUIRED                     | 미인증 호출
--   22023     | INVALID_INPUT: storage_path is required | 경로 누락·공백
--   42501     | NOT_QUESTION_PARTY                | 질문 당사자(학생/배정·claim 멘토/admin) 아님
--   22023     | STORAGE_PATH_MISMATCH             | 경로 첫 세그먼트 ≠ question_id (위조 차단)
--   22023     | MESSAGE_NOT_IN_QUESTION           | message_id 가 이 질문 소속이 아님
--   40001     | REGISTER_CONFLICT_UNRESOLVED      | 충돌 후 기존 행 조회 실패(경합) — 재시도 대상
--   42P10     | (PostgreSQL 원문)                  | **167 미적용** — arbiter 부재. 배포 사고 신호
--
--   호출자 분기 규칙: 22023·42501 은 재시도 금지(입력·권한 문제). 40001 은 1회 재시도 허용.
--   42P10 은 앱에서 복구 불가 — 즉시 알림 대상(167 누락 배포).
--
-- 3상태 구분 방법(요약): 예외 발생 = 실패 / status='created' = 신규 / status='existing' = 멱등 히트.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── §V 검증 SELECT (적용 후 별도 실행) ──
-- select p.oid::regprocedure::text, pg_get_function_result(p.oid), p.proacl::text
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' and p.proname='add_individual_question_attachment';
-- 기대: add_individual_question_attachment(uuid,text,text,text,uuid) | jsonb |
--       {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--
-- ── ROLLBACK 절차 ──
-- 168 을 되돌리려면 함수를 구 정의(RETURNS uuid · plain INSERT)로 재생성한다.
--   drop function if exists public.add_individual_question_attachment(uuid,text,text,text,uuid);
--   -- 이후 staging 실측 원본 정의(이 파일 상단 '배경' 의 pg_get_functiondef 전문)를 그대로 재적용하고
--   -- revoke all ... from public, anon; grant execute ... to authenticated, service_role; 을 재실행한다.
-- 되돌림 순서: 앱 배선(App-A3) 되돌림 → 168 → 167. 167 을 먼저 지우면 안 된다.
