"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { DONE, P } from "@/lib/requests/defaults";
import { renameInFormula, withFormulas } from "@/lib/requests/formula";
import { defaultsOf } from "@/lib/requests/props";
import { stamp, today } from "@/lib/requests/logic";
import { stageOf } from "@/lib/requests/stages";
import { deleteNoteTree, deleteOwnedChats } from "./channels";
import { copySubPages, deleteSubPages } from "./subPages";
import { freshBlocks } from "./templates";
import { db, newId, type CalEvent, type Database, type DbPage, type DbView, type Note, type PageTemplate, type Property, type StatusGroup, type TagColor, type Todo } from "./db";
import { pageNoteId } from "./notes";

// ---- 読み込み ----

export function useDatabases(roomId: string) {
  return useLiveQuery(async () => (await db.databases.where("roomId").equals(roomId).toArray()).sort((a, b) => a.order - b.order), [roomId]);
}

export function useDatabase(dbId: string) {
  return useLiveQuery(async () => (await db.databases.get(dbId)) ?? null, [dbId]);
}

/** ルームの依頼データベース（ホームで使う） */
export function useRequestDatabase(roomId: string) {
  return useLiveQuery(async () => (await db.databases.where("roomId").equals(roomId).filter((d) => d.kind === "request").first()) ?? null, [roomId]);
}

/** データベースのページ（ゴミ箱のものは除く）。数式の項目は、計算した値を入れて返す（保存はしない） */
export function usePages(dbId: string | undefined) {
  return useLiveQuery(async () => {
    if (!dbId) return [];
    const [database, pages] = await Promise.all([db.databases.get(dbId), db.dbPages.where("dbId").equals(dbId).toArray()]);
    return withFormulas(database, pages.filter((p) => !p.deletedAt));
  }, [dbId]);
}

/** ページ1つ（ゴミ箱のものも返す。deletedAt で分かる）。数式の項目は計算した値を入れる */
export function usePage(pageId: string) {
  return useLiveQuery(async () => {
    const page = await db.dbPages.get(pageId);
    if (!page) return null;
    return withFormulas(await db.databases.get(page.dbId), [page])[0];
  }, [pageId]);
}

/** ゴミ箱のページ（新しく入れた順） */
export function useTrash(dbId: string) {
  return useLiveQuery(async () => (await db.dbPages.where("dbId").equals(dbId).filter((p) => !!p.deletedAt).toArray()).sort((a, b) => b.deletedAt! - a.deletedAt!), [dbId]);
}

export function useViews(dbId: string | undefined) {
  return useLiveQuery(async () => (dbId ? (await db.dbViews.where("dbId").equals(dbId).toArray()).sort((a, b) => a.order - b.order) : []), [dbId]);
}

/** ルームの予定（データベースのカレンダーに出る）。カレンダーブロックだけの予定は除く */
export function useEvents(roomId: string) {
  return useLiveQuery(async () => (await db.events.where("roomId").equals(roomId).toArray()).filter((e) => !e.calendarId), [roomId]);
}

/** カレンダーブロックに出す予定：そのカレンダーの予定（calendarId）と、room が true ならルームの予定 */
export function useCalendarEvents(roomId: string, calendarId: string, room: boolean) {
  return useLiveQuery(
    async () => (await db.events.where("roomId").equals(roomId).toArray()).filter((e) => (calendarId && e.calendarId === calendarId) || (room && !e.calendarId)),
    [roomId, calendarId, room],
  );
}

/** いくつかのデータベースのページ（ゴミ箱のものは除く。数式の項目は計算した値を入れる）。カレンダーブロックで使う */
export function usePagesOf(dbIds: string[]) {
  const key = [...new Set(dbIds)].sort().join(",");
  return useLiveQuery(async () => {
    const ids = key ? key.split(",") : [];
    if (!ids.length) return [];
    const [databases, pages] = await Promise.all([db.databases.bulkGet(ids), db.dbPages.where("dbId").anyOf(ids).toArray()]);
    return databases.flatMap((d) => (d ? withFormulas(d, pages.filter((p) => p.dbId === d.id && !p.deletedAt)) : []));
  }, [key]);
}

export function useTodos(roomId: string) {
  return useLiveQuery(async () => (await db.todos.where("roomId").equals(roomId).toArray()).sort((a, b) => a.createdAt - b.createdAt), [roomId]);
}

// ---- 依頼（ページ） ----

/** ページの名前の後ろに付ける言葉（データベースの設定。無いときは、依頼は「様」） */

