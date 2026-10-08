"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { forgetBlobUrls } from "@/lib/media/blob-url";
import { readImage } from "@/lib/media/image";
import { childrenOf, descendants, withAncestors } from "@/lib/media/logic";
import { db, newId, type Library, type Media } from "./db";

export type Undo = () => Promise<void>;

export function useMedia(roomId: string) {
  return useLiveQuery(() => db.media.where("roomId").equals(roomId).sortBy("createdAt"), [roomId]);
}

export function useLibraries(roomId: string) {
  return useLiveQuery(() => db.libraries.where("roomId").equals(roomId).toArray(), [roomId]);
}

// ---- 元に戻す：操作の前にルームのライブラリーと画像の所属を丸ごと控えておく ----

async function snapshot(roomId: string): Promise<Undo> {
  const libs = await db.libraries.where("roomId").equals(roomId).toArray();
  const media = (await db.media.where("roomId").equals(roomId).toArray()).map((m) => ({
    id: m.id,
    libIds: [...m.libIds],
    trashed: m.trashed,
    fav: m.fav,
  }));
  return async () => {
    await db.transaction("rw", db.libraries, db.media, async () => {
      await db.libraries.where("roomId").equals(roomId).delete();
      await db.libraries.bulkAdd(libs);
      for (const m of media) await db.media.update(m.id, { libIds: m.libIds, trashed: m.trashed, fav: m.fav });
    });
  };
}

async function roomLibs(roomId: string) {
  return db.libraries.where("roomId").equals(roomId).toArray();
}

// ---- 画像 ----

export async function uploadFiles(roomId: string, userId: string, files: File[]) {
  const ids: string[] = [];
  let failed = 0;
  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      failed++;
      continue;
    }
    try {
      const info = await readImage(file);
      const id = newId();
      await db.transaction("rw", db.media, db.mediaBlobs, async () => {
        await db.mediaBlobs.add({ id, original: file, thumb: info.thumb });
        await db.media.add({
          id,
          roomId,
          uploadedBy: userId,
          name: file.name.replace(/\.\w+$/, ""),
          fileName: file.name,
          mime: file.type,
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

export async function renameMedia(id: string, name: string) {
  await db.media.update(id, { name });
}

export async function setFav(ids: string[], fav: boolean) {
  await db.media.where("id").anyOf(ids).modify({ fav });
}

export async function moveToTrash(roomId: string, ids: string[]): Promise<Undo> {
  const undo = await snapshot(roomId);
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

// ---- ライブラリー ----

export async function createLibrary(roomId: string, name: string, parentId: string | null) {
  const siblings = childrenOf(await roomLibs(roomId), parentId);
  const lib: Library = {
    id: newId(),
    roomId,
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

/** ライブラリーと小ライブラリーを削除。画像は消さない */
export async function deleteLibrary(roomId: string, id: string): Promise<Undo> {
  const undo = await snapshot(roomId);
  const ids = descendants(await roomLibs(roomId), id);
  await db.transaction("rw", db.libraries, db.media, async () => {
    await db.libraries.bulkDelete(ids);
    await db.media
      .where("roomId")
      .equals(roomId)
      .modify((m) => {
        m.libIds = m.libIds.filter((x) => !ids.includes(x));
      });
  });
  return undo;
}

/**
 * 「整理」：選んだ画像を、選んだライブラリーに入れる。
 * もともと入っていて選択を外したライブラリーからは、その小ライブラリーごと外す。
 */
export async function organize(roomId: string, mediaIds: string[], selected: string[], before: string[]): Promise<Undo> {
  const undo = await snapshot(roomId);
  const libs = await roomLibs(roomId);
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
export async function setLibraryMembers(roomId: string, libId: string, selected: string[]): Promise<Undo> {
  const undo = await snapshot(roomId);
  const libs = await roomLibs(roomId);
  const below = descendants(libs, libId);
  await db.media
    .where("roomId")
    .equals(roomId)
    .modify((m) => {
      if (m.trashed) return;
      const has = m.libIds.includes(libId);
      const want = selected.includes(m.id);
      if (want && !has) m.libIds = withAncestors(libs, [...m.libIds, libId]);
      if (!want && has) m.libIds = m.libIds.filter((x) => !below.includes(x));
    });
  return undo;
}

/** ライブラリーから画像を出す（小ライブラリーからも外れる） */
export async function removeFromLibrary(roomId: string, libId: string, mediaIds: string[]): Promise<Undo> {
  const undo = await snapshot(roomId);
  const below = descendants(await roomLibs(roomId), libId);
  await db.media
    .where("id")
    .anyOf(mediaIds)
    .modify((m) => {
      m.libIds = m.libIds.filter((x) => !below.includes(x));
    });
  return undo;
}

/** 選んだ画像で新しいライブラリーを作る */
export async function groupIntoLibrary(roomId: string, mediaIds: string[], name: string, parentId: string | null) {
  const lib = await createLibrary(roomId, name, parentId);
  const libs = await roomLibs(roomId);
  await db.media
    .where("id")
    .anyOf(mediaIds)
    .modify((m) => {
      m.libIds = withAncestors(libs, [...m.libIds, lib.id]);
    });
  return lib;
}

/**
 * ライブラリーの場所を変える（別の親の小ライブラリーにする・最上位に出す）。
 * removeFromOldParent のとき、中の画像を元の親たちからも外す。
 */
export async function moveLibrary(
  roomId: string,
  id: string,
  newParentId: string | null,
  removeFromOldParent: boolean,
  /** 並べる位置（あるライブラリーの前か後ろ）。無ければ最後 */
  place?: { targetId: string; after: boolean },
): Promise<Undo> {
  const undo = await snapshot(roomId);
  const libs = await roomLibs(roomId);
  const lib = libs.find((l) => l.id === id);
  if (!lib || (newParentId && descendants(libs, id).includes(newParentId))) return undo;
  const sub = descendants(libs, id);
  const oldChain = lib.parentId ? chainIds(libs, lib.parentId) : [];
  const siblings = childrenOf(libs, newParentId);
  await db.transaction("rw", db.libraries, db.media, async () => {
    await db.libraries.update(id, { parentId: newParentId, order: (siblings.at(-1)?.order ?? 0) + 1 });
    const updated = await roomLibs(roomId);
    await db.media
      .where("roomId")
      .equals(roomId)
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
export async function reorderLibrary(roomId: string, id: string, direction: -1 | 1) {
  const libs = await roomLibs(roomId);
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

/** ライブラリーを別のライブラリーにまとめる（中の画像と小ライブラリーを移して、元は削除） */
export async function mergeLibrary(roomId: string, id: string, intoId: string): Promise<Undo> {
  const undo = await snapshot(roomId);
  const libs = await roomLibs(roomId);
  if (descendants(libs, id).includes(intoId)) return undo;
  await db.transaction("rw", db.libraries, db.media, async () => {
    await db.libraries.where("parentId").equals(id).modify({ parentId: intoId });
    await db.libraries.delete(id);
    const updated = await roomLibs(roomId);
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
