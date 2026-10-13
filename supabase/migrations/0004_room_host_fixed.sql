-- ルームのホスト（作った人）は引き継げない。
-- ルームのメディア（紐づけるボックス）を変えられるのはルームを作ったホストだけで、ホストが紐づけられるのは自分のボックスだけ。
-- ホストが変わらなければ、ルームに紐づくボックスの持ち主はいつもそのルームのホストになる

create function public.keep_room_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'ルームを作った人（ホスト）は変えられません';
  end if;
  return new;
end;
$$;

create trigger rooms_keep_creator
  before update on public.rooms
  for each row execute function public.keep_room_creator();

-- ホストの役割も、作った人から動かさない（ほかの人をホストにしない・作った人をメンバーにしない）
create function public.keep_room_host_role()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  creator uuid;
begin
  select created_by into creator from public.rooms where id = new.room_id;
  if (new.user_id = creator) <> (new.role = 'host') then
    raise exception 'ホストはルームを作った人だけです';
  end if;
  return new;
end;
$$;

create trigger room_members_keep_host
  before insert or update on public.room_members
  for each row execute function public.keep_room_host_role();
