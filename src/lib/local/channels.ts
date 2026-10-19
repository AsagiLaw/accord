"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db, newId, type Category, type Database, type DbView } from "./db";

// サイドバーの「カテゴリー」と「チャンネル」。
// チャンネルは データベース・チャット・ノート・ウィンドウ の4種類で、それぞれの行に categoryId と navOrder を持たせている。

export type ChannelKind = "db" | "chat" | "note" | "window";
/** sourceId：ウィンドウ・ノートが、ソースにしているテンプレート。updatedAt・updatedBy：ノートの最終更新（サイドバーの「更新あり」の印に使う） */
export type Channel = { kind: ChannelKind; id: string; name: string; icon?: string; categoryId: string | null; order: number; sourceId?: string | null; updatedAt?: number; updatedBy?: string };

export const CHANNEL_KINDS: Record<ChannelKind, { label: string; note: string }> = {
  db: { label: "データベース", note: "依頼などを表やカレンダーで管理する" },
  chat: { label: "チャット", note: "2人で話す。画像はメディアから" },
  note: { label: "ノート", note: "ブロック式で書くページ" },
  window: { label: "ウィンドウ", note: "画面いっぱいに部品を自由に並べる" },
};

const tableOf = (kind: ChannelKind) => (kind === "db" ? db.databases : kind === "chat" ? db.chats : kind === "window" ? db.windows : db.notes);
const CHANNEL_TABLES = [db.databases, db.chats, db.notes, db.windows];

export function useCategories(roomId: string) {
  return useLiveQuery(async () => (await db.categories.where("roomId").equals(roomId).toArray()).sort((a, b) => a.order - b.order), [roomId]);
}

/** ルームのチャンネルを全部（依頼ページの中のチャット・メモは除く） */
export function useChannels(roomId: string) {
  return useLiveQuery(async () => {
    const [dbs, chats, notes, windows] = await Promise.all([
      db.databases.where("roomId").equals(roomId).toArray(),
      db.chats.where("roomId").equals(roomId).filter((c) => !c.pageId).toArray(),
      db.notes.where("roomId").equals(roomId).filter((n) => !n.pageId && !n.template && !n.inner).toArray(),
      // ホームのウィンドウは、サイドバーの「ホーム」から開くので出さない。テンプレートも出さない
      db.windows.where("roomId").equals(roomId).filter((w) => !w.home && !w.template).toArray(),
    ]);
    const list: Channel[] = [
      ...dbs.map((d) => ({ kind: "db" as const, id: d.id, name: d.name, icon: d.icon, categoryId: d.categoryId ?? null, order: d.navOrder ?? d.createdAt })),
      ...chats.map((c) => ({ kind: "chat" as const, id: c.id, name: c.name, icon: c.icon, categoryId: c.categoryId ?? null, order: c.navOrder ?? c.createdAt })),
      ...notes.map((n) => ({ kind: "note" as const, id: n.id, name: n.title, icon: n.icon, categoryId: n.categoryId ?? null, order: n.navOrder ?? n.createdAt, sourceId: n.sourceId ?? null, updatedAt: n.updatedAt, updatedBy: n.updatedBy })),
      ...windows.map((w) => ({ kind: "window" as const, id: w.id, name: w.name, icon: w.icon, categoryId: w.categoryId ?? null, order: w.navOrder ?? w.createdAt, sourceId: w.sourceId ?? null })),
    ];
    return list.sort((a, b) => a.order - b.order);
  }, [roomId]);
}

// ---- カテゴリー ----

export async function createCategory(roomId: string, name: string, before?: string) {
  const cats = (await db.categories.where("roomId").equals(roomId).toArray()).sort((a, b) => a.order - b.order);
  const cat: Category = { id: newId(), roomId, name, order: 0, createdAt: Date.now() };
  const i = before ? cats.findIndex((c) => c.id === before) : -1;
  const next = i < 0 ? [...cats, cat] : [...cats.slice(0, i), cat, ...cats.slice(i)];
  await db.transaction("rw", db.categories, async () => {
    await db.categories.add(cat);
    await Promise.all(next.map((c, k) => db.categories.update(c.id, { order: k + 1 })));
  });
  return cat;
}

