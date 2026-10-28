"use client";

import Dexie from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect } from "react";
import { APPEND, autoName, groupKey, madeOf, planExisting, planImport, stripExt } from "@/lib/media/autoname";
import { forgetBlobUrls, refreshBlobUrls } from "@/lib/media/blob-url";
import { isDefaultEdit, renderEdit, type ImageEdit } from "@/lib/media/edit";
import type { ImportFile } from "@/lib/media/folders";
import { decodeImage, isImageFile, makeThumb, readImage, readRecordedDate } from "@/lib/media/image";
import { PSD_MIME } from "@/lib/media/psd";
import { childrenOf, descendants, withAncestors } from "@/lib/media/logic";
import { loadBlobRow, loadShownBlob } from "@/lib/media/remote";
import { boxAccess, uploadBoxForRoom } from "./boxes";
import { speakerName } from "./chat";
import { renumber, renumberBoxes } from "./renumber";
import { fetchReferencedMedia } from "./rowSync";
import { db, newId, type Library, type Media, type MediaBlob } from "./db";

export type Undo = () => Promise<void>;

/** 画像のファイルの複製（自分の画像として R2 に置き直すので、取ってきた印は外す） */
function ownCopy(row: MediaBlob, id: string): MediaBlob {
  const { remoteRev: _remote, ...rest } = row;
  void _remote;
  return { ...rest, id };
}

