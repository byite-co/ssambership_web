-- 001_dashboard_era_community_policies.sql — 대시보드 UI 로 생성됐던 out-of-band 정책 복원.
--
-- 근거: 원장 20260731170632(community_direct_write_lockdown) 사전 게이트가
-- community_posts 쓰기 정책 6종( cp_write_self / cp_update_own / cp_update_self /
-- cp_delete_own + 한글명 2종 )의 존재를 name+cmd+roles 로 단언한 뒤 6종 전부 DROP 한다.
-- 한글명 2종은 어떤 저장소 SQL 에도 CREATE 가 없다 — 초기 대시보드 정책 편집기 산물.
--
-- ⚠️ 원문 qual/with_check 는 부모에서 이미 DROP 되어 복구 불가(UNRECOVERABLE).
-- 게이트는 name+cmd+roles 만 검사하고 이 정책들은 최종 상태에 남지 않으므로,
-- 아래 본문은 당시 통용되던 self-write 형태로 재구성했다(최종 스키마 영향 0).
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='community_posts' and policyname='로그인 유저 게시글 작성') then
    execute 'create policy "로그인 유저 게시글 작성" on public.community_posts'
         || ' for insert to public with check (auth.uid() is not null and author_id = auth.uid())';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='community_posts' and policyname='본인 게시글 수정') then
    execute 'create policy "본인 게시글 수정" on public.community_posts'
         || ' for update to public using (author_id = auth.uid()) with check (author_id = auth.uid())';
  end if;
end $$;
