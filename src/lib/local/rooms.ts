"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db, defaultRoomContents, newId, type Profile, type RoomRole } from "./db";

export type MemberWithProfile = { userId: string; role: RoomRole; displayName: string };

/** その利用者が参加しているルーム（参加順） */
export function useMyRooms(userId: string | undefined) {
  return useLiveQuery(async () => {
    if (!userId) return [];
    const links = await db.roomMembers.where("userId").equals(userId).sortBy("joinedAt");
    const rooms = await db.rooms.bulkGet(links.map((l) => l.roomId));
    return rooms.filter((r) => r !== undefined);
  }, [userId]);
}

/** ルーム。見つからなければ null、読み込み中は undefined */
export function useRoom(roomId: string) {
  return useLiveQuery(async () => (await db.rooms.get(roomId)) ?? null, [roomId]);
}

export function useMembers(roomId: string) {
  return useLiveQuery(async () => {
    const links = await db.roomMembers.where("roomId").equals(roomId).sortBy("joinedAt");
    const profiles = await db.profiles.bulkGet(links.map((l) => l.userId));
    return links.map(
      (l, i): MemberWithProfile => ({ userId: l.userId, role: l.role, displayName: profiles[i]?.displayName ?? "" }),
    );
  }, [roomId]);
}

export function useAllProfiles() {
  return useLiveQuery(() => db.profiles.orderBy("createdAt").toArray(), []);
}

export async function createRoom(name: string, userId: string) {
  const id = newId();
  const now = Date.now();
  const c = defaultRoomContents(id);
  await db.transaction("rw", [db.rooms, db.roomMembers, db.chats, db.databases, db.dbViews, db.categories], async () => {
    await db.rooms.add({ id, name, createdBy: userId, createdAt: now });
    await db.roomMembers.add({ roomId: id, userId, role: "host", joinedAt: now });
    await db.categories.bulkAdd(c.categories);
    await db.chats.add(c.chat);
    await db.databases.add(c.database);
    await db.dbViews.bulkAdd(c.views);
  });
  return id;
}

export async function renameRoom(roomId: string, name: string) {
  await db.rooms.update(roomId, { name });
}

/** サーバー版の「招待リンクで参加」に当たる操作。既存の人を加えるか、新しい人を作って加える */
export async function addMember(roomId: string, who: { userId: string } | { displayName: string }) {
  await db.transaction("rw", db.profiles, db.roomMembers, async () => {
    let userId: string;
    if ("userId" in who) {
      userId = who.userId;
    } else {
      const profile: Profile = { id: newId(), displayName: who.displayName, createdAt: Date.now() };
      await db.profiles.add(profile);
      userId = profile.id;
    }
    if (!(await db.roomMembers.get([roomId, userId]))) {
      await db.roomMembers.add({ roomId, userId, role: "member", joinedAt: Date.now() });
    }
  });
}

export async function renameProfile(userId: string, displayName: string) {
  await db.profiles.update(userId, { displayName });
}
