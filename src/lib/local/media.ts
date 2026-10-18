"use client";

import Dexie from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { forgetBlobUrls, refreshBlobUrls } from "@/lib/media/blob-url";
import { isDefaultEdit, renderEdit, type ImageEdit } from "@/lib/media/edit";
import { decodeImage, isImageFile, makeThumb, readImage } from "@/lib/media/image";
import { PSD_MIME } from "@/lib/media/psd";
import { childrenOf, descendants, withAncestors } from "@/lib/media/logic";
import { uploadBoxForRoom } from "./boxes";
import { db, newId, type Library, type Media, type MediaBlob } from "./db";

export type Undo = () => Promise<void>;

export function useMedia(boxId: string) {
  return useLiveQuery(() => db.media.where("boxId").equals(boxId).sortBy("createdAt"), [boxId]);
}

/** ボックスごとの画像の数と、表紙に使う新しい画像3枚（ゴミ箱の画像は除く） */
export function useBoxSummaries(boxIds: string[]) {
  const key = boxIds.join(",");
  return useLiveQuery(async () => {
    const out = new Map<string, { count: number; covers: Media[] }>();
    for (const id of boxIds) out.set(id, { count: 0, covers: [] });
    const rows = (await db.media.where("boxId").anyOf(boxIds).toArray()).filter((m) => !m.trashed);
    rows.sort((a, b) => b.createdAt - a.createdAt);
    for (const m of rows) {
      const s = out.get(m.boxId)!;
      s.count++;
      if (s.covers.length < 3) s.covers.push(m);
    }
    return out;
  }, [key]); // boxIds は中身（key）で比べる
}

/**
 * ID で画像を引く（どのボックスに入っていても）。チャットやノートに貼った画像は、見られる人なら必ず見られるようにするため、
 * ボックスからではなく ID で引く。消された画像は入らない
 */
export function useMediaByIds(ids: string[]) {
  const key = ids.join(",");
  return useLiveQuery(async () => {
    const rows = await db.media.bulkGet([...new Set(ids)]);
    return new Map(rows.flatMap((m) => (m ? [[m.id, m] as const] : [])));
  }, [key]); // ids は中身（key）で比べる
}

export function useLibraries(boxId: string) {
  return useLiveQuery(() => db.libraries.where("boxId").equals(boxId).toArray(), [boxId]);
}

// ---- 元に戻す：操作の前にボックスのライブラリーと画像の所属を丸ごと控えておく ----

async function snapshot(boxId: string): Promise<Undo> {
  const libs = await db.libraries.where("boxId").equals(boxId).toArray();
  const media = (await db.media.where("boxId").equals(boxId).toArray()).map((m) => ({
    id: m.id,
    libIds: [...m.libIds],
    trashed: m.trashed,
    fav: m.fav,
  }));
  return async () => {
    await db.transaction("rw", db.libraries, db.media, async () => {
      await db.libraries.where("boxId").equals(boxId).delete();
      await db.libraries.bulkAdd(libs);
      for (const m of media) await db.media.update(m.id, { libIds: m.libIds, trashed: m.trashed, fav: m.fav });
    });
  };
}

async function boxLibs(boxId: string) {
  return db.libraries.where("boxId").equals(boxId).toArray();
}

// ---- 画像 ----

export async function uploadFiles(boxId: string, userId: string, files: File[]) {
  const ids: string[] = [];
  let failed = 0;
  for (const file of files) {
    if (!isImageFile(file)) {
      failed++;
      continue;
    }
    try {
      const info = await readImage(file);
      const id = newId();
      await db.transaction("rw", db.media, db.mediaBlobs, async () => {
        await db.mediaBlobs.add({ id, original: file, thumb: info.thumb, ...(info.view && { view: info.view }) });
        await db.media.add({
          id,
          boxId,
          uploadedBy: userId,
          name: file.name.replace(/\.\w+$/, ""),
          fileName: file.name,
          mime: info.view ? PSD_MIME : file.type,
          size: file.size,
          width: info.width,
          height: info.height,
          dpi: info.dpi,
          createdAt: Date.now() + ids.length, // 同時に入れた画像も順番を保つ
          fav: false,
          trashed: false,
          libIds: [],
        });
      });
      ids.push(id);
    } catch {
      failed++;
    }
  }
  return { ids, failed };
}

