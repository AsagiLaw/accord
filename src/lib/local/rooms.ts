"use client";

import { useLiveQuery } from "dexie-react-hooks";
import type { IconName } from "@/components/Icon";
import roomPreset from "@/lib/requests/roomPreset.json";
import { unlinkRoom } from "./boxes";
import { db, defaultCategories, defaultChat, newId, newMyMediaBox, newRoomMediaBox, type Category, type Chat, type Database, type DbView, type Profile, type RoomRole, type WindowPage } from "./db";

export type MemberWithProfile = {
  userId: string;
  role: RoomRole;
  displayName: string;
  /** メンバー一覧に出す、アイコン画像・ひとこと・状態 */
  avatar?: string;
  statusText?: string;
  statusExpiresAt?: number;
  presence?: Profile["presence"];
};

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
      (l, i): MemberWithProfile => ({
        userId: l.userId,
        role: l.role,
        displayName: profiles[i]?.displayName ?? "",
        avatar: profiles[i]?.avatar,
        statusText: profiles[i]?.statusText,
        statusExpiresAt: profiles[i]?.statusExpiresAt,
        presence: profiles[i]?.presence,
      }),
    );
  }, [roomId]);
}

export function useAllProfiles() {
  return useLiveQuery(() => db.profiles.orderBy("createdAt").toArray(), []);
}

/**
 * ルームを作るときのメディア：new は新しいボックスを作って紐づける、box は自分のボックスを紐づける、none は紐づけない
 * （紐づけないルームでチャットなどに送った画像は、送った人のマイメディアに入る）。canEdit はメンバーが編集もできるか
 */
export type RoomMediaChoice = { kind: "new"; name: string; canEdit: boolean } | { kind: "box"; boxId: string; canEdit: boolean } | { kind: "none" };

/** ルームを作るときの始め方。original は「オリジナルの作成」、それ以外はテンプレート */
export type RoomTemplateId = "original" | "request" | "chat" | "note";

/** 「テンプレートから始める」で選べるもの */
export const ROOM_TEMPLATES: { id: Exclude<RoomTemplateId, "original">; name: string; description: string; icon: IconName }[] = [
  { id: "request", name: "依頼管理", description: "依頼データベース（テンプレート・ビュー付き）、ウィンドウ「HOME」、チャット", icon: "db" },
  { id: "chat", name: "チャット中心", description: "チャット「雑談」「連絡」「資料」", icon: "chat" },
  { id: "note", name: "ノート中心", description: "ノート「はじめに」と、チャット「雑談」", icon: "note" },
];

/**
 * 「依頼管理」で作るルームの中身（roomPreset.json：見本のルームから写したもの）。ID は全部新しくして、中の繋がり（ブロックの dbId など）も付け替える。
 * データのページ・チャットの会話・カレンダーの予定は入れない（カレンダーやチャットは、はじめて出したときに新しくできる）
 */
function presetRecords(roomId: string, now: number) {
  type Preset = { categories: Category[]; databases: Database[]; views: DbView[]; chats: Chat[]; windows: WindowPage[] };
  const src = roomPreset as unknown as Preset;
  let text = JSON.stringify(src);
  const ids = [
    ...src.categories.map((x) => x.id),
    ...src.databases.flatMap((d) => [d.id, ...(d.templates ?? []).map((t) => t.id)]),
    ...src.views.map((x) => x.id),
    ...src.chats.map((x) => x.id),
    ...src.windows.map((x) => x.id),
  ];
  for (const old of ids) text = text.split(old).join(newId());
  const out = JSON.parse(text) as Preset;
  return {
    categories: out.categories.map((c) => ({ ...c, roomId, createdAt: now })),
    databases: out.databases.map((d) => ({ ...d, roomId, createdAt: now, templates: d.templates?.map((t) => ({ ...t, createdAt: now, updatedAt: undefined })) })),
    views: out.views,
    chats: out.chats.map((c) => ({ ...c, roomId, createdAt: now })),
    windows: out.windows.map((w) => ({ ...w, roomId, createdAt: now, updatedAt: now, items: [] })),
  };
}

