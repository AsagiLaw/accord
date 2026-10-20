-- 第2段階の 2-5：オンライン表示。サイトを開いている間は、30秒おきに「開いている」と記録する（presence_beat）。
-- ほかの人の記録は、見せてよい人（自分・同じルームの人・申請中も含め間柄のある人：0005 の visible_profiles）の分だけを読む（presence_list）。
-- 「オフライン表示」を選んでいる人の記録は、本人にしか返さない。
-- 時刻は「何秒前か」で返す（それぞれのパソコンの時計がずれていても、正しく分かるように）

create table public.presence_beats (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- 最後に「開いている」と記録した時刻
  beat_at timestamptz not null default now(),
  -- 最後にマウスやキーボードを操作した時刻（しばらく無ければ退席中）
  active_at timestamptz not null default now()
);

-- 表そのものは誰も直接は読み書きできない（下の関数だけを使う）
alter table public.presence_beats enable row level security;

-- 「開いている」と記録する。idle_seconds：最後に操作してから何秒たったか。
-- 操作の時刻は、ほかのタブのほうが新しければそちらを残す（どれかのタブで操作していればオンライン）
create function public.presence_beat(idle_seconds integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  active timestamptz := now() - make_interval(secs => greatest(0, least(coalesce(idle_seconds, 0), 86400)));
begin
  if me is null then
    return;
  end if;
  insert into public.presence_beats (user_id, beat_at, active_at) values (me, now(), active)
  on conflict (user_id) do update
    set beat_at = now(), active_at = greatest(public.presence_beats.active_at, excluded.active_at);
end;
$$;

-- 見せてよい人の、最近の記録（5分より前のものは返さない）。beat_ago・active_ago は何秒前か
create function public.presence_list()
returns table (user_id uuid, beat_ago double precision, active_ago double precision)
language sql stable security definer set search_path = ''
as $$
  select b.user_id, extract(epoch from now() - b.beat_at), extract(epoch from now() - b.active_at)
  from public.presence_beats b
  join private.visible_profiles() p on p.id = b.user_id
  where b.beat_at > now() - interval '5 minutes'
    and (p.presence <> 'invisible' or p.id = (select auth.uid()));
$$;

revoke all on function public.presence_beat(integer) from public, anon;
revoke all on function public.presence_list() from public, anon;
grant execute on function public.presence_beat(integer) to authenticated;
grant execute on function public.presence_list() to authenticated;
