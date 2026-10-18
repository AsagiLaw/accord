"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { removeSharesBetween } from "./boxes";
import { findProfileByUsername } from "./profiles";
import { db, newId, type Friendship, type Profile } from "./db";

export type FriendRow = { friendship: Friendship; other: Profile };
export type Friendships = { friends: FriendRow[]; incoming: FriendRow[]; outgoing: FriendRow[] };

/** 自分に関わる間柄：フレンド（名前順）・届いた申請・送った申請（新しい順） */
export function useFriendships(userId: string | undefined) {
  return useLiveQuery(async (): Promise<Friendships> => {
    const out: Friendships = { friends: [], incoming: [], outgoing: [] };
    if (!userId) return out;
    const rows = [
      ...(await db.friendships.where("fromId").equals(userId).toArray()),
      ...(await db.friendships.where("toId").equals(userId).toArray()),
    ];
    const others = await db.profiles.bulkGet(rows.map((f) => (f.fromId === userId ? f.toId : f.fromId)));
    rows.forEach((friendship, i) => {
      const other = others[i];
      if (!other) return;
      const row = { friendship, other };
      if (friendship.status === "accepted") out.friends.push(row);
      else if (friendship.toId === userId) out.incoming.push(row);
      else out.outgoing.push(row);
    });
    out.friends.sort((a, b) => a.other.displayName.localeCompare(b.other.displayName, "ja"));
    out.incoming.sort((a, b) => b.friendship.createdAt - a.friendship.createdAt);
    out.outgoing.sort((a, b) => b.friendship.createdAt - a.friendship.createdAt);
    return out;
  }, [userId]);
}

async function between(a: string, b: string) {
  return (
    (await db.friendships.where("fromId").equals(a).filter((f) => f.toId === b).first()) ??
    (await db.friendships.where("fromId").equals(b).filter((f) => f.toId === a).first())
  );
}

/**
 * フレンドの申請を送る。相手からの申請が届いていれば、送る代わりにそれを承認する
 * （お互いに申請し合ったら、フレンドになる）
 */
export async function requestFriend(fromId: string, toId: string): Promise<"sent" | "accepted" | "already" | "pending" | "self"> {
  if (fromId === toId) return "self";
  return db.transaction("rw", db.friendships, async () => {
    const existing = await between(fromId, toId);
    if (existing?.status === "accepted") return "already";
    if (existing?.fromId === fromId) return "pending";
    if (existing) {
      await db.friendships.update(existing.id, { status: "accepted", respondedAt: Date.now() });
      return "accepted";
    }
    await db.friendships.add({ id: newId(), fromId, toId, status: "pending", createdAt: Date.now() });
    return "sent";
  });
}

/**
 * 相手の ID（Discord のユーザー名と同じ）で申請を送る。名前では探さない（同じ名前の人を取り違えないように）。
 * 見つからなければ notFound（ID の形が違うときも）
 */
export async function requestFriendByUsername(fromId: string, text: string): Promise<{ result: Awaited<ReturnType<typeof requestFriend>> | "notFound"; other?: Profile }> {
  const other = await findProfileByUsername(text);
  if (!other) return { result: "notFound" };
  return { result: await requestFriend(fromId, other.id), other };
}

export async function acceptFriend(friendshipId: string) {
  await db.friendships.update(friendshipId, { status: "accepted", respondedAt: Date.now() });
}

/**
 * 申請を断る・取り消す、フレンドを解除する（間柄を消す）。DM のやり取りは残る。
 * フレンドだったときは、お互いのボックスの共有もやめる（相手が入れた画像は、相手のマイメディアに移る）
 */
export async function removeFriendship(friendshipId: string) {
  const f = await db.friendships.get(friendshipId);
  await db.friendships.delete(friendshipId);
  if (f?.status === "accepted") await removeSharesBetween(f.fromId, f.toId);
}
