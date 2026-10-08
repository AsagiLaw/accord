"use client";

import { useSyncExternalStore } from "react";

// 「名称表示」：カーソルを置いた場所の名前を出す。指示を出すときに名前を確かめるための機能。端末ごとの設定
const KEY = "irai-note:name-hints";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setNameHints(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // 保存できなくても、このページの間は切り替わる
  }
  listeners.forEach((fn) => fn());
}

export function useNameHints(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      window.addEventListener("storage", fn);
      return () => {
        listeners.delete(fn);
        window.removeEventListener("storage", fn);
      };
    },
    read,
    () => false,
  );
}
