begin;
alter table public.community_posts add column if not exists create_idempotency_key uuid;
alter table public.community_posts add column if not exists deleted_at timestamptz;
create unique index if not exists community_posts_author_idem_key
  on public.community_posts (author_id, create_idempotency_key);
create index if not exists idx_cp_active_created
  on public.community_posts (created_at desc) where deleted_at is null;
commit;