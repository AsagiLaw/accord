"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { TopBarSlot } from "@/components/TopBarSlot";
import { usePageFade } from "@/components/usePageFade";
import { useChat } from "@/lib/local/chat";
import type { Profile } from "@/lib/local/db";
import { dmOther } from "@/lib/local/dm";
import { useAllProfiles, useMyRooms } from "@/lib/local/rooms";
import { useCurrentUser } from "@/lib/local/session";
import { DmSidebar } from "./DmSidebar";

/** 上のバーに出す、今の画面のアイコンと名前。DM の画面では null（相手の名前を出す） */
function pageOf(pathname: string): { icon: IconName; label: string } | null {
  if (pathname.startsWith("/dm/media")) return { icon: "folder", label: "メディア" };
  if (pathname === "/dm") return { icon: "ppl", label: "フレンド" };
  return null;
}

/** DM の画面の上のバー：相手の名前 */
function DmTitle({ chatId, me }: { chatId: string; me: Profile }) {
  const chat = useChat(chatId);
  const profiles = useAllProfiles();
  const other = chat && profiles?.find((p) => p.id === dmOther(chat, me.id));
  return (
    <>
      <Icon name="person" size={16} className="shrink-0" />
      <span className="truncate">{chat && profiles ? (other?.displayName ?? "削除された人") : ""}</span>
    </>
  );
}

/**
 * Discord のホームに当たる画面：ダイレクトメッセージ・フレンド・メディア。
 * ルームの画面と同じく、左にルームバーとサイドバー、右にメイン画面
 */
export default function DmLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const me = useCurrentUser();
  const myRooms = useMyRooms(me?.id);
  // 上のバーの右（画面ごとの操作を置く場所）
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // 画面を切り替えたら、中身をふわっと出す
  const content = useRef<HTMLDivElement>(null);
  usePageFade(content);

  if (me === undefined || myRooms === undefined) {
    return <p className="loading p-8 text-muted">読み込み中…</p>;
  }
  if (!me) {
    return (
      <main className="mx-auto max-w-sm px-4 py-16 text-center">
        <p className="mb-4">利用者がまだいません。</p>
        <Link href="/" className="btn">
          はじめる
        </Link>
      </main>
    );
  }
  const page = pageOf(pathname);
  // ボックスのメディア画面は、場所の表示と操作をまとめて右の場所に入れる（ルームのメディアと同じ）
  const inBox = /^\/dm\/media\/[^/]+/.test(pathname);

  return (
    <div className="flex h-dvh flex-col">
      {/* ルームの画面と同じ、いちばん上の細いバー */}
      <div
        data-name="ルーム名バー"
        className="flex h-6 shrink-0 items-center justify-center gap-1.5 border-b border-line bg-rail px-4 text-xs font-bold text-muted"
      >
        <Icon name="chat" size={14} />
        <span className="truncate">ダイレクトメッセージ</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <DmSidebar rooms={myRooms} me={me} />
        <main data-name="メイン画面" className="flex min-w-0 flex-1 flex-col">
          <header
            data-name="上部バー"
            className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line pr-2 pl-[60px] text-sm md:h-8 md:px-[clamp(16px,4vw,40px)]"
          >
            <span className={`min-w-0 flex-1 items-center gap-1.5 px-1 font-bold ${inBox ? "hidden" : "flex"}`}>
              {page ? (
                <>
                  <Icon name={page.icon} size={16} className="shrink-0" />
                  <span className="truncate">{page.label}</span>
                </>
              ) : (
                <DmTitle chatId={pathname.split("/")[2]} me={me} />
              )}
            </span>
            <div ref={setSlot} data-name="上部バーの操作" className={`flex items-center gap-2 ${inBox ? "min-w-0 flex-1" : "shrink-0"}`} />
          </header>
          <TopBarSlot.Provider value={slot}>
            <div ref={content} data-name="メイン画面の中身" className="min-h-0 flex-1 overflow-auto px-[clamp(16px,4vw,40px)] pt-4 pb-7 [scrollbar-gutter:stable]">
              {children}
            </div>
          </TopBarSlot.Provider>
        </main>
      </div>
    </div>
  );
}
