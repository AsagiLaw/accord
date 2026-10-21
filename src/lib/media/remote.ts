"use client";

import type { Transaction } from "dexie";
import { useSyncExternalStore } from "react";
import { db, type Media, type MediaBlob } from "@/lib/local/db";
import { supa } from "@/lib/local/sync";
import { PSD_MIME } from "./psd";

// Supabase 版：画像のファイルを Cloudflare R2 に置き、ほかの人のブラウザでは R2 から取ってくる（第3段階）。
// 置く・読むための札は /api/media/sign が出す（見られる画像か・編集できるボックスかを Supabase で確かめてから）。
// 自分が入れた・編集した画像は、ブラウザの中（mediaBlobs）に書いたのをフックで拾って置く。
// ほかの人の画像は、ブラウザの中に無ければ取ってきて残す：一覧の小さい画像は blobCache に、元の画像まで要るときは mediaBlobs に

type Kind = "thumb" | "original" | "view" | "source" | "meta";
type Op = { id: string; rev: number; kind: Kind; op: "get" | "put" };

const revOf = (m: Pick<Media, "rev"> | undefined) => m?.rev ?? 0;

/** 札をまとめてもらう。もらえなかった（見られない・まだ情報が届いていない）ものは null */
async function sign(ops: Op[]): Promise<(string | null)[] | null> {
  const res = await fetch("/api/media/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ops }) }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { urls?: (string | null)[] } | null;
  return body?.urls?.length === ops.length ? body.urls : null;
}

// ---- 置く ----

/** 置いた画像の印（画像の ID と rev）。置き直さないため */
const doneKey = (id: string, rev: number) => `accord:r2:${id}:${rev}`;
function isDone(id: string, rev: number) {
  try {
    return localStorage.getItem(doneKey(id, rev)) === "1";
  } catch {
    return false;
  }
}
/** その画像の置いた印を全部忘れる（消したとき。取り消しで戻したら、また置けるように） */
function forgetDone(id: string) {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(`accord:r2:${id}:`)) localStorage.removeItem(k);
  } catch {
    // 忘れられなくても、戻したときに置かれないだけ（ほかの端末で開けば置かれる）
  }
}

function markDone(id: string, rev: number) {
  try {
    localStorage.setItem(doneKey(id, rev), "1");
  } catch {
    // 覚えられなくても、次にまた置くだけ（同じものを置き直しても害はない）
  }
}

/** 置く順番を待っている画像（ID → 試した回数） */
const waiting = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;
let me: string | null = null;

// ---- 置く進み具合（一覧のゲージと、上部バーのサークルゲージに出す） ----

/** 置き終わっていない画像（ID → その画像のファイル全部の量・送った量。量は、置き始めるまでは画像の容量で見積もる） */
const items = new Map<string, { total: number; sent: number }>();
/** 今のひとまとまり（置き終わっていない画像が無くなるまで）で、置き終わった画像の量（サークルゲージが戻らないように） */
let finishedBytes = 0;
/** これまでに送った量（速さを出すため。送り直した分も入る） */
let sentBytes = 0;
/** 送った量の記録（最近10秒の分で速さを出す） */
let samples: { at: number; bytes: number }[] = [];
const SPEED_WINDOW = 10_000;

/** 上部バーに出す、置いている画像のまとめ。速さ（バイト/秒）と残りの時間（秒）は、まだ分からなければ null */
export type UploadSummary = { count: number; ratio: number; speed: number | null; remaining: number | null };
let summary: UploadSummary | null = null;

function summarize(): UploadSummary | null {
  if (!items.size) return null;
  const now = Date.now();
  samples.push({ at: now, bytes: sentBytes });
  samples = samples.filter((s) => s.at >= now - SPEED_WINDOW);
  const first = samples[0];
  // 1秒以上たたないと、速さはあてにならない
  const speed = now - first.at >= 1000 ? ((sentBytes - first.bytes) * 1000) / (now - first.at) : null;
  let total = finishedBytes;
  let sent = finishedBytes;
  for (const it of items.values()) {
    total += it.total;
    sent += Math.min(it.sent, it.total);
  }
  return {
    count: items.size,
    ratio: total ? sent / total : 0,
    speed,
    remaining: speed ? (total - sent) / speed : null,
  };
}

const progressListeners = new Set<() => void>();
let progressFrame = 0;
let tick: ReturnType<typeof setInterval> | null = null;