/** 新しいページの初期値：受付日・開始日は今日、枚数1、進行0%、ステータスは最初の選択肢。項目に「はじめから入る値」があれば、そちらを使う */
export function newPageDefaults(database: Database, userId?: string): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const p of database.props) {
    if (p.type === "status") v[p.id] = p.options?.[0] ?? "";
    if (database.kind === "request") {
      if (p.id === P.received || p.id === P.start) v[p.id] = today();
      if (p.id === P.count) v[p.id] = 1;
      if (p.id === P.progress || p.id === P.fee) v[p.id] = 0;
    }
  }
  return { ...v, ...defaultsOf(database, userId) };
}

/** 通し番号の項目ごとの、次の番号（ゴミ箱のページも数える。同じ番号を二度使わない） */
async function nextSerials(database: Database): Promise<Record<string, number>> {
  const props = database.props.filter((p) => p.type === "serial");
  if (!props.length) return {};
  const pages = await db.dbPages.where("dbId").equals(database.id).toArray();
  return Object.fromEntries(props.map((p) => [p.id, Math.max(0, ...pages.map((pg) => Number(pg.values[p.id]) || 0)) + 1]));
}

/** 依頼（ページ）を作る。チャットの項目の会話も一緒に作る。
 * ウィンドウ型のテンプレートは繋ぐ（本文はテンプレートの中身を出す）。ノート型のテンプレートは繋がず、同じブロックを本文に入れる */
export async function createPage(database: Database, userId: string, title: string, values: Record<string, unknown>, template?: PageTemplate) {
  const id = newId();
  const now = Date.now();
  const chatId = newId();
  const reenactChatId = newId();
  // 作成日時・更新日時の項目は、作ったときの日時を入れておく。通し番号は次の番号
  const auto = { ...Object.fromEntries(database.props.filter((p) => p.type === "created" || p.type === "edited").map((p) => [p.id, stamp(now)])), ...(await nextSerials(database)) };
  // はじめから入る値：渡された値に無い項目だけ入れる（「自分」は作った人）
  const given = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v === "@me" ? userId : v]));
  values = { ...defaultsOf(database, userId), ...given };
  // チャット・イメージチャットの項目（1つずつ）があれば、その会話を作って入れておく。無ければ作らない
  const chatProp = database.props.find((p) => p.type === "chat");
  const imageProp = database.props.find((p) => p.type === "imageChat");
  const chatValues = { ...(chatProp ? { [chatProp.id]: chatId } : {}), ...(imageProp ? { [imageProp.id]: reenactChatId } : {}) };
  const page: DbPage = {
    id,
    dbId: database.id,
    roomId: database.roomId,
    title,
    values: { ...values, ...auto, ...chatValues },
    chatId: chatProp ? chatId : null,
    reenactChatId: imageProp ? reenactChatId : null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
  if (template) {
    page.bodyKind = template.kind;
    if (template.kind === "window") page.sourceId = template.id;
  }
  await db.transaction("rw", db.dbPages, db.chats, db.notes, async () => {
    await db.dbPages.add(page);
    if (template?.kind === "note")
      await db.notes.add({ id: pageNoteId(id), roomId: database.roomId, title, blocks: freshBlocks(template.blocks), pageId: id, order: 0, createdAt: now, updatedAt: now, updatedBy: userId });
    await db.chats.bulkAdd([
      ...(chatProp ? [{ id: chatId, roomId: database.roomId, name: chatProp.name, kind: "normal" as const, order: 0, createdAt: now, pageId: id }] : []),
      ...(imageProp ? [{ id: reenactChatId, roomId: database.roomId, name: imageProp.name, kind: "image" as const, order: 0, createdAt: now, pageId: id, speakers: ["依頼者", "自分"] }] : []),
    ]);
  });
  return page;
}

/** 更新日時の項目を今の日時にする */
async function touched(page: DbPage): Promise<Partial<DbPage>> {
  const d = await db.databases.get(page.dbId);
  const now = Date.now();
  const edited = (d?.props ?? []).filter((p) => p.type === "edited");
  return { updatedAt: now, ...(edited.length ? { values: { ...page.values, ...Object.fromEntries(edited.map((p) => [p.id, stamp(now)])) } } : {}) };
}

export async function updatePageTitle(pageId: string, title: string) {
  const page = await db.dbPages.get(pageId);
  if (page) await db.dbPages.update(pageId, { title, ...(await touched(page)) });
}

