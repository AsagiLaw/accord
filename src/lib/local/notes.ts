"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { deleteOwnedChats } from "./channels";
import { db, newId, type Note } from "./db";

/** サイドバーに出すノート（依頼のメモ・テンプレートは除く） */
export function useNotes(roomId: string) {
  return useLiveQuery(async () => (await db.notes.where("roomId").equals(roomId).filter((n) => !n.pageId && !n.template).toArray()).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt), [roomId]);
}

export function useNote(noteId: string | undefined) {
  return useLiveQuery(async () => (noteId ? ((await db.notes.get(noteId)) ?? null) : null), [noteId]);
}

/** 依頼ページのメモ。まだ無ければ null */
export function usePageNote(pageId: string) {
  return useLiveQuery(async () => (await db.notes.where("pageId").equals(pageId).first()) ?? null, [pageId]);
}

export async function createNote(roomId: string, userId: string, title: string, pageId: string | null = null) {
  const existing = await db.notes.where("roomId").equals(roomId).toArray();
  const now = Date.now();
  const note: Note = { id: newId(), roomId, title, blocks: [], pageId, order: Math.max(0, ...existing.map((n) => n.order)) + 1, createdAt: now, updatedAt: now, updatedBy: userId };
  await db.notes.add(note);
  return note;
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
