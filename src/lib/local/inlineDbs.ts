"use client";

import { emptyDatabase } from "./channels";
import { db, newId, type Database, type DbPage, type DbView, type Note, type Property, type ViewType } from "./db";
import { DB_BLOCK, inlineDbIds, pageNoteId, saveNoteBlocks, type BlockCopies } from "./notes";
import { copySubPages } from "./subPages";
import { freshBlocks } from "./templates";

// ノートの中のデータベース（Notion のインライン・フルページのデータベース）。データベースそのものは、ふつうのデータベースと同じ。
// 持ち主のノート（noteId）の本文にデータベースのブロックがあり、ブロックを消すとゴミ箱へ、戻すとゴミ箱から戻る

/** ビューの形の名前（新しいデータベースのはじめのビューの名前） */
const VIEW_NAMES: Partial<Record<ViewType, string>> = { table: "テーブル", board: "ボード", list: "リスト", gallery: "ギャラリー", calendar: "カレンダー", timeline: "タイムライン" };

/**
 * ノートの中に新しいデータベースを作る（項目は、データベースカテゴリーで作るものと同じ）。type ははじめのビューの形。
 * ボードはステータスの項目で列に分け、カレンダー・タイムラインは日付の項目を足して使う（Notion と同じ）。名前ははじめは空（「無題」と出す）
 */
export async function createInlineDatabase(roomId: string, noteId: string, type: ViewType = "table") {
  const { database, views } = emptyDatabase(roomId, "");
  const view = views[0];
  const extra: Property[] = [];
  view.type = type;
  view.name = VIEW_NAMES[type] ?? view.name;
  if (type === "board") {
    const status: Property = {
      id: `p_${newId().slice(0, 8)}`,
      name: "ステータス",
      type: "status",
      options: ["未着手", "進行中", "完了"],
      groups: { 未着手: "todo", 進行中: "doing", 完了: "done" },
      colors: { 未着手: "gray", 進行中: "blue", 完了: "green" },
    };
    extra.push(status);
    view.options = { group: status.id };
  }
  if (type === "calendar") {
    const date: Property = { id: `p_${newId().slice(0, 8)}`, name: "日付", type: "date" };
    extra.push(date);
    view.options = { date: date.id, stages: true };
  }
  // タイムラインは、開始日から終了日までの帯
  if (type === "timeline") {
    const start: Property = { id: `p_${newId().slice(0, 8)}`, name: "開始日", type: "date" };
    const end: Property = { id: `p_${newId().slice(0, 8)}`, name: "終了日", type: "date" };
    extra.push(start, end);
    view.options = { start: start.id, end: end.id, stages: true };
  }
  // チャットの項目は、いちばん後ろのまま
  database.props = [...database.props.filter((p) => p.type !== "chat"), ...extra, ...database.props.filter((p) => p.type === "chat")];
  database.noteId = noteId;
  await db.transaction("rw", db.databases, db.dbViews, async () => {
    await db.databases.add(database);
    await db.dbViews.bulkAdd(views);
  });
  return database.id;
}

/** ノートの本文から、データベースのブロックが消えた（戻った）ときに、データベースをゴミ箱に入れる（ゴミ箱から戻す）。このノートのデータベースだけ */
export async function syncInlineDbs(noteId: string, removed: string[], added: string[]) {
  const list = (await db.databases.bulkGet([...removed, ...added])).filter((d): d is Database => !!d);
  for (const d of list) {
    if (removed.includes(d.id) && d.noteId === noteId && !d.deletedAt) await db.databases.update(d.id, { deletedAt: Date.now() });
    // ゴミ箱のデータベースを、ほかのノートに貼ったときは（切り取って貼ったとき）、そのノートのものにする（Notion の移動と同じ）
    if (added.includes(d.id) && d.deletedAt) await db.databases.update(d.id, { deletedAt: undefined, noteId });
  }
}

type Loose = { id?: string; type?: string; props?: Record<string, unknown>; children?: Loose[] };

/** 持ち主のノートの本文を作り替える */
async function editOwnerBlocks(database: Database, userId: string, edit: (blocks: Loose[]) => Loose[]) {
  const note = database.noteId ? await db.notes.get(database.noteId) : undefined;
  if (!note) return;
  const blocks = edit(note.blocks as Loose[]);
  if (JSON.stringify(blocks) !== JSON.stringify(note.blocks)) await saveNoteBlocks(note.id, blocks, userId);
}