export async function updatePageValue(pageId: string, propId: string, value: unknown) {
  const page = await db.dbPages.get(pageId);
  if (!page) return;
  const values = { ...page.values, [propId]: value };
  // 進行を100%にしたら、ステータスも完了にする（手数を減らすため）
  if (propId === P.progress && Number(value) >= 100 && values[P.status] !== DONE) values[P.status] = DONE;
  // 依頼では、工程を選ぶと進行の％がその工程の％になり、100%なら完了にする
  const database = await db.databases.get(page.dbId);
  const prop = database?.props.find((p) => p.id === propId);
  if (database?.kind === "request" && prop?.type === "stage") {
    const pct = stageOf(prop, { values }).pct;
    if (database.props.some((p) => p.id === P.progress)) values[P.progress] = pct;
    if (pct >= 100) values[P.status] = DONE;
  }
  const t = await touched({ ...page, values });
  await db.dbPages.update(pageId, { values: t.values ?? values, updatedAt: t.updatedAt });
}

/** ゴミ箱に入れておく日数。過ぎたら完全に削除する */
export const TRASH_DAYS = 30;

/** ページをゴミ箱に入れる（一覧から消える。チャットや本文はそのまま残り、戻せる） */
export async function trashPage(page: Pick<DbPage, "id">) {
  await db.dbPages.update(page.id, { deletedAt: Date.now() });
}

/** ゴミ箱から戻す */
export async function restorePage(pageId: string) {
  await db.dbPages.update(pageId, { deletedAt: undefined });
}

/** ゴミ箱に入れてから TRASH_DAYS 日たったページ（データベースのページ・ノートの子のページ）を、完全に削除する（アプリを開いたときに呼ぶ） */
export async function purgeOldTrash() {
  const limit = Date.now() - TRASH_DAYS * 864e5;
  const old = await db.dbPages.filter((p) => !!p.deletedAt && p.deletedAt < limit).toArray();
  for (const p of old) await deletePageForever(p);
  const notes = await db.notes.filter((n) => !!n.deletedAt && n.deletedAt < limit).toArray();
  for (const n of notes) await deleteNoteTree(n.id);
}

/** ルームのゴミ箱のもの：ノートの子のページ（parent は親のノート）と、データベースのページ */
export type RoomTrashItem = { kind: "note"; note: Note; parent?: Note; deletedAt: number } | { kind: "page"; page: DbPage; database?: Database; deletedAt: number };

/** ルームのゴミ箱（ノートの子のページと、すべてのデータベースのページ。新しく入れた順） */
export function useRoomTrash(roomId: string) {
  return useLiveQuery(async () => {
    const [notes, pages, databases] = await Promise.all([
      db.notes.where("roomId").equals(roomId).toArray(),
      db.dbPages.where("roomId").equals(roomId).filter((p) => !!p.deletedAt).toArray(),
      db.databases.where("roomId").equals(roomId).toArray(),
    ]);
    const items: RoomTrashItem[] = [
      ...notes.filter((n) => !!n.deletedAt).map((n) => ({ kind: "note" as const, note: n, parent: notes.find((x) => x.id === n.parentId), deletedAt: n.deletedAt! })),
      ...pages.map((p) => ({ kind: "page" as const, page: p, database: databases.find((d) => d.id === p.dbId), deletedAt: p.deletedAt! })),
    ];
    return items.sort((a, b) => b.deletedAt - a.deletedAt);
  }, [roomId]);
}

/** ルームのゴミ箱を空にする（ノートの子のページは中のページごと） */
export async function emptyRoomTrash(roomId: string) {
  const notes = await db.notes.where("roomId").equals(roomId).filter((n) => !!n.deletedAt).toArray();
  for (const n of notes) await deleteNoteTree(n.id);
  const pages = await db.dbPages.where("roomId").equals(roomId).filter((p) => !!p.deletedAt).toArray();
  for (const p of pages) await deletePageForever(p);
}

/** ゴミ箱を空にする */
export async function emptyTrash(dbId: string) {
  const pages = await db.dbPages.where("dbId").equals(dbId).filter((p) => !!p.deletedAt).toArray();
  for (const p of pages) await deletePageForever(p);
}

