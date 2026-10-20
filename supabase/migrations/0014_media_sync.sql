-- 第2段階の 2-4：メディアのボックス・共有先・画像の情報・ライブラリーを Supabase に保存する。
-- ボックスと共有先は 0003 の表（media_boxes・box_shares）をそのまま使い、アプリは 2-1 と同じく写して使う（src/lib/local/sync.ts）。
-- 画像の情報とライブラリーは synced_rows（0011）に「ボックス」という置き場所（box_id）を足して入れる（src/lib/local/rowSync.ts）。
-- 見られるのはボックスを使える人（持ち主・共有されたフレンド・紐づいたルームのメンバー：0003 の can_view_box）。
-- 画像のファイルそのものは、まだブラウザの中だけ（第3段階で R2 に移す）。
-- 決まり（policy）の名前は 63 バイトまで（日本語は1文字3バイト）なので、短くする。途中まで流れていても、もう一度流せる形にしてある

-- ---- 置き場所に「ボックス」を足す ----

alter table public.synced_rows add column if not exists box_id uuid references public.media_boxes (id) on delete cascade;

-- 置き場所は「ルーム・DM・ボックス」のどれか1つ（0011 の「ルームか DM のどちらか一方」を付け直す）
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.synced_rows'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%room_id IS NULL%'
  loop
    execute format('alter table public.synced_rows drop constraint %I', c);
  end loop;
end;
$$;

alter table public.synced_rows drop constraint if exists synced_rows_scope;
alter table public.synced_rows add constraint synced_rows_scope check (num_nonnulls(room_id, dm, box_id) = 1);

alter table public.synced_rows drop constraint if exists synced_rows_tbl_check;
alter table public.synced_rows add constraint synced_rows_tbl_check check (tbl in (
  'categories', 'chats', 'messages', 'chatReads', 'imageUsers',
  'databases', 'dbPages', 'dbViews', 'events', 'todos', 'notes', 'windows',
  'media', 'libraries'
));

-- 画像の情報とライブラリーはボックスにだけ、ボックスには画像の情報とライブラリーだけを置く
alter table public.synced_rows drop constraint if exists synced_rows_box_tables;
alter table public.synced_rows add constraint synced_rows_box_tables check ((box_id is not null) = (tbl in ('media', 'libraries')));

create index if not exists synced_rows_box_idx on public.synced_rows (box_id, updated_at) where box_id is not null;

-- 画像はボックスの間を動かせる（どこの行かのうち、ボックスだけは変えてよい。動かせるかは下の決まりで見る）
create or replace function public.synced_rows_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    if new.tbl <> old.tbl or new.id <> old.id
      or new.room_id is distinct from old.room_id or new.dm is distinct from old.dm
      or (new.box_id is distinct from old.box_id and new.tbl <> 'media') then
      raise exception 'どこの行かは変えられません';
    end if;
    -- 発言の書き手は変えさせない（ホストが消すときも）
    if new.tbl = 'messages' and new.data ->> 'authorId' is distinct from old.data ->> 'authorId' then
      raise exception '発言の書き手は変えられません';
    end if;
    -- 画像を入れた人も変えさせない（完全に削除できるのは、入れた人だけのため）
    if new.tbl = 'media' and new.data ->> 'uploadedBy' is distinct from old.data ->> 'uploadedBy' then
      raise exception '画像を入れた人は変えられません';
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

-- ---- 決まり（0011 の3つを、ボックスの分も足して作り直す） ----

drop policy if exists "メンバーと DM の2人は行を見られる" on public.synced_rows;
drop policy if exists "メンバーと DM の2人は行を書ける" on public.synced_rows;
drop policy if exists "メンバーと DM の2人は行を直せる" on public.synced_rows;
drop policy if exists "行を見られる" on public.synced_rows;
drop policy if exists "行を書ける" on public.synced_rows;
drop policy if exists "行を直せる" on public.synced_rows;

-- 見られるのは、メンバー・DM の2人・ボックスを使える人
create policy "行を見られる" on public.synced_rows
  for select to authenticated
  using (
    case when box_id is not null then public.can_view_box(box_id) else public.can_see_row(room_id, dm) end
  );

-- 発言は自分の名前でだけ書ける。既読と通知の設定は自分の分だけ。画像は、編集もできるボックスに、自分が入れたものとしてだけ入れられる
-- 書けるのは、メンバー・DM の2人・ボックスを編集できる人
create policy "行を書ける" on public.synced_rows
  for insert to authenticated
  with check (
    (case
      when box_id is not null then public.can_edit_box(box_id)
      when room_id is not null then public.can_see_row(room_id, null)
      else public.can_write_dm(dm)
    end)
    and (tbl <> 'messages' or data ->> 'authorId' = (select auth.uid())::text)
    and (tbl <> 'chatReads' or data ->> 'userId' = (select auth.uid())::text)
    and (tbl <> 'media' or data ->> 'uploadedBy' = (select auth.uid())::text)
  );

-- 発言を直す・消すのは、書いた人（ルームならホストも）。既読は自分の分だけ。
-- 画像とライブラリーは、編集もできるボックスのものだけ直せて、動かす先も編集できるボックスだけ。画像を完全に削除できるのは入れた人だけ
-- 直せるのは、メンバー・DM の2人・ボックスを編集できる人
create policy "行を直せる" on public.synced_rows
  for update to authenticated
  using (
    (case when box_id is not null then public.can_edit_box(box_id) else public.can_see_row(room_id, dm) end)
    and (tbl <> 'messages' or created_by = (select auth.uid()) or (room_id is not null and public.is_room_host(room_id)))
    and (tbl <> 'chatReads' or data ->> 'userId' = (select auth.uid())::text)
  )
  with check (
    (case when box_id is not null then public.can_edit_box(box_id) else public.can_see_row(room_id, dm) end)
    and (tbl <> 'chatReads' or data ->> 'userId' = (select auth.uid())::text)
    and (tbl <> 'media' or not deleted or data ->> 'uploadedBy' = (select auth.uid())::text)
  );

