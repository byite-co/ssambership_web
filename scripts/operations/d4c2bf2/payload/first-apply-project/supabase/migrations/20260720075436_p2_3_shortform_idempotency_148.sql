begin;
alter table public.shortform_posts add column if not exists create_idempotency_key uuid;
create unique index if not exists shortform_posts_author_idem_key
  on public.shortform_posts (author_id, create_idempotency_key);
commit;