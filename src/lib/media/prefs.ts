"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_PREFS, type MediaPrefs } from "./logic";

// 並べ替え・画像サイズなどの表示の好み。人ごと・端末ごとの設定なのでブラウザに保存する
const KEY = "irai-note:media-prefs";
const listeners = new Set<() => void>();
let cached: MediaPrefs | null = null;

function read(): MediaPrefs {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<MediaPrefs>) : {};
    cached = { ...DEFAULT_PREFS, ...parsed, dirs: { ...DEFAULT_PREFS.dirs, ...parsed.dirs } };
    // 今は無い並べる基準が残っていたら、はじめの基準に戻す
    if (!(cached.sort in DEFAULT_PREFS.dirs)) cached.sort = DEFAULT_PREFS.sort;
  } catch {
    cached = DEFAULT_PREFS;
  }
  return cached;
}

export function updatePrefs(patch: Partial<MediaPrefs>) {
  cached = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // 保存できなくても、このタブの間は効く
  }
  listeners.forEach((fn) => fn());
}

export function useMediaPrefs() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    read,
    () => DEFAULT_PREFS,
  );
}
