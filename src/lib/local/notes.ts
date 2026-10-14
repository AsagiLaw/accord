"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { deleteOwnedChats } from "./channels";
import { db, newId, type Note } from "./db";

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

export async function createNote(roomId: string, userId: string, title: string, pageId: string | null = null) {
  const existing = await db.notes.where("roomId").equals(roomId).toArray();
  const now = Date.now();
  const note: Note = { id: newId(), roomId, title, blocks: [], pageId, order: Math.max(0, ...existing.map((n) => n.order)) + 1, createdAt: now, updatedAt: now, updatedBy: userId };
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

export async function saveNoteBlocks(noteId: string, blocks: unknown[], userId: string) {
  const updatedAt = Date.now();
  await db.notes.update(noteId, { blocks, updatedAt, updatedBy: userId });
  return updatedAt;
}

export async function renameNote(noteId: string, title: string) {
  await db.notes.update(noteId, { title });
}

/** ノートを削除する。貼った画像はメディアに残る */
export async function deleteNote(noteId: string) {
  await deleteOwnedChats(`note:${noteId}`);
  await db.notes.delete(noteId);
}