export async function renameCategory(id: string, name: string) {
  await db.categories.update(id, { name });
}

/** カテゴリーを消す。中のチャンネルは消さず、カテゴリーの外（一番上）に出す */
export async function deleteCategory(roomId: string, id: string) {
  await db.transaction("rw", [db.categories, ...CHANNEL_TABLES], async () => {
    for (const t of CHANNEL_TABLES) {
      await (t as typeof db.chats).where("roomId").equals(roomId).filter((x) => x.categoryId === id).modify({ categoryId: null });
    }
    await db.categories.delete(id);
  });
}

/** カテゴリーを並べ替える（index の位置に入れる） */
export async function moveCategory(roomId: string, id: string, index: number) {
  const cats = (await db.categories.where("roomId").equals(roomId).toArray()).sort((a, b) => a.order - b.order);
  const moving = cats.find((c) => c.id === id);
  if (!moving) return;
  const rest = cats.filter((c) => c.id !== id);
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, moving);
  await db.transaction("rw", db.categories, () => Promise.all(rest.map((c, k) => db.categories.update(c.id, { order: k + 1 }))));
}

// ---- チャンネル ----

/** チャンネルを、カテゴリーの index の位置に動かす（同じカテゴリーの中の並べ替えも同じ） */
export async function moveChannel(ch: Pick<Channel, "kind" | "id">, categoryId: string | null, index: number, all: Channel[]) {
  const target = all.filter((c) => c.categoryId === categoryId && !(c.kind === ch.kind && c.id === ch.id));
  const moving = all.find((c) => c.kind === ch.kind && c.id === ch.id);
  if (!moving) return;
  target.splice(Math.max(0, Math.min(index, target.length)), 0, { ...moving, categoryId });
  await db.transaction("rw", CHANNEL_TABLES, () =>
    Promise.all(target.map((c, k) => (tableOf(c.kind) as typeof db.chats).update(c.id, { categoryId, navOrder: k + 1 }))),
  );
}

async function nextOrder(roomId: string, categoryId: string | null) {
  const lists = await Promise.all(CHANNEL_TABLES.map((t) => (t as typeof db.chats).where("roomId").equals(roomId).toArray()));
  const inCat = lists.flat().filter((x) => (x.categoryId ?? null) === categoryId);
  return Math.max(0, ...inCat.map((x) => x.navOrder ?? 0)) + 1;
}

/** 空のデータベース（名前とタグの2項目、テーブルのビュー1つ） */
export function emptyDatabase(roomId: string, name: string): { database: Database; views: DbView[] } {
  const id = newId();
  return {
    database: {
      id,
      roomId,
      name,
      kind: "generic",
      props: [
        { id: "title", name: "名前", type: "title" },
        { id: `p_${newId().slice(0, 8)}`, name: "タグ", type: "multiselect", options: [] },
        // ページごとの会話（依頼と同じく、チャットはデータベースの項目）
        { id: "p_chat", name: "チャット", type: "chat" },
      ],
      plans: {},
      order: 1,
      createdAt: Date.now(),
    },
    views: [{ id: newId(), dbId: id, name: "テーブル", type: "table", filters: [], sort: null, options: {}, order: 1 }],
  };
}

/** チャンネルを作る。作ったものの ID を返す */
export async function createChannel(roomId: string, userId: string, kind: ChannelKind, name: string, categoryId: string | null) {
  const navOrder = await nextOrder(roomId, categoryId);
  const now = Date.now();
  if (kind === "db") {
    const { database, views } = emptyDatabase(roomId, name);
    await db.transaction("rw", db.databases, db.dbViews, async () => {
      await db.databases.add({ ...database, categoryId, navOrder });
      await db.dbViews.bulkAdd(views);
    });
    return database.id;
  }
  if (kind === "chat") {
    const id = newId();
    await db.chats.add({ id, roomId, name, kind: "normal", order: navOrder, createdAt: now, categoryId, navOrder });
    return id;
  }
  if (kind === "window") {
    const id = newId();
    await db.windows.add({ id, roomId, name, items: [], blocks: [], order: navOrder, createdAt: now, updatedAt: now, categoryId, navOrder });
    return id;
  }
  const id = newId();
  await db.notes.add({ id, roomId, title: name, blocks: [], pageId: null, order: navOrder, createdAt: now, updatedAt: now, updatedBy: userId, categoryId, navOrder });
  return id;
}