/** ページを完全に削除する。チャットの発言も消える（添付した画像はメディアに残る） */
export async function deletePageForever(page: DbPage) {
  const chatIds = [page.chatId, page.reenactChatId].filter((x): x is string => !!x);
  // 本文（ノート・ウィンドウ）に置いたチャットも消す
  const notes = await db.notes.where("pageId").equals(page.id).toArray();
  for (const n of notes) await deleteOwnedChats(`note:${n.id}`);
  await deleteOwnedChats(`page:${page.id}`);
  // チャットの項目で作ったチャット（pageId がこのページ）も消す
  const own = (await db.chats.filter((c) => c.pageId === page.id).toArray()).map((c) => c.id);
  chatIds.push(...own.filter((x) => !chatIds.includes(x)));
  await db.transaction("rw", [db.dbPages, db.chats, db.messages, db.chatReads, db.events, db.notes], async () => {
    await db.notes.where("pageId").equals(page.id).delete();
    await db.messages.filter((m) => chatIds.includes(m.chatId)).delete();
    await db.chatReads.filter((r) => chatIds.includes(r.chatId)).delete();
    await db.chats.bulkDelete(chatIds);
    await db.events.where("pageId").equals(page.id).delete();
    await db.dbPages.delete(page.id);
  });
}

/**
 * ページを複製する（項目の値・アイコン・本文・テンプレートとの繋がり）。名前は「〇〇のコピー」。
 * チャット（チャットの項目・本文のチャット）は新しく空のものにする。作成日時・更新日時は今にする
 */
export async function duplicatePage(page: DbPage, userId: string) {
  const database = await db.databases.get(page.dbId);
  if (!database) return;
  const now = Date.now();
  const id = newId();
  const values = { ...(await db.dbPages.get(page.id))?.values };
  for (const p of database.props) {
    if (p.type === "chat" || p.type === "imageChat" || p.type === "formula") delete values[p.id];
    if (p.type === "created" || p.type === "edited") values[p.id] = stamp(now);
  }
  // 通し番号は新しい番号にする
  Object.assign(values, await nextSerials(database));
  const copy: DbPage = {
    id,
    dbId: page.dbId,
    roomId: page.roomId,
    title: page.title ? `${page.title}のコピー` : "",
    icon: page.icon,
    values,
    chatId: null,
    reenactChatId: null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    bodyKind: page.bodyKind,
    sourceId: page.sourceId,
  };
  const note = await db.notes.where("pageId").equals(page.id).filter((n) => !n.sub).first();
  await db.transaction("rw", db.dbPages, db.notes, async () => {
    await db.dbPages.add(copy);
    // 本文：チャットのブロックはチャットを外して入れる（開いたときに新しく作る）
    if (note) await db.notes.add({ ...note, id: pageNoteId(id), title: copy.title, blocks: freshBlocks(note.blocks), pageId: id, createdAt: now, updatedAt: now, updatedBy: userId });
  });
  // 「ページ」の項目の別ページも写す
  await copySubPages(page.id, id, userId);
  // チャットの項目は、空の会話を用意しておく
  for (const p of database.props.filter((x) => x.type === "chat" || x.type === "imageChat")) await ensurePropChat(id, p);
  return copy;
}

// ---- データベースの設定 ----

/** 選択肢を足す（依頼窓口・依頼プランなどの「追加…」） */
export async function addOption(dbId: string, propId: string, option: string) {
  const d = await db.databases.get(dbId);
  if (!d) return;
  const props = d.props.map((p): Property => (p.id === propId && !(p.options ?? []).includes(option) ? { ...p, options: [...(p.options ?? []), option] } : p));
  await db.databases.update(dbId, { props });
}

export async function updateDatabase(dbId: string, patch: Partial<Pick<Database, "name" | "props" | "plans" | "dueProp" | "dueDays">>) {
  await db.databases.update(dbId, patch);
}

// ---- ビュー ----

/** ビューを保存する。固定したビューは、固定を外すとき（locked を外した保存）だけ通す */
export async function saveView(view: DbView) {
  const prev = await db.dbViews.get(view.id);
  if (prev?.options.locked && view.options.locked) return;
  await db.dbViews.put(view);
}

export async function createView(dbId: string, name: string, type: DbView["type"]) {
  const views = await db.dbViews.where("dbId").equals(dbId).toArray();
  const view: DbView = { id: newId(), dbId, name, type, filters: [], sort: null, options: type === "calendar" || type === "timeline" ? { stages: true } : {}, order: Math.max(0, ...views.map((v) => v.order)) + 1 };
  await db.dbViews.add(view);
  return view;
}

/**
 * 項目を、そのデータベースのテーブルのビューに列として出す（チャットのブロックで項目を作ったとき・繋いだとき）。
 * 出す項目を決めていないテーブルは、はじめからチャットの項目も出るので、そのまま。固定したビューは変えない
 */
