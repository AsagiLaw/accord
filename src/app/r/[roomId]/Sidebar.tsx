"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { MenuItem, Popover, usePopover } from "@/components/ui/Popover";
import type { Profile } from "@/lib/local/db";
import { useAllProfiles } from "@/lib/local/rooms";
import { setCurrentUser } from "@/lib/local/session";
import { ChannelNav } from "./ChannelNav";
import { RoomRail } from "./RoomRail";
import { MediaNav } from "./media/MediaNav";

type Room = { id: string; name: string };

export function Sidebar({
  room,
  rooms,
  me,
}: {
  room: Room;
  rooms: Room[];
  me: Profile;
}) {
  const profiles = useAllProfiles();
  const pathname = usePathname();
  const router = useRouter();
  const roomMenu = usePopover();
  // スマホで開いたときのページを覚えておき、ページを移動したら閉じた扱いにする
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (v: boolean) => setOpenAt(v ? pathname : null);
  const base = `/r/${room.id}`;
  // メディアを開いている間は、サイドバーの中身をメディアの一覧に切り替える
  const inMedia = pathname.startsWith(`${base}/media`);
  // メディアから戻るときの行き先：最後に開いていたメディア以外の画面
  const lastChannelPath = useRef<string | null>(null);
  useEffect(() => {
    if (!inMedia) lastChannelPath.current = pathname;
  }, [inMedia, pathname]);

  return (
    <>
      <button
        className="btn-sub fixed top-2 left-2 z-30 w-11 bg-card px-0 md:hidden"
        aria-label="メニュー"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="menu" size={22} />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-10 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* スマホでは、ルームバーとサイドバーをまとめて左から出す */}
      <div
        className={`fixed inset-y-0 left-0 z-20 flex w-[min(368px,92vw)] transition-transform md:static md:w-auto md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-[104%]"}`}
      >
        <RoomRail rooms={rooms} currentId={room.id} userId={me.id} />
        <nav
          data-name={inMedia ? "メディア用サイドバー" : "サイドバー"}
          className={`flex min-w-0 flex-1 flex-col border-r border-line bg-sidebar px-2 py-3 backdrop-blur-xl md:w-62 md:flex-none`}
        >
          {/* Discord のサーバー名の欄のように、左にルーム名、右にメディアのボタン。下に区切り線を入れる */}
          <div
            data-name="ルーム名とメディア"
            className="mt-12 mb-2 flex items-center gap-1 border-b border-line px-1 pb-2 md:mt-0"
          >
            {/* Discord のように、ルーム名を押すとルームのメニューが出る */}
            <button
              type="button"
              data-name="ルーム名"
              aria-haspopup="menu"
              aria-expanded={!!roomMenu.anchor}
              onClick={roomMenu.toggle}
              className="flex min-w-0 items-center gap-1 rounded-[10px] px-2 py-1.5 text-left font-bold hover:bg-tint"
            >
              <span className="min-w-0 truncate">{room.name}</span>
              {/* 閉じているときは下向き、開いているときは上向きの「∨」 */}
              <Icon
                name="expand"
                size={16}
                className={`shrink-0 text-muted transition-transform ${roomMenu.anchor ? "rotate-180" : ""}`}
              />
            </button>
            <Popover
              anchor={roomMenu.anchor}
              onClose={roomMenu.close}
              width={220}
              label="ルームのメニュー"
            >
              <MenuItem
                icon={<Icon name="gear" size={16} />}
                onClick={() => {
                  roomMenu.close();
                  router.push(`${base}/settings`);
                }}
              >
                ルームの設定
              </MenuItem>
            </Popover>
            {/* メディアとチャンネルの切り替え。メディアを開いている間は色が付き、押すと前に開いていた画面に戻る */}
            <button
              type="button"
              data-name="メディア"
              aria-label={inMedia ? "メディアを閉じる" : "メディア"}
              aria-pressed={inMedia}
              title={inMedia ? "メディアを閉じる" : "メディア"}
              onClick={() =>
                router.push(
                  inMedia ? (lastChannelPath.current ?? base) : `${base}/media`,
                )
              }
              className={`ml-auto grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border transition ${
                inMedia
                  ? "border-accent bg-accent text-accent-ink"
                  : "border-line text-ink hover:bg-tint"
              }`}
            >
              <Icon name="folder" size={26} />
            </button>
          </div>

          {inMedia ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <MediaNav roomId={room.id} userId={me.id} />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ChannelNav roomId={room.id} userId={me.id} />
            </div>
          )}

          <div
            data-name="サイドバー下部"
            className="mt-auto space-y-0.5 border-t border-line pt-2"
          >
            {/* ローカル版だけの機能：2人分の動きを1台で試すための利用者切り替え */}
            <label
              data-name="利用者の切り替え（ローカル版のみ）"
              className="flex min-h-[38px] items-center gap-2 rounded-[10px] px-3"
            >
              <Icon name="ppl" />
              <span className="shrink-0 text-sm text-muted">利用者</span>
              <select
                className="min-w-0 flex-1 bg-transparent font-bold"
                value={me.id}
                onChange={(e) => setCurrentUser(e.target.value)}
              >
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
