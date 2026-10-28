"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ChatImagesButton } from "@/components/chat/ChatImages";
import { ChatNotifyButton } from "@/components/chat/ChatNotify";
import { ChatPinsButton } from "@/components/chat/ChatPins";
import { ChatSearchButton } from "@/components/chat/ChatSearch";
import { ChatView } from "@/components/chat/ChatView";
import { TopBarActions } from "@/components/TopBarSlot";
import { useChat } from "@/lib/local/chat";
import { dmOther } from "@/lib/local/dm";
import { useFriendships } from "@/lib/local/friends";
import { useAllProfiles, type MemberWithProfile } from "@/lib/local/rooms";
import { useCurrentUser } from "@/lib/local/session";
import { ChatSkeleton } from "@/components/Skeleton";

/** フレンドとの DM。フレンドでなくなった相手とは、前のやり取りを読めるだけ */
export default function DmChatPage() {
  const { chatId } = useParams<{ chatId: string }>();
  const me = useCurrentUser();
  const chat = useChat(chatId);
  const profiles = useAllProfiles();
  const friendships = useFriendships(me?.id);

  if (chat === undefined || !me || !profiles || !friendships) return <ChatSkeleton />;
  // 自分が入っていない DM は見られない（サーバー版でも同じ）
  if (!chat || !chat.dm?.includes(me.id)) {
    return (
      <p className="text-muted">
        DMが見つかりません。<Link href="/dm" className="underline">フレンドの画面へ</Link>
      </p>
    );
  }

  const otherId = dmOther(chat, me.id);
  const members: MemberWithProfile[] = chat.dm.map((id) => ({
    userId: id,
    role: "member",
    displayName: profiles.find((p) => p.id === id)?.displayName ?? "",
  }));
  const isFriend = friendships.friends.some((f) => f.other.id === otherId);

  return (
    <div data-name="DM画面" data-full-chat="" className="flex h-full min-h-0 flex-col">
      <TopBarActions>
        <ChatPinsButton chatId={chat.id} />
        <ChatSearchButton chatId={chat.id} roomId="" />
        <ChatImagesButton chatId={chat.id} roomId="" />
        <ChatNotifyButton chatId={chat.id} />
      </TopBarActions>
      <div className="min-h-0 flex-1">
        <ChatView
          key={chat.id}
          chat={chat}
          me={me}
          members={members}
          readOnlyNotice={isFriend ? undefined : "フレンドではないため、メッセージを送れません。フレンドになると、また送れます。"}
        />
      </div>
    </div>
  );
}