export async function showPropInTables(dbId: string, propId: string) {
  await db.dbViews
    .where("dbId")
    .equals(dbId)
    .modify((v) => {
      const visible = v.options.visible;
      if (v.type !== "table" || v.options.locked || !visible || visible.includes(propId)) return;
      v.options = { ...v.options, visible: [...visible, propId] };
    });
}

export async function deleteView(viewId: string) {
  await db.dbViews.delete(viewId);
}

// ---- カレンダーの予定・ToDo ----

export async function addEvent(roomId: string, date: string, text: string, pageId: string | null = null) {
  const e: CalEvent = { id: newId(), roomId, date, text, pageId, createdAt: Date.now() };
  await db.events.add(e);
}

export async function deleteEvent(id: string) {
  await db.events.delete(id);
}

/** 予定を済みにする・戻す（ToDo のブロックのチェック） */
export async function setEventDone(id: string, done: boolean) {
  await db.events.update(id, { done: done || undefined });
}

/** ルームの中のカレンダーブロック（ノート・ウィンドウ・ページの本文に置いたもの）。ToDo のブロックのソースに選べる */
export type RoomCalendar = { calendarId: string; label: string; own: boolean; room: boolean; dbs: string };

export function useRoomCalendars(roomId: string) {
  return useLiveQuery(async () => {
    const [notes, windows, pages] = await Promise.all([db.notes.where("roomId").equals(roomId).toArray(), db.windows.where("roomId").equals(roomId).toArray(), db.dbPages.where("roomId").equals(roomId).toArray()]);
    const out: RoomCalendar[] = [];
    type B = { type?: string; props?: Record<string, string>; children?: B[] };
    const walk = (where: string, blocks: unknown[] | undefined) => {
      const found: B[] = [];
      const go = (list: B[]) => list.forEach((b) => (b.type === "calendarBlock" && b.props?.calendarId ? found.push(b) : null, b.children && go(b.children)));
      go((blocks ?? []) as B[]);
      // 同じところに2つ以上あれば、番号を付けて分ける
      found.forEach((b, i) =>
        out.push({
          calendarId: b.props!.calendarId,
          label: `${where}のカレンダー${found.length > 1 ? i + 1 : ""}`,
          own: b.props!.own !== "",
          room: b.props!.room === "1",
          dbs: b.props!.dbs ?? "[]",
        }),
      );
    };
    for (const n of notes) {
      if (n.template || n.inner || n.deletedAt) continue;
      // ページの本文・別ページは、そのページの名前で呼ぶ
      const page = n.pageId ? pages.find((p) => p.id === n.pageId) : undefined;
      if (n.pageId && (!page || page.deletedAt)) continue;
      walk(page ? `ページ「${page.title || "無題"}」` : `ノート「${n.title || "無題"}」`, n.blocks);
    }
    for (const w of windows) if (!w.template) walk(w.home ? "ホーム" : `ウィンドウ「${w.name || "無題"}」`, w.blocks);
    return out;
  }, [roomId]);
}

/** 予定の中身（カレンダーブロックの予定の画面で直すもの） */
export type EventFields = Pick<CalEvent, "date" | "text" | "end" | "time" | "endTime" | "color" | "memo" | "calendarId" | "done">;

/** 予定を足す（id が無いとき）か直す。終わりの日が始まりの日と同じなら、1日だけの予定にする */
export async function saveCalEvent(roomId: string, id: string | null, fields: EventFields) {
  const clean: EventFields = { ...fields, end: fields.end && fields.end > fields.date ? fields.end : undefined };
  if (id) await db.events.update(id, clean);
  else await db.events.add({ id: newId(), roomId, pageId: null, createdAt: Date.now(), ...clean });
}

export async function addTodo(roomId: string, text: string) {
  const t: Todo = { id: newId(), roomId, text, done: false, createdAt: Date.now() };
  await db.todos.add(t);
}

export async function toggleTodo(id: string, done: boolean) {
  await db.todos.update(id, { done });
}

/** やることを消す。消したものを返すので、restoreTodo で元に戻せる */
export async function deleteTodo(id: string) {
  const t = await db.todos.get(id);
  await db.todos.delete(id);
  return t;
}

export async function restoreTodo(t: Todo) {
  await db.todos.put(t);
}

// ---- 項目（プロパティ）・選択肢 ----

/** 依頼の計算に使う項目。削除と種類の変更はできない */
export const LOCKED_PROPS: string[] = [P.title, P.received, P.start, P.due, P.fee, P.status];

