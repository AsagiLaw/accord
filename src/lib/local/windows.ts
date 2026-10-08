"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";

export function useWindowPage(id: string | undefined) {
  return useLiveQuery(async () => (id ? ((await db.windows.get(id)) ?? null) : null), [id]);
}

export async function renameWindow(id: string, name: string) {
  await db.windows.update(id, { name, updatedAt: Date.now() });
}

export async function saveWindowBlocks(id: string, blocks: unknown[]) {
  await db.windows.update(id, { blocks, updatedAt: Date.now() });
}

/** 区画の高さの割合を保存する */
export async function saveWindowHeights(id: string, heights: Record<string, number>) {
  await db.windows.update(id, { heights, updatedAt: Date.now() });
}
