-- アカウントの欄（左下）とアカウントの設定：アイコン画像・ひとこと・状態
-- avatar は正方形に切り抜いて小さくした画像（ローカル版と同じく data URL。Storage に移すときは URL に替える）

alter table public.profiles
  add column avatar text,
  add column status_text text check (char_length(status_text) <= 60),
  add column presence text not null default 'online'
    check (presence in ('online', 'idle', 'dnd', 'invisible'));

-- ほかの人に見せるプロフィールの窓口（profiles_public）。表そのもの（profiles）は本人しか読めないので（0001）、
-- 見てよい人（自分・同じルームの人・申請中も含め間柄のある人）の行は、private の関数で取り出す。
-- private は API に出さない（Supabase の Exposed schemas に入れない）ので、この関数を直接は呼べない
create schema if not exists private;
grant usage on schema private to authenticated;

create function private.visible_profiles()
returns setof public.profiles
language sql stable security definer set search_path = ''
as $$
  select p.* from public.profiles p
  where p.id in (
    select (select auth.uid())
    union
    select b.user_id
    from public.room_members a
    join public.room_members b on b.room_id = a.room_id
    where a.user_id = (select auth.uid())
    union
    select case when f.from_id = (select auth.uid()) then f.to_id else f.from_id end
    from public.friendships f
    where f.from_id = (select auth.uid()) or f.to_id = (select auth.uid())
  );
$$;

revoke all on function private.visible_profiles() from public, anon;
grant execute on function private.visible_profiles() to authenticated;

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
from private.visible_profiles();

-- 窓口は読むだけ。ログインしていない人には見せない（create or replace view でも、この権限は残る）
revoke all on public.profiles_public from anon, authenticated;
grant select on public.profiles_public to authenticated;
