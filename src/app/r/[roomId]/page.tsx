"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { channelHref, useCategories, useChannels } from "@/lib/local/channels";

/**
 * ルームを開いたとき：サイドバーの一番上のチャンネル（カテゴリーの外が先、そのあとカテゴリーの順）を開く。
 * チャンネルが1つも無ければ、作り方を出す
 */
export default function RoomTop() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();
  const channels = useChannels(roomId);
  const categories = useCategories(roomId);
  const first = channels && categories ? [null, ...categories.map((c) => c.id)].flatMap((cat) => channels.filter((ch) => ch.categoryId === cat))[0] : undefined;
  useEffect(() => {
    if (first) router.replace(channelHref(roomId, first));
  }, [first, roomId, router]);
  if (!channels || !categories || first) return <p className="loading text-muted">読み込み中…</p>;
  return <p className="text-muted">チャンネルがまだありません。サイドバーの「＋」から作ってください。</p>;
}
