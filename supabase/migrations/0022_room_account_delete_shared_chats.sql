-- 不具合の直し：
-- 1. ルームを消したとき、紐づけ（box_shares）が on delete cascade で一緒に消えるだけで、メンバーが入れた画像が
--    メンバーのマイメディアに移らなかった（あとから remove_box_share を呼んでも、紐づけがもう無いので何もしない）。
--    紐づけをやめて画像を移してから、ルームを消す関数（delete_room）にする
-- 2. アカウントを消したとき、自分のボックスが on delete cascade で中の画像ごと消え、フレンドが入れた画像まで消えていた。
--    先に delete_box（0014）で、中の画像を入れた人のマイメディアに移してから消す
-- 3. イメージチャット・やり取り再現チャットの発言は、ルームのメンバーなら誰でも直せる・消せる（画面と同じ。みんなで会話を書き起こすため）。
--    これまでは書いた人とホストだけで、ほかのメンバーが直しても Supabase に断られ、直した人の画面だけが変わっていた
-- 4. 発言などを書いたことのある人は、アカウントを消せなかった。アカウントを消すと、行の書いた人・直した人の印が on delete set null で外れるが、
--    そのときも synced_rows_stamp が印を付け直し（消えるアカウントの ID）、外部キーの決まりに断られていた
-- もう一度流せる形にしてある

-- ---- 4. 書いた人・直した人の印（0014 の synced_rows_stamp の続き） ----

-- その人のプロフィールがあるか（決まり（RLS）に関わらず確かめる）
create or replace function private.profile_exists(who uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = who);
$$;

revoke all on function private.profile_exists(uuid) from public, anon;
grant execute on function private.profile_exists(uuid) to authenticated;

-- 書いた人と時刻は、Supabase が決める。どこの行か・書いた人は、あとから変えさせない（画像はボックスの間だけ動かせる）。
-- 書いた人・直した人のアカウントを消したとき（on delete set null）だけは、印を外すのをそのまま通す
create or replace function public.synced_rows_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    if new.created_by is null and old.created_by is not null and new.updated_by is not distinct from old.updated_by then
      if not private.profile_exists(old.created_by) then
        return new;
      end if;
    end if;
    if new.updated_by is null and old.updated_by is not null and new.created_by is not distinct from old.created_by then
      if not private.profile_exists(old.updated_by) then
        return new;
      end if;
    end if;
    if new.tbl <> old.tbl or new.id <> old.id
      or new.room_id is distinct from old.room_id or new.dm is distinct from old.dm
      or (new.box_id is distinct from old.box_id and new.tbl <> 'media') then
      raise exception 'どこの行かは変えられません';
    end if;
    -- 発言の書き手は変えさせない（ホストが消すときも）
    if new.tbl = 'messages' and new.data ->> 'authorId' is distinct from old.data ->> 'authorId' then
      raise exception '発言の書き手は変えられません';
    end if;
    -- 画像を入れた人も変えさせない
    if new.tbl = 'media' and new.data ->> 'uploadedBy' is distinct from old.data ->> 'uploadedBy' then
      raise exception '画像を入れた人は変えられません';
    end if;
    new.created_by := old.created_by;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

-- ---- 1. ルームを消す ----

-- ルームを消す（消せるのは、ルームを作ったホストだけ）。紐づいたボックスを使えなくなったメンバーが入れた画像は、
-- その人のマイメディアに移す（remove_box_share と同じ）。メンバー・招待・ルームの中の行は on delete cascade で一緒に消える
create or replace function public.delete_room(target uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  creator uuid;
  s record;
begin
  if me is null then
    raise exception 'ログインしていません';
  end if;
  select created_by into creator from public.rooms where id = target;
  if not found then
    return;
  end if;
  if creator <> me then
    raise exception 'ルームを削除できるのは、ルームを作ったホストだけです';
  end if;
  for s in select id, box_id from public.box_shares where room_id = target loop
    delete from public.box_shares where id = s.id;
    perform private.return_media(s.box_id);
  end loop;
  delete from public.rooms where id = target;
end;
$$;

revoke all on function public.delete_room(uuid) from public, anon;
grant execute on function public.delete_room(uuid) to authenticated;

-- ---- 2. アカウントを消す ----

-- 自分のアカウントを削除する（0008 の続き）。ホストのルームがあるうちは削除できない。
-- 自分のボックス（マイメディアでないもの）は、delete_box と同じく中の画像を入れた人のマイメディアに移してから消す
-- （自分が入れた画像は自分のマイメディアに移り、アカウントと一緒に消える）
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  b record;
begin
  if me is null then
    raise exception 'ログインしていません';
  end if;
  if exists (select 1 from public.rooms where created_by = me) then
    raise exception 'ホストになっているルームを、先に削除してください';
  end if;
  for b in select id from public.media_boxes where owner_id = me and kind = 'box' loop
    perform public.delete_box(b.id);
  end loop;
  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---- 3. イメージチャット・やり取り再現チャットの発言 ----

-- その発言が、ルームのイメージチャット・やり取り再現チャットのものか（同じルームのチャットだけ）
create or replace function public.is_shared_chat_message(r_room uuid, chat_id text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select r_room is not null and exists (
    select 1 from public.synced_rows c
    where c.tbl = 'chats'
      and c.id = chat_id
      and c.room_id = r_room
      and not c.deleted
      and c.data ->> 'kind' in ('image', 'reenact')
  );
$$;

revoke all on function public.is_shared_chat_message(uuid, text) from public, anon;
grant execute on function public.is_shared_chat_message(uuid, text) to authenticated;

drop policy if exists "行を直せる" on public.synced_rows;

-- 発言を直す・消すのは、書いた人（ルームならホストも。イメージチャット・やり取り再現チャットはメンバーの誰でも）。既読は自分の分だけ。
-- イメージチャット・やり取り再現チャットの発言を、ほかの人の名前のままふつうのチャットへ動かせないよう、直したあとの行も確かめる。
-- 画像とライブラリーは、編集もできるボックスのものだけ直せて（完全に削除も）、動かす先も編集できるボックスだけ（0020 と同じ）
-- 直せるのは、メンバー・DM の2人・ボックスを編集できる人
create policy "行を直せる" on public.synced_rows
  for update to authenticated
  using (
    (case when box_id is not null then public.can_edit_box(box_id) else public.can_see_row(room_id, dm) end)
    and (tbl <> 'messages' or created_by = (select auth.uid())
      or (room_id is not null and (public.is_room_host(room_id) or public.is_shared_chat_message(room_id, data ->> 'chatId'))))
    and (tbl <> 'chatReads' or data ->> 'userId' = (select auth.uid())::text)
  )
  with check (
    (case when box_id is not null then public.can_edit_box(box_id) else public.can_see_row(room_id, dm) end)
    and (tbl <> 'messages' or created_by = (select auth.uid())
      or (room_id is not null and (public.is_room_host(room_id) or public.is_shared_chat_message(room_id, data ->> 'chatId'))))
    and (tbl <> 'chatReads' or data ->> 'userId' = (select auth.uid())::text)
  );