/**
 * ルームで画像を入れる（ルームに紐づいたボックスへ。紐づいていない・見るだけ・DM なら、自分のマイメディアへ）。
 * toMine：マイメディアに入れたか（知らせの文に使う）
 */
export async function uploadToRoom(roomId: string, userId: string, files: File[]) {
  const target = await uploadBoxForRoom(roomId, userId);
  return { ...(await uploadFiles(target.boxId, userId, files)), toMine: target.mine };
}

/** ボックスに画像を入れた人と、その枚数（ゴミ箱の画像は除く。多い順） */
export function useBoxContributors(boxId: string | undefined) {
  return useLiveQuery(async () => {
    if (!boxId) return [];
    const counts = new Map<string, number>();
    await db.media
      .where("boxId")
      .equals(boxId)
      .each((m) => {
        if (!m.trashed) counts.set(m.uploadedBy, (counts.get(m.uploadedBy) ?? 0) + 1);
      });
    const people = await db.profiles.bulkGet([...counts.keys()]);
    return [...counts.entries()]
      .map(([userId, count], i) => ({ userId, name: people[i]?.displayName ?? "削除された人", count }))
      .sort((a, b) => b.count - a.count);
  }, [boxId]);
}

export type SentImage = { media: Media; by: string; at: number };

/**
 * そのチャットで送られた画像（新しい順）。チャットの上のフォルダから見る。
 * 発言から集めるので、発言やチャットを消すと、その画像も一覧から消える（画像そのものは、入っているボックスに残る）
 */
export function useChatSentMedia(chatId: string) {
  return useLiveQuery(async (): Promise<SentImage[]> => {
    const messages = (await db.messages.where("[chatId+createdAt]").between([chatId, Dexie.minKey], [chatId, Dexie.maxKey]).toArray())
      .filter((m) => m.mediaIds.length)
      .reverse();
    const people = new Map((await db.profiles.toArray()).map((p) => [p.id, p.displayName]));
    const media = new Map((await db.media.bulkGet([...new Set(messages.flatMap((m) => m.mediaIds))])).flatMap((m) => (m ? [[m.id, m] as const] : [])));
    const out: SentImage[] = [];
    const seen = new Set<string>();
    for (const msg of messages) {
      for (const id of msg.mediaIds) {
        const m = media.get(id);
        if (!m || seen.has(id)) continue;
        seen.add(id);
        out.push({ media: m, by: msg.speaker ?? people.get(msg.authorId) ?? "退出した人", at: msg.createdAt });
      }
    }
    return out;
  }, [chatId]);
}

export async function renameMedia(id: string, name: string) {
  await db.media.update(id, { name });
}

export async function setFav(ids: string[], fav: boolean) {
  await db.media.where("id").anyOf(ids).modify({ fav });
}

export async function moveToTrash(boxId: string, ids: string[]): Promise<Undo> {
  const undo = await snapshot(boxId);
  await db.media.where("id").anyOf(ids).modify({ trashed: true });
  return undo;
}

export async function restoreFromTrash(ids: string[]) {
  await db.media.where("id").anyOf(ids).modify({ trashed: false });
}

/** 完全に削除。アップロードした本人の画像だけ消し、他の人の画像は残す */
export async function deleteForever(ids: string[], userId: string) {
  const rows = await db.media.bulkGet(ids);
  const mine = rows.filter((m): m is Media => !!m && m.uploadedBy === userId).map((m) => m.id);
  await db.transaction("rw", db.media, db.mediaBlobs, db.libraries, async () => {
    await db.media.bulkDelete(mine);
    await db.mediaBlobs.bulkDelete(mine);
    await db.libraries
      .filter((l) => l.repMediaId !== null && mine.includes(l.repMediaId))
      .modify({ repMediaId: null });
  });
  forgetBlobUrls(mine);
  return { deleted: mine.length, skipped: ids.length - mine.length };
}

// ---- 編集（元の画像は source に残しておき、いつでも戻せる） ----

