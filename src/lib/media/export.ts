"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db, type Media } from "@/lib/local/db";
import { supa } from "@/lib/local/sync";
import { useBlobState } from "./blob-url";
import { PSD_MIME } from "./psd";
import { makeZip } from "./zip";
import { loadBlobRow, loadShownBlob } from "@/lib/media/remote";

// メディアの画像を、元の画像のファイルとして外へ出す（他のアプリへのドラッグ・コピー・ダウンロード）。
// デスクトップアプリ版にするときは、ここを差し替える（複数枚のドラッグもできるようになる）

/** アプリの中で、メディアの画像をドラッグしているときの印（ファイルの追加と区別する） */
export const MEDIA_DRAG_TYPE = "application/x-irai-media";

/** ファイル名に使えるようにする：Windows で使えない文字は「_」にし、最後の「.」と空白を除く。空になったら fallback */
export function safeFileName(name: string, fallback = "image"): string {
  return (
    name
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
      .replace(/[. ]+$/, "")
      .trim() || fallback
  );
}

/** 外へ出すときのファイル名：表示している名前＋元の拡張子 */
export function exportFileName(m: Media): string {
  const ext =
    /\.[^.]+$/.exec(m.fileName)?.[0] ??
    (m.mime === PSD_MIME ? ".psd" : m.mime.startsWith("image/") ? "." + m.mime.slice(6).replace("jpeg", "jpg").replace("svg+xml", "svg") : "");
  return safeFileName(m.name) + ext;
}

/** 元の画像を名前付きの URL で返す仕組み（public/media-sw.js）が、このページで動いているか */
const fileServerReady = () => typeof navigator !== "undefined" && !!navigator.serviceWorker?.controller;
let registered = false;

function useFileServer() {
  const [ready, setReady] = useState(fileServerReady);
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    if (!registered) {
      registered = true;
      // 動かせなくても、ブラウザ内の URL で表示する（ドラッグしたときのファイル名が意味のない文字になるだけ）
      sw.register("/media-sw.js").catch(() => {});
    }
    const on = () => setReady(fileServerReady());
    sw.addEventListener("controllerchange", on);
    return () => sw.removeEventListener("controllerchange", on);
  }, []);
  return ready;
}

/**
 * その画像の、表示とドラッグに使う画像（PSD は表示用の PNG、ほかは元の画像。編集した画像は編集後のもの）が、ブラウザの中にあるか
 * （ほかの人の画像は、R2 から取ってきて中身が今のものか）。
 * 無ければ、その1つだけを取ってくる（Supabase 版。PSD 本体や編集前の画像は、ダウンロードや編集で要るときに取る）
 */
function useLocalOriginal(m: Media | undefined) {
  const id = m?.id;
  const rev = m?.rev ?? 0;
  const shown = m?.mime === PSD_MIME ? "view" : "original";
  const ready = useLiveQuery(async () => {
    if (!id || !supa) return true;
    const row = await db.mediaBlobs.get(id);
    if (row && (row.remoteRev === undefined || row.remoteRev === rev)) return true;
    // 表示に使う分だけを取ってきたもの（loadShownBlob が blobCache に残す）
    return !!(await db.blobCache.get(`${id}:${rev}:${shown}`));
  }, [id, rev, shown]);
  // 取りに行き終わった画像（取れなかったときは、ここに入っても ready にならない）
  const [tried, setTried] = useState<string | null>(null);
  useEffect(() => {
    if (!id || ready !== false) return;
    let alive = true;
    void loadShownBlob(id, "original")
      .catch(() => undefined)
      .then(() => alive && setTried(`${id}:${rev}`));
    return () => {
      alive = false;
    };
  }, [id, rev, ready]);
  return { ready: ready === true, loading: !!id && ready !== true && tried !== `${id}:${rev}` };
}

/**
 * 元の画像の URL。「/media-file/<ID>/<ファイル名>」の形にして、ドラッグして他のアプリに渡したときに、
 * この名前のファイルになるようにする。その仕組みが使えないときは、ブラウザ内の URL
 */
export function useOriginalUrl(m: Media | undefined) {
  return useOriginalState(m).url;
}

/** 元の画像の URL と、まだ取りに行っている途中か（拡大表示で、読み込み中のくるくるを出すため） */
export function useOriginalState(m: Media | undefined): { url: string | undefined; loading: boolean } {
  const named = useFileServer();
  const blob = useBlobState(m && !named ? m.id : undefined, "original");
  const local = useLocalOriginal(named ? m : undefined);
  if (!m) return { url: undefined, loading: false };
  // 「/media-file/」はブラウザの中の画像（public/media-sw.js が mediaBlobs か blobCache から読む）を返すので、
  // ほかの人の画像は R2 から取ってくるまで待つ（Supabase 版）
  if (named && !local.ready) return { url: undefined, loading: local.loading };
  // 編集して中身が変わったら、別の URL にする（ブラウザが前の画像を使い回さないように）。ファイル名は最後の部分なので変わらない
  const rev = m.rev ? `${m.rev}/` : "";
  // PSD は表示用の PNG を出すので、名前も .png にする（ドラッグして渡すのも PNG になる）
  const name = m.mime === PSD_MIME ? safeFileName(m.name) + ".png" : exportFileName(m);
  return named ? { url: `/media-file/${m.id}/${rev}${encodeURIComponent(name)}`, loading: false } : blob;
}

/**
 * 元の画像（img）をドラッグし始めたとき。ブラウザが画像そのものを、ファイルとして他のアプリ（Photoshop・デスクトップなど）に渡す。
 * ghost：ドラッグ中に見せる要素（透明な画像を重ねてドラッグさせるときに、下の見た目を使う）。渡せないときは false
 */