/** ボックスの画像。完全に削除して小さい画像だけ残したもの（gone）は入れない */
export function useMedia(boxId: string) {
  return useLiveQuery(async () => (await db.media.where("boxId").equals(boxId).sortBy("createdAt")).filter((m) => !m.gone), [boxId]);
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
  const found = useLiveQuery(async () => {
    const rows = await db.media.bulkGet([...new Set(ids)]);
    return new Map(rows.flatMap((m) => (m ? [[m.id, m] as const] : [])));
  }, [key]); // ids は中身（key）で比べる
  // Supabase 版：ブラウザの中に無い画像（DM で送られた画像など）は、貼られている発言やノートを見られるなら引いてくる
  useEffect(() => {
    if (!found) return;
    const missing = [...new Set(ids)].filter((id) => id && !found.has(id));
    if (missing.length) void fetchReferencedMedia(missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, key]);
  return found;
}

export function useLibraries(boxId: string) {
  return useLiveQuery(() => db.libraries.where("boxId").equals(boxId).toArray(), [boxId]);
}

// ---- 元に戻す：操作の前にボックスのライブラリーと画像の所属を丸ごと控えておく ----

async function snapshot(boxId: string): Promise<Undo> {
  const libs = await db.libraries.where("boxId").equals(boxId).toArray();
  // 自動の名前の番号も控える（ゴミ箱に入れると、残りの番号が詰まるため）
  const media = (await db.media.where("boxId").equals(boxId).toArray()).map((m) => ({
    id: m.id,
    libIds: [...m.libIds],
    trashed: m.trashed,
    fav: m.fav,
    name: m.name,
    title: m.title,
    seq: m.seq,
    madeAt: m.madeAt,
  }));
  return async () => {
    await db.transaction("rw", db.libraries, db.media, async () => {
      await db.libraries.where("boxId").equals(boxId).delete();
      await db.libraries.bulkAdd(libs);
      for (const m of media) {
        const { id, ...rest } = m;
        await db.media.update(id, rest);
      }
    });
  };
}

/** いくつかのボックスを控える（選んだ画像が別々のボックスにあるとき） */
async function snapshotOf(rows: Media[]): Promise<Undo> {
  const undos = await Promise.all([...new Set(rows.map((m) => m.boxId))].map(snapshot));
  return async () => {
    for (const undo of undos) await undo();
  };
}

async function boxLibs(boxId: string) {
  return db.libraries.where("boxId").equals(boxId).toArray();
}

// ---- 自動の名前（20250101_誕生日・20250101_誕生日_01） ----

/** ボックスの中の、まとまりごとの今の枚数（入れる画像に続きの番号を付けるため。番号は詰めてあるので、一番大きい番号と同じ） */
async function groupSizes(boxId: string) {
  const out = new Map<string, number>();
  await db.media
    .where("boxId")
    .equals(boxId)
    .each((m) => {
      if (m.title === undefined || m.trashed) return;
      const key = groupKey(madeOf(m), m.title);
      out.set(key, (out.get(key) ?? 0) + 1);
    });
  return out;
}

/** 今ある画像の、中に記録された撮影日・作成日（無ければファイルの更新日時）。編集した画像は編集前の画像から読む */
async function recordedDates(rows: Media[]) {
  const out = new Map<string, number | null>();
  for (const m of rows) {
    const row = await loadBlobRow(m.id).catch(() => undefined);
    const file = row?.source ?? row?.original;
    const modified = file instanceof File && file.lastModified ? file.lastModified : null;
    out.set(m.id, file ? ((await readRecordedDate(file)) ?? modified) : null);
  }
  return out;
}

/**
 * 画像のタイトルを変えて、名前を付け直す（名前の変更・プレビュー欄のタイトル・まとめてタイトルを変更）。
 * 自動の名前でなかった画像も、この形にする。加わったまとまりでは最後の番号になる（選んだ画像どうしは今の番号の順）
 */
export async function setTitle(ids: string[], title: string): Promise<Undo> {
  const rows = (await db.media.bulkGet(ids)).filter((m): m is Media => !!m && m.title !== title);
  const recorded = await recordedDates(rows.filter((m) => m.title === undefined && m.madeAt === undefined));
  const undo = await snapshotOf(rows);
  await db.transaction("rw", db.media, async () => {
    for (const m of rows) {
      const madeAt = m.title === undefined ? planExisting(m, recorded.get(m.id) ?? null).madeAt : madeOf(m);
      await db.media.update(m.id, { title, madeAt, seq: APPEND + (m.seq ?? 0) });
    }
  });
  await renumberBoxes(rows);
  return undo;
}

/** 今ある画像に自動の名前を付ける（右クリックの「名前を自動で付ける」）。タイトルは今の名前から日付を除いたもの */
export async function applyAutoName(ids: string[]): Promise<Undo> {
  const rows = (await db.media.bulkGet(ids)).filter((m): m is Media => !!m && m.title === undefined);
  const recorded = await recordedDates(rows.filter((m) => m.madeAt === undefined));
  const undo = await snapshotOf(rows);
  await db.transaction("rw", db.media, async () => {
    // 番号は、今の並び（追加した順）で振る
    for (const m of [...rows].sort((a, b) => a.createdAt - b.createdAt)) await db.media.update(m.id, { ...planExisting(m, recorded.get(m.id) ?? null), seq: APPEND });
  });
  await renumberBoxes(rows);
  return undo;
}

/** 制作日を変える（プレビュー欄の制作日）。自動の名前の画像は、名前の日付も変わり、その日のまとまりの最後の番号になる */
export async function setMadeAt(id: string, madeAt: number) {
  const m = await db.media.get(id);
  if (!m || m.madeAt === madeAt) return;
  await db.media.update(id, m.title === undefined ? { madeAt } : { madeAt, seq: APPEND });
  if (m.title !== undefined) await renumber(m.boxId);
}

// ---- 画像 ----

/**
 * フォルダごと入れた画像のための、フォルダと同じ並びのライブラリー（名前はフォルダ名のまま）。
 * 同じ所に同じ名前のライブラリーがあれば、それを使う。フォルダの並びごとに、上から順のライブラリーの ID を返す（画像はそのすべてに入れる）
 */
async function folderLibraries(boxId: string, paths: string[][]) {
  const chains = new Map<string, string[]>();
  const tops: Library[] = [];
  await db.transaction("rw", db.libraries, async () => {
    const libs = await boxLibs(boxId);
    for (const path of paths) {
      const key = path.join("/");
      if (chains.has(key)) continue;
      const ids: string[] = [];
      let parentId: string | null = null;
      for (const name of path) {
        let lib = libs.find((l) => l.parentId === parentId && l.name === name);
        if (!lib) {
          lib = { id: newId(), boxId, name, parentId, repMediaId: null, order: (childrenOf(libs, parentId).at(-1)?.order ?? 0) + 1, createdAt: Date.now() };
          libs.push(lib);
          await db.libraries.add(lib);
        }
        if (parentId === null && !tops.includes(lib)) tops.push(lib);
        ids.push(lib.id);
        parentId = lib.id;
      }
      chains.set(key, ids);
    }
  });
  return { libIdsOf: (path: string[] | undefined) => (path?.length ? (chains.get(path.join("/")) ?? []) : []), tops };
}

/**
 * 画像を入れる。制作日はいつも記録し、ボックスの設定で「名前を自動で付ける」がオンなら、名前を「20250101_誕生日」の形にする
 * （同じ制作日・同じタイトルが2枚以上なら「_01」から番号を付ける）
 * （フォルダごと入れたらフォルダ名をタイトルにし、フォルダの中の名前の順に番号を振る）
 */
export async function uploadFiles(boxId: string, userId: string, files: (File | ImportFile)[]) {
  const ids: string[] = [];
  let failed = 0;
  // 入れる人や端末に関係なく、入れる先のボックスの設定に従う
  const auto = !!(await db.mediaBoxes.get(boxId))?.autoName;
  const text = (a: string, b: string) => a.localeCompare(b, "ja", { numeric: true });
  let items = files.map((f) => (f instanceof File ? { file: f } : f));
  if (auto) items = [...items].sort((a, b) => text((a.folders ?? []).join("/"), (b.folders ?? []).join("/")) || text(a.file.name, b.file.name));
  // 先に、すべての画像の制作日とタイトルを決める（同じまとまりが2枚以上になるかで、番号を付けるかが決まるため）
  const plans: (ReturnType<typeof planImport> | null)[] = [];
  for (const { file, folder } of items)
    plans.push(isImageFile(file) ? planImport({ fileName: file.name, folder, embedded: await readRecordedDate(file), modified: file.lastModified || null }) : null);
  const seqs = auto ? await groupSizes(boxId) : null;
  const totals = new Map(seqs);
  if (seqs) for (const p of plans) if (p) totals.set(groupKey(p.madeAt, p.title), (totals.get(groupKey(p.madeAt, p.title)) ?? 0) + 1);
  // フォルダごと入れた画像は、フォルダと同じ並びのライブラリーに入れる（設定に関係なく）
  const folderLibs = await folderLibraries(
    boxId,
    items.flatMap((it, i) => (plans[i] && it.folders?.length ? [it.folders] : [])),
  );
  for (const [i, { file, folders }] of items.entries()) {
    const plan = plans[i];
    if (!plan) {
      failed++;
      continue;
    }
    try {
      const info = await readImage(file);
      let naming: Pick<Media, "name" | "title" | "seq"> = { name: stripExt(file.name) };
      if (seqs) {
        const key = groupKey(plan.madeAt, plan.title);
        const seq = (seqs.get(key) ?? 0) + 1;
        seqs.set(key, seq);
        naming = { name: autoName(plan.madeAt, plan.title, totals.get(key)! > 1 ? seq : undefined), title: plan.title, seq };
      }
      const id = newId();
      await db.transaction("rw", db.media, db.mediaBlobs, async () => {
        await db.mediaBlobs.add({ id, original: file, thumb: info.thumb, ...(info.view && { view: info.view }) });
        await db.media.add({
          id,
          boxId,
          uploadedBy: userId,
          ...naming,
          madeAt: plan.madeAt,
          fileName: file.name,
          mime: info.view ? PSD_MIME : file.type,
          size: file.size,
          width: info.width,
          height: info.height,
          dpi: info.dpi,
          createdAt: Date.now() + ids.length, // 同時に入れた画像も順番を保つ
          fav: false,
          trashed: false,
          libIds: folderLibs.libIdsOf(folders),
        });
      });
      ids.push(id);
    } catch {
      failed++;
    }
  }
  // 前からあった1枚に番号が付く（2枚目が入った）まとまりや、読めなかった画像で間が空いたまとまりを、ここで整える
  if (auto && ids.length) await renumber(boxId);
  // libs：フォルダから作った（使った）一番上のライブラリー
  return { ids, failed, libs: folderLibs.tops };
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
    // イメージチャット・再現チャットは、話者の名前（イメージユーザーの ID などのままにしない）
    const chat = await db.chats.get(chatId);
    const speakers = new Map<string, string | undefined>();
    for (const s of new Set(messages.flatMap((m) => (m.speaker ? [m.speaker] : [])))) speakers.set(s, await speakerName(s, chat));
    const media = new Map((await db.media.bulkGet([...new Set(messages.flatMap((m) => m.mediaIds))])).flatMap((m) => (m ? [[m.id, m] as const] : [])));
    const out: SentImage[] = [];
    const seen = new Set<string>();
    for (const msg of messages) {
      for (const id of msg.mediaIds) {
        const m = media.get(id);
        if (!m || seen.has(id)) continue;
        seen.add(id);
        out.push({ media: m, by: (msg.speaker ? speakers.get(msg.speaker) : undefined) ?? people.get(msg.authorId) ?? "退出した人", at: msg.createdAt });
      }
    }
    return out;
  }, [chatId]);
}

