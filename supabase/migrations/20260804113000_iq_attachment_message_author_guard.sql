-- =============================================================================
-- 20260804113000_iq_attachment_message_author_guard.sql
-- =============================================================================
-- DB-IQ-ATTR-001. public.add_individual_question_attachment 은 p_message_id 의
-- '질문 소속'(MESSAGE_NOT_IN_QUESTION)만 검증하고 '메시지 작성자 = 호출자'는
-- 검증하지 않았다. 같은 질문의 당사자라면 자기 업로드를 **상대방 메시지**에
-- 연결해 상대가 보낸 것처럼 보이게 할 수 있다(앱 타임라인 §2-1 은 연결 메시지
-- 작성자를 표시 방향·라벨의 정본으로 쓴다 — 위장 벡터).
--
-- 이 migration 은 가드 1건만 '추가'한다(additive):
--   p_message_id is not null → individual_question_messages.author_id = auth.uid()
--   위반 시 MESSAGE_AUTHOR_MISMATCH (errcode 42501).
--
-- 불변 계약:
--   * 시그니처·반환 봉투(jsonb 키·의미: ok/status/idempotent_hit/attachment_id/
--     question_id/storage_path/message_id_mismatch)·멱등(on conflict do nothing +
--     선조회 existing 경로)·author_id 기록(auth.uid())·Storage fail-closed 검증
--     (수렴 M2 §12.6)·경로 첫 세그먼트 검증 전부 그대로.
--   * grant 도 그대로(CREATE OR REPLACE 는 기존 ACL 보존 — authenticated·
--     service_role EXECUTE, anon/PUBLIC 없음). GRANT/REVOKE 문 없음.
--   * 정상 클라이언트 흐름(자기 메시지에만 연결: 멘토 첫 답변·양측 후속 메시지·
--     멘토 첨삭본)은 영향 0 — 구버전 앱의 p_message_id null 등록도 영향 0.
--
-- 선행: 20260803142559(author_id) → 20260803162808(M2 §12.6 Storage fail-closed).
-- 롤백: supabase/rollback/20260804113000_iq_attachment_message_author_guard_rollback.sql
-- =============================================================================
begin;

-- 사전 게이트: 대상이 배포 정본(메시지 소속 검증 + author_id 기록)이어야 하고,
-- 가드가 이미 적용돼 있으면 중단한다(이중 적용 방지 — 멱등 재실행은 rollback 후).
do $$
declare
  v_oid oid := to_regprocedure('public.add_individual_question_attachment(uuid,text,text,text,uuid)')::oid;
  v_src text;
begin
  if v_oid is null then
    raise exception 'target function public.add_individual_question_attachment(uuid,text,text,text,uuid) not found';
  end if;
  select prosrc into v_src from pg_proc where oid = v_oid;
  if position('MESSAGE_NOT_IN_QUESTION' in v_src) = 0
     or position('author_id' in v_src) = 0
     or position('idempotent_hit' in v_src) = 0 then
    raise exception 'baseline mismatch: expected 20260803162808 deployed body (message check + author_id + idempotent envelope)';
  end if;
  if position('MESSAGE_AUTHOR_MISMATCH' in v_src) > 0 then
    raise exception 'MESSAGE_AUTHOR_MISMATCH guard already applied';
  end if;
end
$$;