/** 編集の前の状態に戻す「元に戻す」を作る */
async function blobSnapshot(id: string): Promise<Undo> {
  const row = await db.mediaBlobs.get(id);
  const m = await db.media.get(id);
  return async () => {
    if (!row || !m) return;
    const { fileName, mime, size, width, height, edited } = m;
    await db.transaction("rw", db.media, db.mediaBlobs, async () => {
      await db.mediaBlobs.put(row);
      const now = await db.media.get(id);
      await db.media.update(id, { fileName, mime, size, width, height, edited, rev: (now?.rev ?? 0) + 1 });
    });
    refreshBlobUrls([id]);
  };
}

const canKeepType = (type: string) => ["image/jpeg", "image/png", "image/webp"].includes(type);

/** 編集した画像のファイル名：形式が変わったら拡張子も替える */
function withExt(fileName: string, mime: string) {
  const ext = "." + mime.slice(6).replace("jpeg", "jpg");
  return /\.[^.]+$/.test(fileName) ? fileName.replace(/\.[^.]+$/, ext) : fileName + ext;
}

/** 編集前の画像（まだ編集していなければ、今の画像）と、その情報 */
function sourceOf(row: MediaBlob, m: Media) {
  return {
    source: row.source ?? row.original,
    sourceInfo: row.sourceInfo ?? { fileName: m.fileName, mime: m.mime, size: m.size, width: m.width, height: m.height },
  };
}

/** 元の画像に編集をあてて、元の大きさの画像と一覧用の小さい画像を作る */
async function renderEdited(source: Blob, sourceInfo: { fileName: string; mime: string }, edit: ImageEdit) {
  const bitmap = await decodeImage(source);
  let canvas: HTMLCanvasElement;
  try {
    canvas = renderEdit(bitmap, edit);
  } finally {
    bitmap.close();
  }
  const type = canKeepType(source.type) ? source.type : "image/png";
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画像を作れませんでした"))), type, 0.95),
  );
  const thumb = await makeThumb(canvas);
  // ブラウザが作れない形式（Safari の WebP など）は PNG になるので、実際にできた形式を使う
  const mime = blob.type || type;
  return {
    blob,
    thumb,
    fields: {
      width: canvas.width,
      height: canvas.height,
      size: blob.size,
      mime,
      fileName: mime === sourceInfo.mime ? sourceInfo.fileName : withExt(sourceInfo.fileName, mime),
    },
  };
}

/** 編集を保存する。何も編集していなければ、元の画像に戻す */
export async function saveEdit(id: string, edit: ImageEdit): Promise<Undo> {
  const row = await db.mediaBlobs.get(id);
  const m = await db.media.get(id);
  if (!row || !m) throw new Error("画像が見つかりません");
  if (isDefaultEdit(edit)) return revertEdit(id);
  const undo = await blobSnapshot(id);
  const { source, sourceInfo } = sourceOf(row, m);
  const out = await renderEdited(source, sourceInfo, edit);
  await db.transaction("rw", db.media, db.mediaBlobs, async () => {
    await db.mediaBlobs.put({ id, original: out.blob, thumb: out.thumb, source, sourceInfo, edit });
    await db.media.update(id, { ...out.fields, edited: true, rev: (m.rev ?? 0) + 1 });
  });
  refreshBlobUrls([id]);
  return undo;
}

/**
 * 複製の追加日時。元の画像と同じ日時にして、追加日時の順で並べたときに元の画像の隣に来るようにする。
 * まったく同じだと前後が決まらないので、1ミリ秒より小さくずらす（画面の日時の表示は元と同じ）。
 * 同じ画像を何回か複製したときは、前に作った複製の後ろに並べる
 */
async function copyCreatedAt(m: Media) {
  const near = await db.media
    .where("boxId")
    .equals(m.boxId)
    .filter((x) => x.createdAt > m.createdAt && x.createdAt < m.createdAt + 0.5)
    .toArray();
  return Math.max(m.createdAt, ...near.map((x) => x.createdAt)) + 0.001;
}

/**
 * 編集を、新しい画像（複製）として保存する。元の画像はそのまま。
 * 複製にも編集前の画像を残すので、複製もあとから編集し直したり、オリジナルに戻したりできる
 */
