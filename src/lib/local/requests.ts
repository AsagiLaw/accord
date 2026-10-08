"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { DONE, P } from "@/lib/requests/defaults";
import { stamp, today } from "@/lib/requests/logic";
import { stageOf } from "@/lib/requests/stages";
import { deleteOwnedChats } from "./channels";
import { freshBlocks } from "./templates";
import { db, newId, type CalEvent, type Database, type DbPage, type DbView, type PageTemplate, type Property, type TagColor, type Todo } from "./db";

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

export function usePages(dbId: string | undefined) {
  return useLiveQuery(async () => (dbId ? db.dbPages.where("dbId").equals(dbId).toArray() : []), [dbId]);
}

export function usePage(pageId: string) {
  return useLiveQuery(async () => (await db.dbPages.get(pageId)) ?? null, [pageId]);
}

export function useViews(dbId: string | undefined) {
  return useLiveQuery(async () => (dbId ? (await db.dbViews.where("dbId").equals(dbId).toArray()).sort((a, b) => a.order - b.order) : []), [dbId]);
}

export function useEvents(roomId: string) {
  return useLiveQuery(() => db.events.where("roomId").equals(roomId).toArray(), [roomId]);
}

export function useTodos(roomId: string) {
  return useLiveQuery(async () => (await db.todos.where("roomId").equals(roomId).toArray()).sort((a, b) => a.createdAt - b.createdAt), [roomId]);
}

// ---- 依頼（ページ） ----

/** ページの名前の後ろに付ける言葉（データベースの設定。無いときは、依頼は「様」） */
export const nameSuffixOf = (d: Pick<Database, "nameSuffix">) => d.nameSuffix ?? "";

/** 新しい依頼の初期値：受付日・開始日は今日、枚数1、進行0%、ステータスは最初の選択肢 */
export function newPageDefaults(database: Database): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const p of database.props) {
    if (p.type === "status") v[p.id] = p.options?.[0] ?? "";
    if (database.kind === "request") {
      if (p.id === P.received || p.id === P.start) v[p.id] = today();
      if (p.id === P.count) v[p.id] = 1;
      if (p.id === P.progress || p.id === P.fee) v[p.id] = 0;
    }
  }
  return v;
}

/** 依頼（ページ）を作る。チャットの項目の会話も一緒に作る。
 * ウィンドウ型のテンプレートは繋ぐ（本文はテンプレートの中身を出す）。ノート型のテンプレートは繋がず、同じブロックを本文に入れる */
export async function createPage(database: Database, userId: string, title: string, values: Record<string, unknown>, template?: PageTemplate) {
  const id = newId();
  const now = Date.now();
  const chatId = newId();
  const reenactChatId = newId();
  // 作成日時・更新日時の項目は、作ったときの日時を入れておく
  const auto = Object.fromEntries(database.props.filter((p) => p.type === "created" || p.type === "edited").map((p) => [p.id, stamp(now)]));
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
      await db.notes.add({ id: newId(), roomId: database.roomId, title, blocks: freshBlocks(template.blocks), pageId: id, order: 0, createdAt: now, updatedAt: now, updatedBy: userId });
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

/** 依頼を削除する。チャットの発言も消える（添付した画像はメディアに残る） */
export async function deletePage(page: DbPage) {
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

// ---- データベースの設定 ----

/** 選択肢を足す（依頼窓口・依頼プランなどの「追加…」） */
export async function addOption(dbId: string, propId: string, option: string) {
  const d = await db.databases.get(dbId);
  if (!d) return;
  const props = d.props.map((p): Property => (p.id === propId && !(p.options ?? []).includes(option) ? { ...p, options: [...(p.options ?? []), option] } : p));
  await db.databases.update(dbId, { props });
}

export async function updateDatabase(dbId: string, patch: Partial<Pick<Database, "name" | "props" | "plans" | "nameSuffix">>) {
  await db.databases.update(dbId, patch);
}

// ---- ビュー ----

export async function saveView(view: DbView) {
  await db.dbViews.put(view);
}

export async function createView(dbId: string, name: string, type: DbView["type"]) {
  const views = await db.dbViews.where("dbId").equals(dbId).toArray();
  const view: DbView = { id: newId(), dbId, name, type, filters: [], sort: null, options: type === "calendar" || type === "timeline" ? { stages: true } : {}, order: Math.max(0, ...views.map((v) => v.order)) + 1 };
  await db.dbViews.add(view);
  return view;
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

export async function addTodo(roomId: string, text: string) {
  const t: Todo = { id: newId(), roomId, text, done: false, createdAt: Date.now() };
  await db.todos.add(t);
}

export async function toggleTodo(id: string, done: boolean) {
  await db.todos.update(id, { done });
}

export async function deleteTodo(id: string) {
  await db.todos.delete(id);
}

// ---- 項目（プロパティ）・選択肢 ----

/** 依頼の計算に使う項目。削除と種類の変更はできない */
export const LOCKED_PROPS: string[] = [P.title, P.received, P.start, P.due, P.fee, P.status];

/** 種類の変更ができない項目：タイトル、チャットの項目（会話と繋がっている）、依頼の計算に使う項目 */
export function isLocked(database: Database, propId: string) {
  const prop = database.props.find((p) => p.id === propId);
  if (prop?.type === "chat" || prop?.type === "imageChat") return true;
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
  return prop;
}

export async function updateProperty(dbId: string, propId: string, patch: Partial<Omit<Property, "id">>) {
  await patchProps(dbId, (props) => props.map((p) => (p.id === propId ? { ...p, ...patch } : p)));
  if (patch.type === "created" || patch.type === "edited") await backfill(dbId, propId, patch.type);
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
  await db.transaction("rw", [db.databases, db.dbPages, db.dbViews, db.chats, db.messages, db.chatReads], async () => {
    await patchProps(dbId, (props) => props.filter((p) => p.id !== propId));
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

/** 選択肢の名前を変える。その選択肢が入っているページの値も変える */
export async function renameOption(dbId: string, propId: string, from: string, to: string) {
  if (!to || from === to) return;
  await db.transaction("rw", db.databases, db.dbPages, db.dbViews, async () => {
    await patchProps(dbId, (props) =>
      props.map((p) => {
        if (p.id !== propId) return p;
        const colors = { ...p.colors };
        if (colors[from]) {
          colors[to] = colors[from];
          delete colors[from];
        }
        return { ...p, options: (p.options ?? []).map((o) => (o === from ? to : o)), colors };
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
    await patchProps(dbId, (props) => props.map((p) => (p.id === propId ? { ...p, options: (p.options ?? []).filter((o) => o !== option) } : p)));
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
export async function createBlankPage(database: Database, userId: string, values: Record<string, unknown> = {}) {
  return createPage(database, userId, "", { ...newPageDefaults(database), ...values });
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
      const id = newId();
      await db.chats.add({ id, roomId: page.roomId, name: prop.name, kind: prop.type === "imageChat" ? "image" : "normal", order: 0, createdAt: Date.now(), pageId });
      await db.dbPages.update(pageId, { values: { ...page.values, [prop.id]: id } });
      return id;
    })
    .finally(() => ensuring.delete(key));
  ensuring.set(key, job);
  return job;
}
