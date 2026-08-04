-- 003_out_of_band_policies.sql — 대시보드 생성 정책 9종 (부모 pg_policies 원문 그대로)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='admin_action_logs' and policyname='관리자만 로그 기록') then
    execute $pol$create policy "관리자만 로그 기록" on public.admin_action_logs for insert to public
  with check ((auth.uid() = admin_id))$pol$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='admin_action_logs' and policyname='관리자만 로그 조회') then
    execute $pol$create policy "관리자만 로그 조회" on public.admin_action_logs for select to public
  using ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.role = 'admin'::text)))))$pol$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='community_posts' and policyname='누구나 게시글 읽기') then
    execute $pol$create policy "누구나 게시글 읽기" on public.community_posts for select to public
  using ((status = 'published'::text))$pol$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='custom_order_deliverables' and policyname='멘토만 납품 업로드') then
    execute $pol$create policy "멘토만 납품 업로드" on public.custom_order_deliverables for insert to public
  with check ((auth.uid() = mentor_id))$pol$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='custom_order_messages' and policyname='당사자만 메시지 전송') then
    execute $pol$create policy "당사자만 메시지 전송" on public.custom_order_messages for insert to public
  with check ((auth.uid() = author_id))$pol$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='custom_request_applications' and policyname='멘토만 지원') then
    execute $pol$create policy "멘토만 지원" on public.custom_request_applications for insert to public
  with check ((auth.uid() = mentor_id))$pol$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='custom_request_orders' and policyname='주문 당사자만 읽기') then
    execute $pol$create policy "주문 당사자만 읽기" on public.custom_request_orders for select to public
  using (((auth.uid() = student_id) OR (auth.uid() = mentor_id)))$pol$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='custom_request_posts' and policyname='학생만 의뢰 등록') then
    execute $pol$create policy "학생만 의뢰 등록" on public.custom_request_posts for insert to public
  with check ((auth.uid() = author_id))$pol$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='post_reactions' and policyname='본인 반응만 조회') then
    execute $pol$create policy "본인 반응만 조회" on public.post_reactions for select to public
  using ((auth.uid() = user_id))$pol$;
  end if;
end $$;
