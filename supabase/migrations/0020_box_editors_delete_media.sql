-- 画像を完全に削除できる人を、入れた本人から「ボックスの持ち主と、編集もできる共有の人（can_edit_box）」に広げる。
-- 0014 の「行を直せる」の、消した印（deleted）を付けられるのは入れた本人だけ、という決まりを外す。もう一度流せる形にしてある

drop policy if exists "行を直せる" on public.synced_rows;

-- 発言を直す・消すのは、書いた人（ルームならホストも）。既読は自分の分だけ。
-- 画像とライブラリーは、編集もできるボックスのものだけ直せて（完全に削除も）、動かす先も編集できるボックスだけ
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
  );
