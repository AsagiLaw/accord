"use client";

import Dexie from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { db, newId, type Chat, type ImageUser, type Message } from "./db";

/** サイドバーに出すチャット（依頼ページの中のチャットは除く） */
export function useChats(roomId: string) {
  return useLiveQuery(
    async () =>
      (await db.chats.where("roomId").equals(roomId).filter((c) => !c.pageId).toArray()).sort(
        (a, b) => a.order - b.order || a.createdAt - b.createdAt,
      ),
    [roomId],
  );
}

export function useChat(chatId: string) {
  return useLiveQuery(async () => (await db.chats.get(chatId)) ?? null, [chatId]);
}

export function useMessages(chatId: string) {
  return useLiveQuery(
    () => db.messages.where("[chatId+createdAt]").between([chatId, Dexie.minKey], [chatId, Dexie.maxKey]).toArray(),
    [chatId],
  );
}

/** ルームの各チャットの未読数（自分以外の発言で、最後に読んだ時刻より後のもの） */
export function useUnreadCounts(roomId: string, userId: string | undefined) {
  return useLiveQuery(async () => {
    const counts = new Map<string, number>();
    if (!userId) return counts;
    const reads = new Map((await db.chatReads.where("userId").equals(userId).toArray()).map((r) => [r.chatId, r.lastReadAt]));
    await db.messages
      .where("roomId")
      .equals(roomId)
      .each((m) => {
        if (m.authorId !== userId && m.createdAt > (reads.get(m.chatId) ?? 0)) counts.set(m.chatId, (counts.get(m.chatId) ?? 0) + 1);
      });
    return counts;
  }, [roomId, userId]);
}

export async function markRead(chatId: string, userId: string, upTo: number) {
  const cur = await db.chatReads.get([chatId, userId]);
  if (!cur || cur.lastReadAt < upTo) await db.chatReads.put({ chatId, userId, lastReadAt: upTo });
}

export async function createChat(roomId: string, name: string, kind: Chat["kind"] = "normal") {
  const existing = await db.chats.where("roomId").equals(roomId).toArray();
  const chat: Chat = {
    id: newId(),
    roomId,
    name,
    kind,
    order: Math.max(0, ...existing.map((c) => c.order)) + 1,
    createdAt: Date.now(),
  };
  await db.chats.add(chat);
  return chat;
}

export async function renameChat(chatId: string, name: string) {
  await db.chats.update(chatId, { name });
}

/** チャットと発言を削除する。添付した画像はメディアに残る */
export async function deleteChat(chatId: string) {
  await db.transaction("rw", db.chats, db.messages, db.chatReads, async () => {
    await db.messages.where("[chatId+createdAt]").between([chatId, Dexie.minKey], [chatId, Dexie.maxKey]).delete();
    await db.chatReads.filter((r) => r.chatId === chatId).delete();
    await db.chats.delete(chatId);
  });
}

export async function sendMessage(
  chat: Pick<Chat, "id" | "roomId">,
  authorId: string,
  body: { text: string; mediaIds: string[]; replyTo: string | null; speaker?: string | null },
) {
  const now = Date.now();
  const message: Message = {
    id: newId(),
    chatId: chat.id,
    roomId: chat.roomId,
    authorId,
    speaker: body.speaker ?? null,
    text: body.text,
    mediaIds: body.mediaIds,
    replyTo: body.replyTo,
    createdAt: now,
    editedAt: null,
  };
  await db.messages.add(message);
  // 自分の発言は既読にしておく
  await markRead(chat.id, authorId, now);
  return message;
}

export async function editMessage(id: string, text: string) {
  await db.messages.update(id, { text, editedAt: Date.now() });
}

export async function deleteMessage(id: string) {
  await db.messages.delete(id);
}

// ---- やり取り再現チャット ----

export async function addSpeaker(chatId: string, name: string) {
  const chat = await db.chats.get(chatId);
  const list = chat?.speakers ?? ["依頼者", "自分"];
  if (!list.includes(name)) await db.chats.update(chatId, { speakers: [...list, name] });
}

/** 入力済みの発言の話者を変える */
export async function changeSpeaker(messageId: string, speaker: string) {
  await db.messages.update(messageId, { speaker });
}

/** ルームごとの未読の合計（ルームバーの赤い数字に使う） */
export function useRoomUnreadTotals(roomIds: string[], userId: string | undefined) {
  const key = roomIds.join(",");
  return useLiveQuery(async () => {
    const totals = new Map<string, number>();
    if (!userId || !roomIds.length) return totals;
    const reads = new Map((await db.chatReads.where("userId").equals(userId).toArray()).map((r) => [r.chatId, r.lastReadAt]));
    await db.messages
      .where("roomId")
      .anyOf(roomIds)
      .each((m) => {
        if (m.authorId !== userId && m.createdAt > (reads.get(m.chatId) ?? 0)) totals.set(m.roomId, (totals.get(m.roomId) ?? 0) + 1);
      });
    return totals;
  }, [key, userId]); // roomIds は中身（key）で比べる
}

// ---- ブロックのチャット・イメージチャット ----

/** ノートのブロックに置くチャットを作る。サイドバーには出さない（pageId に note: を付ける） */
/** ノート・ウィンドウの中に置くチャット。owner は持ち主（note:ID / window:ID）。消すときに一緒に消す */
export async function createBlockChat(roomId: string, owner: string, kind: "normal" | "image") {
  const chat: Chat = { id: newId(), roomId, name: kind === "image" ? "イメージチャット" : "チャット", kind, order: 0, createdAt: Date.now(), pageId: owner };
  await db.chats.add(chat);
  return chat;
}

export async function setChatAllowed(chatId: string, allowed: string[] | undefined) {
  await db.chats.update(chatId, { allowed });
}

export function useImageUsers(roomId: string) {
  return useLiveQuery(async () => (await db.imageUsers.where("roomId").equals(roomId).toArray()).sort((a, b) => a.createdAt - b.createdAt), [roomId]);
}

export async function saveImageUser(user: Omit<ImageUser, "id" | "createdAt"> & { id?: string }) {
  if (user.id) {
    await db.imageUsers.update(user.id, { name: user.name, icon: user.icon, mediaId: user.mediaId });
    return user.id;
  }
  const id = newId();
  await db.imageUsers.add({ ...user, id, createdAt: Date.now() });
  return id;
}

/** イメージユーザーを消す。そのユーザーの発言は「削除されたユーザー」として残る */
export async function deleteImageUser(id: string) {
  await db.imageUsers.delete(id);
}