export function startMediaDrag(e: React.DragEvent<HTMLImageElement>, m: Media, ghost?: Element | null): boolean {
  const img = e.currentTarget;
  // タッチ端末や、元の画像をまだ読み込めていないときは、ドラッグしない
  if (!img.complete || !img.naturalWidth || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    e.preventDefault();
    return false;
  }
  e.dataTransfer.setData(MEDIA_DRAG_TYPE, m.id);
  if (ghost) e.dataTransfer.setDragImage(ghost, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
  return true;
}

/** 元の画像をクリップボードにコピーする（貼り付け先で Ctrl+V）。ブラウザがコピーできる画像は PNG だけなので、PNG にして入れる */
export async function copyImage(m: Media) {
  const png = (async () => {
    const row = await loadBlobRow(m.id);
    if (!row) throw new Error("no blob");
    const src = row.view ?? row.original;
    if (src.type === "image/png") return src;
    const bitmap = await createImageBitmap(src);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png failed"))), "image/png"),
    );
  })();
  // 中身はあとから渡す（PNG にする間に、コピーの許可が切れないように）
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/** 元の画像をダウンロードする（ブラウザのダウンロードのフォルダに入る） */
export async function downloadOriginals(list: Media[]) {
  for (const m of list) {
    const row = await loadBlobRow(m.id);
    if (!row) continue;
    const url = URL.createObjectURL(row.original);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName(m);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    // 続けてのダウンロードを、ブラウザに止められにくくする
    if (list.length > 1) await new Promise((r) => setTimeout(r, 200));
  }
}

// File System Access API（Chrome・Edge）。TypeScript の型にまだ無いので、使う分だけ書く
type Writable = { write(data: Blob): Promise<void>; close(): Promise<void> };
type FilePicker = (options?: {
  suggestedName?: string;
  id?: string;
  startIn?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<Writable> }>;

/** 保存先を選んで保存できるブラウザか（Chrome・Edge） */
export const canPickSaveLocation = () => typeof window !== "undefined" && "showSaveFilePicker" in window;

/**
 * 1枚を、保存先とファイル名を選んで保存する（「名前を付けて保存」の画面）。やめたら false。
 * ボタンを押した流れのまま呼ぶこと（保存の画面は、押した直後でないと開けない）
 */
export async function saveFileAs(m: Media): Promise<boolean> {
  const name = exportFileName(m);
  const ext = /\.[^.]+$/.exec(name)?.[0];
  let file: Awaited<ReturnType<FilePicker>>;
  try {
    file = await (window as unknown as { showSaveFilePicker: FilePicker }).showSaveFilePicker({
      suggestedName: name,
      // ZIP で保存するときと同じ id にして、前に保存した場所から開く
      id: "irai-note-media",
      startIn: "pictures",
      types: ext && m.mime ? [{ description: "画像", accept: { [m.mime]: [ext] } }] : undefined,
    });
  } catch (err) {
    if ((err as DOMException).name === "AbortError") return false;
    throw err;
  }
  const row = await loadBlobRow(m.id);
  if (!row) throw new Error("画像が見つかりません");
  const w = await file.createWritable();
  await w.write(row.original);
  await w.close();
  return true;
}

/** ZIP に入れる画像と、ZIP の中のフォルダ（["ラフ", "表情"] なら「ラフ/表情」の中。無ければ一番上） */
export type ZipItem = { m: Media; folder?: string[] };

/**
 * 複数の元の画像を1つの ZIP にまとめて保存する（「名前を付けて保存」の画面）。ZIP の中のファイル名は画像の名前。
 * 保存先を選べないブラウザでは、ブラウザのダウンロードのフォルダに入れる。やめたら false。
 * ボタンを押した流れのまま呼ぶこと（保存の画面は、押した直後でないと開けない）。onMaking：ZIP を作り始めるとき
 */
export async function saveZip(items: ZipItem[], zipName: string, onMaking?: () => void): Promise<boolean> {
  const name = safeFileName(zipName, "media") + ".zip";
  let file: Awaited<ReturnType<FilePicker>> | undefined;
  if (canPickSaveLocation()) {
    try {
      // 先に保存先を選んでもらう（ZIP を作っている間に、保存の画面を開ける時間が過ぎないように）
      file = await (window as unknown as { showSaveFilePicker: FilePicker }).showSaveFilePicker({
        suggestedName: name,
        id: "irai-note-media",
        startIn: "pictures",
        types: [{ description: "ZIP ファイル", accept: { "application/zip": [".zip"] } }],
      });
    } catch (err) {
      if ((err as DOMException).name === "AbortError") return false;
      throw err;
    }
  }
  onMaking?.();
  const zip = await makeZip(await zipEntries(items));
  if (file) {
    const w = await file.createWritable();
    await w.write(zip);
    await w.close();
  } else {
    const url = URL.createObjectURL(zip);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return true;
}

/** ZIP に入れる中身。同じフォルダに同じ名前の画像があれば「名前 (2).png」のようにずらす */
async function zipEntries(items: ZipItem[]): Promise<{ name: string; data: Blob }[]> {
  const used = new Set<string>();
  const out: { name: string; data: Blob }[] = [];
  for (const { m, folder = [] } of items) {
    const row = await loadBlobRow(m.id);
    if (!row) continue;
    const name = [...folder.map((f) => safeFileName(f, "_")), exportFileName(m)].join("/");
    // 「.」はファイル名の部分だけで探す（フォルダの名前に「.」があっても、そこで分けない）
    const dot = name.lastIndexOf(".");
    const [base, ext] = dot > name.lastIndexOf("/") + 1 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let n = name;
    for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base} (${i})${ext}`;
    used.add(n.toLowerCase());
    out.push({ name: n, data: row.original });
  }
  if (!out.length) throw new Error("画像が見つかりません");
  return out;
}
