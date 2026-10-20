-- 第2段階の 2-3：データベース・ページ・ビュー・予定・ToDo・ノート・ウィンドウも、synced_rows（0011）に入れる。
-- どれもルームの中のもの（DM には置かない）。見られるのはルームのメンバーだけ（0011 の決まりのまま）
alter table public.synced_rows drop constraint synced_rows_tbl_check;
alter table public.synced_rows add constraint synced_rows_tbl_check check (tbl in (
  'categories', 'chats', 'messages', 'chatReads', 'imageUsers',
  'databases', 'dbPages', 'dbViews', 'events', 'todos', 'notes', 'windows'
));

-- 2-3 の表は、ルームの行だけ（DM には置かない）
alter table public.synced_rows add constraint synced_rows_dm_tables check (
  dm is null or tbl in ('chats', 'messages', 'chatReads')
);

-- ノートやウィンドウの本文は大きくなるので、1行の大きさの上限を広げる（0011 は 200KB）
alter table public.synced_rows drop constraint synced_rows_data_check;
alter table public.synced_rows add constraint synced_rows_data_check check (pg_column_size(data) <= 1000000);