export async function saveEditAsCopy(id: string, edit: ImageEdit, userId: string): Promise<{ id: string; undo: Undo }> {
  const row = await db.mediaBlobs.get(id);
  const m = await db.media.get(id);
  if (!row || !m) throw new Error("画像が見つかりません");
  const { source, sourceInfo } = sourceOf(row, m);
  const copyId = newId();
  const base: Media = {
    id: copyId,
    boxId: m.boxId,
    uploadedBy: userId,
    name: `${m.name} のコピー`,
    fileName: sourceInfo.fileName,
    mime: sourceInfo.mime,
    size: sourceInfo.size,
    width: sourceInfo.width,
    height: sourceInfo.height,
    dpi: m.dpi,
    createdAt: await copyCreatedAt(m),
    fav: false,
    trashed: false,
    // 元の画像と同じライブラリーに入れる
    libIds: [...m.libIds],
  };
  let blobRow: MediaBlob;
  let media: Media;
  if (isDefaultEdit(edit)) {
    // 何も編集していなければ、オリジナルをそのまま複製する
    const { thumb, view } = row.source ? await readImage(source) : row;
    blobRow = { id: copyId, original: source, thumb, ...(view && { view }) };
    media = base;
  } else {
    const out = await renderEdited(source, sourceInfo, edit);
    blobRow = { id: copyId, original: out.blob, thumb: out.thumb, source, sourceInfo, edit };
    media = { ...base, ...out.fields, edited: true };
  }
  await db.transaction("rw", db.media, db.mediaBlobs, async () => {
    await db.mediaBlobs.add(blobRow);
    await db.media.add(media);
  });
  return { id: copyId, undo: () => removeCopies([copyId]) };
}

/** 作った複製を取り消す（「元に戻す」用） */
async function removeCopies(ids: string[]) {
  await db.transaction("rw", db.media, db.mediaBlobs, db.libraries, async () => {
    await db.media.bulkDelete(ids);
    await db.mediaBlobs.bulkDelete(ids);
    await db.libraries
      .filter((l) => l.repMediaId !== null && ids.includes(l.repMediaId))
      .modify({ repMediaId: null });
  });
  forgetBlobUrls(ids);
}

/**
 * 画像をそのまま複製する（右クリックの「複製」）。名前は「〇〇 のコピー」、元と同じライブラリーに入れる。
 * 編集してある画像は、編集の内容とオリジナルも写すので、複製もオリジナルに戻せる
 */
export async function duplicateMedia(ids: string[], userId: string): Promise<{ ids: string[]; undo: Undo }> {
  const made: string[] = [];
  await db.transaction("rw", db.media, db.mediaBlobs, async () => {
    for (const id of ids) {
      const m = await db.media.get(id);
      const row = await db.mediaBlobs.get(id);
      if (!m || !row) continue;
      const copyId = newId();
      await db.mediaBlobs.add({ ...row, id: copyId });
      await db.media.add({
        ...m,
        id: copyId,
        uploadedBy: userId,
        name: `${m.name} のコピー`,
        createdAt: await copyCreatedAt(m),
        fav: false,
        trashed: false,
        rev: 0,
        libIds: [...m.libIds],
      });
      made.push(copyId);
    }
  });
  return { ids: made, undo: () => removeCopies(made) };
}

/**
 * 画像を、そのボックスに入っている状態にする。もう入っていればそのまま、ほかのボックスの画像はコピーを入れる
 * （名前はそのまま・ライブラリーには入れない・入れた人は userId）。
 * 返すのは、そのボックスに入っている画像の ID（並びは ids と同じ）と、コピーした枚数
 */
export async function ensureInBox(ids: string[], boxId: string, userId: string) {
  const out: string[] = [];
  let copied = 0;
  const now = Date.now();
  await db.transaction("rw", db.media, db.mediaBlobs, async () => {
    for (const [k, id] of ids.entries()) {
      const m = await db.media.get(id);
      const row = await db.mediaBlobs.get(id);
      if (!m || !row) continue;
      if (m.boxId === boxId) {
        out.push(id);
        continue;
      }
      const copyId = newId();
      await db.mediaBlobs.add({ ...row, id: copyId });
      // 同時に入れた画像も順番を保つ
      await db.media.add({ ...m, id: copyId, boxId, uploadedBy: userId, createdAt: now + k, fav: false, trashed: false, rev: 0, libIds: [] });
      out.push(copyId);
      copied++;
    }
  });
  return { ids: out, copied };
}

