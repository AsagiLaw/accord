"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { sendMessage } from "./chat";
import { db, newId, type Profile, type Room, type RoomInvite, type RoomRole } from "./db";
import { openDm } from "./dm";

// ルームへの招待（Discord と同じ）：フレンドとの DM に招待のカードを送り、相手が「参加する」を押すとメンバーになる。
// 誘えるのはホストと、ホストが「メンバーも招待できる」にしたルームのメンバー。招待のカードを消すと、招待も取り消す（chat.ts の deleteMessage）

/** 招待の期限（日） */
export const INVITE_DAYS = 7;

/** その役割の人が、そのルームに招待できるか */
export const canInviteTo = (room: Pick<Room, "membersCanInvite">, role: RoomRole | undefined) => role === "host" || (role === "member" && !!room.membersCanInvite);

/** 招待がまだ使えるか（参加していなくて、期限の前） */
export const inviteOpen = (invite: RoomInvite, now = Date.now()) => !invite.acceptedAt && invite.expiresAt > now;

/** 自分がそのルームに招待できるか（ルーム名のメニューなどに「フレンドを招待」を出すか） */
export function useCanInvite(roomId: string, userId: string | undefined) {
  return useLiveQuery(async () => {
    if (!userId) return false;
    const [room, member] = await Promise.all([db.rooms.get(roomId), db.roomMembers.get([roomId, userId])]);
    return !!room && canInviteTo(room, member?.role);
  }, [roomId, userId]);
}

/** ホストが「メンバーもフレンドを招待できる」を切り替える */
export async function setMembersCanInvite(roomId: string, userId: string, on: boolean) {
  const member = await db.roomMembers.get([roomId, userId]);
  if (member?.role !== "host") return false;
  await db.rooms.update(roomId, { membersCanInvite: on || undefined });
  return true;
}

export type InviteResult = "sent" | "member" | "invited" | "notFriend" | "forbidden";

/**
 * フレンドをルームに招待する：招待を作り、2人の DM に招待のカードを送る。
 * もうメンバーなら member、まだ使える招待を送ってあれば invited（同じ招待を何度も送らない）
 */
export async function inviteFriend(roomId: string, fromId: string, toId: string): Promise<InviteResult> {
  const [room, from, to] = await Promise.all([db.rooms.get(roomId), db.roomMembers.get([roomId, fromId]), db.roomMembers.get([roomId, toId])]);
  if (!room || !canInviteTo(room, from?.role)) return "forbidden";
  if (to) return "member";
  const friends = await db.friendships
    .where("fromId")
    .anyOf(fromId, toId)
    .filter((f) => f.status === "accepted" && ((f.fromId === fromId && f.toId === toId) || (f.fromId === toId && f.toId === fromId)))
    .count();
  if (!friends) return "notFriend";
  const now = Date.now();
  const sent = await db.roomInvites
    .where("roomId")
    .equals(roomId)
    .filter((i) => i.toId === toId && i.fromId === fromId && inviteOpen(i, now))
    .count();
  if (sent) return "invited";
  const invite: RoomInvite = { id: newId(), roomId, fromId, toId, createdAt: now, expiresAt: now + INVITE_DAYS * 24 * 60 * 60_000 };
  await db.roomInvites.add(invite);
  const chatId = await openDm(fromId, toId);
  await sendMessage({ id: chatId, roomId: "" }, fromId, { text: "", mediaIds: [], replyTo: null, inviteId: invite.id });
  return "sent";
}

/** 自分が招待できて、その人がまだ入っていないルーム（参加した順。フレンドのメニューの「ルームに招待」） */
export async function roomsToInvite(userId: string, friendId: string) {
  const links = await db.roomMembers.where("userId").equals(userId).sortBy("joinedAt");
  const out: Room[] = [];
  for (const l of links) {
    const room = await db.rooms.get(l.roomId);
    if (room && canInviteTo(room, l.role) && !(await db.roomMembers.get([room.id, friendId]))) out.push(room);
  }
  return out;
}

/** 招待を受けてルームに参加する。うまくいけばルームの ID、だめならその理由 */
export async function acceptInvite(inviteId: string, userId: string): Promise<{ ok: true; roomId: string } | { ok: false; error: string }> {
  return db.transaction("rw", db.roomInvites, db.rooms, db.roomMembers, async () => {
    const invite = await db.roomInvites.get(inviteId);
    if (!invite) return { ok: false as const, error: "この招待は取り消されました" };
    if (invite.toId !== userId) return { ok: false as const, error: "この招待は、ほかの人あてです" };
    if (!(await db.rooms.get(invite.roomId))) return { ok: false as const, error: "このルームは削除されました" };
    if (await db.roomMembers.get([invite.roomId, userId])) return { ok: true as const, roomId: invite.roomId };
    if (!inviteOpen(invite)) return { ok: false as const, error: "招待の期限が切れています。もう一度招待してもらってください" };
    const now = Date.now();
    await db.roomMembers.add({ roomId: invite.roomId, userId, role: "member", joinedAt: now });
    await db.roomInvites.update(inviteId, { acceptedAt: now });
    return { ok: true as const, roomId: invite.roomId };
  });
}

/** 招待のカードに出すもの。招待が無い（取り消された・ルームが消えた）ときは null */
export type InviteCardData = {
  invite: RoomInvite;
  room: Room;
  from: Profile | undefined;
  memberCount: number;
  /** 見ている人が、もうメンバーか */
  joined: boolean;
};

export function useInviteCard(inviteId: string, viewerId: string) {
  return useLiveQuery(async (): Promise<InviteCardData | null> => {
    const invite = await db.roomInvites.get(inviteId);
    const room = invite && (await db.rooms.get(invite.roomId));
    if (!invite || !room) return null;
    const [from, memberCount, joined] = await Promise.all([
      db.profiles.get(invite.fromId),
      db.roomMembers.where("roomId").equals(room.id).count(),
      db.roomMembers.get([room.id, viewerId]),
    ]);
    return { invite, room, from, memberCount, joined: !!joined };
  }, [inviteId, viewerId]);
}

/** そのルームで、まだ返事の無い招待を送ってある人（招待の画面で「招待済み」にする） */
export function useOpenInvites(roomId: string, fromId: string) {
  return useLiveQuery(async () => {
    const now = Date.now();
    const list = await db.roomInvites.where("roomId").equals(roomId).toArray();
    return new Set(list.filter((i) => i.fromId === fromId && inviteOpen(i, now)).map((i) => i.toId));
  }, [roomId, fromId]);
}