/** 名前を変える。自動で名前を付けた画像は、書いたものをタイトルにして名前を付け直す */
export async function renameMedia(id: string, name: string) {
  const m = await db.media.get(id);
  if (m?.title !== undefined) await setTitle([id], name);
  else await db.media.update(id, { name });
}

export async function setFav(ids: string[], fav: boolean) {
  await db.media.where("id").anyOf(ids).modify({ fav });
}

export async function moveToTrash(boxId: string, ids: string[]): Promise<Undo> {
  const undo = await snapshot(boxId);
  await db.media.where("id").anyOf(ids).modify({ trashed: true });
  // 自動の名前の番号は、抜けた所を詰める
  await renumber(boxId);
  return undo;
}

/** ゴミ箱から戻す。自動の名前の画像は、そのときのまとまりの最後の番号になる */
export async function restoreFromTrash(ids: string[]) {
  await db.media
    .where("id")
    .anyOf(ids)
    .modify((m: Media) => {
      m.trashed = false;
      if (m.title !== undefined) m.seq = APPEND + (m.seq ?? 0);
    });
  await renumberBoxes(await db.media.bulkGet(ids));
}

/**
 * 完全に削除。消せるのは、画像が入っているボックスの持ち主と、編集もできる共有の人（見るだけの人の分は残す）。
 * チャットやデータベース・ノートで使われている画像は、元の画像を消して一覧用の小さい画像（WebP）だけ残す（gone）。
 * メディアの一覧からは消えるが、チャットなどでは見られて、拡大もできる
 */
