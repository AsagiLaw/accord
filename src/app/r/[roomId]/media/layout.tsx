"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { MediaScreen } from "@/components/media/MediaScreen";
import { useBoxAccess, useRoomBox } from "@/lib/local/boxes";
import { useMembers, useRoom } from "@/lib/local/rooms";
import { useCurrentUser } from "@/lib/local/session";

/**
 * ルームの「メディア」：ルームに紐づいたボックスを開く。
 * 紐づいていないルームにはメディアの画面が無い（画像は各チャットの上のフォルダから見る）ので、ルームの最初へ移る
 */
export default function MediaLayout({ children }: { children: React.ReactNode }) {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();
  const me = useCurrentUser();
  const room = useRoom(roomId);
  const members = useMembers(roomId);
  const link = useRoomBox(roomId);
  const access = useBoxAccess(link?.box.id ?? "", me?.id);
  useEffect(() => {
    if (link === null) router.replace(`/r/${roomId}`);
  }, [link, roomId, router]);
  if (!me || !room || !members || !link || access === undefined) return null;
  return (
    <MediaScreen
      boxId={link.box.id}
      base={`/r/${roomId}/media`}
      title="メディア"
      canEdit={access === "owner" || access === "edit"}
      me={me}
      members={members}
    >
      {children}
    </MediaScreen>
  );
}
