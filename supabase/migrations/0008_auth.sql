-- ログインまわり：Google で登録した人の名前とアイコン、アカウントの削除

-- 登録したときのプロフィール：メールで登録した人は入れた表示名、Google の人は Google の名前とアイコン
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(new.email, '@', 1)
    ),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  );
  return new;
end;
$$;

-- 自分のアカウントを削除する（画面の「アカウントを削除する」から呼ぶ）。
-- Discord と同じく、ホストのルームがあるうちは削除できない（ホストは引き継げない：0004）。
-- auth.users を消すと、プロフィール・ルームへの参加・フレンド・ボックスは on delete cascade で一緒に消える
create function public.delete_my_account()
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'ログインしていません';
  end if;
  if exists (select 1 from public.rooms where created_by = me) then
    raise exception 'ホストになっているルームを、先に削除してください';
  end if;
  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
