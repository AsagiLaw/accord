-- プロフィールの自己紹介と仕事用の情報：自己紹介・リンク（ポートフォリオや SNS）・依頼の受付状況

alter table public.profiles
  add column bio text check (char_length(bio) <= 400),
  -- [{ "label": "ポートフォリオ", "url": "https://..." }]（最大5つ。URL は http / https だけ）
  add column links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 5),
  add column work_status text check (work_status in ('open', 'consult', 'closed'));

-- 公開用のビューにも足す（オフライン表示の扱いは 0005 と同じ）
create or replace view public.profiles_public
with (security_invoker = true) as
select
  id,
  display_name,
  avatar,
  status_text,
  case when presence = 'invisible' and id <> auth.uid() then 'offline' else presence end as presence,
  created_at,
  bio,
  links,
  work_status
from public.profiles;
