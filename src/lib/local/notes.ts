"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { deleteNoteTree } from "./channels";
import { db, newId, type Note, type NoteCover, type NoteLook } from "./db";

/** サイドバーに出すノート（依頼のメモ・テンプレート・ボタンの中のページ・子のページは除く） */
export function useNotes(roomId: string) {
  return useLiveQuery(
    async () =>
      (await db.notes.where("roomId").equals(roomId).filter((n) => !n.pageId && !n.template && !n.inner && !n.parentId && !n.deletedAt).toArray()).sort(
        (a, b) => a.order - b.order || a.createdAt - b.createdAt,
      ),
    [roomId],
  );
}

export function useNote(noteId: string | undefined) {
  return useLiveQuery(async () => (noteId ? ((await db.notes.get(noteId)) ?? null) : null), [noteId]);
}

/** 依頼ページのメモ（本文）。まだ無ければ null。「ページ」の項目の別ページ（sub）は除く */
export function usePageNote(pageId: string) {
  return useLiveQuery(async () => (await db.notes.where("pageId").equals(pageId).filter((n) => !n.sub).first()) ?? null, [pageId]);
}

/**
 * 依頼ページの本文のノートの ID。ページから決まるので、2人がほぼ同時に初めて開いても、本文は1つにまとまる（Supabase 版）。
 * 前に作った本文は、ランダムな ID のまま（usePageNote はページで探す）
 */
export const pageNoteId = (pageId: string) => `pn_${pageId}`;

export async function createNote(roomId: string, userId: string, title: string, pageId: string | null = null) {
  if (pageId) {
    const found = await db.notes.get(pageNoteId(pageId));
    if (found) return found;
  }
  const existing = await db.notes.where("roomId").equals(roomId).toArray();
  const now = Date.now();
  const note: Note = { id: pageId ? pageNoteId(pageId) : newId(), roomId, title, blocks: [], pageId, order: Math.max(0, ...existing.map((n) => n.order)) + 1, createdAt: now, updatedAt: now, updatedBy: userId };
  await db.notes.add(note);
  return note;
}

/** ボタンのブロックの中のページ（ノート型・ウィンドウ型）を作る。サイドバーには出さない */
export async function createInnerNote(roomId: string, userId: string, kind: "note" | "window", title: string) {
  const now = Date.now();
  const note: Note = { id: newId(), roomId, title, blocks: [], pageId: null, order: 0, createdAt: now, updatedAt: now, updatedBy: userId, inner: { kind } };
  await db.notes.add(note);
  return note;
}

/** ボタンの中のページの形（ノート型・ウィンドウ型）を変える。中身はそのまま */
export async function setInnerKind(noteId: string, kind: "note" | "window") {
  await db.notes.update(noteId, { inner: { kind } });
}

/** updatedAt：保存する時刻。書き込む前に「自分の保存」と覚えておきたいときに渡す */
export async function saveNoteBlocks(noteId: string, blocks: unknown[], userId: string, updatedAt = Date.now()) {
  await db.notes.update(noteId, { blocks, updatedAt, updatedBy: userId });
  return updatedAt;
}

export async function renameNote(noteId: string, title: string) {
  await db.notes.update(noteId, { title });
}

/** カバーを変える（null なら外す）。画像の見せる高さ（y）は、はじめは真ん中 */
export async function setNoteCover(noteId: string, cover: NoteCover | null) {
  await db.notes.update(noteId, { cover: cover ?? undefined });
}

/** 見た目（書体・小さい文字・全幅）の一部を変える */
export async function setNoteLook(noteId: string, patch: NoteLook) {
  const prev = (await db.notes.get(noteId))?.look ?? {};
  await db.notes.update(noteId, { look: { ...prev, ...patch } });
}

export async function setNoteLocked(noteId: string, locked: boolean) {
  await db.notes.update(noteId, { locked: locked || undefined });
}

/** ノートを、中の子のページごと削除する。貼った画像はメディアに残る */
export async function deleteNote(noteId: string) {
  await deleteNoteTree(noteId);
}

// ---- 子のページ（ノートの「ページ」ブロック） ----

/** 子のページを開くブロックの種類 */
export const SUB_PAGE = "subPage";

type Loose = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: Loose[] };

/** 本文の「ページ」ブロックが開く子のページの ID（入れ子・列・タブの中も。本文の順） */
export function subPageIds(blocks: unknown[]): string[] {
  const out: string[] = [];
  const walk = (list: Loose[]) => {
    for (const b of list) {
      if (b.type === SUB_PAGE && typeof b.props?.noteId === "string" && b.props.noteId) out.push(b.props.noteId);
      if (b.children?.length) walk(b.children);
    }
  };
  walk(blocks as Loose[]);
  return out;
}

/** 子のページを作る。id は先に決めておく（「ページ」ブロックに入れる ID） */
export async function createSubNote(id: string, parent: Pick<Note, "id" | "roomId">, userId: string) {
  const now = Date.now();
  await db.notes.add({ id, roomId: parent.roomId, title: "", blocks: [], pageId: null, order: 0, createdAt: now, updatedAt: now, updatedBy: userId, parentId: parent.id });
}

