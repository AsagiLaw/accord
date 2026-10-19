-- ステップ1：アカウント・ルーム・メンバー
-- Supabase の SQL Editor に貼り付けて実行する。

-- プロフィール（auth.users と 1:1）
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

-- サインアップ時にプロフィールを自動作成
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ルーム
create type public.room_role as enum ('host', 'member');

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.room_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index room_members_user_idx on public.room_members (user_id);

-- RLS の中で room_members を参照すると再帰するため、判定は security definer 関数に寄せる
create function public.is_room_member(target uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.room_members
    where room_id = target and user_id = (select auth.uid())
  );
$$;

create function public.is_room_host(target uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.room_members
    where room_id = target and user_id = (select auth.uid()) and role = 'host'
  );
$$;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;

-- 表そのものを読めるのは本人だけ。ほかの人のプロフィールは、見せる用の窓口（profiles_public：0005）から読む
-- （オフライン表示や、期限の切れたひとことを、ほかの人に見せないため）
create policy "自分のプロフィールを見られる" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "自分のプロフィールを更新できる" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "メンバーはルームを見られる" on public.rooms
  for select to authenticated
  using (public.is_room_member(id));

create policy "ホストはルーム名を変えられる" on public.rooms
  for update to authenticated
  using (public.is_room_host(id))
  with check (public.is_room_host(id));

create policy "メンバーは同じルームのメンバーを見られる" on public.room_members
  for select to authenticated
  using (public.is_room_member(room_id));

-- ルーム作成（ルームと「作った人＝ホスト」を同時に作る）
create function public.create_room(room_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  insert into public.rooms (name, created_by)
  values (room_name, uid)
  returning id into new_id;
  insert into public.room_members (room_id, user_id, role)
  values (new_id, uid, 'host');
  return new_id;
end;
$$;

-- 関数は既定で PUBLIC に実行権があるので、ログイン済みユーザーだけに絞る
revoke execute on function public.create_room(text) from public, anon;
grant execute on function public.create_room(text) to authenticated;
