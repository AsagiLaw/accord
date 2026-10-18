"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { PopupDialog } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/overlay";
import type { Profile } from "@/lib/local/db";
import { useFriendships } from "@/lib/local/friends";
import { INVITE_DAYS, inviteFriend, useCanInvite, useOpenInvites, type InviteResult } from "@/lib/local/invites";
import { useMembers } from "@/lib/local/rooms";

const NOT_SENT: Record<Exclude<InviteResult, "sent">, string> = {
  member: "もうこのルームのメンバーです",
  invited: "もう招待を送っています",
  notFriend: "フレンドにだけ招待を送れます",
  forbidden: "このルームに招待できるのはホストだけです",
};

/**
 * 「（ルーム名）にフレンドを招待」（Discord と同じ）。フレンドの一覧から選んで招待を送ると、その人との DM に招待のカードが届く。
 * もうメンバーの人は「参加済み」、返事を待っている人は「招待済み」
 */
export function InviteFriendsDialog({ room, me, onClose }: { room: { id: string; name: string }; me: Profile; onClose: () => void }) {
  const friendships = useFriendships(me.id);
  const members = useMembers(room.id);
  const invited = useOpenInvites(room.id, me.id);
  const canInvite = useCanInvite(room.id, me.id);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const loading = !friendships || !members || !invited || canInvite === undefined;
  const q = query.trim().toLowerCase();
  const friends = (friendships?.friends ?? []).filter(({ other }) => !q || other.displayName.toLowerCase().includes(q) || other.username.includes(q.replace(/^@/, "")));

  const send = async (other: Profile) => {
    setBusy(other.id);
    const r = await inviteFriend(room.id, me.id, other.id);
    setBusy(null);
    toast(r === "sent" ? `${other.displayName}さんに招待を送りました（DMに届きます）` : NOT_SENT[r]);
  };

  return (
    <PopupDialog title={`「${room.name}」にフレンドを招待`} onClose={onClose} width="max-w-md">
      {loading ? (
        <p className="text-muted">読み込み中…</p>
      ) : !canInvite ? (
        <p className="text-sm text-muted">このルームに招待できるのはホストだけです。ホストがルームの設定で「メンバーもフレンドを招待できる」をオンにすると、メンバーも招待できます。</p>
      ) : !friendships.friends.length ? (
        <div className="grid place-items-center gap-2 py-6 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-tint text-accent">
            <Icon name="ppl" size={28} />
          </span>
          <p className="font-bold">フレンドはまだいません</p>
          <p className="text-sm text-muted">招待できるのはフレンドだけです。相手の ID で、フレンドの申請を送ってください。</p>
          <Link href="/dm" className="btn mt-1" onClick={onClose}>
            フレンドの画面へ
          </Link>
        </div>
      ) : (
        <div data-name="フレンドを招待" className="space-y-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="フレンドを名前か ID で探す"
            aria-label="フレンドを探す"
            className="field"
            autoFocus
          />
          {friends.length ? (
            <ul className="max-h-[50dvh] overflow-y-auto">
              {friends.map(({ other }) => {
                const member = members.some((m) => m.userId === other.id);
                const sent = invited.has(other.id);
                return (
                  <li key={other.id} data-name={`フレンド（${other.displayName}）`} className="flex items-center gap-3 border-t border-line px-1 py-2 first:border-t-0">
                    <Avatar name={other.displayName} src={other.avatar} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{other.displayName}</span>
                      <span className="block truncate text-xs text-muted">{other.username}</span>
                    </span>
                    {member ? (
                      <span className="shrink-0 text-xs text-muted">参加済み</span>
                    ) : sent ? (
                      <button type="button" className="btn-sub min-h-[34px] shrink-0 px-3 text-sm" disabled>
                        招待済み
                      </button>
                    ) : (
                      <button type="button" className="btn min-h-[34px] shrink-0 px-3 text-sm" disabled={busy === other.id} onClick={() => send(other)}>
                        招待
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-4 text-center text-sm text-muted">「{query.trim()}」に当てはまるフレンドはいません</p>
          )}
          <p className="rounded-[10px] bg-tint px-3 py-2 text-xs text-muted">
            招待は、フレンドとのDMにカードで届きます。相手が「参加する」を押すと、ルームのメンバーになります（招待の期限は{INVITE_DAYS}日です）。
          </p>
        </div>
      )}
    </PopupDialog>
  );
}
