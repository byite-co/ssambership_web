-- interleave_20260804100001_post_ledger_attr_convergence.sql
-- as-applied 속성 발산 수렴: 컬럼 null/default · FK 정의 · due_payouts 뷰 (부모 실측 원문).
-- [컬럼 null/default — 부모 실측으로]
alter table public.admin_action_logs alter column created_at drop not null;
alter table public.comments alter column author_id drop not null;
alter table public.comments alter column created_at drop not null;
alter table public.comments alter column is_deleted drop not null;
alter table public.comments alter column like_count drop not null;
alter table public.comments alter column post_id drop not null;
alter table public.community_hashtags alter column count drop not null;
alter table public.community_posts alter column comment_count drop not null;
alter table public.community_posts alter column hashtags drop not null;
alter table public.community_posts alter column image_urls drop not null;
alter table public.community_posts alter column like_count drop not null;
alter table public.community_posts alter column status drop not null;
alter table public.community_posts alter column updated_at set default now();
alter table public.community_posts alter column view_count drop not null;
alter table public.custom_request_applications alter column estimated_days set default 7;
alter table public.custom_request_applications alter column portfolio_urls drop not null;
alter table public.custom_request_posts alter column file_urls drop not null;
alter table public.favorites alter column created_at drop not null;
alter table public.favorites alter column mentor_id drop not null;
alter table public.favorites alter column user_id drop not null;
alter table public.payout_run_items alter column withholding_cents set not null;
alter table public.payout_run_items alter column withholding_cents set default 0;
alter table public.post_reactions alter column created_at drop not null;
alter table public.post_reactions alter column post_id drop not null;
alter table public.post_reactions alter column type drop not null;
alter table public.post_reactions alter column user_id drop not null;
alter table public.scan_annotations alter column annotation_json drop not null;
alter table public.scan_annotations alter column annotation_json drop default;
alter table public.scan_annotations alter column scan_image_path set not null;
alter table public.shortform_posts alter column like_count drop not null;
alter table public.shortform_posts alter column status drop not null;
alter table public.shortform_posts alter column tags drop not null;
alter table public.shortform_posts alter column updated_at set default now();
alter table public.shortform_posts alter column view_count drop not null;
-- [FK 정의 — 부모 실측으로 drop 후 재생성]
alter table public.admin_action_logs drop constraint admin_action_logs_admin_id_fkey;
alter table public.admin_action_logs add constraint admin_action_logs_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES auth.users(id);
alter table public.comments drop constraint comments_author_id_fkey;
alter table public.comments add constraint comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.disputes drop constraint disputes_submitted_by_fkey;
alter table public.disputes add constraint disputes_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES auth.users(id);
alter table public.favorites drop constraint favorites_mentor_id_fkey;
alter table public.favorites add constraint favorites_mentor_id_fkey FOREIGN KEY (mentor_id) REFERENCES mentor_profiles(user_id) ON DELETE CASCADE;
alter table public.favorites drop constraint favorites_user_id_fkey;
alter table public.favorites add constraint favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.post_reactions drop constraint post_reactions_user_id_fkey;
alter table public.post_reactions add constraint post_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.scan_annotations drop constraint scan_annotations_author_id_fkey;
alter table public.scan_annotations add constraint scan_annotations_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public.shortform_posts drop constraint shortform_posts_creator_id_fkey;
alter table public.shortform_posts add constraint shortform_posts_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES auth.users(id);
-- [due_payouts 뷰 — 부모 as-applied 정의로 재생성 (or-replace 는 컬럼 축소 불가)]
drop view if exists public.due_payouts;
create view public.due_payouts as  SELECT 'subscription'::text AS source_type,
    ssi.id AS source_id,
    ssi.mentor_id,
    ssi.mentor_amount_cents,
    ssi.gross_cents,
    ssi.platform_fee_cents,
    ssi.fee_rate,
    ssi.period_end AS completion_ts
   FROM subscription_settlement_items ssi
  WHERE ((ssi.period_end IS NOT NULL) AND (ssi.period_end <= now()) AND (ssi.status <> ALL (ARRAY['paid'::text, 'hold'::text, 'canceled'::text])))
UNION ALL
 SELECT 'custom_request'::text AS source_type,
    cs.id AS source_id,
    cs.mentor_id,
    ((cs.mentor_amount)::bigint * 100) AS mentor_amount_cents,
    ((cs.gross_amount)::bigint * 100) AS gross_cents,
    ((cs.platform_fee_amount)::bigint * 100) AS platform_fee_cents,
    cs.fee_rate,
    o.accepted_at AS completion_ts
   FROM (custom_order_settlement_items cs
     JOIN custom_request_orders o ON ((o.id = cs.custom_request_order_id)))
  WHERE ((cs.status = ANY (ARRAY['pending'::text, 'on_hold'::text, 'payable'::text])) AND (o.accepted_at IS NOT NULL) AND (o.accepted_at <= now()) AND (COALESCE(lower(TRIM(BOTH FROM o.payment_status)), ''::text) <> 'refunded'::text) AND (COALESCE(lower(TRIM(BOTH FROM o.status)), ''::text) <> ALL (ARRAY['cancelled'::text, 'canceled'::text, 'refunded'::text])) AND (NOT (EXISTS ( SELECT 1
           FROM disputes d
          WHERE ((d.custom_request_order_id = o.id) AND (d.status = ANY (ARRAY['open'::text, 'under_review'::text, 'escalated'::text])))))))
UNION ALL
 SELECT 'individual_question'::text AS source_type,
    q.id AS source_id,
    COALESCE(q.claimed_mentor_id, q.designated_mentor_id) AS mentor_id,
    (floor(((q.price_cents)::numeric * 0.85)))::bigint AS mentor_amount_cents,
    (q.price_cents)::bigint AS gross_cents,
    (q.price_cents - (floor(((q.price_cents)::numeric * 0.85)))::bigint) AS platform_fee_cents,
    0.15 AS fee_rate,
    q.released_at AS completion_ts
   FROM individual_questions q
  WHERE ((q.released_at IS NOT NULL) AND (q.released_at <= now()) AND (q.release_ledger_id IS NULL) AND (q.refund_ledger_id IS NULL) AND (q.status <> ALL (ARRAY['refunded'::text, 'expired'::text, 'canceled'::text])) AND (COALESCE(q.claimed_mentor_id, q.designated_mentor_id) IS NOT NULL));
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.due_payouts to service_role;
-- 부모 실측: anon/authenticated 는 due_payouts 에 어떤 권한도 없다(hardened 기본 잔여분 제거)
revoke all on public.due_payouts from anon, authenticated;