/** 編集をやめて、元の画像に戻す（iPhone の「オリジナルに戻す」） */
export async function revertEdit(id: string): Promise<Undo> {
  const row = await db.mediaBlobs.get(id);
  const m = await db.media.get(id);
  if (!row || !m || !row.source) return async () => {};
  const undo = await blobSnapshot(id);
  const info = await readImage(row.source);
  const s = row.sourceInfo;
  await db.transaction("rw", db.media, db.mediaBlobs, async () => {
    await db.mediaBlobs.put({ id, original: row.source!, thumb: info.thumb, ...(info.view && { view: info.view }) });
    await db.media.update(id, {
      edited: false,
      rev: (m.rev ?? 0) + 1,
      width: info.width,
      height: info.height,
      size: s?.size ?? row.source!.size,
      mime: s?.mime ?? row.source!.type,
      fileName: s?.fileName ?? m.fileName,
    });
  });
  refreshBlobUrls([id]);
  return undo;
}

// ---- ライブラリー ----

export async function createLibrary(boxId: string, name: string, parentId: string | null) {
  const siblings = childrenOf(await boxLibs(boxId), parentId);
  const lib: Library = {
    id: newId(),
    boxId,
    name,
    parentId,
    repMediaId: null,
    order: (siblings.at(-1)?.order ?? 0) + 1,
    createdAt: Date.now(),
  };
  await db.libraries.add(lib);
  return lib;
}

export async function renameLibrary(id: string, name: string) {
  await db.libraries.update(id, { name });
}

export async function setRepresentative(libId: string, mediaId: string) {
  await db.libraries.update(libId, { repMediaId: mediaId });
}

/** ライブラリーと子ライブラリーを削除。画像は消さない */
export async function deleteLibrary(boxId: string, id: string): Promise<Undo> {
  const undo = await snapshot(boxId);
  const ids = descendants(await boxLibs(boxId), id);
  await db.transaction("rw", db.libraries, db.media, async () => {
    await db.libraries.bulkDelete(ids);
    await db.media
      .where("boxId")
      .equals(boxId)
      .modify((m) => {
        m.libIds = m.libIds.filter((x) => !ids.includes(x));
      });
  });
  return undo;
}

/**
 * 「整理」：選んだ画像を、選んだライブラリーに入れる。
 * もともと入っていて選択を外したライブラリーからは、その子ライブラリーごと外す。
 */
export async function organize(boxId: string, mediaIds: string[], selected: string[], before: string[]): Promise<Undo> {
  const undo = await snapshot(boxId);
  const libs = await boxLibs(boxId);
  const removed = [...new Set(before.filter((x) => !selected.includes(x)).flatMap((x) => descendants(libs, x)))].filter(
    (x) => !selected.includes(x),
  );
  await db.media
    .where("id")
    .anyOf(mediaIds)
    .modify((m) => {
      const kept = m.libIds.filter((x) => !removed.includes(x));
      m.libIds = withAncestors(libs, [...kept, ...selected]);
    });
  return undo;
}

/** ライブラリーの「画像を追加」：選択した画像だけがこのライブラリーに入っている状態にする */
export async function setLibraryMembers(boxId: string, libId: string, selected: string[]): Promise<Undo> {
  const undo = await snapshot(boxId);
  const libs = await boxLibs(boxId);
  const below = descendants(libs, libId);
  await db.media
    .where("boxId")
    .equals(boxId)
    .modify((m) => {
      if (m.trashed) return;
      const has = m.libIds.includes(libId);
      const want = selected.includes(m.id);
      if (want && !has) m.libIds = withAncestors(libs, [...m.libIds, libId]);
      if (!want && has) m.libIds = m.libIds.filter((x) => !below.includes(x));
    });
  return undo;
}

/** ライブラリーから画像を出す（子ライブラリーからも外れる） */
export async function removeFromLibrary(boxId: string, libId: string, mediaIds: string[]): Promise<Undo> {
  const undo = await snapshot(boxId);
  const below = descendants(await boxLibs(boxId), libId);
  await db.media
    .where("id")
    .anyOf(mediaIds)
    .modify((m) => {
      m.libIds = m.libIds.filter((x) => !below.includes(x));
    });
  return undo;
}

