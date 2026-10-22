-- 「名前を自動で付ける」をボックスごとの設定にする（これまでは端末ごと）。
-- そのボックスに画像を入れる人は、誰でも、どの端末からでも同じ設定で名前が付く。
-- 変えられるのは、そのボックスに画像を入れられる人（持ち主か、編集もできる共有：can_edit_box）。
-- 表の update は持ち主だけ（名前の変更：0003）なので、関数で変える。もう一度流せる形にしてある

alter table public.media_boxes add column if not exists auto_name boolean not null default false;

create or replace function public.set_box_auto_name(target uuid, auto boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_edit_box(target) then
    raise exception 'このボックスの設定は変えられません';
  end if;
  update public.media_boxes set auto_name = auto where id = target;
end;
$$;

revoke all on function public.set_box_auto_name(uuid, boolean) from public, anon;
grant execute on function public.set_box_auto_name(uuid, boolean) to authenticated;
