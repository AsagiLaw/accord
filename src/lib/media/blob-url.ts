"use client";

import { useEffect, useReducer } from "react";
import { db } from "@/lib/local/db";

// 画像の中身は変わらないので、一度作った表示用 URL は使い回す
const urls = new Map<string, string>();
const pending = new Map<string, Promise<void>>();

type Kind = "thumb" | "original";

function load(id: string, kind: Kind): Promise<void> {
  const key = `${kind}:${id}`;
  let p = pending.get(key);
  if (!p) {
    p = db.mediaBlobs.get(id).then((row) => {
      if (row) urls.set(key, URL.createObjectURL(row[kind]));
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
    }
  }
}

export function useBlobUrl(id: string | undefined, kind: Kind = "thumb") {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const key = id ? `${kind}:${id}` : "";
  useEffect(() => {
    if (!id || urls.has(key)) return;
    let alive = true;
    load(id, kind).then(() => alive && rerender());
    return () => {
      alive = false;
    };
  }, [id, kind, key]);
  return key ? urls.get(key) : undefined;
}
