-- アカウントの ID（Discord のユーザー名と同じ）と、フレンドをルームに招待する
-- ID：半角の英小文字・数字・「_」「.」で2〜32文字（「.」は2つ続けない）。ほかの人と重ならない。
-- 登録のときに自分で決め、あとで変えられる。フレンドの申請は ID で送る（名前では探さない）

-- ---- ID ----------------------------------------------------------------------

-- 重ならない仮の ID を作る（自分で決めていない人：今いる人と、Google で登録した人）。
-- 名前の英数字を元にし、使えなければ後ろに数字を付ける。英数字が無ければ「user」と数字
create function public.make_username(base text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  stem text := left(regexp_replace(regexp_replace(lower(coalesce(base, '')), '[^a-z0-9_.]+', '', 'g'), '\.{2,}', '.', 'g'), 27);
  candidate text;
begin
  if char_length(stem) >= 2 and not exists (select 1 from public.profiles where username = stem) then
    return stem;
  end if;
  if char_length(stem) < 2 then
    stem := 'user';
  end if;
  loop
    candidate := stem || lpad(floor(random() * 10000)::text, 4, '0');
    exit when not exists (select 1 from public.profiles where username = candidate);
  end loop;
  return candidate;
end;
$$;

revoke all on function public.make_username(text) from public, anon, authenticated;

alter table public.profiles add column username text;

-- 今いる人には、名前から仮の ID を付ける（1人ずつ。同じ文の中では、前の人の ID が見えないため）
do $$
declare
  r record;
begin
  for r in select id, display_name from public.profiles where username is null order by created_at loop
    update public.profiles set username = public.make_username(r.display_name) where id = r.id;
  end loop;
end;
$$;

alter table public.profiles
  alter column username set not null,
  add constraint profiles_username_format check (username ~ '^[a-z0-9_.]{2,32}$' and position('..' in username) = 0);

create unique index profiles_username_idx on public.profiles (username);

-- 登録したときのプロフィール（0008 の続き）：登録の画面で決めた ID。決めていない（Google）・もう使われているときは仮の ID。
-- メールアドレスからは ID を作らない（ほかの人に見えるため）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  wanted text := lower(nullif(new.raw_user_meta_data ->> 'username', ''));
  meta_name text := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', '')
  );
begin
  insert into public.profiles (id, display_name, avatar, username)
  values (
    new.id,
    coalesce(meta_name, split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    case
      when wanted ~ '^[a-z0-9_.]{2,32}$' and position('..' in wanted) = 0
        and not exists (select 1 from public.profiles where username = wanted) then wanted
      else public.make_username(meta_name)
    end
  );
  return new;
end;
$$;

-- 登録の画面で、入れた ID がまだ使われていないか確かめる（ログインの前にも使うので anon にも許す）
create function public.username_available(name text)
returns boolean
language sql stable
security definer set search_path = ''
as $$
  select lower(name) ~ '^[a-z0-9_.]{2,32}$'
    and position('..' in name) = 0
    and not exists (select 1 from public.profiles where username = lower(name));
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- ほかの人に見せるプロフィールにも ID を出す（0007 の続き。列は後ろに足す）
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
  status_expires_at,
  username
from private.visible_profiles();

-- 相手の ID でフレンドの申請を送る。相手のプロフィールは見られないので、探すのはこの関数の中で行う。
-- 相手からの申請が届いていれば、送る代わりに承認する。
-- 返す値：sent（送った）・accepted（フレンドになった）・already（もうフレンド）・pending（もう送ってある）・self（自分）・not_found（いない）
create function public.send_friend_request(target_username text)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  target uuid;
  existing public.friendships;
begin
  if me is null then
    raise exception 'ログインしていません';
  end if;
  select id into target from public.profiles where username = lower(ltrim(trim(target_username), '@'));
  if target is null then
    return 'not_found';
  end if;
  if target = me then
    return 'self';
  end if;
  select * into existing from public.friendships
    where least(from_id, to_id) = least(me, target) and greatest(from_id, to_id) = greatest(me, target)
    for update;
  if existing.id is not null then
    if existing.status = 'accepted' then
      return 'already';
    end if;
    if existing.from_id = me then
      return 'pending';
    end if;
    update public.friendships set status = 'accepted', responded_at = now() where id = existing.id;
    return 'accepted';
  end if;
  insert into public.friendships (from_id, to_id) values (me, target);
  return 'sent';
end;
$$;

revoke all on function public.send_friend_request(text) from public, anon;
grant execute on function public.send_friend_request(text) to authenticated;

-- ---- ルームへの招待 ---------------------------------------------------------------
-- フレンドとの DM に招待のカードを送り、相手が「参加する」を押すとメンバーになる（期限7日）。
-- 招待できるのはホストと、ホストが「メンバーもフレンドを招待できる」にしたルームのメンバー。
-- DM のカード（発言の invite_id）は、チャットの表を作るときに足す

alter table public.rooms add column members_can_invite boolean not null default false;

create table public.room_friend_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  from_id uuid not null references public.profiles (id) on delete cascade,
  to_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check (from_id <> to_id)
);