export async function deleteForever(ids: string[], userId: string) {
  const rows = (await db.media.bulkGet(ids)).filter((m): m is Media => !!m);
  const access = new Map<string, boolean>();
  for (const boxId of new Set(rows.map((m) => m.boxId))) access.set(boxId, ["owner", "edit"].includes((await boxAccess(boxId, userId)) ?? ""));
  const allowed = rows.filter((m) => access.get(m.boxId));
  const ok = allowed.map((m) => m.id);
  const used = await usedElsewhere(ok);
  const thumbs = new Map<string, Blob>();
  for (const id of used) {
    const thumb = (await db.mediaBlobs.get(id))?.thumb ?? (await loadShownBlob(id, "thumb"));
    if (thumb instanceof Blob) thumbs.set(id, thumb);
  }
  const gone = ok.filter((id) => !thumbs.has(id));
  await db.transaction("rw", db.media, db.mediaBlobs, db.libraries, async () => {
    await db.media.bulkDelete(gone);
    await db.mediaBlobs.bulkDelete(gone);
    for (const m of allowed) {
      const thumb = thumbs.get(m.id);
      if (!thumb) continue;
      // 小さい画像がそのまま「元の画像」になる。名前の番号からも外れるよう、ゴミ箱に入った扱いにしておく。
      // rev は変えない（R2 には今の rev の小さい画像がもうあるので、置き直さずにそれだけ残す）
      await db.media.update(m.id, { gone: true, trashed: true, fav: false, libIds: [], edited: false, mime: thumb.type || "image/webp", size: thumb.size });
      // ほかの人が入れた画像は、R2 から取ってきたものと同じ扱いにする（自分のブラウザから R2 に置き直さない）
      await db.mediaBlobs.put({ id: m.id, original: thumb, thumb, ...(m.uploadedBy !== userId && { remoteRev: m.rev ?? 0 }) });
    }
    await db.libraries
      .filter((l) => l.repMediaId !== null && ok.includes(l.repMediaId))
      .modify({ repMediaId: null });
  });
  forgetBlobUrls(gone);
  refreshBlobUrls([...thumbs.keys()]);
  return { deleted: ok.length, skipped: ids.length - ok.length, kept: thumbs.size };
}