/** 画面に知らせる。描くたびに1回だけにまとめる */
function notifyProgress() {
  if (progressFrame) return;
  progressFrame = requestAnimationFrame(() => {
    progressFrame = 0;
    summary = summarize();
    if (!items.size) {
      finishedBytes = 0;
      samples = [];
    }
    // 送っていない間も速さと残りの時間が変わるので、置いている間は1秒おきに出し直す
    if (items.size && !tick) tick = setInterval(notifyProgress, 1000);
    if (!items.size && tick) {
      clearInterval(tick);
      tick = null;
    }
    progressListeners.forEach((f) => f());
  });
}

/** 置く画像に足す（量は、画像の容量で見積もっておく） */
function track(id: string) {
  if (items.has(id)) return;
  items.set(id, { total: 1, sent: 0 });
  notifyProgress();
  void db.media.get(id).then((m) => {
    const it = items.get(id);
    if (it && it.sent === 0 && m?.size) it.total = m.size;
  });
}

/** 置き終わった（done）・あきらめたときに外す。あきらめた画像は、次に開いたときにまた置く */
function untrack(id: string, done: boolean) {
  const it = items.get(id);
  if (!it) return;
  if (done) finishedBytes += it.total;
  items.delete(id);
  notifyProgress();
}

function subscribeProgress(f: () => void) {
  progressListeners.add(f);
  return () => progressListeners.delete(f);
}

/** その画像を R2 に置く進み具合（0〜1。順番を待っている間は 0）。置き終わっている・このブラウザで置くものでなければ undefined */
export function useUploadProgress(id: string) {
  return useSyncExternalStore(
    subscribeProgress,
    () => {
      const it = items.get(id);
      return it ? Math.min(1, it.sent / it.total) : undefined;
    },
    () => undefined,
  );
}

/** このブラウザで R2 に置いている画像のまとめ。置いている画像が無ければ null */
export function useUploadSummary() {
  return useSyncExternalStore(
    subscribeProgress,
    () => summary,
    () => null,
  );
}

function queueUpload(id: string, tries = 0) {
  if (!supa || !me) return;
  waiting.set(id, tries);
  track(id);
  if (!timer) timer = setTimeout(() => void flushUploads(), tries ? Math.min(30_000, 3000 * tries) : 1500);
}

async function flushUploads() {
  timer = null;
  const ids = [...waiting.entries()];
  waiting.clear();
  for (const [id, tries] of ids) {
    const ok = await uploadOne(id).catch(() => false);
    // 画像の情報がまだ Supabase に届いていない・つながらなかったときは、しばらくして置き直す（10回まで）
    if (!ok && tries < 10) queueUpload(id, tries + 1);
    // 置けた・あきらめたときは、ゲージから外す
    else if (!waiting.has(id)) untrack(id, ok);
  }
}

/** R2 に1つのファイルを置く。送った量を onSent に知らせる（fetch では送った量が分からないので XMLHttpRequest を使う） */
function put(url: string, blob: Blob, onSent: (bytes: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", blob.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => onSent(e.loaded);
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = xhr.onabort = xhr.ontimeout = () => resolve(false);
    xhr.send(blob);
  });
}

/** 1枚の画像のファイルを R2 に置く。置けたら true */
async function uploadOne(id: string) {
  const [row, media] = await Promise.all([db.mediaBlobs.get(id), db.media.get(id)]);
  // ほかの人の画像を取ってきたもの・消した画像は置かない
  if (!row || !media || row.remoteRev !== undefined) return true;
  const rev = revOf(media);
  if (isDone(id, rev)) return true;
  const parts: [Kind, Blob][] = [["thumb", row.thumb], ["original", row.original]];
  if (row.view) parts.push(["view", row.view]);
  if (row.source) parts.push(["source", row.source]);
  if (row.sourceInfo || row.edit) parts.push(["meta", new Blob([JSON.stringify({ sourceInfo: row.sourceInfo, edit: row.edit })], { type: "application/json" })]);
  const urls = await sign(parts.map(([kind]) => ({ id, rev, kind, op: "put" })));
  if (!urls || urls.some((u) => !u)) return false;
  // ゲージは、その画像のファイル全部を合わせた量で進める
  const item = items.get(id) ?? { total: 1, sent: 0 };
  items.set(id, item);
  item.total = parts.reduce((n, [, blob]) => n + blob.size, 0) || 1;
  item.sent = 0;
  let done = 0;
  for (const [i, [, blob]] of parts.entries()) {
    let last = 0;
    const ok = await put(urls[i]!, blob, (sent) => {
      sentBytes += sent - last;
      last = sent;
      item.sent = done + sent;
      notifyProgress();
    });
    if (!ok) {
      item.sent = 0;
      notifyProgress();
      return false;
    }
    done += blob.size;
  }
  markDone(id, rev);
  // 編集して中身が変わったときは、前の版のファイルを消す（R2 に溜まらないように）
  if (rev > 0) void removeFiles({ prune: [{ id, rev }] });
  return true;
}

