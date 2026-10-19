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

/** そのチャットの、時刻が from 以降の発言（古い順）。from が undefined の間は読まない。hasOlder：それより前にも発言があるか */
export function useMessagesSince(chatId: string, from: number | undefined) {
  return useLiveQuery(async () => {
    if (from === undefined) return undefined;
    const messages = await db.messages.where("[chatId+createdAt]").between([chatId, from], [chatId, Dexie.maxKey], true, true).toArray();
    const hasOlder = (await db.messages.where("[chatId+createdAt]").between([chatId, Dexie.minKey], [chatId, from], true, false).limit(1).count()) > 0;
    return { messages, hasOlder };
  }, [chatId, from]);
}

/**
 * 時刻 before より前（before を含む。null なら最新から）の発言を新しい方から count 件たどった、いちばん古い発言の時刻。
 * そこから読めば count 件ぶん読み込める。発言が足りなければ 0（最初から全部）
 */
export async function olderFrom(chatId: string, before: number | null, count: number) {
  const m = await db.messages
    .where("[chatId+createdAt]")
    .between([chatId, Dexie.minKey], [chatId, before ?? Dexie.maxKey], true, true)
    .reverse()
    .offset(count - 1)
    .first();
  return m?.createdAt ?? 0;
}

/**
 * そのチャットで、まだ読んでいない最初の発言（自分以外の、最後に読んだ時刻より後のもの）。
 * 一度も開いたことがないチャット（読んだ記録が無い）は、未読から開かずに一番下から見せるので null
 */
export async function firstUnread(chatId: string, userId: string) {
  const read = await db.chatReads.get([chatId, userId]);
  // 通知を切っただけで、まだ読んでいないときも同じ
  if (!read?.lastReadAt) return null;
  const m = await db.messages
    .where("[chatId+createdAt]")
    .between([chatId, read.lastReadAt], [chatId, Dexie.maxKey], false, true)
    .filter((x) => x.authorId !== userId)
    .first();
  return m ?? null;
}

/** ID で発言を引く（読み込んでいない古い発言への返信の引用に使う） */
export function useMessagesByIds(ids: string[]) {
  const key = ids.join(",");
  return useLiveQuery(
    async () => new Map((await db.messages.bulkGet(ids)).filter((m): m is Message => !!m).map((m) => [m.id, m])),
    [key], // ids は中身（key）で比べる
  );
}

/** 表のセルに出す、発言の数と最後の発言（発言を全部は読まない） */
export function useChatSummary(chatId: string) {
  return useLiveQuery(async () => {
    const range = () => db.messages.where("[chatId+createdAt]").between([chatId, Dexie.minKey], [chatId, Dexie.maxKey]);
    return { count: await range().count(), last: await range().last() };
  }, [chatId]);
}

/** チャットの発言を、新しい順に探す（全部を一度に持たず、順に見ていく）。多すぎるときは limit 件まで */
export async function searchMessages(chatId: string, match: (m: Message) => boolean, limit: number) {
  return db.messages.where("[chatId+createdAt]").between([chatId, Dexie.minKey], [chatId, Dexie.maxKey]).reverse().filter(match).limit(limit).toArray();
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
  // 通知を切っているかは残す
  if (!cur || cur.lastReadAt < upTo) await db.chatReads.put({ ...cur, chatId, userId, lastReadAt: upTo });
}

/** そのチャットの、人ごとのどこまで読んだか（既読に使う）。人の ID → 最後に読んだ発言の時刻 */
export function useChatReads(chatId: string) {
  return useLiveQuery(
    async () =>
      new Map(
        (await db.chatReads.where("[chatId+userId]").between([chatId, Dexie.minKey], [chatId, Dexie.maxKey]).toArray()).map((r) => [r.userId, r.lastReadAt]),
      ),
    [chatId],
  );
}

/** そのチャットの通知を切っているか（人ごと。どの端末でも同じ） */
export function useChatMuted(chatId: string, userId: string | undefined) {
  return useLiveQuery(async () => (userId ? !!(await db.chatReads.get([chatId, userId]))?.muted : false), [chatId, userId]);
}

export async function setChatMuted(chatId: string, userId: string, muted: boolean) {
  const cur = await db.chatReads.get([chatId, userId]);
  await db.chatReads.put({ chatId, userId, lastReadAt: cur?.lastReadAt ?? 0, ...(muted && { muted: true }) });
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
  body: { text: string; mediaIds: string[]; replyTo: string | null; speaker?: string | null; inviteId?: string },
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
    ...(body.inviteId ? { inviteId: body.inviteId } : {}),
  };
  await db.messages.add(message);
  // 自分の発言は既読にしておく
  await markRead(chat.id, authorId, now);
  return message;
}

export async function editMessage(id: string, text: string) {
  await db.messages.update(id, { text, editedAt: Date.now() });
}

/** 発言を消す。ルームへの招待のカードなら、招待も取り消す（もう参加していれば、招待の記録は残す） */
export async function deleteMessage(id: string) {
  await db.transaction("rw", db.messages, db.roomInvites, async () => {
    const m = await db.messages.get(id);
    const invite = m?.inviteId ? await db.roomInvites.get(m.inviteId) : undefined;
    if (invite && !invite.acceptedAt) await db.roomInvites.delete(invite.id);
    await db.messages.delete(id);
  });
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
