"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ChatView } from "@/components/chat/ChatView";
import { ChatImagesButton } from "@/components/chat/ChatImages";
import { ChatSearchButton } from "@/components/chat/ChatSearch";
import { TopBarActions } from "@/components/TopBarSlot";
import { useChat } from "@/lib/local/chat";
import { useMembers } from "@/lib/local/rooms";
import { useCurrentUser } from "@/lib/local/session";

export default function ChatPage() {
  const { roomId, chatId } = useParams<{ roomId: string; chatId: string }>();
  const chat = useChat(chatId);
  const me = useCurrentUser();
  const members = useMembers(roomId);

  if (chat === undefined || !me || !members) return <p className="text-muted">読み込み中…</p>;
  if (!chat || chat.roomId !== roomId) {
    return (
      <p className="text-muted">
        チャットが見つかりません。<Link href={`/r/${roomId}`} className="underline">ルームの最初へ</Link>
      </p>
    );
  }

  return (
    <div data-name="チャット画面" className="flex h-full min-h-0 flex-col">
      {/* 名前は上のバーに出る（名前の変更は、サイドバーの右クリックから）。参加者は上のバーの右のメンバー一覧 */}
      <TopBarActions>
        <ChatSearchButton chatId={chat.id} roomId={roomId} />
        <ChatImagesButton chatId={chat.id} roomId={roomId} />
      </TopBarActions>
      <div className="min-h-0 flex-1">
        <ChatView key={chat.id} chat={chat} me={me} members={members} />
      </div>
    </div>
  );
}
