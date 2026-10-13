"use client";

import { Avatar } from "@/components/Avatar";
import { UserCardButton } from "@/components/account/UserCard";
import { Icon } from "@/components/Icon";
import { useNow, useShownPresence, type ShownPresence } from "@/lib/local/presence";
import { liveStatus } from "@/lib/status";
import type { MemberWithProfile } from "@/lib/local/rooms";

const byName = (a: MemberWithProfile, b: MemberWithProfile) => a.displayName.localeCompare(b.displayName, "ja");

/** 一覧の小見出し：「ホスト — 1」のように、まとまりの名前と人数 */
function GroupHead({ label, count }: { label: string; count: number }) {
  return (
    <h3 className="px-2 pt-4 pb-1 text-xs font-bold tracking-wide text-muted first:pt-1">
      {label} — {count}
    </h3>
  );
}

function MemberRow({ m, presence }: { m: MemberWithProfile; presence: ShownPresence }) {
  const offline = presence === "offline" || presence === "invisible";
  const name = m.displayName || "名前なし";
  const status = liveStatus(m, useNow());
  return (
    <li data-name={`メンバー（${name}）`}>
      {/* 押すと、その人のプロフィールのカード */}
      <UserCardButton
        userId={m.userId}
        role={m.role}
        label={name}
        // オフラインの人は、Discord と同じく薄く出す
        className={`flex min-h-[44px] w-full items-center gap-2.5 rounded-[10px] px-2 py-1 text-left transition hover:bg-tint ${offline ? "opacity-45 hover:opacity-100" : ""}`}
      >
        <Avatar name={name} src={m.avatar} size={32} presence={offline ? undefined : presence} ring="border-sidebar" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-bold">{name}</span>
          {status && <span className="block truncate text-xs text-muted">{status}</span>}
        </span>
      </UserCardButton>
    </li>
  );
}

/**
 * Discord の右の列と同じ、ルームに参加している人の一覧。
 * 「ホスト」「メンバー」「オフライン」（サイトを開いていない人と、オフライン表示の人）に分け、それぞれ名前順に並べる
 */
function MemberGroups({ members, meId }: { members: MemberWithProfile[]; meId: string }) {
  const shownOf = useShownPresence(meId);
  const shown = new Map(members.map((m) => [m.userId, shownOf({ id: m.userId, presence: m.presence })]));
  const isOff = (m: MemberWithProfile) => ["offline", "invisible"].includes(shown.get(m.userId)!);
  const offline = members.filter(isOff).sort(byName);
  const online = members.filter((m) => !isOff(m));
  const groups = [
    { label: "ホスト", list: online.filter((m) => m.role === "host").sort(byName) },
    { label: "メンバー", list: online.filter((m) => m.role !== "host").sort(byName) },
  ];
  return (
    <>
      {groups.map(
        (g) =>
          g.list.length > 0 && (
            <section key={g.label} aria-label={g.label}>
              <GroupHead label={g.label} count={g.list.length} />
              <ul className="space-y-0.5">
                {g.list.map((m) => (
                  <MemberRow key={m.userId} m={m} presence={shown.get(m.userId)!} />
                ))}
              </ul>
            </section>
          ),
      )}
      {offline.length > 0 && (
        <section aria-label="オフライン">
          <GroupHead label="オフライン" count={offline.length} />
          <ul className="space-y-0.5">
            {offline.map((m) => (
              <MemberRow key={m.userId} m={m} presence={shown.get(m.userId)!} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * メンバー一覧の列。パソコンではメイン画面の右に並べ、スマホでは右から重ねて出す（まわりを押すか「×」で閉じる）
 */
export function MemberList({
  members,
  meId,
  desktopOpen,
  mobileOpen,
  onCloseMobile,
}: {
  members: MemberWithProfile[];
  meId: string;
  desktopOpen: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  return (
    <>
      {desktopOpen && (
        <aside
          data-name="メンバー一覧"
          aria-label="メンバー"
          className="hidden w-60 shrink-0 overflow-y-auto border-l border-line bg-sidebar px-2 py-3 backdrop-blur-xl md:block"
        >
          <MemberGroups members={members} meId={meId} />
        </aside>
      )}
      {mobileOpen && (
        <div className="md:hidden">
          <div className="fixed inset-0 z-40 bg-black/40" onClick={onCloseMobile} />
          <aside
            data-name="メンバー一覧"
            aria-label="メンバー"
            className="fixed inset-y-0 right-0 z-40 flex w-[min(300px,85vw)] flex-col border-l border-line bg-sidebar backdrop-blur-xl"
          >
            <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
              <Icon name="ppl" size={18} />
              <b className="min-w-0 flex-1 truncate">メンバー</b>
              <button type="button" onClick={onCloseMobile} aria-label="閉じる" className="grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-tint hover:text-ink">
                <Icon name="x" size={20} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
              <MemberGroups members={members} meId={meId} />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
