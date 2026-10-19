"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { CreateRoomForm } from "@/components/CreateRoomForm";
import { useMyRooms } from "@/lib/local/rooms";
import { useCurrentUser } from "@/lib/local/session";

// 入口：今の利用者が参加している最初のルームへ
export default function Home() {
  const router = useRouter();
  const me = useCurrentUser();
  const rooms = useMyRooms(me?.id);

  useEffect(() => {
    if (rooms?.length) router.replace(`/r/${rooms[0].id}`);
  }, [rooms, router]);

  if (me && rooms && !rooms.length) {
    return (
      <main className="mx-auto max-w-sm px-4 py-16">
        <h1 className="mb-2 text-2xl font-bold">ルームを作る</h1>
        <p className="mb-6 text-sm text-muted">{me.displayName} さんが参加しているルームはまだありません。</p>
        <CreateRoomForm userId={me.id} />
      </main>
    );
  }
  return <p className="loading p-8 text-muted">読み込み中…</p>;
}