/** 種類の変更ができない項目：タイトル、チャットの項目（会話と繋がっている）、依頼の計算に使う項目 */
export function isLocked(database: Database, propId: string) {
  const prop = database.props.find((p) => p.id === propId);
  if (prop?.type === "chat" || prop?.type === "imageChat" || prop?.type === "page") return true;
  return propId === P.title || prop?.type === "title" || (database.kind === "request" && LOCKED_PROPS.includes(propId));
}

/** 削除できる項目か：タイトルと、依頼の計算に使う項目は消せない（チャットの項目は、確かめてから会話ごと消せる） */
export function canDeleteProp(database: Database, propId: string) {
  const prop = database.props.find((p) => p.id === propId);
  return !(propId === P.title || prop?.type === "title" || (database.kind === "request" && LOCKED_PROPS.includes(propId)));
}

/** チャットの項目に入っている会話の発言の数（消す前の確認に出す） */
export async function countPropMessages(dbId: string, propId: string) {
  const pages = await db.dbPages.where("dbId").equals(dbId).toArray();
  const chatIds = new Set(pages.map((p) => p.values[propId]).filter((x): x is string => typeof x === "string" && !!x));
  return db.messages.filter((m) => chatIds.has(m.chatId)).count();
}

async function patchProps(dbId: string, fn: (props: Property[]) => Property[]) {
  const d = await db.databases.get(dbId);
  if (d) await db.databases.update(dbId, { props: fn(d.props) });
}

export async function addProperty(dbId: string, name: string, type: Property["type"], after?: string): Promise<Property> {
  return addPropertyNow(dbId, name, type, after);
}

async function addPropertyNow(dbId: string, name: string, type: Property["type"], after?: string) {
  const prop: Property = {
    id: `p_${newId().slice(0, 8)}`,
    name,
    type,
    ...(type === "select" || type === "multiselect" || type === "status" ? { options: [] } : {}),
    ...(type === "stage" ? { stages: { "": [] } } : {}),
  };
  await patchProps(dbId, (props) => {
    const i = after ? props.findIndex((p) => p.id === after) : -1;
    return i < 0 ? [...props, prop] : [...props.slice(0, i + 1), prop, ...props.slice(i + 1)];
  });
  if (type === "created" || type === "edited") await backfill(dbId, prop.id, type);
  if (type === "serial") await numberPages(dbId, prop.id);
  return prop;
}

/** 通し番号の項目を足したとき、今あるページに作った順で番号を入れる */
async function numberPages(dbId: string, propId: string) {
  const pages = (await db.dbPages.where("dbId").equals(dbId).toArray()).sort((a, b) => a.createdAt - b.createdAt);
  await db.transaction("rw", db.dbPages, async () => {
    for (const [i, p] of pages.entries()) await db.dbPages.update(p.id, { values: { ...p.values, [propId]: i + 1 } });
  });
}

export async function updateProperty(dbId: string, propId: string, patch: Partial<Omit<Property, "id">>) {
  await patchProps(dbId, (props) => {
    const before = props.find((p) => p.id === propId);
    const next = props.map((p) => (p.id === propId ? { ...p, ...patch } : p));
    // 名前を変えたら、ほかの数式の中の {前の名前} も新しい名前にする
    if (before && patch.name && patch.name !== before.name)
      return next.map((p) => (p.type === "formula" && p.formula ? { ...p, formula: renameInFormula(p.formula, before.name, patch.name!) } : p));
    return next;
  });
  if (patch.type === "created" || patch.type === "edited") await backfill(dbId, propId, patch.type);
  if (patch.type === "serial") await numberPages(dbId, propId);
}

/** 作成日時・更新日時の項目を足したとき、今あるページにも値を入れる */
async function backfill(dbId: string, propId: string, type: "created" | "edited") {
  await db.dbPages
    .where("dbId")
    .equals(dbId)
    .modify((p) => {
      p.values[propId] = stamp(type === "created" ? p.createdAt : (p.updatedAt ?? p.createdAt));
    });
}