/** R2 からファイルを消してもらう（/api/media/delete が、消してよいかを Supabase で確かめる） */
async function removeFiles(body: { deleted?: string[]; prune?: { id: string; rev: number }[] }) {
  await fetch("/api/media/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
}

/** 完全に削除した画像のファイルを、R2 からも消す（Supabase に消したことが伝わってから呼ぶ。入れた本人の画像だけが消える） */
export async function removeDeletedFiles(ids: string[]) {
  if (!supa) return;
  for (let i = 0; i < ids.length; i += 100) await removeFiles({ deleted: ids.slice(i, i + 100) });
}

// ---- 取ってくる ----

/** 一度にもらえる札の数（/api/media/sign の MAX_OPS） */
const MAX_OPS = 200;
/** 読む札は1時間使える。少し余裕をみて、50分までは使い回す */
const GET_REUSE = 50 * 60_000;

/** もらった読む札（「ID:rev:種類」→ 札） */
const signedGets = new Map<string, { url: string; until: number }>();
/** 札を待っている読み込み。null：見られない・まだ情報が届いていない／undefined：つながらなかった */
let getQueue: { op: Op; resolve: (url: string | null | undefined) => void }[] = [];
let getTimer: ReturnType<typeof setTimeout> | null = null;

/** 読む札をもらう。一覧で一度にたくさん出る画像の札は、まとめて1回でもらう */
function signGet(id: string, rev: number, kind: Kind): Promise<string | null | undefined> {
  const hit = signedGets.get(`${id}:${rev}:${kind}`);
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.url);
  return new Promise((resolve) => {
    getQueue.push({ op: { id, rev, kind, op: "get" }, resolve });
    if (!getTimer) getTimer = setTimeout(() => void flushGets(), 30);
  });
}

async function flushGets() {
  getTimer = null;
  const queued = getQueue;
  getQueue = [];
  const chunks: (typeof queued)[] = [];
  for (let i = 0; i < queued.length; i += MAX_OPS) chunks.push(queued.slice(i, i + MAX_OPS));
  await Promise.all(
    chunks.map(async (chunk) => {
      const urls = await sign(chunk.map((q) => q.op));
      for (const [i, q] of chunk.entries()) {
        const url = urls ? urls[i] : undefined;
        if (url) signedGets.set(`${q.op.id}:${q.op.rev}:${q.op.kind}`, { url, until: Date.now() + GET_REUSE });
        q.resolve(url);
      }
    }),
  );
}

/** R2 に無い（入れた人のブラウザから、まだ置かれていない）。つながらなかったときの null と分けて、取り直す間をあける */
export const MISSING = "missing";
type Got = Blob | typeof MISSING | null;

/** ほかの人の画像のファイルの一部を、R2 から取ってくる。null はつながらなかったとき */
async function fetchKinds(id: string, rev: number, kinds: Kind[]): Promise<Got[]> {
  return Promise.all(
    kinds.map(async (kind): Promise<Got> => {
      const url = await signGet(id, rev, kind);
      if (url === undefined) return null;
      // 札が出ない：画像の情報がまだ届いていないか、見られない
      if (url === null) return MISSING;
      const res = await fetch(url).catch(() => null);
      if (res?.ok) return res.blob();
      if (res?.status === 404) return MISSING;
      // 札の期限切れなど。次はもらい直す
      signedGets.delete(`${id}:${rev}:${kind}`);
      return null;
    }),
  );
}

/** Supabase から届いた行を書いている途中の印（その書き込みは R2 に置き直さない） */
const REMOTE = Symbol("remote-blob");

/**
 * 画像のファイル（元の画像まで全部）。ブラウザの中に無いか、ほかの人の画像で中身が変わっていれば、R2 から取ってきて残す。
 * 編集・書き出し・ダウンロードなど、元の画像が要るところで使う
 */
