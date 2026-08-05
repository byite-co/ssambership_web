CREATE OR REPLACE FUNCTION core_private.user_profile_update_self_impl(p_user_id uuid, p_nickname text, p_grade_level text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_role text;
  v_status text;
  v_susp timestamptz;
  v_norm text;
  v_nick text;
  v_grade text;
  v_set_grade boolean := false;
  v_updated_at timestamptz;
  v_out_nick text;
  v_out_grade text;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select u.role, u.status, u.suspended_until
    into v_role, v_status, v_susp
    from public.users u where u.id = p_user_id
    for update;
  if not found then
    raise exception 'ACCOUNT_NOT_ACTIVE';
  end if;

  if v_role not in ('student','mentor') then
    raise exception 'ROLE_NOT_ALLOWED';
  end if;

  -- 계정 상태 게이트 (Build 13 UGC 게이트와 동일 판정: banned 차단 · 유효 suspended
  -- 차단 · 만료 suspended 허용 · unknown/deleted/빈 status 차단)
  v_norm := lower(btrim(coalesce(v_status, '')));
  if v_norm = 'banned' then
    raise exception 'ACCOUNT_BANNED';
  end if;
  if v_norm = 'suspended' and (v_susp is null or v_susp > now()) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;
  if v_norm not in ('active','suspended') then
    raise exception 'ACCOUNT_NOT_ACTIVE';
  end if;
  if public.account_deletion_write_blocked(p_user_id) then
    raise exception 'ACCOUNT_DELETION_IN_PROGRESS';
  end if;

  -- nickname: null=유지 · trim 후 빈 값=오류 · 최대 30자
  if p_nickname is not null then
    v_nick := btrim(p_nickname);
    if v_nick = '' then
      raise exception 'NICKNAME_REQUIRED' using errcode = '22023';
    end if;
    if char_length(v_nick) > 30 then
      raise exception 'NICKNAME_TOO_LONG' using errcode = '22023';
    end if;
  end if;

  -- grade_level: null=유지 · ''=값 제거 · 학생만 · 자유 텍스트 최대 20자
  if p_grade_level is not null then
    if v_role <> 'student' then
      raise exception 'GRADE_LEVEL_NOT_ALLOWED' using errcode = '22023';
    end if;
    v_grade := nullif(btrim(p_grade_level), '');
    if v_grade is not null and char_length(v_grade) > 20 then
      raise exception 'GRADE_LEVEL_TOO_LONG' using errcode = '22023';
    end if;
    v_set_grade := true;
  end if;

  update public.users u
     set nickname    = coalesce(v_nick, u.nickname),
         grade_level = case when v_set_grade then v_grade else u.grade_level end,
         updated_at  = now()
   where u.id = p_user_id
   returning u.updated_at, u.nickname, u.grade_level
     into v_updated_at, v_out_nick, v_out_grade;

  return jsonb_build_object(
    'ok', true,
    'contract_version', 1,
    'nickname', v_out_nick,
    'grade_level', v_out_grade,
    'updated_at', v_updated_at
  );
end
$function$
