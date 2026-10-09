begin;
create temporary table m16_pre_state on commit drop as
select p.priv, has_table_privilege('service_role','public.community_posts',p.priv) as has
from (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(priv);
create temporary table m16_pre_select_policies on commit drop as
select policyname from pg_policies where schemaname='public' and tablename='community_posts' and cmd='SELECT';
do $$
declare v_role text; v_priv text; v_cnt int;
begin
if to_regclass('public.community_posts') is null then raise exception 'BATCH_F_M16_POLICY_BASELINE_MISMATCH: public.community_posts not found'; end if;
if not (select relrowsecurity from pg_class where oid='public.community_posts'::regclass) then raise exception 'BATCH_F_M16_POLICY_BASELINE_MISMATCH: RLS not enabled on community_posts'; end if;
if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api_web_v1' and p.proname in ('community_post_create','community_post_update','community_post_soft_delete'))<>3
or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api_app_v1' and p.proname in ('community_post_create','community_post_update','community_post_soft_delete'))<>3
then raise exception 'BATCH_F_M16_POLICY_BASELINE_MISMATCH: F4/F5/F6 wrappers (M7/M17) missing'; end if;
select count(*) into v_cnt from pg_policies where schemaname='public' and tablename='community_posts' and cmd in ('INSERT','UPDATE','DELETE');
if v_cnt<>6 then raise exception 'BATCH_F_M16_POLICY_BASELINE_MISMATCH: write policies expected 6, measured %',v_cnt; end if;
select count(*) into v_cnt from pg_policies where schemaname='public' and tablename='community_posts' and ((policyname='cp_write_self' and cmd='INSERT' and roles='{authenticated}') or (policyname='로그인 유저 게시글 작성' and cmd='INSERT' and roles='{public}') or (policyname='cp_update_own' and cmd='UPDATE' and roles='{authenticated}') or (policyname='cp_update_self' and cmd='UPDATE' and roles='{authenticated}') or (policyname='본인 게시글 수정' and cmd='UPDATE' and roles='{public}') or (policyname='cp_delete_own' and cmd='DELETE' and roles='{authenticated}'));
if v_cnt<>6 then raise exception 'BATCH_F_M16_POLICY_BASELINE_MISMATCH: write policy identity set mismatch (matched %/6)',v_cnt; end if;
if (select count(*) from pg_policies where schemaname='public' and tablename='community_posts' and cmd='SELECT' and policyname in ('cp_select_own','cp_select_published'))<>2 then raise exception 'BATCH_F_M16_POLICY_BASELINE_MISMATCH: cp_select_own/cp_select_published missing'; end if;
for v_role,v_priv in select r.rolname,p.priv from (values ('anon'),('authenticated')) r(rolname) cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
loop if not has_table_privilege(v_role,'public.community_posts',v_priv) then raise exception 'BATCH_F_M16_POLICY_BASELINE_MISMATCH: expected % % on public.community_posts = true, measured false',v_role,v_priv; end if; end loop;
end $$;
revoke all on public.community_posts from anon, authenticated;
grant select on public.community_posts to anon, authenticated;
drop policy "cp_write_self" on public.community_posts;
drop policy "로그인 유저 게시글 작성" on public.community_posts;
drop policy "cp_update_own" on public.community_posts;
drop policy "cp_update_self" on public.community_posts;
drop policy "본인 게시글 수정" on public.community_posts;
drop policy "cp_delete_own" on public.community_posts;
do $$
declare v_role text; v_priv text; v_has boolean; v_cnt int;
begin
for v_role,v_priv in select r.rolname,p.priv from (values ('anon'),('authenticated')) r(rolname) cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(priv)
loop v_has:=has_table_privilege(v_role,'public.community_posts',v_priv); if v_priv='SELECT' and not v_has then raise exception 'M16_POST_MISMATCH: % SELECT expected true, measured false',v_role; elsif v_priv<>'SELECT' and v_has then raise exception 'M16_POST_MISMATCH: % % expected false, measured true',v_role,v_priv; end if; end loop;
select count(*) into v_cnt from pg_policies where schemaname='public' and tablename='community_posts' and cmd in ('INSERT','UPDATE','DELETE'); if v_cnt<>0 then raise exception 'M16_POST_MISMATCH: write policies expected 0, measured %',v_cnt; end if;
if exists (select policyname from m16_pre_select_policies except select policyname from pg_policies where schemaname='public' and tablename='community_posts' and cmd='SELECT') or exists (select policyname from pg_policies where schemaname='public' and tablename='community_posts' and cmd='SELECT' except select policyname from m16_pre_select_policies) then raise exception 'M16_POST_MISMATCH: SELECT policy set changed'; end if;
select count(*) into v_cnt from m16_pre_state s where s.has is distinct from has_table_privilege('service_role','public.community_posts',s.priv); if v_cnt<>0 then raise exception 'M16_POST_MISMATCH: service_role privilege drift = % entries',v_cnt; end if;
end $$;
commit;