"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { BoxShareDialog } from "@/components/media/BoxShareDialog";
import { MediaNav } from "@/components/media/MediaNav";
import { RoomRail } from "@/components/RoomRail";
import { SidebarShell } from "@/components/SidebarShell";
import { choose, toast } from "@/components/ui/overlay";
import { useBox, useBoxAccess } from "@/lib/local/boxes";
import type { Profile } from "@/lib/local/db";
import { openDm, useMyDms } from "@/lib/local/dm";
import { useFriendships } from "@/lib/local/friends";
import { Avatar } from "@/components/Avatar";
import { badgeTone, useDoNotDisturb } from "@/lib/local/dnd";

type Room = { id: string; name: string; icon?: string };

/** 未読の数。取り込み中は灰色で控えめにする */
function Badge({ n }: { n: number }) {
  const quiet = useDoNotDisturb();
  return <span className={`rounded-full px-2 text-xs ${badgeTone(quiet)}`}>{n > 99 ? "99+" : n}</span>;
}

function NavLink({ href, icon, label, active, badge = 0 }: { href: string; icon: IconName; label: string; active: boolean; badge?: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-[36px] items-center gap-2 rounded-[10px] px-3 py-1.5 transition ${active ? "bg-accent font-bold text-accent-ink" : "hover:bg-tint"}`}
    >
      <Icon name={icon} size={18} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge > 0 && !active && <Badge n={badge} />}
    </Link>
  );
}

/** ダイレクトメッセージの画面のサイドバー：上にフレンドとメディア、その下に DM の一覧（新しく発言があった順） */
export function DmSidebar({ rooms, me }: { rooms: Room[]; me: Profile }) {
  const pathname = usePathname();
  const router = useRouter();
  const dms = useMyDms(me.id);
  const friendships = useFriendships(me.id);
  // ボックスを開いている間は、DM の一覧の代わりに、そのボックスのライブラリーを出す
  const boxId = pathname.match(/^\/dm\/media\/([^/]+)/)?.[1];
  const box = useBox(boxId);
  // 見られないボックス（URL を直接開いたときなど）は、中身も「メディアを追加」も出さない
  const access = useBoxAccess(boxId ?? "", me.id);
  const [sharing, setSharing] = useState(false);

  // 「＋」：フレンドを選んで DM を始める（もうあれば、それを開く）
  const startDm = async () => {
    const friends = friendships?.friends ?? [];
    if (!friends.length) {
      toast("DMはフレンドと始められます。先にフレンドを追加してください");
      return router.push("/dm");
    }
    const i = await choose("DMを始める相手", friends.map((f) => ({ label: f.other.displayName })));
    if (i === null) return;
    router.push(`/dm/${await openDm(me.id, friends[i].other.id)}`);
  };

  return (
    <SidebarShell me={me}>
      <RoomRail rooms={rooms} currentId={null} userId={me.id} />
      <nav
        data-name="DM用サイドバー"
        className="flex min-w-0 flex-1 flex-col border-r border-line bg-sidebar px-2 py-3 backdrop-blur-xl md:w-62 md:flex-none"
      >
        <div data-name="フレンドとメディア" className="mt-12 mb-2 space-y-0.5 border-b border-line pb-2 md:mt-0">
          {/* 届いた申請の数を出す */}
          <NavLink href="/dm" icon="ppl" label="フレンド" active={pathname === "/dm"} badge={friendships?.incoming.length} />
          <NavLink href="/dm/media" icon="folder" label="メディア" active={pathname.startsWith("/dm/media")} />
        </div>

        {boxId ? (
          <div data-name="ボックスのライブラリー" className="flex min-h-0 flex-1 flex-col">
            <div className="mb-1 flex items-center gap-1">
              <Link
                href="/dm/media"
                className="flex min-w-0 flex-1 items-center gap-1 rounded-[10px] px-2 py-1 text-sm text-muted hover:bg-tint hover:text-ink"
                title="ボックスの一覧へ"
              >
                <Icon name="back" size={16} className="shrink-0" />
                <span className="truncate font-bold text-ink">{box && access ? box.name : "ボックスの一覧"}</span>
              </Link>
              {/* 共有の設定は持ち主だけ（マイメディアは共有できない） */}
              {box && access === "owner" && box.kind === "box" && (
                <button
                  type="button"
                  onClick={() => setSharing(true)}
                  aria-label={`「${box.name}」の共有`}
                  title="共有"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:bg-tint hover:text-ink"
                >
                  <Icon name="ppl" size={18} />
                </button>
              )}
            </div>
            {box && access && <MediaNav boxId={box.id} base={`/dm/media/${box.id}`} userId={me.id} canEdit={access !== "view"} />}
            {sharing && box && <BoxShareDialog box={box} me={me} onClose={() => setSharing(false)} />}
          </div>
        ) : (
          <div data-name="DM一覧" className="min-h-0 flex-1 overflow-y-auto">
            <div className="mb-0.5 flex items-center gap-0.5 pr-1 text-xs text-muted">
              <span className="min-w-0 flex-1 truncate py-1 pl-1 font-bold tracking-wide">ダイレクトメッセージ</span>
              <button
                type="button"
                aria-label="DMを始める"
                title="DMを始める"
                onClick={startDm}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-tint hover:text-ink"
              >
                <Icon name="add" size={16} />
              </button>
            </div>
            {dms?.length ? (
              <div className="space-y-0.5">
                {dms.map(({ chat, other, unread }) => {
                  const href = `/dm/${chat.id}`;
                  const active = pathname === href;
                  const name = other?.displayName ?? "削除された人";
                  return (
                    <Link
                      key={chat.id}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      aria-label={`${name}さんとのDM${unread ? `（未読${unread}件）` : ""}`}
                      className={`flex min-h-[40px] items-center gap-2 rounded-[10px] px-2 py-1 transition ${active ? "bg-accent font-bold text-accent-ink" : "hover:bg-tint"} ${unread && !active ? "font-bold" : ""}`}
                    >
                      <Avatar name={name} src={other?.avatar} size={28} onAccent={active} />
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      {unread > 0 && !active && <Badge n={unread} />}
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="px-3 pt-1 text-xs text-muted">フレンドとのDMがここに並びます</p>
            )}
          </div>
        )}
      </nav>
    </SidebarShell>
  );
}