export async function loadBlobRow(id: string): Promise<MediaBlob | undefined> {
  const row = await db.mediaBlobs.get(id);
  if (!supa) return row;
  const media = await db.media.get(id);
  const rev = revOf(media);
  if (row && (row.remoteRev === undefined || row.remoteRev === rev || !media)) return row;
  if (!media) return row;
  const isPsd = media.mime === PSD_MIME;
  const kinds: Kind[] = ["thumb", "original", ...(isPsd ? (["view"] as const) : []), ...(media.edited ? (["source", "meta"] as const) : [])];
  const blobs = await fetchKinds(id, rev, kinds);
  const got = new Map(kinds.map((k, i) => [k, blobs[i] instanceof Blob ? blobs[i] : null]));
  const thumb = got.get("thumb");
  const original = got.get("original");
  if (!thumb || !original) return row;
  const meta = got.get("meta") ? ((await got.get("meta")!.text().then(JSON.parse).catch(() => null)) as Pick<MediaBlob, "sourceInfo" | "edit"> | null) : null;
  const fresh: MediaBlob = {
    id,
    thumb,
    original,
    ...(got.get("view") ? { view: got.get("view")! } : {}),
    ...(got.get("source") ? { source: got.get("source")! } : {}),
    ...(meta?.sourceInfo ? { sourceInfo: meta.sourceInfo } : {}),
    ...(meta?.edit ? { edit: meta.edit } : {}),
    remoteRev: rev,
  };
  await db.transaction("rw", db.mediaBlobs, async (tx) => {
    (tx as unknown as Record<symbol, boolean>)[REMOTE] = true;
    await db.mediaBlobs.put(fresh);
  });
  return fresh;
}

/**
 * 画面に出す画像のファイル（thumb：一覧の小さい画像／original：元の大きさ。PSD は表示用）。
 * ブラウザの中に無ければ、その種類だけを R2 から取ってきて残す（一覧で元の画像まで取りに行かないように）。
 * R2 にまだ無いときは MISSING、つながらなかったときは undefined
 */
export async function loadShownBlob(id: string, kind: "thumb" | "original"): Promise<Blob | typeof MISSING | undefined> {
  const row = await db.mediaBlobs.get(id);
  const media = supa ? await db.media.get(id) : undefined;
  const rev = revOf(media);
  if (row && (row.remoteRev === undefined || row.remoteRev === rev)) return kind === "original" ? (row.view ?? row.original) : row.thumb;
  if (!supa || !media) return row ? (kind === "original" ? (row.view ?? row.original) : row.thumb) : undefined;
  const want: Kind = kind === "thumb" ? "thumb" : media.mime === PSD_MIME ? "view" : "original";
  const key = `${id}:${rev}:${want}`;
  const cached = await db.blobCache.get(key);
  if (cached) return cached.blob;
  const [blob] = await fetchKinds(id, rev, [want]);
  if (!(blob instanceof Blob)) return blob ?? undefined;
  await db.blobCache.put({ key, blob });
  return blob;
}

// ---- 始める ----

let hooked = false;

function hook() {
  if (hooked) return;
  hooked = true;
  const remote = (trans: Transaction) => !!(trans as unknown as Record<symbol, boolean>)[REMOTE];
  db.mediaBlobs.hook("creating", function (_key, obj, trans) {
    if (remote(trans)) return;
    const id = obj.id;
    trans.on("complete", () => queueUpload(id));
  });
  db.mediaBlobs.hook("updating", function (_mods, _key, obj, trans) {
    if (remote(trans)) return;
    const id = obj.id;
    trans.on("complete", () => queueUpload(id));
  });
  db.mediaBlobs.hook("deleting", function (primKey, _obj, trans) {
    const id = String(primKey);
    trans.on("complete", () => forgetDone(id));
  });
}

/**
 * ログインした人が替わったら始める。自分が入れた画像で、まだ R2 に置いていないものを置く
 * （第3段階より前に入れた画像も、ここで置かれる）
 */
export async function startMediaSync(userId: string | null) {
  if (!supa || userId === me) return;
  me = userId;
  if (!userId) return;
  hook();
  const mine = (await db.media.filter((m) => m.uploadedBy === userId).toArray()).filter((m) => !isDone(m.id, revOf(m)));
  const local = new Set((await db.mediaBlobs.where("id").anyOf(mine.map((m) => m.id)).primaryKeys()) as string[]);
  for (const m of mine) if (local.has(m.id)) queueUpload(m.id);
}
