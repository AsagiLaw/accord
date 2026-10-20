"use client";

// フォルダごと入れた画像を集める（ドラッグして入れたとき・「フォルダを追加」で選んだとき）

/**
 * 入れるファイルと、入っていたフォルダ（フォルダごと入れたときだけ）。
 * folders は入れたフォルダから画像のすぐ上のフォルダまでの名前の並び（同じ形のライブラリーを作る）、folder はその最後（自動の名前のタイトル）
 */
export type ImportFile = { file: File; folder?: string; folders?: string[] };

const inFolders = (file: File, folders: string[]): ImportFile =>
  folders.length ? { file, folder: folders[folders.length - 1], folders } : { file };

/** パソコンが自分で作るファイル（隠しファイル・サムネイルの控えなど）は入れない */
const isJunk = (name: string) => name.startsWith(".") || /^(thumbs\.db|desktop\.ini)$/i.test(name);

/** 「フォルダを追加」で選んだファイル（webkitRelativePath は「フォルダ/中のフォルダ/画像.png」） */
export function filesFromFolderInput(list: FileList | File[]): ImportFile[] {
  return [...list]
    .filter((f) => !isJunk(f.name))
    .map((file) => inFolders(file, file.webkitRelativePath.split("/").slice(0, -1)));
}

/**
 * ドロップされたもの。フォルダは中まで見て、画像ごとに入っていたフォルダの並びを付ける。
 * フォルダが無ければ、今までどおりファイルだけ。ドロップの知らせの中で呼ぶ（後からは中身を見られない）
 */
export function filesFromDrop(dt: DataTransfer): Promise<ImportFile[]> {
  const entries = [...dt.items].filter((it) => it.kind === "file").map((it) => it.webkitGetAsEntry?.() ?? null);
  const files = [...dt.files];
  if (!entries.some((e) => e?.isDirectory)) return Promise.resolve(files.map((file) => ({ file })));
  return (async () => {
    const out: ImportFile[] = [];
    for (const [i, entry] of entries.entries()) {
      if (entry) await walk(entry, [], out);
      else if (files[i]) out.push({ file: files[i] });
    }
    return out;
  })();
}

async function walk(entry: FileSystemEntry, folders: string[], out: ImportFile[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)).catch(() => null);
    if (file && !isJunk(file.name)) out.push(inFolders(file, folders));
    return;
  }
  if (!entry.isDirectory) return;
  // 一度に読めるのは一部だけなので、空になるまで読み続ける
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject)).catch(() => []);
    if (!batch.length) break;
    for (const e of batch) await walk(e, [...folders, entry.name], out);
  }
}