/** 項目を削除する。各ページの値と、ビューの条件からも消す */
export async function deleteProperty(dbId: string, propId: string) {
  // タイトルと依頼の計算に使う項目は消さない（画面からも消せないようにしてある）
  const database = await db.databases.get(dbId);
  if (!database || !canDeleteProp(database, propId)) return;
  const isChat = database.props.some((p) => p.id === propId && (p.type === "chat" || p.type === "imageChat"));
  // 「ページ」の項目は、各ページの別ページを消す
  if (database.props.some((p) => p.id === propId && p.type === "page")) await deleteSubPages(dbId, propId);
  await db.transaction("rw", [db.databases, db.dbPages, db.dbViews, db.chats, db.messages, db.chatReads], async () => {
    await patchProps(dbId, (props) => props.filter((p) => p.id !== propId));
    // 納期のお知らせに選んでいた項目なら、名前から自動で選ぶ形に戻す（消えた項目を指したままだと、お知らせが止まる）
    if (database.dueProp === propId) await db.databases.update(dbId, { dueProp: undefined });
    // チャットの項目は、各ページの会話（発言も）を消す
    if (isChat) {
      const pages = await db.dbPages.where("dbId").equals(dbId).toArray();
      const chatIds = pages.map((p) => p.values[propId]).filter((x): x is string => typeof x === "string" && !!x);
      await db.messages.filter((m) => chatIds.includes(m.chatId)).delete();
      await db.chatReads.filter((x) => chatIds.includes(x.chatId)).delete();
      await db.chats.bulkDelete(chatIds);
    }
    await db.dbPages
      .where("dbId")
      .equals(dbId)
      .modify((p) => {
        const v = p.values[propId];
        if (isChat && typeof v === "string") {
          if (p.chatId === v) p.chatId = null;
          if (p.reenactChatId === v) p.reenactChatId = null;
        }
        delete p.values[propId];
      });
    await db.dbViews
      .where("dbId")
      .equals(dbId)
      .modify((v) => {
        v.filters = v.filters.filter((f) => f.prop !== propId);
        if (v.sort?.prop === propId) v.sort = null;
        if (v.sorts) v.sorts = v.sorts.filter((x) => x.prop !== propId);
        if (v.options.visible) v.options.visible = v.options.visible.filter((x) => x !== propId);
        if (v.options.group === propId) delete v.options.group;
        if (v.options.calc) delete v.options.calc[propId];
      });
  });
}

