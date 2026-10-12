"use client";

import { useEffect, useReducer, useSyncExternalStore } from "react";
import { db } from "@/lib/local/db";

// 一度作った表示用 URL は使い回す。画像を編集して中身が変わったら refreshBlobUrls で作り直す
const urls = new Map<string, string>();
const pending = new Map<string, Promise<void>>();
/** 中身が変わったので作り直す URL（作り直すまでは古い URL を見せておき、表示が一瞬消えないようにする） */
const stale = new Set<string>();

type Kind = "thumb" | "original";

let generation = 0;
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};
const notify = () => {
  generation++;
  for (const f of listeners) f();
};

function load(id: string, kind: Kind): Promise<void> {
  const key = `${kind}:${id}`;
  let p = pending.get(key);
  if (!p) {
    p = db.mediaBlobs.get(id).then((row) => {
      const old = urls.get(key);
      if (row) urls.set(key, URL.createObjectURL(row[kind]));
      else urls.delete(key);
      if (old) URL.revokeObjectURL(old);
      stale.delete(key);
    });
    pending.set(key, p);
  }
  return p;
}

export function forgetBlobUrls(ids: string[]) {
  for (const id of ids) {
    for (const kind of ["thumb", "original"] as const) {
      const key = `${kind}:${id}`;
      const url = urls.get(key);
      if (url) URL.revokeObjectURL(url);
      urls.delete(key);
      pending.delete(key);
      stale.delete(key);
    }
  }
}

/** 画像の中身が変わったとき（編集・元に戻す）。表示している所は新しい画像に替わる */
export function refreshBlobUrls(ids: string[]) {
  for (const id of ids) {
    for (const kind of ["thumb", "original"] as const) {
      const key = `${kind}:${id}`;
      pending.delete(key);
      if (urls.has(key)) stale.add(key);
    }
  }
  notify();
}

export function useBlobUrl(id: string | undefined, kind: Kind = "thumb") {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const gen = useSyncExternalStore(subscribe, () => generation, () => 0);
  const key = id ? `${kind}:${id}` : "";
  useEffect(() => {
    if (!id || (urls.has(key) && !stale.has(key))) return;
    let alive = true;
    load(id, kind).then(() => alive && rerender());
    return () => {
      alive = false;
    };
  }, [id, kind, key, gen]);
  return key ? urls.get(key) : undefined;
}
