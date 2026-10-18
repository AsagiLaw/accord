"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { toast } from "@/components/ui/overlay";
import type { Room } from "@/lib/local/db";
import { acceptInvite, inviteOpen, useInviteCard } from "@/lib/local/invites";

const dateLabel = (t: number) => new Date(t).toLocaleDateString("ja-JP", { month: "long", day: "numeric" });

/** ルームバーと同じアイコン：画像が無ければ名前の最初の1文字 */
function RoomIcon({ room }: { room: Room }) {
  return room.icon ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={room.icon} alt="" className="h-12 w-12 shrink-0 rounded-[16px] object-cover" />
  ) : (
    <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] border border-line bg-bg text-lg font-bold">
      {Array.from(room.name.trim())[0] ?? "?"}
    </span>
  );
}

/**
 * DM に届く、ルームへの招待のカード（Discord と同じ）。招待された人は「参加する」でメンバーになり、
 * メンバーになっている人には「開く」を出す。送った人には、相手が参加したか・期限を出す
 */
export function InviteCard({ inviteId, meId, mine }: { inviteId: string; meId: string; mine: boolean }) {
  const router = useRouter();
  const data = useInviteCard(inviteId, meId);
  const [busy, setBusy] = useState(false);
  const box = "w-[min(340px,72vw)] rounded-[14px] border border-line bg-card p-3 text-ink";

  if (data === undefined) return <div className={`${box} text-sm text-muted`}>読み込み中…</div>;
  if (!data) {
    return (
      <div data-name="ルームへの招待（使えない）" className={`${box} flex items-center gap-3`}>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-tint text-muted">
          <Icon name="x" size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">使えない招待です</span>
          <span className="block text-xs text-muted">取り消されたか、ルームが削除されました。</span>
        </span>
      </div>
    );
  }

  const { invite, room, from, memberCount, joined } = data;
  const open = inviteOpen(invite);
  const toMe = invite.toId === meId;
  const fromName = from?.displayName ?? "削除された人";
  // カードの下に出す、今の様子
  const note = invite.acceptedAt
    ? toMe
      ? `${dateLabel(invite.acceptedAt)}に参加しました`
      : "相手が参加しました"
    : open
      ? `${dateLabel(invite.expiresAt)}まで使えます`
      : "招待の期限が切れました";

  const join = async () => {
    setBusy(true);
    const r = await acceptInvite(invite.id, meId);
    setBusy(false);
    if (!r.ok) return toast(r.error);
    toast(`ルーム「${room.name}」に参加しました`);
    router.push(`/r/${r.roomId}`);
  };

  return (
    <div data-name="ルームへの招待" className={box}>
      <p className="mb-2 text-xs font-bold tracking-wide text-muted">{mine ? "ルームに招待しました" : `${fromName}さんから、ルームへの招待が届きました`}</p>
      <div className="flex items-center gap-3">
        <RoomIcon room={room} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{room.name}</span>
          <span className="flex items-center gap-1 text-xs text-muted">
            <Icon name="ppl" size={13} />
            メンバー {memberCount}人
          </span>
        </span>
        {joined ? (
          <button type="button" className="btn-sub min-h-[36px] shrink-0 px-3 text-sm" onClick={() => router.push(`/r/${room.id}`)}>
            開く
          </button>
        ) : toMe ? (
          <button type="button" className="btn min-h-[36px] shrink-0 px-3 text-sm" disabled={busy || !open} onClick={join}>
            {open ? (busy ? "参加しています…" : "参加する") : "期限切れ"}
          </button>
        ) : null}
      </div>
      <p className="mt-2 border-t border-line pt-1.5 text-xs text-muted">{note}</p>
    </div>
  );
}