/** ノートの中のデータベースをゴミ箱に入れ、持ち主のノートの本文からブロックを外す（データベースの画面の「ゴミ箱に入れる」） */
export async function trashInlineDb(database: Database, userId: string) {
  await db.databases.update(database.id, { deletedAt: Date.now() });
  const strip = (list: Loose[], inColumn: boolean): Loose[] => {
    const kept = list.filter((b) => !(b.type === DB_BLOCK && b.props?.dbId === database.id)).map((b) => (b.children?.length ? { ...b, children: strip(b.children, b.type === "column") } : b));
    // 列は中身が無いと開けなくなるので、空の段落を残す
    return inColumn && !kept.length ? [{ id: newId(), type: "paragraph", props: {}, children: [] }] : kept;
  };
  await editOwnerBlocks(database, userId, (blocks) => strip(blocks, false));
}

/** ノートの中のデータベースをゴミ箱から戻す。持ち主のノートの本文にブロックが無ければ、最後に足す */
export async function restoreInlineDb(database: Database, userId: string) {
  await db.databases.update(database.id, { deletedAt: undefined });
  await editOwnerBlocks(database, userId, (blocks) => (inlineDbIds(blocks).includes(database.id) ? blocks : [...blocks, { id: newId(), type: DB_BLOCK, props: { dbId: database.id }, children: [] }]));
}

/**
 * ブロックの複製で、データベースを中身ごと写す（項目・ビュー・テンプレートと、ゴミ箱に無いページ。ページの本文と「ページ」の項目の別ページも）。
 * 名前はそのまま。チャット（チャットの項目・本文のチャット）は写さず、開いたときに新しく作る
 */
export async function copyDatabases(list: BlockCopies["dbs"], userId: string) {
  for (const { from, to, noteId } of list) {
    const src = await db.databases.get(from);
    if (!src) continue;
    const now = Date.now();
    const views = await db.dbViews.where("dbId").equals(from).toArray();
    const pages = (await db.dbPages.where("dbId").equals(from).toArray()).filter((p) => !p.deletedAt);
    const viewIds = new Map(views.map((v) => [v.id, newId()]));
    const pageIds = new Map(pages.map((p) => [p.id, newId()]));
    const { deletedAt: _deleted, ...rest } = structuredClone(src);
    void _deleted;
    const copy: Database = {
      ...rest,
      id: to,
      noteId,
      createdAt: now,
      ...(src.sidebarViewId && viewIds.has(src.sidebarViewId) ? { sidebarViewId: viewIds.get(src.sidebarViewId) } : {}),
    };
    const dropped = new Set(src.props.filter((p) => p.type === "chat" || p.type === "imageChat" || p.type === "formula").map((p) => p.id));
    const newPages: DbPage[] = pages.map((p) => ({
      ...structuredClone(p),
      id: pageIds.get(p.id)!,
      dbId: to,
      values: Object.fromEntries(Object.entries(p.values).filter(([k]) => !dropped.has(k))),
      chatId: null,
      reenactChatId: null,
      createdBy: userId,
    }));
    const bodies = pages.length ? await db.notes.where("pageId").anyOf(pages.map((p) => p.id)).filter((n) => !n.sub).toArray() : [];
    const newBodies: Note[] = bodies.map((n) => {
      const pageId = pageIds.get(n.pageId!)!;
      return { ...n, id: pageNoteId(pageId), blocks: freshBlocks(n.blocks), pageId, chatMap: undefined, createdAt: now, updatedAt: now, updatedBy: userId };
    });
    await db.transaction("rw", db.databases, db.dbViews, db.dbPages, db.notes, async () => {
      await db.databases.add(copy);
      await db.dbViews.bulkAdd(views.map((v): DbView => ({ ...structuredClone(v), id: viewIds.get(v.id)!, dbId: to })));
      await db.dbPages.bulkAdd(newPages);
      await db.notes.bulkAdd(newBodies);
    });
    for (const [fromPage, toPage] of pageIds) await copySubPages(fromPage, toPage, userId);
  }
}
