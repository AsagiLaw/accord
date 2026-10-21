"use client";

import Dexie from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Chat, type Profile } from "./db";
import { supa } from "./sync";

// ダイレクトメッセージ：2人だけのチャット。ふつうのチャットと同じ表に入れ、roomId は空、dm に2人を入れる

export type DmRow = {
  chat: Chat;
  /** 相手。消えた人なら undefined */
  other: Profile | undefined;
  /** 最後に発言があった日時（まだ発言が無ければ、DM を始めた日時） */
  lastAt: number;
  unread: number;
};

/**
 * 2人の DM の ID。2人のどちらが先に作っても同じ ID になるので、Supabase で1つにまとまる。
 * ローカル版で前に作った DM は、ランダムな ID のまま（openDm は2人で探す）
 */
export const dmChatId = (a: string, b: string) => `dm_${[a, b].sort().join("_")}`;

/** その人との DM を開く。まだ無ければ作る */
export async function openDm(me: string, other: string) {
  const pair = [me, other].sort();
  return db.transaction("rw", db.chats, async () => {
    if (await db.chats.get(dmChatId(me, other))) return dmChatId(me, other);
    // Supabase 版では、2人で決まる ID の DM だけを使う（ほかの ID の DM は rowSync が片づける）
    const found = supa
      ? undefined
      : await db.chats
      .where("dm")
      .equals(pair[0])
      .filter((c) => !!c.dm?.includes(pair[1]))
      .first();
    if (found) return found.id;
    const chat: Chat = { id: dmChatId(me, other), roomId: "", name: "", kind: "normal", order: 0, createdAt: Date.now(), dm: pair };
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
        // last() は問い合わせの中身を変える（逆順・1件に絞る）ので、数えるのは別に作る
        const messages = () => db.messages.where("[chatId+createdAt]").between([chat.id, Dexie.minKey], [chat.id, Dexie.maxKey]);
        const last = await messages().last();
        const read = reads.get(chat.id) ?? 0;
        const unread = await messages().filter((m) => m.authorId !== userId && m.createdAt > read).count();
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
