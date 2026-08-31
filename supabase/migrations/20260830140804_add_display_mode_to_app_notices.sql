alter table public.app_notices
  add column display_mode text not null default 'page'
  constraint app_notices_display_mode_allowed check (display_mode in ('page', 'popup'));

comment on column public.app_notices.display_mode is '노출 방식: page=공지 목록에만, popup=전역 팝업 모달로도 노출';
