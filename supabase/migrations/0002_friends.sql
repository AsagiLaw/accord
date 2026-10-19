-- フレンド：申請を送り、相手が承認するとフレンドになる。断る・取り消す・解除は行を消す
-- （ダイレクトメッセージの表は、チャットの表と一緒に作る）

create type public.friend_status as enum ('pending', 'accepted');

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles (id) on delete cascade,
  to_id uuid not null references public.profiles (id) on delete cascade,
  status public.friend_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_id <> to_id)
);

-- 同じ2人の間柄は1つだけ（どちらから申請しても）
create unique index friendships_pair_idx
  on public.friendships (least(from_id, to_id), greatest(from_id, to_id));
create index friendships_to_idx on public.friendships (to_id);

alter table public.friendships enable row level security;

create policy "自分の間柄を見られる" on public.friendships
  for select to authenticated
  using (from_id = (select auth.uid()) or to_id = (select auth.uid()));

create policy "自分から申請を送れる" on public.friendships
  for insert to authenticated
  with check (from_id = (select auth.uid()) and status = 'pending');

create policy "届いた申請を承認できる" on public.friendships
  for update to authenticated
  using (to_id = (select auth.uid()) and status = 'pending')
  with check (to_id = (select auth.uid()) and status = 'accepted');

create policy "自分の間柄を消せる（断る・取り消す・解除）" on public.friendships
  for delete to authenticated
  using (from_id = (select auth.uid()) or to_id = (select auth.uid()));

-- 申請中も含め、間柄のある人のプロフィールは、見せる用の窓口（profiles_public：0005）から見られる。
-- 相手は ID で探す（send_friend_request：0009）
