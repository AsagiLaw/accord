"use client";

import Dexie from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { db, newId, type Chat, type Profile } from "./db";

// ダイレクトメッセージ：2人だけのチャット。ふつうのチャットと同じ表に入れ、roomId は空、dm に2人を入れる

export type DmRow = {
  chat: Chat;
  /** 相手。消えた人なら undefined */
  other: Profile | undefined;
  /** 最後に発言があった日時（まだ発言が無ければ、DM を始めた日時） */
  lastAt: number;
  unread: number;
};

/** その人との DM を開く。まだ無ければ作る */
export async function openDm(me: string, other: string) {
  const pair = [me, other].sort();
  return db.transaction("rw", db.chats, async () => {
    const found = await db.chats
      .where("dm")
      .equals(pair[0])
      .filter((c) => !!c.dm?.includes(pair[1]))
      .first();
    if (found) return found.id;
    const chat: Chat = { id: newId(), roomId: "", name: "", kind: "normal", order: 0, createdAt: Date.now(), dm: pair };
    await db.chats.add(chat);
    return chat.id;
  });
}

/** 自分の DM（新しく発言があった順）と、それぞれの未読の数 */
export function useMyDms(userId: string | undefined) {
  return useLiveQuery(async () => {
    if (!userId) return [];
    const chats = await db.chats.where("dm").equals(userId).toArray();
    const reads = new Map((await db.chatReads.where("userId").equals(userId).toArray()).map((r) => [r.chatId, r.lastReadAt]));
    const others = await db.profiles.bulkGet(chats.map((c) => c.dm!.find((id) => id !== userId) ?? userId));
    const rows = await Promise.all(
      chats.map(async (chat, i): Promise<DmRow> => {
        const messages = db.messages.where("[chatId+createdAt]").between([chat.id, Dexie.minKey], [chat.id, Dexie.maxKey]);
        const last = await messages.last();
        const read = reads.get(chat.id) ?? 0;
        const unread = await messages.filter((m) => m.authorId !== userId && m.createdAt > read).count();
        return { chat, other: others[i], lastAt: last?.createdAt ?? chat.createdAt, unread };
      }),
    );
    return rows.sort((a, b) => b.lastAt - a.lastAt);
  }, [userId]);
}

/** DM の相手（自分でない方の人） */
export function dmOther(chat: Chat, me: string) {
  return chat.dm?.find((id) => id !== me);
}
