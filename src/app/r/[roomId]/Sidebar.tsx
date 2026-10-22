"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { RoomRail } from "@/components/RoomRail";
import { SidebarShell } from "@/components/SidebarShell";
import { MenuItem, Popover, usePopover } from "@/components/ui/Popover";
import type { Profile } from "@/lib/local/db";
import { ChannelNav } from "./ChannelNav";
import { MediaNav } from "@/components/media/MediaNav";
import { MediaSettingsDialog } from "@/components/media/MediaSettings";
import { useBoxAccess, useRoomBox } from "@/lib/local/boxes";
import { useCanInvite } from "@/lib/local/invites";
import { InviteFriendsDialog } from "@/components/InviteFriendsDialog";

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
  const pathname = usePathname();
  const router = useRouter();
  const roomMenu = usePopover();
  // メディアのボタンを右クリックしたときのメニューと、そこから開くメディアの設定
  const mediaMenu = usePopover();
  const [mediaSettings, setMediaSettings] = useState(false);
  // フレンドを招待（ホストと、ホストが許したときのメンバー）
  const canInvite = useCanInvite(room.id, me.id);
  const [inviting, setInviting] = useState(false);
  const base = `/r/${room.id}`;
  // ルームの「メディア」は、ルームに紐づいたボックス
  const roomBox = useRoomBox(room.id);
  const roomBoxAccess = useBoxAccess(roomBox?.box.id ?? "", me.id);
  // メディアを開いている間は、サイドバーの中身をメディアの一覧に切り替える
  const inMedia = pathname.startsWith(`${base}/media`);
  // メディアから戻るときの行き先：最後に開いていたメディア以外の画面
  const lastChannelPath = useRef<string | null>(null);
  useEffect(() => {
    if (!inMedia) lastChannelPath.current = pathname;
  }, [inMedia, pathname]);
  // メディアのボタンの行き先を先に読んでおく（押したらすぐ移れるように）
  const hasBox = !!roomBox;
  useEffect(() => {
    if (hasBox) router.prefetch(inMedia ? (lastChannelPath.current ?? base) : `${base}/media`);
  }, [hasBox, inMedia, base, router]);

  return (
    <SidebarShell me={me}>
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
            {/* Discord と同じく、招待をいちばん上に */}
            {canInvite && (
              <MenuItem
                icon={<Icon name="add" size={16} />}
                onClick={() => {
                  roomMenu.close();
                  setInviting(true);
                }}
              >
                フレンドを招待
              </MenuItem>
            )}
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
          {inviting && <InviteFriendsDialog room={room} me={me} onClose={() => setInviting(false)} />}
          {/* メディアのボタンは、ボックスが紐づいているルームだけ（設定していないルームでは、チャットの上のフォルダから画像を見る） */}
          {roomBox && (
            <>
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
              onContextMenu={mediaMenu.openAt}
              className={`ml-auto grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border transition ${
                inMedia
                  ? "border-accent bg-accent text-accent-ink"
                  : "border-line text-ink hover:bg-tint"
              }`}
            >
              <Icon name="folder" size={26} />
            </button>
            <Popover
              anchor={mediaMenu.anchor}
              onClose={mediaMenu.close}
              width={220}
              label="メディアのメニュー"
            >
              <MenuItem
                icon={<Icon name="gear" size={16} />}
                onClick={() => {
                  mediaMenu.close();
                  setMediaSettings(true);
                }}
              >
                メディアの設定
              </MenuItem>
            </Popover>
            {mediaSettings && (
              <MediaSettingsDialog
                boxId={roomBox?.box.id}
                canEdit={roomBoxAccess === "owner" || roomBoxAccess === "edit"}
                onClose={() => setMediaSettings(false)}
              />
            )}
            </>
          )}
        </div>

        {inMedia ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {roomBox ? (
              <MediaNav boxId={roomBox.box.id} base={`${base}/media`} userId={me.id} canEdit={roomBoxAccess === "owner" || roomBoxAccess === "edit"} />
            ) : (
              <p className="px-3 text-xs text-muted">メディアのボックスが紐づいていません</p>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ChannelNav roomId={room.id} userId={me.id} />
          </div>
        )}
      </nav>
    </SidebarShell>
  );
}
