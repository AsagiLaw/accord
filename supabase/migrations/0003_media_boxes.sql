-- メディアのボックス：画像とライブラリーを入れる入れ物。持ち主は1人で、フレンドやルームと共有できる
-- （画像とライブラリーの表は、メディアの表と一緒に作る。どちらも box_id でボックスに入る）

create type public.box_kind as enum ('mine', 'box');

create table public.media_boxes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  -- mine：アカウントごとに1つの「マイメディア」（削除・共有・紐づけはできない）
  kind public.box_kind not null default 'box',
  created_at timestamptz not null default now()
);

create unique index media_boxes_one_mine_idx on public.media_boxes (owner_id) where kind = 'mine';

-- 共有先：フレンド（user_id）か、ルーム（room_id。メンバー全員）のどちらか一方
create table public.box_shares (
  id uuid primary key default gen_random_uuid(),
  box_id uuid not null references public.media_boxes (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete cascade,
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  check ((user_id is null) <> (room_id is null))
);

-- 1つのルームに紐づけられるボックスは1つだけ。同じ人に同じボックスを二重に共有しない
create unique index box_shares_room_idx on public.box_shares (room_id) where room_id is not null;
create unique index box_shares_user_idx on public.box_shares (box_id, user_id) where user_id is not null;
create index box_shares_box_idx on public.box_shares (box_id);

-- 見られるか：持ち主・共有されたフレンド・紐づいたルームのメンバー
create function public.can_view_box(target uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.media_boxes where id = target and owner_id = (select auth.uid()))
    or exists (
      select 1 from public.box_shares s
      where s.box_id = target
        and (s.user_id = (select auth.uid())
          or (s.room_id is not null and exists (
            select 1 from public.room_members m where m.room_id = s.room_id and m.user_id = (select auth.uid())
          )))
    );
$$;

-- 画像を入れたり整理したりできるか：持ち主か、編集もできる共有
create function public.can_edit_box(target uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.media_boxes where id = target and owner_id = (select auth.uid()))
    or exists (
      select 1 from public.box_shares s
      where s.box_id = target and s.can_edit
        and (s.user_id = (select auth.uid())
          or (s.room_id is not null and exists (
            select 1 from public.room_members m where m.room_id = s.room_id and m.user_id = (select auth.uid())
          )))
    );
$$;

alter table public.media_boxes enable row level security;
alter table public.box_shares enable row level security;

create policy "使えるボックスを見られる" on public.media_boxes
  for select to authenticated
  using (public.can_view_box(id));

create policy "自分のボックスを作れる" on public.media_boxes
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and kind = 'box');

create policy "持ち主はボックスの名前を変えられる" on public.media_boxes
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- 削除は、中の画像を入れた人のマイメディアに移してから行うので、関数（delete_box）で行う。マイメディアは消せない

create policy "使えるボックスの共有先を見られる" on public.box_shares
  for select to authenticated
  using (public.can_view_box(box_id));

-- フレンドとの共有の追加・変更・解除は、ボックスの持ち主だけ（マイメディアは共有できない）。
-- 共有をやめたときの画像の移し替えも、関数で行う
create policy "持ち主はフレンドとの共有を決められる" on public.box_shares
  for all to authenticated
  using (user_id is not null and exists (select 1 from public.media_boxes b where b.id = box_id and b.owner_id = (select auth.uid()) and b.kind = 'box'))
  with check (user_id is not null and exists (select 1 from public.media_boxes b where b.id = box_id and b.owner_id = (select auth.uid()) and b.kind = 'box'));

-- ルームのメディア（紐づけるボックス・権限）を変えられるのは、ルームを作ったホストだけ
create policy "ルームを作ったホストはルームの紐づけを決められる" on public.box_shares
  for all to authenticated
  using (room_id is not null and exists (select 1 from public.rooms r where r.id = room_id and r.created_by = (select auth.uid())))
  with check (
    room_id is not null
    and exists (select 1 from public.rooms r where r.id = room_id and r.created_by = (select auth.uid()))
    and exists (select 1 from public.media_boxes b where b.id = box_id and b.kind = 'box')
  );

-- サインアップしたら、マイメディアも作る
create function public.handle_new_profile_media()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.media_boxes (owner_id, name, kind) values (new.id, 'マイメディア', 'mine');
  return new;
end;
$$;

create trigger on_profile_created_media
  after insert on public.profiles
  for each row execute function public.handle_new_profile_media();
