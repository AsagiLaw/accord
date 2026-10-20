-- 0011 の続き：行の ID の長さの上限を広げる。
-- DM のチャットの ID は「dm_人の ID_人の ID」（76文字）で、既読の ID はそれに「|人の ID」を付けるので、100文字を超える
alter table public.synced_rows drop constraint synced_rows_id_check;
alter table public.synced_rows add constraint synced_rows_id_check check (char_length(id) <= 200);