-- 본문 = 배포 정본(20260803162808, prosrc md5 58f0c2411d40b2ce3bcec23efa0c88a1)
-- + 메시지 작성자 가드 1블록. 그 외 문자 그대로 동일.
create or replace function public.add_individual_question_attachment(p_question_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_message_id uuid default null::uuid)
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
  v_status text; v_susp timestamptz; v_norm text;
  v_obj_owner text;
  v_obj_meta jsonb;
  v_obj_found boolean := false;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  v_path := btrim(coalesce(p_storage_path, ''));
  if v_path = '' then
    raise exception 'INVALID_INPUT: storage_path is required' using errcode = '22023';
  end if;

  if not public.user_is_individual_question_party(p_question_id) then
    raise exception 'NOT_QUESTION_PARTY' using errcode = '42501';
  end if;

  if split_part(v_path, '/', 1) <> p_question_id::text then
    raise exception 'STORAGE_PATH_MISMATCH' using errcode = '22023';
  end if;

  if p_message_id is not null and not exists (
    select 1
    from public.individual_question_messages m
    where m.id = p_message_id
      and m.question_id = p_question_id
  ) then
    raise exception 'MESSAGE_NOT_IN_QUESTION' using errcode = '22023';
  end if;

  -- 메시지 작성자 = 호출자 가드(20260804113000): 상대방 메시지에 내 첨부를
  -- 연결하는 것을 막는다 — 타임라인 표시 방향은 연결 메시지 작성자가 정본이라
  -- 위장으로 이어진다. 자기 메시지 연결(정상 흐름 전부)은 그대로 통과한다.
  if p_message_id is not null and not exists (
    select 1
    from public.individual_question_messages m
    where m.id = p_message_id
      and m.author_id = v_uid
  ) then
    raise exception 'MESSAGE_AUTHOR_MISMATCH' using errcode = '42501';
  end if;

  -- 멱등 선조회: 이미 등록된 (question_id, storage_path) 는 기존 계약 그대로 반환
  -- (legacy 객체 읽기·기존 등록 행을 깨지 않는다 — 신규 등록만 아래에서 fail-closed)
  select a.id, a.message_id
    into v_id, v_existing_message_id
  from public.individual_question_attachments a
  where a.question_id = p_question_id
    and a.storage_path = v_path;

  if v_id is null then
    -- === 신규 등록 검증 (수렴 M2 §12.6) ===
    -- 계정 상태 4종 + 삭제 진행
    select u.status, u.suspended_until into v_status, v_susp from public.users u where u.id = v_uid;
    if not found then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
    v_norm := lower(btrim(coalesce(v_status,'')));
    if v_norm = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;
    if v_norm = 'suspended' and (v_susp is null or v_susp > now()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
    if v_norm not in ('active','suspended') then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
    if public.account_deletion_write_blocked(v_uid) then raise exception 'ACCOUNT_DELETION_IN_PROGRESS'; end if;

    -- Storage object 존재·소유·MIME·크기 (bucket=individual-question-attachments 고정)
    select o.owner_id, o.metadata into v_obj_owner, v_obj_meta
      from storage.objects o
     where o.bucket_id = 'individual-question-attachments'
       and o.name = v_path;
    v_obj_found := found;
    if not v_obj_found then
      raise exception 'STORAGE_OBJECT_NOT_FOUND' using errcode = '22023';
    end if;
    if v_obj_owner is null or v_obj_owner <> v_uid::text then
      raise exception 'STORAGE_OBJECT_NOT_OWNED' using errcode = '42501';
    end if;
    if v_obj_meta ? 'mimetype'
       and coalesce(nullif(btrim(p_mime_type), ''), '(none)') <> (v_obj_meta->>'mimetype') then
      raise exception 'MIME_MISMATCH' using errcode = '22023';
    end if;
    if p_mime_type is not null and btrim(p_mime_type) <> '' and not exists (
      select 1 from storage.buckets b
       where b.id = 'individual-question-attachments'
         and (b.allowed_mime_types is null or btrim(p_mime_type) = any (b.allowed_mime_types))
    ) then
      raise exception 'MIME_NOT_ALLOWED' using errcode = '22023';
    end if;
    if v_obj_meta ? 'size' and (v_obj_meta->>'size')::bigint > 20971520 then
      raise exception 'SIZE_EXCEEDED' using errcode = '22023';
    end if;

    insert into public.individual_question_attachments
      (question_id, message_id, storage_path, file_name, mime_type, author_id)
    values
      (p_question_id, p_message_id, v_path, p_file_name, p_mime_type, v_uid)
    on conflict (question_id, storage_path) do nothing
    returning id into v_id;

    if v_id is not null then
      v_created := true;
    else
      select a.id, a.message_id
        into v_id, v_existing_message_id
      from public.individual_question_attachments a
      where a.question_id = p_question_id
        and a.storage_path = v_path;

      if v_id is null then
        raise exception 'REGISTER_CONFLICT_UNRESOLVED' using errcode = '40001';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok',            true,
    'status',        case when v_created then 'created' else 'existing' end,
    'idempotent_hit', not v_created,
    'attachment_id', v_id,
    'question_id',   p_question_id,
    'storage_path',  v_path,
    'message_id_mismatch',
      case when v_created then false
           else coalesce(v_existing_message_id, '00000000-0000-0000-0000-000000000000'::uuid)
                is distinct from coalesce(p_message_id, '00000000-0000-0000-0000-000000000000'::uuid)
      end
  );
end;
$function$;

-- 자가 검증: 가드 존재 + 기존 계약 마커 보존 + 최소권한 ACL 불변.
do $$
declare
  v_oid oid := to_regprocedure('public.add_individual_question_attachment(uuid,text,text,text,uuid)')::oid;
  v_src text;
begin
  select prosrc into v_src from pg_proc where oid = v_oid;
  if position('MESSAGE_AUTHOR_MISMATCH' in v_src) = 0 then
    raise exception 'guard missing after replace';
  end if;
  if position('MESSAGE_NOT_IN_QUESTION' in v_src) = 0
     or position('idempotent_hit' in v_src) = 0
     or position('author_id' in v_src) = 0 then
    raise exception 'existing contract markers lost';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'anon must not execute add_individual_question_attachment';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'authenticated execute missing';
  end if;
  if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'service_role execute missing';
  end if;
end
$$;

commit;
