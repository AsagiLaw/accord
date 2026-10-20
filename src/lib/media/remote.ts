"use client";

import type { Transaction } from "dexie";
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

function queueUpload(id: string, tries = 0) {
  if (!supa || !me) return;
  waiting.set(id, tries);
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
  }
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
  for (const [i, [, blob]] of parts.entries()) {
    const res = await fetch(urls[i]!, { method: "PUT", body: blob, headers: { "content-type": blob.type || "application/octet-stream" } }).catch(() => null);
    if (!res?.ok) return false;
  }
  markDone(id, rev);
  return true;
}

// ---- 取ってくる ----

/** ほかの人の画像のファイルの一部を、R2 から取ってくる。取れなければ null */
async function fetchKinds(id: string, rev: number, kinds: Kind[]): Promise<(Blob | null)[] | null> {
  const urls = await sign(kinds.map((kind) => ({ id, rev, kind, op: "get" })));
  if (!urls) return null;
  return Promise.all(
    urls.map(async (url) => {
      if (!url) return null;
      const res = await fetch(url).catch(() => null);
      return res?.ok ? res.blob() : null;
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
  if (!blobs) return row;
  const got = new Map(kinds.map((k, i) => [k, blobs[i]]));
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
 * ブラウザの中に無ければ、その種類だけを R2 から取ってきて残す（一覧で元の画像まで取りに行かないように）
 */
export async function loadShownBlob(id: string, kind: "thumb" | "original"): Promise<Blob | undefined> {
  const row = await db.mediaBlobs.get(id);
  const media = supa ? await db.media.get(id) : undefined;
  const rev = revOf(media);
  if (row && (row.remoteRev === undefined || row.remoteRev === rev)) return kind === "original" ? (row.view ?? row.original) : row.thumb;
  if (!supa || !media) return row ? (kind === "original" ? (row.view ?? row.original) : row.thumb) : undefined;
  const want: Kind = kind === "thumb" ? "thumb" : media.mime === PSD_MIME ? "view" : "original";
  const key = `${id}:${rev}:${want}`;
  const cached = await db.blobCache.get(key);
  if (cached) return cached.blob;
  const blobs = await fetchKinds(id, rev, [want]);
  const blob = blobs?.[0];
  if (!blob) return undefined;
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
