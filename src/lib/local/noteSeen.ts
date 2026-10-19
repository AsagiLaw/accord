"use client";

import { useSyncExternalStore } from "react";

/**
 * ノートを見たときの更新の時刻（人ごと・ノートごと）。サイドバーの「更新あり」の印に使う。
 * 人ごと・端末ごとの印なのでブラウザに保存する（ほかのタブにも、storage の知らせで伝わる）
 */
const key = (userId: string) => `irai-note:note-seen:${userId}`;
const EMPTY: Record<string, number> = {};
const listeners = new Set<() => void>();
const cache = new Map<string, Record<string, number>>();

function read(userId: string): Record<string, number> {
  const hit = cache.get(userId);
  if (hit) return hit;
  let map: Record<string, number> = {};
  try {
    map = JSON.parse(localStorage.getItem(key(userId)) ?? "{}") as Record<string, number>;
  } catch {
    map = {};
  }
  cache.set(userId, map);
  return map;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  // ほかのタブで見たときも、印を消す
  const onStorage = (e: StorageEvent) => {
    if (!e.key?.startsWith("irai-note:note-seen:")) return;
    cache.clear();
    fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** 見たノートの更新の時刻（ノートの ID → 時刻） */
export function useNoteSeen(userId: string | undefined) {
  return useSyncExternalStore(
    subscribe,
    () => (userId ? read(userId) : EMPTY),
    () => EMPTY,
  );
}

/** ノートのこの更新までを見た、と覚える */
export function markNoteSeen(userId: string, noteId: string, updatedAt: number) {
  const map = read(userId);
  if ((map[noteId] ?? 0) >= updatedAt) return;
  const next = { ...map, [noteId]: updatedAt };
  cache.set(userId, next);
  try {
    localStorage.setItem(key(userId), JSON.stringify(next));
  } catch {
    // 覚えられなくても、このタブの間は効く
  }
  listeners.forEach((fn) => fn());
}

/** ほかの人が直して、まだ見ていない更新があるか */
export function hasUnseenUpdate(seen: Record<string, number>, userId: string, note: { id: string; updatedAt?: number; updatedBy?: string }) {
  return !!note.updatedAt && !!note.updatedBy && note.updatedBy !== userId && note.updatedAt > (seen[note.id] ?? 0);
}
