-- 完全に削除したが、チャットやデータベースで使われていたので小さい画像だけ残した画像（data の gone）を、
-- どこからも使われなくなったら消す（消した印を付ける。R2 のファイルは、アプリが /api/media/delete で消す）。
-- 使われているかは、呼んだ人に見えるかどうかに関わらず、Supabase にある消していない行すべての中身で確かめる
-- （呼んだ人が抜けたルームのチャットで、まだ使われている画像を消さないように）。
-- 消せるのは、呼んだ人が編集できるボックス（持ち主か、編集もできる共有：can_edit_box）の画像だけ。もう一度流せる形にしてある

create or replace function public.cleanup_gone_media()
returns setof text
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return;
  end if;
  return query
    update public.synced_rows r
    set deleted = true
    where r.tbl = 'media'
      and not r.deleted
      and r.data ->> 'gone' = 'true'
      and public.can_edit_box(r.box_id)
      -- 画像の ID は重ならないので、行の中身を文字にして探す（発言・ページの項目やアイコン・ノートのブロックなど、どこに入っていても見つかる）
      and not exists (
        select 1 from public.synced_rows x
        where not x.deleted
          and x.tbl not in ('media', 'libraries')
          and position(r.id in x.data::text) > 0
      )
    returning r.id;
end;
$$;

revoke all on function public.cleanup_gone_media() from public, anon;
grant execute on function public.cleanup_gone_media() to authenticated;