export async function createRoom(name: string, userId: string, template: RoomTemplateId = "request", icon?: string, media?: RoomMediaChoice) {
  const id = newId();
  const now = Date.now();
  const categories = defaultCategories(id);
  const [, chatCat, noteCat] = categories;
  const chat = (name: string, order: number): Chat => ({ ...defaultChat(id), name, order, categoryId: chatCat.id, navOrder: order });
  const chats = template === "chat" ? [chat("雑談", 1), chat("連絡", 2), chat("資料", 3)] : [chat("雑談", 1)];
  const preset = template === "request" ? presetRecords(id, now) : null;
  // ルームのメディア：決めていなければ、作った人のボックスを新しく作って紐づける（メンバーは編集もできる）
  const choice: RoomMediaChoice = media ?? { kind: "new", name: `${name}のメディア`, canEdit: true };
  const fresh = choice.kind === "new" ? newRoomMediaBox({ id, name, createdBy: userId }, now) : null;
  if (fresh && choice.kind === "new") {
    fresh.box.name = choice.name.trim() || fresh.box.name;
    fresh.share.canEdit = choice.canEdit;
  }
  // 自分のボックスを紐づけるときは、自分で作ったボックスか確かめる（マイメディアは紐づけられない）
  const existing = choice.kind === "box" ? await db.mediaBoxes.get(choice.boxId) : undefined;
  const linkExisting = choice.kind === "box" && existing?.ownerId === userId && existing.kind === "box";
  await db.transaction("rw", [db.rooms, db.roomMembers, db.chats, db.databases, db.dbViews, db.categories, db.notes, db.windows, db.mediaBoxes, db.boxShares], async () => {
    await db.rooms.add({ id, name, ...(icon ? { icon } : {}), createdBy: userId, createdAt: now });
    if (fresh) {
      await db.mediaBoxes.add(fresh.box);
      await db.boxShares.add(fresh.share);
    }
    if (linkExisting && choice.kind === "box") {
      await db.boxShares.add({ id: newId(), boxId: choice.boxId, roomId: id, canEdit: choice.canEdit, createdAt: now });
    }
    await db.roomMembers.add({ roomId: id, userId, role: "host", joinedAt: now });
    if (preset) {
      // 依頼管理：見本のルームと同じカテゴリー・データベース（ビュー・テンプレート）・ウィンドウ・チャット
      await db.categories.bulkAdd(preset.categories);
      await db.databases.bulkAdd(preset.databases);
      await db.dbViews.bulkAdd(preset.views);
      await db.chats.bulkAdd(preset.chats);
      await db.windows.bulkAdd(preset.windows);
    } else {
      await db.categories.bulkAdd(categories);
      await db.chats.bulkAdd(chats);
    }
    if (template === "note") {
      await db.notes.add({ id: newId(), roomId: id, title: "はじめに", blocks: [], pageId: null, order: 1, createdAt: now, updatedAt: now, updatedBy: userId, categoryId: noteCat.id, navOrder: 1 });
    }
  });
  return id;
}

/**
 * ルームと、その中のもの（チャンネル・ページ・メッセージなど）をすべて消す。元に戻せない。
 * メディアはボックスに入っていてルームのものではないので、紐づけを外すだけで、ボックスと画像は残る
 */
export async function deleteRoom(roomId: string) {
  // 紐づけを外す（メンバーが入れた画像は、それぞれのマイメディアに移る）。メンバーの一覧を使うので、ルームを消す前に行う
  await unlinkRoom(roomId);
  const tables = [db.rooms, db.roomMembers, db.boxShares, db.chats, db.messages, db.chatReads, db.databases, db.dbPages, db.dbViews, db.events, db.todos, db.notes, db.categories, db.imageUsers, db.windows];
  await db.transaction("rw", tables, async () => {
    // ルームの ID を持たないもの（既読・ビュー）は、持ち主から辿って消す
    const chatIds = await db.chats.where("roomId").equals(roomId).primaryKeys();
    const dbIds = await db.databases.where("roomId").equals(roomId).primaryKeys();
    await db.chatReads.filter((r) => chatIds.includes(r.chatId)).delete();
    await db.dbViews.where("dbId").anyOf(dbIds).delete();
    for (const t of [db.boxShares, db.chats, db.messages, db.databases, db.dbPages, db.events, db.todos, db.notes, db.categories, db.imageUsers, db.windows, db.roomMembers]) {
      await (t as typeof db.chats).where("roomId").equals(roomId).delete();
    }
    await db.rooms.delete(roomId);
  });
}

export async function renameRoom(roomId: string, name: string) {
  await db.rooms.update(roomId, { name });
}

/** サーバー版の「招待リンクで参加」に当たる操作。既存の人を加えるか、新しい人を作って加える */
export async function addMember(roomId: string, who: { userId: string } | { displayName: string }) {
  await db.transaction("rw", db.profiles, db.roomMembers, db.mediaBoxes, async () => {
    let userId: string;
    if ("userId" in who) {
      userId = who.userId;
    } else {
      const profile: Profile = { id: newId(), displayName: who.displayName, createdAt: Date.now() };
      await db.profiles.add(profile);
      // 新しい人にも、はじめからマイメディアを用意する
      await db.mediaBoxes.add(newMyMediaBox(profile.id));
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

/** 自分のプロフィール（アイコン・ひとこと・状態）を変える。avatar・statusText を undefined にすると消す */
export async function updateProfile(userId: string, patch: Partial<Pick<Profile, "displayName" | "avatar" | "statusText" | "statusExpiresAt" | "presence" | "bio" | "links" | "workStatus">>) {
  await db.profiles.update(userId, patch);
}
