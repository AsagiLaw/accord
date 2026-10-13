"use client";

import Link from "next/link";
import { useState } from "react";
import { CreateRoomDialog } from "@/components/CreateRoomDialog";
import { Icon } from "@/components/Icon";
import { useRoomUnreadTotals } from "@/lib/local/chat";
import { useMyDms } from "@/lib/local/dm";
import { useFriendships } from "@/lib/local/friends";

type Room = { id: string; name: string; icon?: string };

/** 名前の最初の1文字（絵文字も1文字として扱う） */
const initial = (name: string) => Array.from(name.trim())[0] ?? "?";

/**
 * Discord のサーバー一覧のような、ルームのアイコンを縦に並べる細い列。
 * 今いるルームは左に印が付き、角が少し四角くなる。未読があれば赤い数字を出す。
 */
export function RoomRail({
  rooms,
  currentId,
  userId,
}: {
  rooms: Room[];
  /** 今いるルーム。ダイレクトメッセージを開いているときは null */
  currentId: string | null;
  userId: string;
}) {
  const unread = useRoomUnreadTotals(
    rooms.map((r) => r.id),
    userId,
  );
  const [creating, setCreating] = useState(false);
  const inDm = currentId === null;
  // DM の未読と、届いたフレンドの申請の数
  const dms = useMyDms(userId);
  const friendships = useFriendships(userId);
  const dmCount = (dms ?? []).reduce((n, d) => n + d.unread, 0) + (friendships?.incoming.length ?? 0);

  return (
    <div
      data-name="ルームバー"
      className="flex w-[68px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-rail pt-16 pb-3 md:pt-3"
    >
      {/* Discord のホームに当たる場所：ダイレクトメッセージ・フレンド・メディア。開いている間は色が付き、左に印が付く */}
      <div className="group relative flex w-full shrink-0 justify-center">
        <span
          aria-hidden
          className={`absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-ink transition-all ${inDm ? "h-10" : dmCount ? "h-2 group-hover:h-5" : "h-0 group-hover:h-5"}`}
        />
        <Link
          href="/dm"
          data-name="ダイレクトメッセージ"
          aria-label={`ダイレクトメッセージ${dmCount ? `（新着${dmCount}件）` : ""}`}
          aria-current={inDm ? "page" : undefined}
          title="ダイレクトメッセージ"
          className={`relative grid h-12 w-12 place-items-center transition-all ${
            inDm
              ? "rounded-[16px] bg-accent text-accent-ink"
              : "rounded-[24px] bg-card text-ink group-hover:rounded-[16px] group-hover:bg-accent group-hover:text-accent-ink"
          }`}
        >
          <Icon name="chat" size={24} />
          {dmCount > 0 && (
            <span className="absolute -right-1 -bottom-1 grid h-5 min-w-5 place-items-center rounded-full border-2 border-rail bg-warn px-1 text-[11px] leading-none font-bold text-white">
              {dmCount > 99 ? "99+" : dmCount}
            </span>
          )}
        </Link>
      </div>
      <span aria-hidden className="h-0.5 w-8 shrink-0 rounded-full bg-line" />
      {rooms.map((r) => {
        const active = r.id === currentId;
        const n = unread?.get(r.id) ?? 0;
        return (
          <div key={r.id} className="group relative flex w-full justify-center">
            {/* 左の印：今いるルームは長く、未読があるルームは短く、カーソルを置くと中くらい */}
            <span
              aria-hidden
              className={`absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-ink transition-all ${
                active
                  ? "h-10"
                  : n
                    ? "h-2 group-hover:h-5"
                    : "h-0 group-hover:h-5"
              }`}
            />
            <Link
              href={`/r/${r.id}`}
              aria-label={`ルーム「${r.name}」${n ? `（未読${n}件）` : ""}`}
              aria-current={active ? "page" : undefined}
              title={r.name}
              // 画像が無いルームは、カードと同じ色（ホワイトモードでは白）に文字の色で1文字を出す
              className={`relative grid h-12 w-12 place-items-center text-lg font-bold transition-all ${
                r.icon ? "" : "border border-line bg-card text-ink"
              } ${
                active
                  ? "rounded-[16px]"
                  : "rounded-[24px] group-hover:rounded-[16px]"
              }`}
            >
              {r.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.icon}
                  alt=""
                  className="h-full w-full rounded-[inherit] object-cover"
                />
              ) : (
                initial(r.name)
              )}
              {n > 0 && (
                <span className="absolute -right-1 -bottom-1 grid h-5 min-w-5 place-items-center rounded-full border-2 border-rail bg-warn px-1 text-[11px] leading-none font-bold text-white">
                  {n > 99 ? "99+" : n}
                </span>
              )}
            </Link>
          </div>
        );
      })}
      <span aria-hidden className="h-0.5 w-8 rounded-full bg-line" />
      <button
        type="button"
        onClick={() => setCreating(true)}
        aria-label="ルームを作る"
        title="ルームを作る"
        className="grid h-12 w-12 place-items-center rounded-[24px] bg-card text-accent transition-all hover:rounded-[16px] hover:bg-accent hover:text-accent-ink"
      >
        <Icon name="add" size={24} />
      </button>
      {creating && (
        <CreateRoomDialog userId={userId} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}
