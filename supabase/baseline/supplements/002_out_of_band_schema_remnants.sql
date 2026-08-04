-- 002_out_of_band_schema_remnants.sql — 저장소 SQL 에 없는 부모 실측 객체 복원
-- (002_app_core_schema_draft 일부 수동 적용 흔적 + 대시보드 생성 제약).
-- 모든 정의는 부모 인벤토리(정보 스키마·pg_get_constraintdef) 원문 기반.
alter table public.custom_order_deliverables add column if not exists mentor_id uuid;
alter table public.custom_order_messages add column if not exists content text;
alter table public.custom_order_messages add column if not exists file_url text;
alter table public.custom_order_messages add column if not exists sender_id uuid;
alter table public.custom_request_applications add column if not exists proposal text;
alter table public.question_threads add column if not exists view_count integer default 0;
do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class cl on cl.oid=c.conrelid
                 join pg_namespace n on n.oid=cl.relnamespace
                 where n.nspname='public' and cl.relname='custom_order_deliverables' and c.conname='custom_order_deliverables_mentor_id_fkey') then
    alter table public.custom_order_deliverables add constraint custom_order_deliverables_mentor_id_fkey FOREIGN KEY (mentor_id) REFERENCES auth.users(id);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class cl on cl.oid=c.conrelid
                 join pg_namespace n on n.oid=cl.relnamespace
                 where n.nspname='public' and cl.relname='custom_order_messages' and c.conname='custom_order_messages_sender_id_fkey') then
    alter table public.custom_order_messages add constraint custom_order_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class cl on cl.oid=c.conrelid
                 join pg_namespace n on n.oid=cl.relnamespace
                 where n.nspname='public' and cl.relname='favorites' and c.conname='favorites_user_id_mentor_id_key') then
    alter table public.favorites add constraint favorites_user_id_mentor_id_key UNIQUE (user_id, mentor_id);
  end if;
end $$;
-- 로컬 잉여(부모 부재) 정리 — as-applied 발산분
alter table public.favorites drop constraint if exists favorites_user_mentor_unique;
alter table public.comments drop constraint if exists comments_content_len_chk;
alter table public.comments drop column if exists updated_at;
alter table public.community_hashtags drop column if exists updated_at;
