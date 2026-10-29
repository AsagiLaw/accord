"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { deleteOwnedChats } from "./channels";
import { db, newId, type Note, type NoteCover, type NoteLook } from "./db";

/** サイドバーに出すノート（依頼のメモ・テンプレート・ボタンの中のページは除く） */
export function useNotes(roomId: string) {
  return useLiveQuery(async () => (await db.notes.where("roomId").equals(roomId).filter((n) => !n.pageId && !n.template && !n.inner).toArray()).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt), [roomId]);
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

/** ノートを削除する。貼った画像はメディアに残る */
export async function deleteNote(noteId: string) {
  await deleteOwnedChats(`note:${noteId}`);
  await db.notes.delete(noteId);
}
