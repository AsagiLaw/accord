"use client";

import { useEffect, useReducer, useSyncExternalStore } from "react";
import { db } from "@/lib/local/db";
import { supa } from "@/lib/local/sync";
import { loadShownBlob, MISSING } from "./remote";

// 一度作った表示用 URL は使い回す。画像を編集して中身が変わったら refreshBlobUrls で作り直す
const urls = new Map<string, string>();
const pending = new Map<string, Promise<void>>();
/** 取りに行ったが取れなかった画像（R2 にまだ無い・つながらなかった）。取り直し始めたら外す */
const failed = new Set<string>();
/** 取れなかった画像を取り直した回数 */
const retries = new Map<string, number>();

/**
 * 取り直すまでの間。R2 にまだ無い画像は、入れた人のブラウザから置かれるまで時間がかかるので、
 * 30秒から倍々にあけて5分おきまでにする（何百枚あっても、R2 と札の関数を何度も呼ばないように）。
 * つながらなかったときは5秒から倍々に、1分おきまで
 */
function retryDelay(missing: boolean, tries: number) {
  return missing ? Math.min(5 * 60_000, 30_000 * 2 ** tries) : Math.min(60_000, 5000 * 2 ** tries);
}
/** つながらなかったときに取り直す回数（R2 にまだ無い画像は、画面に出ている間は取り直し続ける） */
const MAX_FAILED_TRIES = 12;

/** 取り直す画像の ID → 取り直す時刻。まとめて1回で取り直す（1枚ごとに画面を描き直さないように） */
const due = new Map<string, number>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRetry(id: string, at: number) {
  due.set(id, Math.min(due.get(id) ?? Infinity, at));
  armRetry();
}

function armRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (!due.size) return;
  const next = Math.min(...due.values());
  retryTimer = setTimeout(runRetry, Math.max(0, next - Date.now()));
}

function runRetry() {
  retryTimer = null;
  // 見えていないタブでは取り直さない（見えたら取り直す）
  if (document.visibilityState !== "visible") return;
  const now = Date.now();
  const ids = [...due].filter(([, at]) => at <= now).map(([id]) => id);
  for (const id of ids) due.delete(id);
  if (ids.length) refreshBlobUrls(ids);
  armRetry();
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && armRetry());
/** 中身が変わったので作り直す URL（作り直すまでは古い URL を見せておき、表示が一瞬消えないようにする） */
const stale = new Set<string>();

/** original：元の大きさの画像（PSD は表示用にした PNG） */
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
    failed.delete(key);
    // ブラウザの中に無ければ、その種類だけを R2 から取ってくる（Supabase 版）。
    // 途中で失敗したときも、取れなかったものとして扱う（読み込み中の印が出たままにならないように）
    p = loadShownBlob(id, kind).catch(() => undefined).then((got) => {
      const blob = got instanceof Blob ? got : undefined;
      const old = urls.get(key);
      if (blob) urls.set(key, URL.createObjectURL(blob));
      else {
        urls.delete(key);
        failed.add(key);
      }
      // ほかの人が入れたばかりで、R2 にまだ置き終わっていないことがある。間をあけながら取り直す
      const tries = retries.get(key) ?? 0;
      if (blob) retries.delete(key);
      else if (supa && (got === MISSING || tries < MAX_FAILED_TRIES)) {
        retries.set(key, tries + 1);
        scheduleRetry(id, Date.now() + retryDelay(got === MISSING, tries));
      }
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
      failed.delete(key);
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
  return useBlobState(id, kind).url;
}

/** 表示用の URL と、まだ取りに行っている途中か（取れなかったときは途中ではない。間をあけて取り直す） */
export function useBlobState(id: string | undefined, kind: Kind = "thumb") {
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
  const url = key ? urls.get(key) : undefined;
  return { url, loading: !!key && !url && !failed.has(key) };
}

// ほかの人が画像を編集して中身が変わったら（rev が上がったら）、表示している所を新しい画像に替える
if (typeof window !== "undefined") {
  db.media.hook("updating", function (mods, primKey, _obj, trans) {
    if (!("rev" in mods)) return;
    trans.on("complete", () => refreshBlobUrls([String(primKey)]));
  });
}
