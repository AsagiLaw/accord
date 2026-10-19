-- ひとことの期限（Discord のカスタムステータスと同じ）。期限を過ぎたひとことは、ほかの人には見せない

alter table public.profiles
  add column status_expires_at timestamptz;

create or replace view public.profiles_public
with (security_invoker = true) as
select
  id,
  display_name,
  avatar,
  case when status_expires_at is null or status_expires_at > now() then status_text end as status_text,
  case when presence = 'invisible' and id <> auth.uid() then 'offline' else presence end as presence,
  created_at,
  bio,
  links,
  work_status,
  status_expires_at
from private.visible_profiles();