export async function renameChannel(ch: Pick<Channel, "kind" | "id">, name: string) {
  if (ch.kind === "note") await db.notes.update(ch.id, { title: name });
  else await (tableOf(ch.kind) as typeof db.chats).update(ch.id, { name });
}

/** チャンネル（データベース・チャット・ノート・ウィンドウ）のアイコンを変える。undefined で種類のアイコンに戻す */
export async function setChannelIcon(ch: Pick<Channel, "kind" | "id">, icon: string | undefined) {
  await (tableOf(ch.kind) as typeof db.chats).update(ch.id, { icon });
}

/** チャンネルを削除する。データベースは中のページ・チャット・ビューも消える（画像はメディアに残る） */
export async function deleteChannel(ch: Pick<Channel, "kind" | "id">) {
  if (ch.kind === "note" || ch.kind === "window") {
    await deleteOwnedChats(`${ch.kind}:${ch.id}`);
    return ch.kind === "note" ? db.notes.delete(ch.id) : db.windows.delete(ch.id);
  }
  if (ch.kind === "chat") {
    await db.transaction("rw", db.chats, db.messages, db.chatReads, async () => {
      await db.messages.filter((m) => m.chatId === ch.id).delete();
      await db.chatReads.filter((r) => r.chatId === ch.id).delete();
      await db.chats.delete(ch.id);
    });
    return;
  }
  await db.transaction("rw", [db.databases, db.dbPages, db.dbViews, db.chats, db.messages, db.chatReads, db.events, db.notes], async () => {
    const pages = await db.dbPages.where("dbId").equals(ch.id).toArray();
    const pageIds = pages.map((p) => p.id);
    // ページのチャットに加えて、チャットの項目のチャット（持ち主がページ）と、ページの本文に置いたチャットも消す
    const notes = await db.notes.filter((n) => !!n.pageId && pageIds.includes(n.pageId)).toArray();
    const owners = new Set([...pageIds, ...pageIds.map((id) => `page:${id}`), ...notes.map((n) => `note:${n.id}`)]);
    const owned = (await db.chats.filter((c) => !!c.pageId && owners.has(c.pageId)).toArray()).map((c) => c.id);
    const chatIds = [...new Set([...pages.flatMap((p) => [p.chatId, p.reenactChatId]).filter((x): x is string => !!x), ...owned])];
    await db.messages.filter((m) => chatIds.includes(m.chatId)).delete();
    await db.chatReads.filter((r) => chatIds.includes(r.chatId)).delete();
    await db.chats.bulkDelete(chatIds);
    await db.events.filter((e) => !!e.pageId && pageIds.includes(e.pageId)).delete();
    await db.notes.filter((n) => !!n.pageId && pageIds.includes(n.pageId)).delete();
    await db.dbPages.bulkDelete(pageIds);
    await db.dbViews.where("dbId").equals(ch.id).delete();
    await db.databases.delete(ch.id);
  });
}

export const channelHref = (roomId: string, ch: Pick<Channel, "kind" | "id">) => `/r/${roomId}/${ch.kind}/${ch.id}`;

/** ノート・ウィンドウの中に置いたチャット（持ち主 owner）を、発言ごと消す */
export async function deleteOwnedChats(owner: string, only?: string) {
  await db.transaction("rw", db.chats, db.messages, db.chatReads, async () => {
    const ids = (await db.chats.filter((c) => c.pageId === owner && (!only || c.id === only)).toArray()).map((c) => c.id);
    if (!ids.length) return;
    await db.messages.filter((m) => ids.includes(m.chatId)).delete();
    await db.chatReads.filter((r) => ids.includes(r.chatId)).delete();
    await db.chats.bulkDelete(ids);
  });
}
