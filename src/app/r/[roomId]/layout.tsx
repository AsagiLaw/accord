"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { TopBarSlot } from "@/components/TopBarSlot";
import { useMembers, useMyRooms, useRoom } from "@/lib/local/rooms";
import { useCurrentUser } from "@/lib/local/session";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export default function RoomLayout({ children }: { children: React.ReactNode }) {
  const { roomId } = useParams<{ roomId: string }>();
  const me = useCurrentUser();
  const room = useRoom(roomId);
  const members = useMembers(roomId);
  const myRooms = useMyRooms(me?.id);
  // 上のバーの右（画面ごとの操作を置く場所）
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  if (me === undefined || room === undefined || members === undefined || myRooms === undefined) {
    return <p className="p-8 text-muted">読み込み中…</p>;
  }
  // サーバー版ではメンバー以外にはルームが見えない。ローカル版でも同じ動きにする
  if (!room || !me || !members.some((m) => m.userId === me.id)) {
    return (
      <main className="mx-auto max-w-sm px-4 py-16 text-center">
        <p className="mb-4">このルームは見られません。</p>
        <Link href="/" className="btn">
          自分のルームへ
        </Link>
      </main>
    );
  }

  return (
    <div className="flex h-dvh">
      <Sidebar room={room} rooms={myRooms} me={me} />
      <main data-name="メイン画面" className="flex min-w-0 flex-1 flex-col">
        {/* Discord のような細いバー：今の画面のアイコンと名前 */}
        <TopBar roomId={roomId} slotRef={setSlot} />
        <TopBarSlot.Provider value={slot}>
          <div data-name="メイン画面の中身" className="min-h-0 flex-1 overflow-auto px-[clamp(16px,4vw,40px)] pt-4 pb-7">
            {children}
          </div>
        </TopBarSlot.Provider>
      </main>
    </div>
  );
}
