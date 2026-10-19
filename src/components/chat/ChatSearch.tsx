"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { PopupDialog } from "@/components/ui/Dialog";
import { searchMessages, useImageUsers } from "@/lib/local/chat";
import type { Message } from "@/lib/local/db";
import { useMembers } from "@/lib/local/rooms";
import { jumpToMessage } from "./useMessageWindow";

/** 一度に出す検索結果の数 */
const MAX_HITS = 200;

/**
 * チャットの上のバー（とチャットのブロックの右上）に置く虫めがねのボタン。押すと、そのチャットの発言を探すポップアップを出す。
 * 発言の中身と、話した人（イメージチャットはイメージユーザーの名前）で探す。結果を押すと、チャットのその発言まで動いて光らせる
 */
export function ChatSearchButton({ chatId, roomId, compact }: { chatId: string; roomId: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-name="チャットを検索"
        aria-label="このチャットを検索"
        title="このチャットを検索"
        onClick={() => setOpen(true)}
        className={`grid shrink-0 place-items-center text-muted hover:bg-tint hover:text-ink ${compact ? "h-6 w-6 rounded-full" : "h-7 w-7 rounded-[8px]"}`}
      >
        <Icon name="search" size={compact ? 15 : 18} />
      </button>
      {open && <ChatSearchDialog chatId={chatId} roomId={roomId} onClose={() => setOpen(false)} />}
    </>
  );
}

/** 見つかった言葉に色を付ける（前後は短く切る） */
function Snippet({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text.length > 80 ? `${text.slice(0, 80)}…` : text}</>;
  const from = Math.max(0, i - 30);
  return (
    <>
      {from > 0 && "…"}
      {text.slice(from, i)}
      <mark className="rounded-[3px] bg-accent/25 px-0.5 text-ink">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length, i + q.length + 50)}
      {i + q.length + 50 < text.length && "…"}
    </>
  );
}

function ChatSearchDialog({ chatId, roomId, onClose }: { chatId: string; roomId: string; onClose: () => void }) {
  const memberList = useMembers(roomId);
  const imageUserList = useImageUsers(roomId);
  const members = memberList ?? [];
  const imageUsers = imageUserList ?? [];
  const [q, setQ] = useState("");
  // 話した人：イメージチャットはイメージユーザー（ID で持っている。前の発言は名前のまま）、ふつうのチャットはメンバー
  const name = (m: Message) => (m.speaker ? (imageUsers.find((u) => u.id === m.speaker)?.name ?? m.speaker) : (members.find((x) => x.userId === m.authorId)?.displayName ?? ""));
  const query = q.trim().toLowerCase();
  // 新しい順。チャットの発言を全部は持たず、データベースの中を順に見て探す（打つたびに探さないよう、少し待ってから）
  const [found, setFound] = useState<{ query: string; hits: Message[] }>();
  const hits = !query ? [] : found?.query === query ? found.hits : null;
  useEffect(() => {
    if (!query) return;
    let live = true;
    const t = setTimeout(() => {
      void searchMessages(chatId, (m) => m.text.toLowerCase().includes(query) || name(m).toLowerCase().includes(query), MAX_HITS).then((r) => live && setFound({ query, hits: r }));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // name は members・imageUsers から作るので、その2つで比べる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, query, memberList, imageUserList]);
  return (
    <PopupDialog title="チャットを検索" onClose={onClose} width="max-w-lg">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="言葉・話した人の名前で探す" aria-label="チャットを検索" className="field mb-3" />
      {query && hits && <p className="mb-2 text-xs text-muted">{hits.length >= MAX_HITS ? `${MAX_HITS}件以上（新しい方から${MAX_HITS}件）` : `${hits.length}件`}</p>}
      <div className="space-y-1">
        {hits?.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              onClose();
              // ポップアップが閉じてから動く
              setTimeout(() => jumpToMessage(chatId, m), 50);
            }}
            className="block w-full rounded-[8px] px-2 py-1.5 text-left text-sm hover:bg-tint"
          >
            <span className="mb-0.5 flex gap-2 text-xs text-muted">
              <b className="truncate text-ink">{name(m) || "—"}</b>
              <span className="shrink-0">{new Date(m.createdAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            </span>
            <span className="block break-words">{m.text ? <Snippet text={m.text} q={q.trim()} /> : <span className="text-muted">（画像）</span>}</span>
          </button>
        ))}
        {query && hits && !hits.length && <p className="py-6 text-center text-sm text-muted">見つかりませんでした</p>}
      </div>
    </PopupDialog>
  );
}
