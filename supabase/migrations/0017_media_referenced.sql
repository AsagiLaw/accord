-- 第3段階：チャット・DM・ノート・ページなどに貼った画像は、それを見られる人なら見られるようにする（ローカル版と同じ決まり）。
-- DM で送った画像は送った人のマイメディアに入り、ノートに貼った画像も、貼った人のボックスに入っていることがある。
-- ボックスの決まり（can_view_box）だけだと、相手には画像の情報もファイルも見えないので、
-- 「見られる行（ルームの行・DM の行）の中身に、その画像の ID が書かれていれば見てよい」とする。
-- 重い確かめなので、決まり（policy）には入れず、必要なときだけ呼ぶ関数にする（アプリと /api/media/sign が使う）

-- 見てよい画像の情報（ID で引く）。ボックスで見られる画像と、見られる行に貼られている画像
create or replace function public.media_for_ids(ids text[])
returns setof public.synced_rows
language sql stable security definer set search_path = ''
as $$
  select r.* from public.synced_rows r
  where r.tbl = 'media'
    and r.id = any (ids)
    and not r.deleted
    and (
      public.can_view_box(r.box_id)
      or exists (
        select 1 from public.synced_rows x
        where x.box_id is null
          and not x.deleted
          and (
            x.room_id in (select m.room_id from public.room_members m where m.user_id = (select auth.uid()))
            or (select auth.uid()) = any (x.dm)
          )
          and position(r.id in x.data::text) > 0
      )
    );
$$;

-- 一度に引ける数を抑える（アプリは100件ずつ引く）
create or replace function public.media_for_ids_checked(ids text[])
returns setof public.synced_rows
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return;
  end if;
  if coalesce(array_length(ids, 1), 0) > 200 then
    raise exception '一度に引けるのは200件までです';
  end if;
  return query select * from public.media_for_ids(ids);
end;
$$;

revoke all on function public.media_for_ids(text[]) from public, anon, authenticated;
revoke all on function public.media_for_ids_checked(text[]) from public, anon;
grant execute on function public.media_for_ids_checked(text[]) to authenticated;