/** 項目の並び順を1つずらす（タイトルは常に先頭） */
export async function moveProperty(dbId: string, propId: string, dir: -1 | 1) {
  await patchProps(dbId, (props) => {
    const i = props.findIndex((p) => p.id === propId);
    const j = i + dir;
    if (i < 1 || j < 1 || j >= props.length) return props;
    const next = [...props];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}

export async function setOptionColor(dbId: string, propId: string, option: string, color: TagColor) {
  await patchProps(dbId, (props) => props.map((p) => (p.id === propId ? { ...p, colors: { ...p.colors, [option]: color } } : p)));
}

/** ステータスの選択肢のグループ（未着手・進行中・完了）を決める */
export async function setOptionGroup(dbId: string, propId: string, option: string, group: StatusGroup) {
  await patchProps(dbId, (props) => props.map((p) => (p.id === propId ? { ...p, groups: { ...p.groups, [option]: group } } : p)));
}

/** 選択肢に数を付ける（手数料の％など）。undefined なら外す */
export async function setOptionValue(dbId: string, propId: string, option: string, value: number | undefined) {
  await patchProps(dbId, (props) =>
    props.map((p) => {
      if (p.id !== propId) return p;
      const optionValues = { ...p.optionValues };
      if (value === undefined) delete optionValues[option];
      else optionValues[option] = value;
      return { ...p, optionValues };
    }),
  );
}

/** 選択肢の名前を変える。その選択肢が入っているページの値も変える */
export async function renameOption(dbId: string, propId: string, from: string, to: string) {
  if (!to || from === to) return;
  await db.transaction("rw", db.databases, db.dbPages, db.dbViews, async () => {
    await patchProps(dbId, (props) =>
      props.map((p) => {
        if (p.id !== propId) return p;
        // 色・グループ・付けた数・はじめから入る値も、新しい名前に移す
        const move = <T,>(rec: Record<string, T> | undefined) => {
          if (!rec || !(from in rec)) return rec;
          const next = { ...rec, [to]: rec[from] };
          delete next[from];
          return next;
        };
        const dv = p.defaultValue;
        const defaultValue = dv === from ? to : Array.isArray(dv) ? dv.map((x) => (x === from ? to : x)) : dv;
        return { ...p, options: (p.options ?? []).map((o) => (o === from ? to : o)), colors: move(p.colors) ?? {}, groups: move(p.groups), optionValues: move(p.optionValues), defaultValue };
      }),
    );
    await db.dbPages
      .where("dbId")
      .equals(dbId)
      .modify((p) => {
        const v = p.values[propId];
        if (v === from) p.values[propId] = to;
        if (Array.isArray(v)) p.values[propId] = v.map((x) => (x === from ? to : x));
      });
    await db.dbViews
      .where("dbId")
      .equals(dbId)
      .modify((v) => {
        v.filters = v.filters.map((f) => (f.prop === propId && f.value === from ? { ...f, value: to } : f));
      });
  });
}

/** 選択肢を消す。その選択肢が入っているページは空になる */
export async function deleteOption(dbId: string, propId: string, option: string) {
  await db.transaction("rw", db.databases, db.dbPages, async () => {
    await patchProps(dbId, (props) =>
      props.map((p) => {
        if (p.id !== propId) return p;
        const dv = p.defaultValue;
        const defaultValue = dv === option ? undefined : Array.isArray(dv) ? dv.filter((x) => x !== option) : dv;
        return { ...p, options: (p.options ?? []).filter((o) => o !== option), defaultValue };
      }),
    );
    await db.dbPages
      .where("dbId")
      .equals(dbId)
      .modify((p) => {
        const v = p.values[propId];
        if (v === option) delete p.values[propId];
        if (Array.isArray(v)) p.values[propId] = v.filter((x) => x !== option);
      });
  });
}

// ---- アイコン・ビュー ----

export async function setPageIcon(pageId: string, icon: string | undefined) {
  await db.dbPages.update(pageId, { icon });
}

export async function setDatabaseIcon(dbId: string, icon: string | undefined) {
  await db.databases.update(dbId, { icon });
}

export async function duplicateView(view: DbView) {
  const views = await db.dbViews.where("dbId").equals(view.dbId).toArray();
  const copy: DbView = { ...structuredClone(view), id: newId(), name: `${view.name}のコピー`, order: Math.max(0, ...views.map((v) => v.order)) + 1 };
  await db.dbViews.add(copy);
  return copy;
}

/** 表のいちばん下の「＋ 新規」などから、名前なしで1件作る */
/**
 * その場で作るページ（表の「新規」・ボードの「＋」・カレンダーの日付から）。「追加」と同じく、既定のテンプレートを使う
 * （テンプレートの初期値と本文。渡した値はそれより優先）
 */
export async function createBlankPage(database: Database, userId: string, values: Record<string, unknown> = {}, title = "") {
  const template = database.templates?.find((t) => t.id === database.defaultTemplateId);
  return createPage(database, userId, title, { ...newPageDefaults(database, userId), ...template?.values, ...values }, template);
}

/** ページの本文（ウィンドウ型）の並べ方を保存する */
export async function savePageLayout(pageId: string, layout: DbPage["layout"]) {
  await db.dbPages.update(pageId, { layout });
}

// ---- チャットの項目 ----

/** ページのチャットの ID を全部（依頼進行・やり取り再現・チャットの項目）。未読の数を出すのに使う */
export function pageChatIds(database: Database, page: DbPage): string[] {
  const ids = [page.chatId, page.reenactChatId, ...database.props.filter((p) => p.type === "chat" || p.type === "imageChat").map((p) => page.values[p.id])];
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && !!x))];
}

const ensuring = new Map<string, Promise<string>>();

/** チャットの項目のチャットを用意する（無ければ作って、ページの値に入れる）。チャットの ID を返す */
export function ensurePropChat(pageId: string, prop: Property): Promise<string> {
  const key = `${pageId}:${prop.id}`;
  const running = ensuring.get(key);
  if (running) return running;
  const job = db
    .transaction("rw", db.dbPages, db.chats, async () => {
      const page = await db.dbPages.get(pageId);
      if (!page) return "";
      const cur = page.values[prop.id];
      if (typeof cur === "string" && cur && (await db.chats.get(cur))) return cur;
      // ページと項目から決まる ID（2人がほぼ同時に開いても、チャットは1つにまとまる）
      const id = `pc_${pageId}_${prop.id}`;
      if (await db.chats.get(id)) {
        await db.dbPages.update(pageId, { values: { ...page.values, [prop.id]: id } });
        return id;
      }
      await db.chats.add({ id, roomId: page.roomId, name: prop.name, kind: prop.type === "imageChat" ? "image" : "normal", order: 0, createdAt: Date.now(), pageId });
      await db.dbPages.update(pageId, { values: { ...page.values, [prop.id]: id } });
      return id;
    })
    .finally(() => ensuring.delete(key));
  ensuring.set(key, job);
  return job;
}