/** 子のページ（ゴミ箱のもの・ゴミ箱のページの中のものは除く）を、親ごとに。親の本文で「ページ」ブロックが並ぶ順 */
export function useSubNotes(roomId: string) {
  return useLiveQuery(async () => {
    const notes = await db.notes.where("roomId").equals(roomId).toArray();
    const byId = new Map(notes.map((n) => [n.id, n]));
    const out = new Map<string, Note[]>();
    for (const n of notes) {
      if (!n.parentId || n.deletedAt || !byId.has(n.parentId)) continue;
      const list = out.get(n.parentId) ?? [];
      list.push(n);
      out.set(n.parentId, list);
    }
    for (const [parentId, list] of out) {
      const order = subPageIds(byId.get(parentId)?.blocks ?? []);
      // 本文にブロックが無いもの（ほかの人の保存と行き違ったときなど）は、後ろに作った順で
      const at = (n: Note) => (order.includes(n.id) ? order.indexOf(n.id) : order.length);
      list.sort((a, b) => at(a) - at(b) || a.createdAt - b.createdAt);
    }
    return out;
  }, [roomId]);
}

/** 上の階層のノート（いちばん上の親から順に）。子のページでなければ空 */
export function useNoteAncestors(parentId: string | null | undefined) {
  return useLiveQuery(async () => {
    const out: Note[] = [];
    for (let id = parentId; id && !out.some((n) => n.id === id); ) {
      const parent = await db.notes.get(id);
      if (!parent) break;
      out.unshift(parent);
      id = parent.parentId;
    }
    return out;
  }, [parentId]);
}

/** ブロックの「ページ」を消した（戻した）ときに、子のページをゴミ箱に入れる（ゴミ箱から戻す）。この親の子のページだけ */
export async function syncSubPages(parentId: string, removed: string[], added: string[]) {
  const notes = (await db.notes.bulkGet([...removed, ...added])).filter((n): n is Note => !!n);
  for (const n of notes) {
    if (removed.includes(n.id) && n.parentId === parentId && !n.deletedAt) await db.notes.update(n.id, { deletedAt: Date.now() });
    // ゴミ箱の子のページを、ほかのノートに貼ったときは（切り取って貼ったとき）、そのノートの子にする（Notion の移動と同じ）
    if (added.includes(n.id) && n.deletedAt) await db.notes.update(n.id, { deletedAt: undefined, parentId });
  }
}

/** 親の本文の「ページ」ブロックを、作り替える（列が空になるときは、空の段落を残す） */
async function editParentBlocks(note: Note, userId: string, edit: (blocks: Loose[]) => Loose[]) {
  if (!note.parentId) return;
  const parent = await db.notes.get(note.parentId);
  if (!parent) return;
  const blocks = edit(parent.blocks as Loose[]);
  if (JSON.stringify(blocks) !== JSON.stringify(parent.blocks)) await saveNoteBlocks(parent.id, blocks, userId);
}

const pageBlockOf = (b: Loose, id: string) => b.type === SUB_PAGE && b.props?.noteId === id;

/** 子のページをゴミ箱に入れ、親の本文から「ページ」ブロックを外す */
export async function trashSubNote(note: Note, userId: string) {
  await db.notes.update(note.id, { deletedAt: Date.now() });
  const strip = (list: Loose[], inColumn: boolean): Loose[] => {
    const kept = list.filter((b) => !pageBlockOf(b, note.id)).map((b) => (b.children?.length ? { ...b, children: strip(b.children, b.type === "column") } : b));
    // 列は中身が無いと開けなくなるので、空の段落を残す
    return inColumn && !kept.length ? [{ id: newId(), type: "paragraph", props: {}, content: [], children: [] }] : kept;
  };
  await editParentBlocks(note, userId, (blocks) => strip(blocks, false));
}

/** 子のページをゴミ箱から戻す。親の本文に「ページ」ブロックが無ければ、最後に足す */
export async function restoreSubNote(note: Note, userId: string) {
  await db.notes.update(note.id, { deletedAt: undefined });
  await editParentBlocks(note, userId, (blocks) => (subPageIds(blocks).includes(note.id) ? blocks : [...blocks, { id: newId(), type: SUB_PAGE, props: { noteId: note.id }, children: [] }]));
}

/**
 * 複製するブロックの中身（チャットは中身を引き継がず、新しい会話になる。ボタンの中のページも、押したときに新しく作る）。
 * 子のページは新しい ID にして、写す組（元・先）を pages に足す（中身は copySubNotes で写す）。keepId が false なら、ブロックに新しい id が付く
 */
export function copyBlockTree(b: Loose, pages: [string, string][], keepId = false): Loose {
  let props = b.props;
  if (b.type === SUB_PAGE && typeof props?.noteId === "string" && props.noteId) {
    const id = newId();
    pages.push([props.noteId, id]);
    props = { ...props, noteId: id };
  } else if (props && ("chatId" in props || "noteId" in props)) props = { ...props, ...("chatId" in props ? { chatId: "" } : {}), ...("noteId" in props ? { noteId: "" } : {}) };
  return { ...b, id: keepId ? b.id : undefined, ...(props ? { props } : {}), children: (b.children ?? []).map((c) => copyBlockTree(c, pages, keepId)) };
}

/** 子のページを、中身ごと写す（中の子のページも写す）。写したページの親は、元のページと同じ */
export async function copySubNotes(pages: [string, string][], userId: string, parentId?: string) {
  for (const [from, to] of pages) {
    const src = await db.notes.get(from);
    if (!src) continue;
    const inner: [string, string][] = [];
    const blocks = (src.blocks as Loose[]).map((b) => copyBlockTree(b, inner, true));
    const now = Date.now();
    const { id: _id, sourceId: _source, chatMap: _chats, deletedAt: _deleted, locked: _locked, ...rest } = src;
    void [_id, _source, _chats, _deleted, _locked];
    await db.notes.add({ ...rest, id: to, blocks, parentId: parentId ?? src.parentId, createdAt: now, updatedAt: now, updatedBy: userId });
    await copySubNotes(inner, userId, to);
  }
}
