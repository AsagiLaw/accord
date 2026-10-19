"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMyRooms } from "@/lib/local/rooms";
import { useCurrentUser } from "@/lib/local/session";

// 入口：今の利用者が参加している最初のルームへ。ルームがまだ無ければ DM・フレンドの画面へ
// （ルームはルームバーの「ルームを作る」から作れる。招待を待つ人もいるので、作るのは強制しない）
export default function Home() {
  const router = useRouter();
  const me = useCurrentUser();
  const rooms = useMyRooms(me?.id);

  useEffect(() => {
    if (!me || !rooms) return;
    router.replace(rooms.length ? `/r/${rooms[0].id}` : "/dm");
  }, [me, rooms, router]);

  return <p className="loading p-8 text-muted">読み込み中…</p>;
}
