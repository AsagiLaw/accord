-- 第2段階の 2-1：プロフィール・ルーム・フレンド・招待を、アプリから Supabase に保存する
-- （アプリは src/lib/local/sync.ts で、ここの表をブラウザの中に写して使う）

-- ルームのアイコン（ローカル版と同じく、小さくした画像の data URL。画像を R2 に移すときに URL に替える）
alter table public.rooms
  add column icon text check (char_length(icon) <= 200000);

-- ルームを作る（0001 の create_room に、アイコンを足す）。ルームと「作った人＝ホスト」を同時に作る
drop function public.create_room(text);

create function public.create_room(room_name text, room_icon text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'ログインしていません';
  end if;
  insert into public.rooms (name, icon, created_by)
  values (room_name, room_icon, uid)
  returning id into new_id;
  insert into public.room_members (room_id, user_id, role)
  values (new_id, uid, 'host');
  return new_id;
end;
$$;

revoke all on function public.create_room(text, text) from public, anon;
grant execute on function public.create_room(text, text) to authenticated;

-- ルームを消せるのは、作った人（ホスト）だけ。メンバー・招待・ボックスの紐づけは on delete cascade で一緒に消える
create policy "ホストはルームを消せる" on public.rooms
  for delete to authenticated
  using (created_by = (select auth.uid()));

-- ほかの人の変更（フレンドの申請・承認、ルームの変更、招待）を、開いている画面にすぐ届ける（Supabase Realtime）。
-- 届くのは、それぞれの表の「見られる」決まり（RLS）で見られる行だけ。
-- ただし消した行の知らせは RLS を通らず、ログインしている全員に主キーだけが届く。
-- room_members は主キーが「ルームと人」の組なので、誰がどのルームにいたかが漏れないよう、ここには入れない（アプリがしばらくおきに読み直す）
alter publication supabase_realtime
  add table public.profiles, public.rooms, public.friendships, public.room_friend_invites;

-- 招待のカードに、ルームのアイコンも出す（0009 の get_room_friend_invite に足す。返す列が変わるので作り直す）
drop function public.get_room_friend_invite(uuid);

create function public.get_room_friend_invite(invite uuid)
returns table (room_id uuid, room_name text, room_icon text, member_count bigint, inviter_name text, expires_at timestamptz, accepted_at timestamptz, is_member boolean)
language sql stable
security definer set search_path = ''
as $$
  select
    r.id,
    r.name,
    r.icon,
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

revoke all on function public.get_room_friend_invite(uuid) from public, anon;
grant execute on function public.get_room_friend_invite(uuid) to authenticated;
