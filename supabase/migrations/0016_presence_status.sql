-- 0015 の続き：presence_list で、その人が選んだ状態（オンライン・退席中・取り込み中）も返す。
-- プロフィールの読み直し（2分おき）を待たずに、30秒おきの読み直しで状態の変更が届くように。
-- 「オフライン表示」の人は、今までどおり本人にしか返さない（返す列が変わるので作り直す）
drop function if exists public.presence_list();

create function public.presence_list()
returns table (user_id uuid, beat_ago double precision, active_ago double precision, presence text)
language sql stable security definer set search_path = ''
as $$
  select b.user_id, extract(epoch from now() - b.beat_at), extract(epoch from now() - b.active_at), p.presence
  from public.presence_beats b
  join private.visible_profiles() p on p.id = b.user_id
  where b.beat_at > now() - interval '5 minutes'
    and (p.presence <> 'invisible' or p.id = (select auth.uid()));
$$;

revoke all on function public.presence_list() from public, anon;
grant execute on function public.presence_list() to authenticated;
