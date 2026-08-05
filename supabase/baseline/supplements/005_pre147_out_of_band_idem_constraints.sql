-- 005_pre147_out_of_band_idem_constraints.sql — 번호 147/148 적용 '이전' 위치 필수.
-- 부모 실측: 원장 147/148(7/20)의 create unique index IF NOT EXISTS 가 no-op 이 되려면
-- 이 시점 이전에 동명 '제약'(constraint) 이 이미 있어야 한다 — 저장소 SQL 에 생성문 없음
-- (out-of-band, 7/17~7/20 사이). 컬럼·제약 정의는 부모 인벤토리 원문.
alter table public.community_posts add column if not exists create_idempotency_key uuid;
alter table public.shortform_posts add column if not exists create_idempotency_key uuid;
alter table public.community_posts add column if not exists status text default 'published'::text;
do $$ begin
  if not exists (select 1 from pg_constraint c join pg_class cl on cl.oid=c.conrelid
                 where cl.relname='community_posts' and c.conname='community_posts_author_idem_key') then
    alter table public.community_posts add constraint community_posts_author_idem_key UNIQUE (author_id, create_idempotency_key);
  end if;
  if not exists (select 1 from pg_constraint c join pg_class cl on cl.oid=c.conrelid
                 where cl.relname='shortform_posts' and c.conname='shortform_posts_author_idem_key') then
    alter table public.shortform_posts add constraint shortform_posts_author_idem_key UNIQUE (author_id, create_idempotency_key);
  end if;
  if not exists (select 1 from pg_constraint c join pg_class cl on cl.oid=c.conrelid
                 where cl.relname='community_posts' and c.conname='community_posts_status_check') then
    alter table public.community_posts add constraint community_posts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'hidden'::text, 'deleted'::text])));
  end if;
end $$;
