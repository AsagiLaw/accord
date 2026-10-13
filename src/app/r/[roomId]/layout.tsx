"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useState } from "react";
import { TopBarSlot } from "@/components/TopBarSlot";
import { useMembers, useMyRooms, useRoom } from "@/lib/local/rooms";
import { useCurrentUser } from "@/lib/local/session";
import { setMemberListOpen, useIsDesktop, useMemberListOpen } from "@/lib/member-list";
import { MemberList } from "./MemberList";
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
  // メンバー一覧：パソコンでは開け閉めを覚えておく。スマホでは重ねて出し、ページを移動したら閉じる
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  const desktopMembers = useMemberListOpen();
  const [mobileMembersAt, setMobileMembersAt] = useState<string | null>(null);
  const mobileMembers = mobileMembersAt === pathname;

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
    <div className="flex h-dvh flex-col">
      {/* 画面のいちばん上の細いバー：今いるルームの名前 */}
      <div
        data-name="ルーム名バー"
        className="flex h-6 shrink-0 items-center justify-center gap-1.5 border-b border-line bg-rail px-4 text-xs font-bold text-muted"
      >
        {/* ルームバーと同じアイコン：画像が無ければ名前の最初の1文字 */}
        {room.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={room.icon} alt="" className="h-4 w-4 rounded-[4px] object-cover" />
        ) : (
          <span aria-hidden className="grid h-4 w-4 place-items-center rounded-[4px] border border-line bg-card text-[10px] leading-none text-ink">
            {Array.from(room.name.trim())[0] ?? "?"}
          </span>
        )}
        <span className="truncate">{room.name}</span>
      </div>
      <div className="flex min-h-0 flex-1">
      <Sidebar room={room} rooms={myRooms} me={me} />
      <main data-name="メイン画面" className="flex min-w-0 flex-1 flex-col">
        {/* Discord のような細いバー：今の画面のアイコンと名前 */}
        <TopBar
          roomId={roomId}
          slotRef={setSlot}
          membersOpen={isDesktop ? desktopMembers : mobileMembers}
          onToggleMembers={() => (isDesktop ? setMemberListOpen(!desktopMembers) : setMobileMembersAt(mobileMembers ? null : pathname))}
        />
        <TopBarSlot.Provider value={slot}>
          {/* Discord と同じく、上のバーの下で、中身の右にメンバー一覧を並べる */}
          <div className="flex min-h-0 flex-1">
            {/* スクロールバーの場所はいつも空けておく（出たり消えたりで幅が変わり、画像の大きさが揺れ続けないように） */}
            <div data-name="メイン画面の中身" className="min-h-0 min-w-0 flex-1 overflow-auto px-[clamp(16px,4vw,40px)] pt-4 pb-7 [scrollbar-gutter:stable]">
              {children}
            </div>
            <MemberList members={members} meId={me.id} desktopOpen={desktopMembers} mobileOpen={mobileMembers} onCloseMobile={() => setMobileMembersAt(null)} />
          </div>
        </TopBarSlot.Provider>
      </main>
      </div>
    </div>
  );
}
