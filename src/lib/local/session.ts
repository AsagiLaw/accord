"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useSyncExternalStore } from "react";
import { db } from "./db";

// ローカル版のログインの代わり：今どちらとして操作しているかをブラウザに覚えておく。
// タブごとの値（sessionStorage）を優先するので、2つのタブで別々の人としてチャットを試せる
const KEY = "irai-note:current-user";
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setCurrentUser(id: string) {
  try {
    sessionStorage.setItem(KEY, id);
    localStorage.setItem(KEY, id);
  } catch {
    // 保存できない環境では、このタブの間だけ有効
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

/** 今の利用者。未選択や削除済みなら最初に登録された人。読み込み中は undefined */
export function useCurrentUser() {
  const stored = useSyncExternalStore(subscribe, read, () => null);
  return useLiveQuery(async () => {
    const found = stored ? await db.profiles.get(stored) : undefined;
    return found ?? (await db.profiles.orderBy("createdAt").first()) ?? null;
  }, [stored]);
}
