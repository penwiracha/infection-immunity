-- =====================================================================
-- 0009 interface language
--   profiles.lang: 'en' (default) | 'th' — the language of the website's
--   own words (menus, buttons, messages). Content is never translated.
--   Set by each user (globe button or Settings); saved like profiles.theme.
-- =====================================================================
alter table public.profiles add column lang text not null default 'en'
  check (lang in ('en', 'th'));
grant update (lang) on public.profiles to authenticated;
