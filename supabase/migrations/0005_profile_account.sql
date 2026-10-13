-- アカウントの欄（左下）とアカウントの設定：アイコン画像・ひとこと・状態
-- avatar は正方形に切り抜いて小さくした画像（ローカル版と同じく data URL。Storage に移すときは URL に替える）

alter table public.profiles
  add column avatar text,
  add column status_text text check (char_length(status_text) <= 60),
  add column presence text not null default 'online'
    check (presence in ('online', 'idle', 'dnd', 'invisible'));

-- オフライン表示の人は、ほかの人にはオフラインに見せる（本人には本当の状態を返す）
create view public.profiles_public
with (security_invoker = true) as
select
  id,
  display_name,
  avatar,
  status_text,
  case when presence = 'invisible' and id <> auth.uid() then 'offline' else presence end as presence,
  created_at
from public.profiles;