/** 選んだ画像で新しいライブラリーを作る */
export async function groupIntoLibrary(boxId: string, mediaIds: string[], name: string, parentId: string | null) {
  const lib = await createLibrary(boxId, name, parentId);
  const libs = await boxLibs(boxId);
  await db.media
    .where("id")
    .anyOf(mediaIds)
    .modify((m) => {
      m.libIds = withAncestors(libs, [...m.libIds, lib.id]);
    });
  return lib;
}

/**
 * ライブラリーの場所を変える（別の親の子ライブラリーにする・最上位に出す）。
 * removeFromOldParent のとき、中の画像を元の親たちからも外す。
 */
export async function moveLibrary(
  boxId: string,
  id: string,
  newParentId: string | null,
  removeFromOldParent: boolean,
  /** 並べる位置（あるライブラリーの前か後ろ）。無ければ最後 */
  place?: { targetId: string; after: boolean },
): Promise<Undo> {
  const undo = await snapshot(boxId);
  const libs = await boxLibs(boxId);
  const lib = libs.find((l) => l.id === id);
  if (!lib || (newParentId && descendants(libs, id).includes(newParentId))) return undo;
  const sub = descendants(libs, id);
  const oldChain = lib.parentId ? chainIds(libs, lib.parentId) : [];
  const siblings = childrenOf(libs, newParentId);
  await db.transaction("rw", db.libraries, db.media, async () => {
    await db.libraries.update(id, { parentId: newParentId, order: (siblings.at(-1)?.order ?? 0) + 1 });
    const updated = await boxLibs(boxId);
    await db.media
      .where("boxId")
      .equals(boxId)
      .modify((m) => {
        if (!m.libIds.some((x) => sub.includes(x))) return;
        let ids = m.libIds;
        if (removeFromOldParent) ids = ids.filter((x) => !oldChain.includes(x));
        m.libIds = withAncestors(updated, ids);
      });
    if (place) {
      const sibs = childrenOf(updated, newParentId).filter((l) => l.id !== id);
      const i = sibs.findIndex((l) => l.id === place.targetId);
      const me = updated.find((l) => l.id === id)!;
      sibs.splice(i < 0 ? sibs.length : i + (place.after ? 1 : 0), 0, me);
      await Promise.all(sibs.map((l, k) => db.libraries.update(l.id, { order: k + 1 })));
    }
  });
  return undo;
}

function chainIds(libs: Library[], id: string): string[] {
  const out: string[] = [];
  let cur = libs.find((l) => l.id === id);
  while (cur) {
    out.push(cur.id);
    cur = cur.parentId ? libs.find((l) => l.id === cur!.parentId) : undefined;
  }
  return out;
}

/** 同じ親の中で並び順を入れ替える */
export async function reorderLibrary(boxId: string, id: string, direction: -1 | 1) {
  const libs = await boxLibs(boxId);
  const lib = libs.find((l) => l.id === id);
  if (!lib) return;
  const siblings = childrenOf(libs, lib.parentId);
  const i = siblings.findIndex((l) => l.id === id);
  const other = siblings[i + direction];
  if (!other) return;
  await db.transaction("rw", db.libraries, async () => {
    // 並び順が重なっていても確実に入れ替わるよう、全員に振り直す
    const next = [...siblings];
    [next[i], next[i + direction]] = [next[i + direction], next[i]];
    await Promise.all(next.map((l, k) => db.libraries.update(l.id, { order: k + 1 })));
  });
}

/** ライブラリーを別のライブラリーにまとめる（中の画像と子ライブラリーを移して、元は削除） */
export async function mergeLibrary(boxId: string, id: string, intoId: string): Promise<Undo> {
  const undo = await snapshot(boxId);
  const libs = await boxLibs(boxId);
  if (descendants(libs, id).includes(intoId)) return undo;
  await db.transaction("rw", db.libraries, db.media, async () => {
    await db.libraries.where("parentId").equals(id).modify({ parentId: intoId });
    await db.libraries.delete(id);
    const updated = await boxLibs(boxId);
    await db.media
      .where("libIds")
      .equals(id)
      .modify((m) => {
        m.libIds = withAncestors(
          updated,
          m.libIds.filter((x) => x !== id).concat(intoId),
        );
      });
  });
  return undo;
}
