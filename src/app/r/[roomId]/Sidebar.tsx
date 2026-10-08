"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import type { Profile } from "@/lib/local/db";
import { useAllProfiles } from "@/lib/local/rooms";
import { setCurrentUser } from "@/lib/local/session";
import { setTheme, useIsDark } from "@/lib/theme";
import { ChannelNav } from "./ChannelNav";
import { RoomRail } from "./RoomRail";
import { MediaNav } from "./media/MediaNav";

type Room = { id: string; name: string };

export function Sidebar({ room, rooms, me }: { room: Room; rooms: Room[]; me: Profile }) {
  const profiles = useAllProfiles();
  const isDark = useIsDark();
  const pathname = usePathname();
  // スマホで開いたときのページを覚えておき、ページを移動したら閉じた扱いにする
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (v: boolean) => setOpenAt(v ? pathname : null);
  const base = `/r/${room.id}`;
  // メディアを開いている間は、サイドバーの中身と色を切り替える（試作と同じ）
  const inMedia = pathname.startsWith(`${base}/media`);

  const item = (href: string, icon: IconName, label: string) => {
    const active = pathname.startsWith(href);
    return (
      <Link
        href={href}
        className={`flex min-h-[38px] items-center gap-2 rounded-[10px] px-3 transition ${active ? "bg-accent font-bold text-accent-ink" : "hover:bg-tint"}`}
      >
        <Icon name={icon} />
        {label}
      </Link>
    );
  };

  return (
    <>
      <button className="btn-sub fixed top-2 left-2 z-30 w-11 bg-card px-0 md:hidden" aria-label="メニュー" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="menu" size={22} />
      </button>
      {open && <div className="fixed inset-0 z-10 bg-black/40 md:hidden" onClick={() => setOpen(false)} />}

      {/* スマホでは、ルームバーとサイドバーをまとめて左から出す */}
      <div
        className={`fixed inset-y-0 left-0 z-20 flex w-[min(368px,92vw)] transition-transform md:static md:w-auto md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-[104%]"}`}
      >
        <RoomRail rooms={rooms} currentId={room.id} userId={me.id} />
        <nav
          data-name={inMedia ? "メディア用サイドバー" : "サイドバー"}
          className={`flex min-w-0 flex-1 flex-col border-r border-line ${inMedia ? "bg-sidebar-media" : "bg-sidebar"} px-2 py-3 backdrop-blur-xl md:w-62 md:flex-none`}
        >
          {inMedia ? (
            <div className="mt-12 flex min-h-0 flex-1 flex-col md:mt-0">
              <MediaNav roomId={room.id} userId={me.id} />
            </div>
          ) : (
            <>
              <Link
                href={`${base}/settings`}
                data-name="ルーム名"
                title="ルームの設定を開く"
                className="mx-1 mt-12 mb-3 block truncate rounded-[10px] px-2 py-1.5 text-lg font-bold hover:bg-tint md:mt-0"
              >
                {room.name}
              </Link>

              <div data-name="メディア" className="space-y-0.5">
                {item(`${base}/media`, "img", "メディア")}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
              <ChannelNav roomId={room.id} userId={me.id} />
              </div>
            </>
          )}

          <div data-name="サイドバー下部" className="mt-auto space-y-0.5 border-t border-line pt-2">
            {item(`${base}/settings`, "gear", "設定")}
            <button
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="flex min-h-[38px] w-full items-center gap-2 rounded-[10px] px-3 text-left hover:bg-tint"
            >
              <Icon name={isDark ? "sun" : "moon"} />
              {isDark ? "ホワイトモードにする" : "ダークモードにする"}
            </button>
            {/* ローカル版だけの機能：2人分の動きを1台で試すための利用者切り替え */}
            <label data-name="利用者の切り替え（ローカル版のみ）" className="flex min-h-[38px] items-center gap-2 rounded-[10px] px-3">
              <Icon name="ppl" />
              <span className="shrink-0 text-sm text-muted">利用者</span>
              <select className="min-w-0 flex-1 bg-transparent font-bold" value={me.id} onChange={(e) => setCurrentUser(e.target.value)}>
                {profiles?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </nav>
      </div>
    </>
  );
}
