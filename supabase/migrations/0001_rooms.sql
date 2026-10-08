-- ステップ1：アカウント・ルーム・メンバー・招待
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
  is_personal boolean not null default false,
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

-- 招待リンク（1本のリンクで1人参加できる。期限7日）
create table public.room_invites (
  token uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references public.profiles (id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

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

create function public.shares_room(other uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.room_members a
    join public.room_members b on a.room_id = b.room_id
    where a.user_id = (select auth.uid()) and b.user_id = other
  );
$$;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_invites enable row level security;

create policy "自分と同じルームの人のプロフィールを見られる" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_room(id));

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

create policy "ホストは招待を見られる" on public.room_invites
  for select to authenticated
  using (public.is_room_host(room_id));

create policy "ホストは招待を作れる" on public.room_invites
  for insert to authenticated
  with check (public.is_room_host(room_id) and created_by = (select auth.uid()));

-- ルーム作成（ルームと「作った人＝ホスト」を同時に作る）
create function public.create_room(room_name text, personal boolean default false)
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
  insert into public.rooms (name, is_personal, created_by)
  values (room_name, personal, uid)
  returning id into new_id;
  insert into public.room_members (room_id, user_id, role)
  values (new_id, uid, 'host');
  return new_id;
end;
$$;

-- 招待リンクを開いたときに、参加前のルーム名を確認する
create function public.get_invite(invite_token uuid)
returns table (room_name text, inviter_name text, expired boolean, used boolean)
language sql stable security definer set search_path = ''
as $$
  select r.name, p.display_name, i.expires_at < now(), i.used_by is not null
  from public.room_invites i
  join public.rooms r on r.id = i.room_id
  join public.profiles p on p.id = i.created_by
  where i.token = invite_token;
$$;

-- 招待を受けてルームに参加する
create function public.accept_invite(invite_token uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inv public.room_invites;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select * into inv from public.room_invites where token = invite_token for update;
  if inv is null then
    raise exception 'invite not found';
  end if;
  if exists (select 1 from public.room_members where room_id = inv.room_id and user_id = uid) then
    return inv.room_id;
  end if;
  if inv.used_by is not null then
    raise exception 'invite already used';
  end if;
  if inv.expires_at < now() then
    raise exception 'invite expired';
  end if;
  insert into public.room_members (room_id, user_id, role) values (inv.room_id, uid, 'member');
  update public.room_invites set used_by = uid, used_at = now() where token = invite_token;
  return inv.room_id;
end;
$$;

-- 関数は既定で PUBLIC に実行権があるので、ログイン済みユーザーだけに絞る
revoke execute on function public.create_room(text, boolean) from public, anon;
revoke execute on function public.get_invite(uuid) from public, anon;
revoke execute on function public.accept_invite(uuid) from public, anon;
grant execute on function public.create_room(text, boolean) to authenticated;
grant execute on function public.get_invite(uuid) to authenticated;
grant execute on function public.accept_invite(uuid) to authenticated;