-- ---- ボックスの削除と、共有をやめたときの画像の移し替え ----

-- ボックスの持ち主は、ボックス（マイメディアでないもの）を消せる。中の画像は、先に delete_box で入れた人のマイメディアに移す
drop policy if exists "持ち主はボックスを消せる" on public.media_boxes;
create policy "持ち主はボックスを消せる" on public.media_boxes
  for delete to authenticated
  using (owner_id = (select auth.uid()) and kind = 'box');

-- その人がボックスを使えるか（can_view_box の、ほかの人の分）
create or replace function private.user_can_view_box(target uuid, who uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.media_boxes where id = target and owner_id = who)
    or exists (
      select 1 from public.box_shares s
      where s.box_id = target
        and (s.user_id = who
          or (s.room_id is not null and exists (
            select 1 from public.room_members m where m.room_id = s.room_id and m.user_id = who
          )))
    );
$$;

-- ボックスの画像を、別のボックスに移す（ライブラリーからは外れる）。その画像を代表にしていたライブラリーは、代表なしに戻す
create or replace function private.move_media(media_id text, from_box uuid, to_box uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.synced_rows
    set box_id = to_box,
        data = jsonb_set(jsonb_set(data, '{boxId}', to_jsonb(to_box::text)), '{libIds}', '[]'::jsonb)
    where tbl = 'media' and id = media_id;
  update public.synced_rows
    set data = jsonb_set(data, '{repMediaId}', 'null'::jsonb)
    where tbl = 'libraries' and box_id = from_box and data ->> 'repMediaId' = media_id;
end;
$$;

-- ボックスを使えなくなった人が入れた画像を、それぞれのマイメディアに移す。移した枚数を返す
create or replace function private.return_media(target uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  mine uuid;
  n integer := 0;
begin
  for r in
    select id, (data ->> 'uploadedBy')::uuid as uploader from public.synced_rows
    where tbl = 'media' and box_id = target and not deleted
  loop
    if r.uploader is null or private.user_can_view_box(target, r.uploader) then
      continue;
    end if;
    select id into mine from public.media_boxes where owner_id = r.uploader and kind = 'mine';
    if mine is null then
      continue;
    end if;
    perform private.move_media(r.id, target, mine);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- 共有をやめる（フレンドとの共有・ルームとの紐づけ）。使えなくなった人が入れた画像は、その人のマイメディアに移る。移した枚数を返す。
-- やめられるのは、ボックスの持ち主・共有された本人（フレンドを解除したとき）・紐づいたルームを作ったホスト
create or replace function public.remove_box_share(share uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  s public.box_shares;
  owner uuid;
begin
  if me is null then
    raise exception 'ログインしていません';
  end if;
  select * into s from public.box_shares where id = share;
  if s.id is null then
    return 0;
  end if;
  select owner_id into owner from public.media_boxes where id = s.box_id;
  if not (owner = me or s.user_id = me
    or (s.room_id is not null and exists (select 1 from public.rooms where id = s.room_id and created_by = me))) then
    raise exception 'この共有はやめられません';
  end if;
  delete from public.box_shares where id = share;
  return private.return_media(s.box_id);
end;
$$;

-- ボックスを消す（マイメディアは消せない）。中の画像は、入れた人のマイメディアに移す（入れた人がもういなければ持ち主の）。
-- ライブラリーと共有先は消える
create or replace function public.delete_box(target uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  b public.media_boxes;
  r record;
  dest uuid;
  owner_mine uuid;
begin
  select * into b from public.media_boxes where id = target;
  if b.id is null then
    return;
  end if;
  if b.owner_id <> me or b.kind <> 'box' then
    raise exception 'このボックスは消せません';
  end if;
  select id into owner_mine from public.media_boxes where owner_id = b.owner_id and kind = 'mine';
  for r in
    select id, (data ->> 'uploadedBy')::uuid as uploader from public.synced_rows
    where tbl = 'media' and box_id = target
  loop
    dest := null;
    select id into dest from public.media_boxes where owner_id = r.uploader and kind = 'mine';
    perform private.move_media(r.id, target, coalesce(dest, owner_mine));
  end loop;
  -- ライブラリーは、消えたことがほかの人にも届くよう、印を付けてから消す（ボックスを消すと一緒に消える）
  update public.synced_rows set deleted = true where tbl = 'libraries' and box_id = target;
  delete from public.media_boxes where id = target;
end;
$$;

revoke all on function private.user_can_view_box(uuid, uuid) from public, anon, authenticated;
revoke all on function private.move_media(text, uuid, uuid) from public, anon, authenticated;
revoke all on function private.return_media(uuid) from public, anon, authenticated;
revoke all on function public.remove_box_share(uuid) from public, anon;
revoke all on function public.delete_box(uuid) from public, anon;
grant execute on function public.remove_box_share(uuid) to authenticated;
grant execute on function public.delete_box(uuid) to authenticated;

-- ボックスと共有先の変更を、開いている画面にすぐ届ける（消した行の知らせは、主キー＝ID だけが届く）
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'media_boxes') then
    alter publication supabase_realtime add table public.media_boxes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'box_shares') then
    alter publication supabase_realtime add table public.box_shares;
  end if;
end;
$$;
