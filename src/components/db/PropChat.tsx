"use client";

import { useEffect } from "react";
import { ChatView } from "@/components/chat/ChatView";
import { ImageChatView } from "@/components/chat/ImageChatView";
import { Icon } from "@/components/Icon";
import { seedUsers } from "@/components/pageBlocks";
import { PopupDialog } from "@/components/ui/Dialog";
import { useChat, useChatSummary } from "@/lib/local/chat";
import type { Database, DbPage, Profile, Property } from "@/lib/local/db";
import { ensurePropChat, nameSuffixOf } from "@/lib/local/requests";
import type { MemberWithProfile } from "@/lib/local/rooms";

/** 表などのセルに出す、チャットの項目の中身：発言の数と、最後の発言 */
export function ChatSummary({ chatId }: { chatId: string }) {
  const summary = useChatSummary(chatId);
  const last = summary?.last;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="flex shrink-0 items-center gap-0.5 text-muted">
        <Icon name="chat" size={14} />
        {summary?.count ?? 0}件
      </span>
      {last && (
        <span className="truncate text-muted">
          {last.speaker ? `${last.speaker}：` : ""}
          {last.text || (last.mediaIds.length ? "（画像）" : "")}
        </span>
      )}
    </span>
  );
}

/** チャットの項目の会話を、ポップアップで開く（表のセルを押したとき）。まだチャットが無ければ作る */
export function PropChatPopup({
  database,
  page,
  prop,
  members,
  userId,
  onClose,
}: {
  database: Database;
  page: DbPage;
  prop: Property;
  members: MemberWithProfile[];
  userId: string;
  onClose: () => void;
}) {
  const cur = page.values[prop.id];
  const chatId = typeof cur === "string" ? cur : "";
  const chat = useChat(chatId);
  useEffect(() => {
    if (!chatId || chat === null) void ensurePropChat(page.id, prop);
  }, [chatId, chat, page.id, prop]);
  const me: Profile = { id: userId, displayName: members.find((m) => m.userId === userId)?.displayName ?? "", username: "", createdAt: 0 };
  const canTalk = !prop.allowed?.length || prop.allowed.includes(userId);
  const notice = canTalk ? undefined : `「${prop.name}」に書き込めるのは、選ばれた人だけです`;
  const name = page.title ? `${page.title}${nameSuffixOf(database)}` : "無題";
  return (
    <PopupDialog title={`${name} › ${prop.name}`} onClose={onClose} width="max-w-2xl">
      <div className="flex h-[70dvh] min-h-0 flex-col p-3">
        {!chat ? (
          <p className="text-sm text-muted">準備中…</p>
        ) : chat.kind === "image" ? (
          <ImageChatView key={chat.id} chat={chat} me={me} readOnlyNotice={notice} fixedUsers={prop.seed === "page" ? seedUsers(page.roomId, page, members, prop.allowed) : []} />
        ) : (
          <ChatView key={chat.id} chat={chat} me={me} members={members} readOnlyNotice={notice} />
        )}
      </div>
    </PopupDialog>
  );
}