/** チャットの発言・データベースのページ（項目・アイコン）・ノート・ウィンドウ・イメージユーザーのどれかで使われている画像 */
async function usedElsewhere(ids: string[]): Promise<Set<string>> {
  const used = new Set<string>();
  if (!ids.length) return used;
  const want = new Set(ids);
  await db.messages.each((msg) => {
    for (const id of msg.mediaIds) if (want.has(id)) used.add(id);
  });
  // 画像の ID は重ならないので、行を文字にして探す（ブロックの中など、どこに入っていても見つかる）
  const tables = [db.dbPages, db.databases, db.notes, db.windows, db.imageUsers] as Dexie.Table<unknown>[];
  for (const table of tables) {
    await table.each((row) => {
      const text = JSON.stringify(row);
      for (const id of ids) if (!used.has(id) && text.includes(id)) used.add(id);
    });
  }
  return used;
}

// ---- 編集（元の画像は source に残しておき、いつでも戻せる） ----

/** 編集の前の状態に戻す「元に戻す」を作る */
async function blobSnapshot(id: string): Promise<Undo> {
  const row = await loadBlobRow(id);
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
  const row = await loadBlobRow(id);
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
  const row = await loadBlobRow(id);
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
    // 自動の名前の画像は、同じタイトルの最後の番号にする（振り直しで名前が決まる）
    ...(m.madeAt !== undefined && { madeAt: m.madeAt }),
    ...(m.title !== undefined && { title: m.title, seq: APPEND }),
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
  if (media.title !== undefined) await renumber(media.boxId);
  return { id: copyId, undo: () => removeCopies([copyId]) };
}

/** 作った複製を取り消す（「元に戻す」用） */
async function removeCopies(ids: string[]) {
  const rows = await db.media.bulkGet(ids);
  await db.transaction("rw", db.media, db.mediaBlobs, db.libraries, async () => {
    await db.media.bulkDelete(ids);
    await db.mediaBlobs.bulkDelete(ids);
    await db.libraries
      .filter((l) => l.repMediaId !== null && ids.includes(l.repMediaId))
      .modify({ repMediaId: null });
  });
  forgetBlobUrls(ids);
  await renumberBoxes(rows);
}

/**
 * 画像をそのまま複製する（右クリックの「複製」）。名前は「〇〇 のコピー」、元と同じライブラリーに入れる。
 * 自動の名前の画像は、同じタイトルの最後の番号になる。
 * 編集してある画像は、編集の内容とオリジナルも写すので、複製もオリジナルに戻せる
 */
export async function duplicateMedia(ids: string[], userId: string): Promise<{ ids: string[]; undo: Undo }> {
  const made: string[] = [];
  // ほかの人の画像は、先に R2 から取ってくる（書き込みのまとまりの中では取りに行けないため）
  for (const id of ids) await loadBlobRow(id);
  await db.transaction("rw", db.media, db.mediaBlobs, async () => {
    for (const id of ids) {
      const m = await db.media.get(id);
      const row = await db.mediaBlobs.get(id);
      if (!m || !row) continue;
      const copyId = newId();
      await db.mediaBlobs.add(ownCopy(row, copyId));
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
        ...(m.title !== undefined && { seq: APPEND }),
      });
      made.push(copyId);
    }
  });
  await renumberBoxes(await db.media.bulkGet(made));
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
  // コピーする画像（ほかのボックスの画像）は、先に R2 から取ってくる（書き込みのまとまりの中では取りに行けないため）
  for (const m of await db.media.bulkGet(ids)) if (m && m.boxId !== boxId) await loadBlobRow(m.id);
  await db.transaction("rw", db.media, db.mediaBlobs, async () => {
    for (const [k, id] of ids.entries()) {
      const m = await db.media.get(id);
      if (!m) continue;
      if (m.boxId === boxId) {
        out.push(id);
        continue;
      }
      const row = await db.mediaBlobs.get(id);
      if (!row) continue;
      const copyId = newId();
      await db.mediaBlobs.add(ownCopy(row, copyId));
      // 同時に入れた画像も順番を保つ。自動の名前の画像は、入れた先のボックスで最後の番号になる
      await db.media.add({ ...m, id: copyId, boxId, uploadedBy: userId, createdAt: now + k, fav: false, trashed: false, rev: 0, libIds: [], ...(m.title !== undefined && { seq: APPEND }) });
      out.push(copyId);
      copied++;
    }
  });
  if (copied) await renumber(boxId);
  return { ids: out, copied };
}

/** 編集をやめて、元の画像に戻す（iPhone の「オリジナルに戻す」） */
export async function revertEdit(id: string): Promise<Undo> {
  const row = await loadBlobRow(id);
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
