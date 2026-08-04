CREATE OR REPLACE FUNCTION core_private.community_image_refs_validate(p_owner_id uuid, p_image_refs text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_refs  text[] := coalesce(p_image_refs, '{}'::text[]);
  v_ref   text;
  v_path  text;
  v_meta  jsonb;
  v_owner uuid;
BEGIN
  IF p_owner_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED');
  END IF;
  IF coalesce(array_length(v_refs, 1), 0) > 5 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_COUNT_EXCEEDED');
  END IF;
  FOREACH v_ref IN ARRAY v_refs LOOP
    -- ① 허용 버킷 (정본 ref 형식: community-post-images/{uid}/{object} — §14.1)
    IF v_ref IS NULL OR v_ref !~ '^community-post-images/' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_REF_INVALID');
    END IF;
    v_path := substring(v_ref FROM char_length('community-post-images/') + 1);
    IF split_part(v_path, '/', 2) = '' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_REF_INVALID');
    END IF;
    -- ② path 첫 세그먼트 = 소유자
    IF split_part(v_path, '/', 1) IS DISTINCT FROM p_owner_id::text THEN
      RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_NOT_OWNED');
    END IF;
    -- ③ storage.objects 실존
    SELECT o.metadata, coalesce(o.owner, nullif(o.owner_id, '')::uuid)
      INTO v_meta, v_owner
      FROM storage.objects o
     WHERE o.bucket_id = 'community-post-images' AND o.name = v_path;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_OBJECT_NOT_FOUND');
    END IF;
    -- ④ 소유자·MIME·크기 (버킷 정책 실측값 — 5 MiB · 4종 MIME)
    IF v_owner IS DISTINCT FROM p_owner_id THEN
      RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_NOT_OWNED');
    END IF;
    IF coalesce(v_meta ->> 'mimetype', '')
       NOT IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_MIME_NOT_ALLOWED');
    END IF;
    IF coalesce((v_meta ->> 'size')::bigint, 0) > 5242880 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_SIZE_EXCEEDED');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true);
END $function$
