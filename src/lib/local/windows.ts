"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db, type WindowPage } from "./db";

export function useWindowPage(id: string | undefined) {
  return useLiveQuery(async () => (id ? ((await db.windows.get(id)) ?? null) : null), [id]);
}

export async function renameWindow(id: string, name: string) {
  await db.windows.update(id, { name, updatedAt: Date.now() });
}

export async function saveWindowBlocks(id: string, blocks: unknown[], updatedAt = Date.now()) {
  await db.windows.update(id, { blocks, updatedAt });
}

/** テンプレートと繋いだウィンドウで、このウィンドウだけで直した文章を保存する（直したブロックの分だけ、今のものに重ねる） */
export async function saveWindowTextMap(id: string, changed: NonNullable<WindowPage["textMap"]>, updatedAt = Date.now()) {
  await db.transaction("rw", db.windows, async () => {
    const win = await db.windows.get(id);
    if (win) await db.windows.update(id, { textMap: { ...win.textMap, ...changed }, updatedAt });
  });
}

/** 文章のブロックの枠・固定を保存する */
export async function saveWindowTextOptions(id: string, textOptions: Record<string, { frame?: boolean; lock?: boolean }>) {
  await db.windows.update(id, { textOptions, updatedAt: Date.now() });
}

/** 区画の高さの割合を保存する */
export async function saveWindowHeights(id: string, heights: Record<string, number>) {
  await db.windows.update(id, { heights, updatedAt: Date.now() });
}
