-- チャットの発言のリアクション（Discord と同じ）。1人が1つの発言に付けた絵文字ごとに1行を synced_rows（0011）に入れる。
-- 置き場所は発言と同じ（ルームか DM）。見られるのは発言を見られる人。付ける・外すのは自分の分だけ。
-- ピン留めはチャットの行（chats）に持つので、表は足さない。「入力中…」の知らせを、チャットを見られる人だけに届ける決まりも足す。
-- もう一度流せる形にしてある

-- ---- 置ける表に「reactions」を足す ----

alter table public.synced_rows drop constraint if exists synced_rows_tbl_check;
alter table public.synced_rows add constraint synced_rows_tbl_check check (tbl in (
  'categories', 'chats', 'messages', 'reactions', 'chatReads', 'imageUsers',
  'databases', 'dbPages', 'dbViews', 'events', 'todos', 'notes', 'windows',
  'media', 'libraries'
));

-- DM に置けるのは、チャット・発言・リアクション・既読だけ（0013 の続き）
alter table public.synced_rows drop constraint if exists synced_rows_dm_tables;
alter table public.synced_rows add constraint synced_rows_dm_tables check (
  dm is null or tbl in ('chats', 'messages', 'reactions', 'chatReads')
);

-- ---- 書ける・直せる決まりに、リアクションは自分の分だけを足す ----

drop policy if exists "行を書ける" on public.synced_rows;

-- 発言は自分の名前でだけ書ける。既読・通知の設定・リアクションは自分の分だけ。画像は、編集もできるボックスに、自分が入れたものとしてだけ入れられる
-- 書けるのは、メンバー・DM の2人・ボックスを編集できる人（0014 の続き）
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
    and (tbl <> 'reactions' or data ->> 'userId' = (select auth.uid())::text)
    and (tbl <> 'media' or data ->> 'uploadedBy' = (select auth.uid())::text)
  );

drop policy if exists "行を直せる" on public.synced_rows;

-- 発言を直す・消すのは、書いた人（ルームならホストも。イメージチャット・やり取り再現チャットはメンバーの誰でも）。既読とリアクションは自分の分だけ。
-- 画像とライブラリーは、編集もできるボックスのものだけ直せて（完全に削除も）、動かす先も編集できるボックスだけ（0022 の続き）
create policy "行を直せる" on public.synced_rows
  for update to authenticated
  using (
    (case when box_id is not null then public.can_edit_box(box_id) else public.can_see_row(room_id, dm) end)
    and (tbl <> 'messages' or created_by = (select auth.uid())
      or (room_id is not null and (public.is_room_host(room_id) or public.is_shared_chat_message(room_id, data ->> 'chatId'))))
    and (tbl <> 'chatReads' or data ->> 'userId' = (select auth.uid())::text)
    and (tbl <> 'reactions' or data ->> 'userId' = (select auth.uid())::text)
  )
  with check (
    (case when box_id is not null then public.can_edit_box(box_id) else public.can_see_row(room_id, dm) end)
    and (tbl <> 'messages' or created_by = (select auth.uid())
      or (room_id is not null and (public.is_room_host(room_id) or public.is_shared_chat_message(room_id, data ->> 'chatId'))))
    and (tbl <> 'chatReads' or data ->> 'userId' = (select auth.uid())::text)
    and (tbl <> 'reactions' or data ->> 'userId' = (select auth.uid())::text)
  );

-- ---- 「入力中…」の知らせ（Realtime の broadcast） ----
-- チャンネルの名前は「typing:チャットの ID」。受け取る・送るのは、そのチャットを見られる人だけ（アプリは private のチャンネルでつなぐ）

-- そのチャットを見られるか（ルームのメンバー・DM の2人）
create or replace function private.can_see_chat(chat text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.synced_rows c
    where c.tbl = 'chats' and c.id = chat and not c.deleted
      and public.can_see_row(c.room_id, c.dm)
  );
$$;

revoke all on function private.can_see_chat(text) from public, anon;
grant execute on function private.can_see_chat(text) to authenticated;

drop policy if exists "入力中を受け取れる" on realtime.messages;
create policy "入力中を受け取れる" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'typing:%'
    and private.can_see_chat(substr(realtime.topic(), 8))
  );

drop policy if exists "入力中を送れる" on realtime.messages;
create policy "入力中を送れる" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'typing:%'
    and private.can_see_chat(substr(realtime.topic(), 8))
  );
