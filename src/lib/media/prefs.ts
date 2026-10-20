"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_PREFS, type MediaPrefs, type PreviewField } from "./logic";

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
    // 版 2 で足したプレビューの詳細（タイトル・制作日）は、前からの設定にも先頭に足す（出すかどうかは、あとで選び直せる）
    if ((parsed.v ?? 1) < 2 && parsed.previewFields) {
      cached.previewFields = [...new Set<PreviewField>(["title", "made", ...parsed.previewFields])];
      cached.v = 2;
    }
  } catch {
    cached = DEFAULT_PREFS;
  }
  return cached;
}

/** 今の設定（画面の外で読むとき。画像を入れるときの「名前を自動で付ける」など） */
export const mediaPrefs = () => read();

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