create index room_friend_invites_room_idx on public.room_friend_invites (room_id);
create index room_friend_invites_to_idx on public.room_friend_invites (to_id);

-- 自分がそのルームに招待できるか
create function public.can_invite_to_room(target uuid)
returns boolean
language sql stable
security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.room_members m
    join public.rooms r on r.id = m.room_id
    where m.room_id = target
      and m.user_id = (select auth.uid())
      and (m.role = 'host' or r.members_can_invite)
  );
$$;

alter table public.room_friend_invites enable row level security;

create policy "送った招待と届いた招待を見られる" on public.room_friend_invites
  for select to authenticated
  using (from_id = (select auth.uid()) or to_id = (select auth.uid()));

-- 招待を作るのと参加するのは、下の関数だけで行う
create policy "送った人は、参加される前なら取り消せる" on public.room_friend_invites
  for delete to authenticated
  using (from_id = (select auth.uid()) and accepted_at is null);

-- フレンドを招待する。まだ使える招待をもう送ってあれば、それを返す（同じ招待を何度も作らない）
create function public.invite_friend_to_room(target_room uuid, friend uuid)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  found uuid;
begin
  if me is null then
    raise exception 'ログインしていません';
  end if;
  if not public.can_invite_to_room(target_room) then
    raise exception 'このルームに招待できるのはホストだけです';
  end if;
  if not exists (
    select 1 from public.friendships
    where status = 'accepted'
      and least(from_id, to_id) = least(me, friend) and greatest(from_id, to_id) = greatest(me, friend)
  ) then
    raise exception 'フレンドにだけ招待を送れます';
  end if;
  if exists (select 1 from public.room_members where room_id = target_room and user_id = friend) then
    raise exception 'もうこのルームのメンバーです';
  end if;
  select id into found from public.room_friend_invites
    where room_id = target_room and from_id = me and to_id = friend and accepted_at is null and expires_at > now()
    limit 1;
  if found is not null then
    return found;
  end if;
  insert into public.room_friend_invites (room_id, from_id, to_id) values (target_room, me, friend) returning id into found;
  return found;
end;
$$;

-- 招待のカードに出すもの（招待された人は、参加する前のルームの名前と人数を見られる）
create function public.get_room_friend_invite(invite uuid)
returns table (room_id uuid, room_name text, member_count bigint, inviter_name text, expires_at timestamptz, accepted_at timestamptz, is_member boolean)
language sql stable
security definer set search_path = ''
as $$
  select
    r.id,
    r.name,
    (select count(*) from public.room_members m where m.room_id = r.id),
    p.display_name,
    i.expires_at,
    i.accepted_at,
    exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = (select auth.uid()))
  from public.room_friend_invites i
  join public.rooms r on r.id = i.room_id
  left join public.profiles p on p.id = i.from_id
  where i.id = invite
    and (i.from_id = (select auth.uid()) or i.to_id = (select auth.uid()));
$$;

-- 招待を受けてルームに参加する（招待された本人だけ。期限の前だけ）
create function public.accept_room_friend_invite(invite uuid)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  inv public.room_friend_invites;
begin
  if me is null then
    raise exception 'ログインしていません';
  end if;
  select * into inv from public.room_friend_invites where id = invite for update;
  if inv.id is null then
    raise exception 'この招待は取り消されました';
  end if;
  if inv.to_id <> me then
    raise exception 'この招待は、ほかの人あてです';
  end if;
  if exists (select 1 from public.room_members where room_id = inv.room_id and user_id = me) then
    return inv.room_id;
  end if;
  if inv.accepted_at is not null or inv.expires_at < now() then
    raise exception '招待の期限が切れています';
  end if;
  insert into public.room_members (room_id, user_id, role) values (inv.room_id, me, 'member');
  update public.room_friend_invites set accepted_at = now() where id = invite;
  return inv.room_id;
end;
$$;

revoke all on function public.can_invite_to_room(uuid) from public, anon;
revoke all on function public.invite_friend_to_room(uuid, uuid) from public, anon;
revoke all on function public.get_room_friend_invite(uuid) from public, anon;
revoke all on function public.accept_room_friend_invite(uuid) from public, anon;
grant execute on function public.can_invite_to_room(uuid) to authenticated;
grant execute on function public.invite_friend_to_room(uuid, uuid) to authenticated;
grant execute on function public.get_room_friend_invite(uuid) to authenticated;
grant execute on function public.accept_room_friend_invite(uuid) to authenticated;
