"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useRouter } from "next/navigation";
import { Avatar, PRESENCE } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Popover, usePopover } from "@/components/ui/Popover";
import { toast } from "@/components/ui/overlay";
import { db, type RoomRole } from "@/lib/local/db";
import { openDm } from "@/lib/local/dm";
import { acceptFriend, requestFriend, useFriendships } from "@/lib/local/friends";
import { useNow, useShownPresence } from "@/lib/local/presence";
import { liveStatus } from "@/lib/status";
import { useCurrentUser } from "@/lib/local/session";
import { ProfileExtras, UsernameLine, WorkStatusChip } from "./ProfileExtras";

/** 左下のアカウントの欄に「アカウントの設定を開いて」と頼む（自分のカードの「プロフィールを編集」から） */
export const OPEN_ACCOUNT_SETTINGS = "irai-note:open-account-settings";
export const openAccountSettings = () => window.dispatchEvent(new Event(OPEN_ACCOUNT_SETTINGS));

/**
 * 人のアイコンや名前を、押すとその人のプロフィールのカードが出るボタンにする（Discord と同じ）。
 * role を渡すと、カードにルームでの役割（ホスト・メンバー）を出す
 */
export function UserCardButton({
  userId,
  role,
  label,
  className = "",
  children,
}: {
  userId: string;
  role?: RoomRole;
  /** 読み上げ用の名前 */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const pop = usePopover();
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={!!pop.anchor}
        aria-label={`${label}さんのプロフィール`}
        onClick={pop.toggle}
        className={`cursor-pointer ${className}`}
      >
        {children}
      </button>
      <Popover anchor={pop.anchor} onClose={pop.close} width={300} label={`${label}さんのプロフィール`}>
        <UserCard userId={userId} role={role} onDone={pop.close} />
      </Popover>
    </>
  );
}

/** ほかの人（と自分）のプロフィールのカード：色の帯・大きなアイコン・名前・ひとこと・役割と、DM やフレンド申請のボタン */
function UserCard({ userId, role, onDone }: { userId: string; role?: RoomRole; onDone: () => void }) {
  const router = useRouter();
  const me = useCurrentUser();
  const person = useLiveQuery(async () => (await db.profiles.get(userId)) ?? null, [userId]);
  const shownOf = useShownPresence(me?.id);
  const friendships = useFriendships(me?.id);
  const now = useNow();

  if (person === undefined || !me) return <p className="p-3 text-sm text-muted">読み込み中…</p>;
  if (!person) return <p className="p-3 text-sm text-muted">この人は退出したか、削除されています。</p>;
  const self = person.id === me.id;
  const shown = shownOf(person);
  const friend = friendships?.friends.find((f) => f.other.id === person.id);
  const incoming = friendships?.incoming.find((f) => f.other.id === person.id);
  const outgoing = friendships?.outgoing.find((f) => f.other.id === person.id);

  return (
    <div data-name={`プロフィールのカード（${person.displayName}）`}>
      <div aria-hidden className="-mx-1.5 -mt-1.5 h-16 rounded-t-[11px] bg-accent" />
      <div className="-mt-10 px-2.5 pb-1">
        <span className="inline-flex rounded-full border-[5px] border-card bg-card">
          <Avatar name={person.displayName} src={person.avatar} size={76} presence={shown} />
        </span>
        <p className="mt-1 truncate text-lg font-bold">{person.displayName}</p>
        <UsernameLine username={person.username} />
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${PRESENCE[shown].dot}`} />
            {PRESENCE[shown].label}
          </span>
          {role && <span className="rounded-full bg-tint px-2 py-0.5 font-bold text-accent">{role === "host" ? "ホスト" : "メンバー"}</span>}
          {self && <span className="rounded-full bg-tint px-2 py-0.5">あなた</span>}
          {friend && <span className="rounded-full bg-tint px-2 py-0.5">フレンド</span>}
          {person.workStatus && <WorkStatusChip status={person.workStatus} />}
        </div>
        {liveStatus(person, now) && <p className="mt-2 rounded-[10px] bg-bg px-2.5 py-2 text-sm break-words">{liveStatus(person, now)}</p>}
        <ProfileExtras person={person} />
      </div>

      <div className="mt-2 flex gap-1.5 px-1 pb-1">
        {self ? (
          <button
            className="btn min-h-[36px] flex-1 text-sm"
            onClick={() => {
              onDone();
              openAccountSettings();
            }}
          >
            <Icon name="edit" size={16} />
            プロフィールを編集
          </button>
        ) : friend ? (
          <button
            className="btn min-h-[36px] flex-1 text-sm"
            onClick={async () => {
              onDone();
              router.push(`/dm/${await openDm(me.id, person.id)}`);
            }}
          >
            <Icon name="chat" size={16} />
            メッセージを送る
          </button>
        ) : incoming ? (
          <button
            className="btn min-h-[36px] flex-1 text-sm"
            onClick={async () => {
              await acceptFriend(incoming.friendship.id);
              toast(`${person.displayName}さんとフレンドになりました`);
            }}
          >
            <Icon name="ok" size={16} />
            フレンド申請を承認
          </button>
        ) : outgoing ? (
          <button className="btn-sub min-h-[36px] flex-1 text-sm" disabled>
            フレンド申請を送りました
          </button>
        ) : (
          <button
            className="btn min-h-[36px] flex-1 text-sm"
            onClick={async () => {
              const r = await requestFriend(me.id, person.id);
              // 相手からも申請が来ていたときは、そのままフレンドになる
              if (r === "accepted") toast(`${person.displayName}さんとフレンドになりました`);
              else if (r === "sent") toast(`${person.displayName}さんにフレンド申請を送りました`);
            }}
          >
            <Icon name="add" size={16} />
            フレンド申請
          </button>
        )}
      </div>
    </div>
  );
}
