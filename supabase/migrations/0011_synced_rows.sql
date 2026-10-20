-- 第2段階の 2-2：チャット（カテゴリー・チャット・発言・既読・イメージユーザー）を Supabase に保存する。
-- アプリはブラウザの中（IndexedDB）に書き、書いた行をそのままここに送る（src/lib/local/rowSync.ts）。
-- 行の中身は data（ブラウザの中と同じ形の JSON）に入れる。2-3 のデータベース・ノートなども、tbl を足すだけで同じ表に入る。
-- 見られるのは、ルームの行はルームのメンバー、DM の行はその2人だけ

-- ---- プロフィールとルームの「最後に変えた時刻」（2-1 の読み直しで、変わった分だけを読むため） ----

alter table public.profiles add column updated_at timestamptz not null default now();
alter table public.rooms add column updated_at timestamptz not null default now();

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger rooms_touch before update on public.rooms
  for each row execute function public.touch_updated_at();

-- 見せる用の窓口にも足す（0009 の続き。列は後ろに足す）
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
  username,
  -- ひとことの期限が切れたのも「変わった」として読み直す
  greatest(updated_at, case when status_expires_at <= now() then status_expires_at end) as updated_at
from private.visible_profiles();

-- ---- 行の表 ----

create table public.synced_rows (
  -- ブラウザの中の表の名前と、その中の ID（既読は「チャットの ID|人の ID」）
  tbl text not null check (tbl in ('categories', 'chats', 'messages', 'chatReads', 'imageUsers')),
  id text not null check (char_length(id) <= 100),
  -- どこの行か：ルーム（room_id）か、DM の2人（dm）のどちらか一方
  room_id uuid references public.rooms (id) on delete cascade,
  dm uuid[],
  data jsonb not null,
  -- 消した行は、ほかの人にも消えたと伝えるため、しばらく印を付けて残す
  deleted boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tbl, id),
  check ((room_id is null) <> (dm is null)),
  check (dm is null or array_length(dm, 1) = 2),
  check (pg_column_size(data) <= 200000)
);

create index synced_rows_room_idx on public.synced_rows (room_id, updated_at) where room_id is not null;
create index synced_rows_dm_idx on public.synced_rows using gin (dm) where dm is not null;
create index synced_rows_updated_idx on public.synced_rows (updated_at);

-- 書いた人と時刻は、Supabase が決める。どこの行か・書いた人は、あとから変えさせない
create function public.synced_rows_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    if new.tbl <> old.tbl or new.id <> old.id
      or new.room_id is distinct from old.room_id or new.dm is distinct from old.dm then
      raise exception 'どこの行かは変えられません';
    end if;
    -- 発言の書き手は変えさせない（ホストが消すときも）
    if new.tbl = 'messages' and new.data ->> 'authorId' is distinct from old.data ->> 'authorId' then
      raise exception '発言の書き手は変えられません';
    end if;
    new.created_by := old.created_by;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create trigger synced_rows_stamp before insert or update on public.synced_rows
  for each row execute function public.synced_rows_stamp();

-- 見られるか：ルームのメンバーか、DM の2人のどちらか
create function public.can_see_row(r_room uuid, r_dm uuid[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when r_room is not null then exists (
      select 1 from public.room_members where room_id = r_room and user_id = (select auth.uid())
    )
    else (select auth.uid()) = any (r_dm)
  end;
$$;

-- DM に書けるか：自分が2人に入っていて、相手とフレンド
create function public.can_write_dm(r_dm uuid[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) = any (r_dm)
    and exists (
      select 1 from public.friendships
      where status = 'accepted'
        and least(from_id, to_id) = least(r_dm[1], r_dm[2])
        and greatest(from_id, to_id) = greatest(r_dm[1], r_dm[2])
    );
$$;

revoke all on function public.can_see_row(uuid, uuid[]) from public, anon;
revoke all on function public.can_write_dm(uuid[]) from public, anon;
grant execute on function public.can_see_row(uuid, uuid[]) to authenticated;
grant execute on function public.can_write_dm(uuid[]) to authenticated;

alter table public.synced_rows enable row level security;

create policy "メンバーと DM の2人は行を見られる" on public.synced_rows
  for select to authenticated
  using (public.can_see_row(room_id, dm));

-- 発言は自分の名前でだけ書ける。既読と通知の設定は自分の分だけ
create policy "メンバーと DM の2人は行を書ける" on public.synced_rows
  for insert to authenticated
  with check (
    (case when room_id is not null then public.can_see_row(room_id, null) else public.can_write_dm(dm) end)
    and (tbl <> 'messages' or data ->> 'authorId' = (select auth.uid())::text)
    and (tbl <> 'chatReads' or data ->> 'userId' = (select auth.uid())::text)
  );

-- 発言を直す・消すのは、書いた人（ルームならホストも）。既読は自分の分だけ。ほかの行はメンバーと DM の2人が直せる
create policy "メンバーと DM の2人は行を直せる" on public.synced_rows
  for update to authenticated
  using (
    public.can_see_row(room_id, dm)
    and (tbl <> 'messages' or created_by = (select auth.uid()) or (room_id is not null and public.is_room_host(room_id)))
    and (tbl <> 'chatReads' or data ->> 'userId' = (select auth.uid())::text)
  )
  with check (
    public.can_see_row(room_id, dm)
    and (tbl <> 'chatReads' or data ->> 'userId' = (select auth.uid())::text)
  );

-- 行は消さずに deleted の印を付ける（ルームを消したときだけ、on delete cascade で消える）

-- 書かれた行を、開いている画面にすぐ届ける。消した行の知らせは主キー（表の名前と ID）だけが全員に届くが、
-- 行を消すのはルームを消したときだけで、ID からは中身も、誰のものかも分からない
alter publication supabase_realtime add table public.synced_rows;
