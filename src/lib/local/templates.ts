"use client";

import { db, newId, type Database, type DbPage, type PageTemplate, type WinNode } from "./db";
import { pageNoteId } from "./notes";
import { unlinkSubPagesOf } from "./subPages";
import { mapTabs } from "./windowLayout";

// データベースのページのテンプレート（ノート型・ウィンドウ型）と、サイドバーに出すページの設定

/** テンプレートの本文から、チャットの中身（chatId）を外す。ページを作ったときに、そのページ用のチャットが新しくできる */
export function freshBlocks(blocks: unknown[] | undefined): unknown[] {
  return (blocks ?? []).map((b) => {
    const block = b as { props?: Record<string, unknown>; children?: unknown[] };
    const props = block.props && "chatId" in block.props ? { ...block.props, chatId: "" } : block.props;
    return { ...block, ...(props ? { props } : {}), ...(block.children ? { children: freshBlocks(block.children) } : {}) };
  });
}

export function freshLayout(layout: WinNode | null | undefined): WinNode | null {
  if (!layout) return null;
  return mapTabs(layout, (t) => ({ ...t, props: t.props.chatId ? { ...t.props, chatId: "" } : t.props, ...(t.blocks ? { blocks: freshBlocks(t.blocks) } : {}) }));
}

async function setTemplates(dbId: string, fn: (list: PageTemplate[]) => PageTemplate[]) {
  const d = await db.databases.get(dbId);
  if (!d) return;
  await db.databases.update(dbId, { templates: fn(d.templates ?? []) });
}

export async function createTemplate(dbId: string, kind: PageTemplate["kind"], name: string) {
  const t: PageTemplate = { id: newId(), name, kind, values: {}, blocks: [], createdAt: Date.now() };
  await setTemplates(dbId, (list) => [...list, t]);
  return t;
}

export async function updateTemplate(dbId: string, id: string, patch: Partial<Omit<PageTemplate, "id" | "kind">>) {
  await setTemplates(dbId, (list) => list.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)));
}

export async function setTemplateValue(dbId: string, id: string, propId: string, value: unknown) {
  await setTemplates(dbId, (list) => list.map((t) => (t.id === id ? { ...t, values: { ...t.values, [propId]: value } } : t)));
}

export async function deleteTemplate(dbId: string, id: string) {
  // 繋いでいるページは、今の中身をコピーして切り離す（本文は消えない）
  const d0 = await db.databases.get(dbId);
  const linked = await db.dbPages.where("dbId").equals(dbId).filter((p) => p.sourceId === id).toArray();
  if (d0) for (const p of linked) await unlinkPageTemplate(d0, p);
  // 「ページ」の項目の別ページも同じく切り離す
  if (d0) await unlinkSubPagesOf(d0, id);
  await setTemplates(dbId, (list) => list.filter((t) => t.id !== id));
  const d = await db.databases.get(dbId);
  if (d?.defaultTemplateId === id) await db.databases.update(dbId, { defaultTemplateId: null });
}

export async function duplicateTemplate(dbId: string, id: string) {
  await setTemplates(dbId, (list) => {
    const src = list.find((t) => t.id === id);
    return src ? [...list, { ...structuredClone(src), id: newId(), name: `${src.name}のコピー`, createdAt: Date.now() }] : list;
  });
}

/** 「追加」で使うテンプレートを決める（null はテンプレートなし） */
export async function setDefaultTemplate(dbId: string, id: string | null) {
  await db.databases.update(dbId, { defaultTemplateId: id });
}

/** サイドバーでデータベースの下に出すページを、ビューで決める（null は出さない、undefined ははじめの設定、"@filter" は sidebarFilter で決める） */
export async function setSidebarView(dbId: string, viewId: string | null | undefined) {
  await db.databases.update(dbId, { sidebarViewId: viewId });
}

/** サイドバーに出すページを、ビューを使わずに決めるときのフィルターと並び替え */
export async function setSidebarFilter(dbId: string, filter: NonNullable<Database["sidebarFilter"]>) {
  await db.databases.update(dbId, { sidebarFilter: filter });
}

// ---- ページのソース（テンプレートと繋ぐ） ----

/** ページがソースにしているテンプレート */
export const templateOf = (database: Database, page: Pick<DbPage, "sourceId">) => (page.sourceId ? database.templates?.find((t) => t.id === page.sourceId) : undefined);

/** ページの本文のノート（「ページ」の項目の別ページは除く） */
const bodyNote = (pageId: string) => db.notes.where("pageId").equals(pageId).filter((n) => !n.sub).first();

/** テンプレートと繋ぐ。本文はテンプレートの中身を出す（このページの本文は消える。項目の値・チャットはそのまま） */
export async function linkPageTemplate(page: DbPage, template: PageTemplate) {
  await db.transaction("rw", db.dbPages, db.notes, async () => {
    await db.dbPages.update(page.id, { sourceId: template.id, bodyKind: template.kind });
    const note = await bodyNote(page.id);
    if (note) await db.notes.update(note.id, { blocks: [], updatedAt: Date.now() });
  });
}

/** テンプレートから切り離す（「選択なし」「分けて編集」）。テンプレートの中身をコピーして、このページだけの本文にする */
export async function unlinkPageTemplate(database: Database, page: DbPage) {
  const t = templateOf(database, page);
  const now = Date.now();
  await db.transaction("rw", db.dbPages, db.notes, async () => {
    await db.dbPages.update(page.id, { sourceId: null, ...(t ? { bodyKind: t.kind } : {}) });
    if (!t) return;
    const blocks = freshBlocks(t.blocks);
    const note = await bodyNote(page.id);
    if (note) await db.notes.update(note.id, { blocks, updatedAt: now });
    else await db.notes.add({ id: pageNoteId(page.id), roomId: page.roomId, title: page.title, blocks, pageId: page.id, order: 0, createdAt: now, updatedAt: now, updatedBy: page.createdBy });
  });
}

/** ノート型のテンプレート：繋がずに、同じブロックをこのページの本文に入れる（"replace" は置き換え、"append" は下に足す） */
export async function applyNoteTemplate(page: DbPage, template: PageTemplate, how: "replace" | "append") {
  const now = Date.now();
  const add = freshBlocks(template.blocks);
  await db.transaction("rw", db.dbPages, db.notes, async () => {
    await db.dbPages.update(page.id, { sourceId: null, bodyKind: "note" });
    const note = await bodyNote(page.id);
    if (note) await db.notes.update(note.id, { blocks: how === "append" ? [...note.blocks, ...add] : add, updatedAt: now });
    else await db.notes.add({ id: pageNoteId(page.id), roomId: page.roomId, title: page.title, blocks: add, pageId: page.id, order: 0, createdAt: now, updatedAt: now, updatedBy: page.createdBy });
  });
}

/** 今の本文から新しいテンプレートを作る。ウィンドウ型は、このページをそれと繋ぐ（今の本文は消えずにテンプレートになる）。ノート型は繋がない */
export async function createTemplateFromPage(database: Database, page: DbPage, name: string) {
  const cur = templateOf(database, page);
  const note = await bodyNote(page.id);
  const t: PageTemplate = { id: newId(), name, kind: cur?.kind ?? page.bodyKind ?? "note", values: {}, blocks: freshBlocks(cur ? cur.blocks : (note?.blocks ?? [])), createdAt: Date.now() };
  await setTemplates(database.id, (list) => [...list, t]);
  if (t.kind === "window") await linkPageTemplate(page, t);
  return t;
}
