"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { deleteOwnedChats } from "./channels";
import { db, newId, type Database, type DbPage, type Note, type Property } from "./db";
import { freshBlocks } from "./templates";

// データベースの「ページ」の項目の別ページ。中身はノート（sub が付いたもの。pageId は持ち主のページ）。
// ノート型のテンプレートは中身をコピーして書ける。ウィンドウ型のテンプレートは繋ぐ（直すときに、テンプレートを直すか、切り離すかを選ぶ）

const subOf = (pageId: string, propId: string) => db.notes.where("pageId").equals(pageId).filter((n) => n.sub?.propId === propId).first();

/** ページの、その項目の別ページ。まだ作っていなければ null */
export function useSubPage(pageId: string | undefined, propId: string | undefined) {
  return useLiveQuery(async () => (pageId && propId ? ((await subOf(pageId, propId)) ?? null) : null), [pageId, propId]);
}

/** 別ページを用意する（あればそれを返す）。項目の設定のテンプレートで作る（無ければ空のノート） */
export async function ensureSubPage(database: Database, page: DbPage, prop: Property, userId: string): Promise<Note> {
  return db.transaction("rw", db.notes, async () => {
    const cur = await subOf(page.id, prop.id);
    if (cur) return cur;
    const t = prop.templateId ? database.templates?.find((x) => x.id === prop.templateId) : undefined;
    const now = Date.now();
    const note: Note = {
      id: newId(),
      roomId: page.roomId,
      title: prop.name,
      // ウィンドウ型は繋ぐので、自分の中身は持たない
      blocks: t?.kind === "note" ? freshBlocks(t.blocks) : [],
      pageId: page.id,
      order: 0,
      createdAt: now,
      updatedAt: now,
      updatedBy: userId,
      sub: { propId: prop.id, kind: t?.kind ?? "note", sourceId: t?.kind === "window" ? t.id : null },
    };
    await db.notes.add(note);
    return note;
  });
}

/** ウィンドウ型の別ページを、テンプレートから切り離す（今の中身をコピーして、この別ページだけの中身にする） */
export async function unlinkSubPage(database: Database, note: Note) {
  if (!note.sub) return;
  const t = note.sub.sourceId ? database.templates?.find((x) => x.id === note.sub!.sourceId) : undefined;
  await db.notes.update(note.id, { sub: { ...note.sub, sourceId: null }, ...(t ? { blocks: freshBlocks(t.blocks) } : {}), updatedAt: Date.now() });
}

/** その項目の別ページを全部消す（項目を消したとき）。中に置いたチャットも消す */
export async function deleteSubPages(dbId: string, propId: string) {
  const pageIds = (await db.dbPages.where("dbId").equals(dbId).primaryKeys()) as string[];
  const notes = await db.notes.where("pageId").anyOf(pageIds).filter((n) => n.sub?.propId === propId).toArray();
  for (const n of notes) await deleteOwnedChats(`note:${n.id}`);
  await db.notes.bulkDelete(notes.map((n) => n.id));
}

/** そのテンプレートと繋いでいる別ページを切り離す（テンプレートを消すとき。今の中身は消えない） */
export async function unlinkSubPagesOf(database: Database, templateId: string) {
  const pageIds = (await db.dbPages.where("dbId").equals(database.id).primaryKeys()) as string[];
  const notes = await db.notes.where("pageId").anyOf(pageIds).filter((n) => n.sub?.sourceId === templateId).toArray();
  for (const n of notes) await unlinkSubPage(database, n);
}

/** ページを複製したとき、別ページも同じ中身で写す（チャットは外して、開いたときに新しく作る） */
export async function copySubPages(fromPageId: string, toPageId: string, userId: string) {
  const notes = await db.notes.where("pageId").equals(fromPageId).filter((n) => !!n.sub).toArray();
  const now = Date.now();
  await db.notes.bulkAdd(notes.map((n) => ({ ...n, id: newId(), blocks: freshBlocks(n.blocks), pageId: toPageId, chatMap: undefined, createdAt: now, updatedAt: now, updatedBy: userId })));
}
