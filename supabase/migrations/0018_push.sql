-- 第3段階：アプリを閉じていても、スマホなどに発言の通知を届ける（Web Push）。
-- 通知をオンにした端末（ブラウザ）ごとに、届け先（push_subscribe）を覚える。
-- 発言を送った人のアプリが、Supabase に書けたあとで /api/push を呼ぶ。サーバーはログインを確かめてから、
-- Supabase の秘密鍵（service_role）で push_targets を呼び、返ってきた届け先に通知を送る。
-- 届け先はサーバーの中だけで使い、ブラウザには読ませない（表は関数からだけ触る）

create table public.push_subscriptions (
  endpoint text primary key check (char_length(endpoint) <= 1000),
  user_id uuid not null references public.profiles (id) on delete cascade,
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- 決まり（policy）を作らないので、関数を通さずには読めも書けもしない
alter table public.push_subscriptions enable row level security;

-- 通知を送った発言（同じ発言で2回送らないため）。1日たったものは片付ける
create table public.push_sent (
  message_id text primary key,
  sent_at timestamptz not null default now()
);

alter table public.push_sent enable row level security;

-- この端末を届け先にする。同じブラウザで別の人がログインし直したら、その人の届け先に付け替える
create function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'ログインしていません';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, (select auth.uid()), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end;
$$;

-- この端末を届け先から外す（自分の分だけ）
create function public.push_unsubscribe(p_endpoint text)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = (select auth.uid());
$$;

-- 届かなくなった届け先（ブラウザが通知の許可を取り消したなど）を片付ける（サーバーだけが呼ぶ）
create function public.push_forget(p_endpoints text[])
returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = any (p_endpoints);
$$;

-- その発言の通知を届ける先（サーバーだけが呼ぶ。p_author はサーバーが確かめたログイン中の人）。
-- 発言を書いた本人のときだけ、書いてから10分の間に1回だけ返す。
-- 届けるのは、そのチャットを見られる人（ルームのメンバーか DM の相手。話せる人が決まっていればその中）のうち、
-- 書いた本人・そのチャットの通知を切った人（chatReads.muted）・取り込み中の人を除いた人の端末
create function public.push_targets(p_message text, p_author uuid)
returns table (endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := p_author;
  msg public.synced_rows;
  chat public.synced_rows;
  added integer;
begin
  select * into msg from public.synced_rows r where r.tbl = 'messages' and r.id = p_message and not r.deleted;
  if not found or me is null or msg.created_by is distinct from me or msg.data ->> 'authorId' is distinct from me::text then
    return;
  end if;
  -- 古い発言を、あとから通知させない
  if coalesce((msg.data ->> 'createdAt')::double precision, 0) < extract(epoch from now() - interval '10 minutes') * 1000 then
    return;
  end if;

  delete from public.push_sent where sent_at < now() - interval '1 day';
  insert into public.push_sent (message_id) values (p_message) on conflict do nothing;
  get diagnostics added = row_count;
  if added = 0 then
    return;
  end if;

  select * into chat from public.synced_rows r where r.tbl = 'chats' and r.id = msg.data ->> 'chatId' and not r.deleted;
  if not found then
    return;
  end if;

  return query
  with people as (
    select m.user_id from public.room_members m where msg.room_id is not null and m.room_id = msg.room_id
    union
    select u from unnest(msg.dm) u where msg.dm is not null
  )
  select s.endpoint, s.p256dh, s.auth
  from people p
  join public.push_subscriptions s on s.user_id = p.user_id
  join public.profiles pr on pr.id = p.user_id
  where p.user_id <> me
    and pr.presence is distinct from 'dnd'
    and (jsonb_typeof(chat.data -> 'allowed') is distinct from 'array' or chat.data -> 'allowed' ? p.user_id::text)
    and not exists (
      select 1 from public.synced_rows rd
      where rd.tbl = 'chatReads'
        and rd.id = chat.id || '|' || p.user_id::text
        and not rd.deleted
        and (rd.data ->> 'muted')::boolean is true
    );
end;
$$;

revoke all on function public.push_subscribe(text, text, text) from public, anon;
revoke all on function public.push_unsubscribe(text) from public, anon;
revoke all on function public.push_forget(text[]) from public, anon, authenticated;
revoke all on function public.push_targets(text, uuid) from public, anon, authenticated;
grant execute on function public.push_subscribe(text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;
grant execute on function public.push_forget(text[]) to service_role;
grant execute on function public.push_targets(text, uuid) to service_role;
