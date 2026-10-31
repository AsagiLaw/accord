"use client";

import { useSyncExternalStore } from "react";
import { choose, confirmAction, promptText, toast } from "@/components/ui/overlay";
import type { Library, Media } from "@/lib/local/db";
import {
  addToLibrary,
  applyAutoName,
  createLibrary,
  deleteForever,
  duplicateMedia,
  deleteLibrary,
  groupIntoLibrary,
  mergeLibrary,
  moveLibrary,
  moveToLibrary,
  moveToTrash,
  movableMedia,
  pastableMedia,
  removeFromLibrary,
  renameLibrary,
  reorderLibrary,
  restoreFromTrash,
  revertEdit,
  saveEdit,
  saveEditAsCopy,
  setTitle,
  uploadFiles,
  type Undo,
} from "@/lib/local/media";
import { canPickSaveLocation, copyImage, downloadOriginals, saveFileAs, saveZip, type ZipItem } from "@/lib/media/export";
import type { ImageEdit } from "@/lib/media/edit";
import type { ImportFile } from "@/lib/media/folders";
import { chain, descendants } from "@/lib/media/logic";

// 確認・お知らせ・元に戻すを含む、画面からの操作の流れ

const undoable = (message: string, undo: Undo) => toast(message, { label: "元に戻す", run: () => void undo() });

/**
 * 画像を入れる。open は入れた先を開く（ライブラリーの ID。無ければ未整理）。
 * フォルダごと入れた画像は、フォルダ名のライブラリーに入るので、そのライブラリーを開けるようにする
 */
export async function uploadFlow(boxId: string, userId: string, files: (File | ImportFile)[], open: (libId?: string) => void) {
  if (!files.length) return;
  toast(`${files.length}枚を読み込み中…`);
  const { ids, failed, libs } = await uploadFiles(boxId, userId, files);
  if (!ids.length) return toast("画像を追加できませんでした");
  const into = libs.length ? `（ライブラリー「${libs[0].name}」${libs.length > 1 ? `ほか${libs.length - 1}つ` : ""}）` : "";
  const skipped = failed ? `（${failed}枚は読み込めない形式のため追加できません）` : "";
  toast(
    `${ids.length}枚を追加しました${into}${skipped}`,
    libs.length ? { label: "開く", run: () => open(libs[0].id) } : { label: "整理する", run: () => open() },
  );
}

/** 選んだ画像のタイトルをまとめて変える。番号は制作日ごとに付け直す（自動の名前でなかった画像も、この形になる） */
export async function retitleFlow(list: Media[]) {
  if (!list.length) return;
  const titles = new Set(list.map((m) => m.title));
  const current = titles.size === 1 ? ([...titles][0] ?? "") : "";
  const title = (await promptText(`${list.length}枚のタイトルを変更`, current, "タイトル"))?.trim();
  if (!title) return;
  const undo = await setTitle(
    list.map((m) => m.id),
    title,
  );
  undoable(`${list.length}枚のタイトルを「${title}」にしました`, undo);
}

/** 今ある画像に、自動の名前（20250101_タイトル。同じものが2枚以上なら _01 から番号付き）を付ける */
export async function autoNameFlow(list: Media[]) {
  const ids = list.filter((m) => m.title === undefined).map((m) => m.id);
  if (!ids.length) return;
  undoable(`${ids.length}枚に名前を付けました`, await applyAutoName(ids));
}

/** 元の画像をクリップボードにコピーする（Discord などに Ctrl+V で貼れる）。コピーできるのは1枚だけ */
export async function copyImageFlow(list: Media[]) {
  if (list.length !== 1) {
    toast("コピーできるのは1枚だけです。複数枚は右クリックの「ダウンロード」を使ってください");
    return;
  }
  try {
    await copyImage(list[0]);
    toast("画像をコピーしました");
  } catch {
    toast("画像をコピーできませんでした");
  }
}

/**
 * 元の画像をダウンロードする。1枚なら「名前を付けて保存」、複数なら1つの ZIP にまとめて「名前を付けて保存」。
 * 保存先を選べないブラウザでは、ブラウザのダウンロードのフォルダに入れる。ZIP の名前は「日付_メディアファイル.zip」
 */
export async function downloadFlow(list: Media[]) {
  if (!list.length) return;
  try {
    if (list.length === 1) {
      if (!canPickSaveLocation()) return await downloadOriginals(list);
      if (await saveFileAs(list[0])) toast("保存しました");
      return;
    }
    const saved = await saveZip(
      list.map((m) => ({ m })),
      zipBaseName("メディアファイル"),
      () => toast(`${list.length}枚を ZIP にまとめています…`),
    );
    if (saved) toast(`${list.length}枚を ZIP にまとめて保存しました`);
  } catch (err) {
    toast(`保存できませんでした（${(err as Error).message}）`);
  }
}

/** ZIP の名前：「2026-10-12_納品」のように、今日の日付の後ろに名前を付ける */
const zipBaseName = (name: string) => `${new Date().toLocaleDateString("sv-SE")}_${name}`;

/**
 * ライブラリーの画像を全て、1つの ZIP にまとめて書き出す（「名前を付けて保存」の画面）。ゴミ箱の画像は入れない。
 * 子ライブラリーの画像は、ZIP の中の子ライブラリーの名前のフォルダに入れる（いくつかの場所に入っている画像は、それぞれに入れる）
 */
export async function exportLibraryFlow(lib: Library, libs: Library[], media: Media[]) {
  const depth = chain(libs, lib.id).length;
  const items: ZipItem[] = [];
  for (const id of descendants(libs, lib.id)) {
    const folder = chain(libs, id)
      .slice(depth)
      .map((l) => l.name);
    for (const m of media) {
      if (m.trashed || !m.libIds.includes(id)) continue;
      items.push(folder.length ? { m, folder } : { m });
    }
  }
  const n = new Set(items.map((x) => x.m.id)).size;
  if (!n) return toast(`「${lib.name}」に画像がありません`);
  try {
    // 画像を数えたらすぐ保存の画面を開く（押した直後でないと開けないため、間に待つ処理を入れない）
    const saved = await saveZip(items, zipBaseName(lib.name), () => toast(`「${lib.name}」の画像${n}枚を ZIP にまとめています…`));
    if (saved) toast(`「${lib.name}」の画像${n}枚を書き出しました`);
  } catch (err) {
    toast(`書き出せませんでした（${(err as Error).message}）`);
  }
}

/** 編集を保存する。保存できたら true */
export async function saveEditFlow(id: string, edit: ImageEdit) {
  try {
    undoable("編集を保存しました", await saveEdit(id, edit));
    return true;
  } catch (err) {
    toast(`保存できませんでした（${(err as Error).message}）`);
    return false;
  }
}

/** 画像をそのまま複製する（右クリックの「複製」） */
export async function duplicateFlow(ids: string[], userId: string) {
  if (!ids.length) return;
  try {
    const { ids: made, undo } = await duplicateMedia(ids, userId);
    undoable(made.length === 1 ? "複製しました" : `${made.length}枚を複製しました`, undo);
  } catch (err) {
    toast(`複製できませんでした（${(err as Error).message}）`);
  }
}

/** 編集を、新しい画像（複製）として保存する。元の画像はそのまま。保存できたら true */
export async function saveCopyFlow(id: string, edit: ImageEdit, userId: string) {
  try {
    const { undo } = await saveEditAsCopy(id, edit, userId);
    undoable("複製として保存しました", undo);
    return true;
  } catch (err) {
    toast(`保存できませんでした（${(err as Error).message}）`);
    return false;
  }
}

/** 編集した画像を、元の画像に戻す（確かめずに。お知らせから元に戻せる） */
export async function revertEditNow(m: Media) {
  undoable("オリジナルに戻しました", await revertEdit(m.id));
}

/** 編集した画像を、元の画像に戻す（確かめてから） */
export async function revertEditFlow(m: Media) {
  const ok = await confirmAction(
    "オリジナルに戻します",
    "オリジナルに戻す",
    `「${m.name}」に加えた編集をすべて取り除きます。`,
  );
  if (!ok) return false;
  await revertEditNow(m);
  return true;
}

export async function trashFlow(boxId: string, ids: string[]) {
  undoable(`${ids.length}枚をゴミ箱へ移動しました`, await moveToTrash(boxId, ids));
}

export async function restoreFlow(ids: string[]) {
  await restoreFromTrash(ids);
  toast(`${ids.length}枚を元に戻しました`);
}

export async function deleteForeverFlow(ids: string[], userId: string) {
  const ok = await confirmAction(
    `${ids.length}枚を完全に削除します`,
    "完全に削除",
    "元に戻せません。チャットやデータベースで使っている画像は、そこで見られるよう小さい画像だけ残ります。",
  );
  if (!ok) return;
  const r = await deleteForever(ids, userId);
  if (!r.deleted) {
    toast("完全に削除できるのは、ボックスの持ち主と、編集もできる共有の人だけです");
    return;
  }
  toast(`${r.deleted}枚を完全に削除しました${r.kept ? `（使われている${r.kept}枚は小さい画像だけ残しました）` : ""}`);
}

export async function removeFromLibraryFlow(boxId: string, lib: Library, ids: string[]) {
  undoable(`${ids.length}枚を「${lib.name}」から出しました`, await removeFromLibrary(boxId, lib.id, ids));
}

/**
 * Delete キー。2か所以上に入っている画像があれば、ここから出すか全部の場所から消すかを確かめる。
 * 「ここ」が無い所（lib が無い：すべて・検索の結果など）と、1か所だけの画像は、そのままゴミ箱へ入れる。やめなければ true
 */
export async function deleteKeyFlow(boxId: string, list: Media[], lib?: Library) {
  const ids = list.map((m) => m.id);
  const shared = list.filter((m) => m.libIds.length > 1).map((m) => m.id);
  if (!lib || !shared.length) {
    await trashFlow(boxId, ids);
    return true;
  }
  const only = ids.filter((id) => !shared.includes(id));
  const i = await choose(`${ids.length}枚を消します`, [
    { label: "ここから出す", detail: `ほかのライブラリーには残ります${only.length ? `（1か所だけの${only.length}枚はゴミ箱へ）` : ""}` },
    { label: "全部の場所から消す", detail: "ゴミ箱へ移動します", danger: true },
  ]);
  if (i === null) return false;
  if (i === 1) {
    await trashFlow(boxId, ids);
    return true;
  }
  const undoOut = await removeFromLibrary(boxId, lib.id, shared);
  const undoTrash = only.length ? await moveToTrash(boxId, only) : null;
  undoable(
    `${shared.length}枚を「${lib.name}」から出しました${only.length ? `（${only.length}枚はゴミ箱へ）` : ""}`,
    async () => {
      await undoTrash?.();
      await undoOut();
    },
  );
  return true;
}

/** 画像をドラッグしてライブラリーへ移す。from が無ければ（元のライブラリーが無い所から）入れるだけ */
export async function moveMediaFlow(boxId: string, ids: string[], from: string | null, to: Library) {
  const undo = await moveToLibrary(boxId, ids, from, to.id);
  undoable(`${ids.length}枚を「${to.name}」${from ? "へ移動しました" : "に入れました"}`, undo);
}

/** 左のライブラリーの印を押した：選んだ画像を入れる（全部入っていれば出す） */
export async function toggleInLibraryFlow(boxId: string, ids: string[], lib: Library, allIn: boolean) {
  if (allIn) undoable(`${ids.length}枚を「${lib.name}」から出しました`, await removeFromLibrary(boxId, lib.id, ids));
  else undoable(`${ids.length}枚を「${lib.name}」に入れました`, await addToLibrary(boxId, lib.id, ids));
}

// Ctrl+C・Ctrl+X で覚えた画像。ページやライブラリーを移っても貼り付けられるように、ここで持つ。
// cutFrom：切り取った画像なら、元のライブラリー（元のライブラリーが無い所なら null）。コピーなら undefined
type Clip = { boxId: string; ids: string[]; cutFrom?: string | null };
let clip: Clip | null = null;
const clipListeners = new Set<() => void>();
function setClip(next: Clip | null) {
  clip = next;
  clipListeners.forEach((fn) => fn());
}

/** 切り取っている画像（元のライブラリーの一覧で薄く出す） */
export function useCutMedia() {
  return useSyncExternalStore(
    (fn) => {
      clipListeners.add(fn);
      return () => clipListeners.delete(fn);
    },
    () => (clip?.cutFrom ? clip : null),
    () => null,
  );
}

/** Ctrl+C：画像を覚える（Ctrl+V でライブラリーに貼り付ける）。1枚なら、Discord などに貼れるようにクリップボードにも入れる */
export async function copyMediaFlow(boxId: string, list: Media[]) {
  if (!list.length) return;
  setClip({ boxId, ids: list.map((m) => m.id) });
  if (list.length === 1) await copyImage(list[0]).catch(() => {});
  toast(list.length === 1 ? "画像をコピーしました" : `${list.length}枚をコピーしました`);
}

/** Ctrl+X：画像を切り取る（Ctrl+V で、元のライブラリーから貼り付け先へ移す）。from が無い所（すべて・検索の結果など）からは入れるだけ */
export async function cutMediaFlow(boxId: string, list: Media[], from: string | null) {
  if (!list.length) return;
  setClip({ boxId, ids: list.map((m) => m.id), cutFrom: from });
  if (list.length === 1) await copyImage(list[0]).catch(() => {});
  toast(`${list.length}枚を切り取りました`);
}

/** 切り取りをやめる（Esc） */
export function cancelCut() {
  if (clip && clip.cutFrom !== undefined) setClip(null);
}

/** Ctrl+V：コピーした画像は今開いているライブラリーにも入れ（同じ画像なのでデータは増えない）、切り取った画像は移す */
export async function pasteMediaFlow(boxId: string, lib: Library | undefined) {
  if (!clip) return;
  if (clip.boxId !== boxId) return toast("別のボックスには貼り付けられません");
  if (!lib) return toast("ライブラリーを開いてから貼り付けてください");
  if (clip.cutFrom !== undefined) {
    if (clip.cutFrom === lib.id) return toast("切り取った場所と同じライブラリーです");
    const { ids, cutFrom } = clip;
    // 切り取りの貼り付けは1回だけ（Windows と同じ）
    setClip(null);
    const alive = await movableMedia(boxId, ids);
    if (alive.length) await moveMediaFlow(boxId, alive, cutFrom, lib);
    return;
  }
  const ids = await pastableMedia(boxId, lib.id, clip.ids);
  if (!ids.length) return toast(`「${lib.name}」にすでに入っています`);
  undoable(`${ids.length}枚を「${lib.name}」に貼り付けました`, await addToLibrary(boxId, lib.id, ids));
}

/** 右クリックの「まとめる」：選んだ画像でライブラリーを作る。ライブラリーの中なら、その子ライブラリーにする */
export async function groupFlow(boxId: string, ids: string[], current: Library | undefined) {
  const name = (
    await promptText(current ? `「${current.name}」に子ライブラリーを作る` : "ライブラリーを作る", "", "ライブラリー名")
  )?.trim();
  if (!name) return false;
  await groupIntoLibrary(boxId, ids, name, current?.id ?? null);
  toast(`${ids.length}枚で「${name}」を作りました`);
  return true;
}

export async function newLibraryFlow(boxId: string, parentId: string | null, parentName?: string) {
  const name = await promptText(parentName ? `「${parentName}」に子ライブラリーを追加` : "ライブラリーを追加", "", "ライブラリー名");
  if (!name) return null;
  return createLibrary(boxId, name, parentId);
}

export async function renameLibraryFlow(lib: Library) {
  const name = await promptText("ライブラリーの名前", lib.name);
  if (name && name !== lib.name) await renameLibrary(lib.id, name);
}

/**
 * サイドバーでライブラリーをドラッグして落としたとき（試作と同じ動き）。
 * before / after：その前・後ろに並べる（親が変わるなら移る）
 * inside：子ライブラリーにするか、合体するかを選ぶ
 * root：一番上の階層に出す
 */
export async function dropLibraryFlow(
  boxId: string,
  libs: Library[],
  id: string,
  drop: { zone: "before" | "after" | "inside"; targetId: string } | { zone: "root" },
) {
  const lib = libs.find((l) => l.id === id);
  if (!lib) return;
  if (drop.zone === "root") return undoable(`「${lib.name}」を一番上に移しました`, await moveLibrary(boxId, lib.id, null));
  const target = libs.find((l) => l.id === drop.targetId);
  if (!target || descendants(libs, id).includes(target.id)) return;
  if (drop.zone !== "inside") {
    return undoable(`「${lib.name}」を移動しました`, await moveLibrary(boxId, lib.id, target.parentId, { targetId: target.id, after: drop.zone === "after" }));
  }
  const i = await choose(`「${lib.name}」を「${target.name}」へ`, [
    { label: "子ライブラリーにする", detail: `「${lib.name}」を「${target.name}」の中に入れます` },
    { label: "合体する", detail: `「${lib.name}」の画像と子ライブラリーを「${target.name}」にまとめ、「${lib.name}」は削除します` },
  ]);
  if (i === 0) return undoable(`「${lib.name}」を「${target.name}」の子ライブラリーにしました`, await moveLibrary(boxId, lib.id, target.id));
  if (i === 1) undoable(`「${lib.name}」を「${target.name}」と合体しました`, await mergeLibrary(boxId, lib.id, target.id));
}

/** サイドバーのライブラリーの「…」メニュー */
/** ライブラリーのメニューの項目（サイドバーの右クリック）。並び順は libraryAction の番号と同じ */
export const LIBRARY_MENU = [
  { label: "名前を変更", icon: "edit" },
  { label: "子ライブラリーを追加", icon: "add" },
  { label: "上へ移動", icon: "up" },
  { label: "下へ移動", icon: "dn" },
  { label: "別の場所へ移動", icon: "folder", detail: "別のライブラリーの子ライブラリーにする・最上位に出す" },
  { label: "他のライブラリーと合体", icon: "copy", detail: "画像と子ライブラリーを移して、このライブラリーは消します" },
  { label: "ライブラリーを書き出す", icon: "download", detail: "ZIP にまとめて保存します。子ライブラリーの画像はフォルダに分けます" },
  { label: "削除", icon: "del", detail: "画像は削除されません", danger: true },
] as const;

/** ライブラリーのメニューで選んだもの（i は LIBRARY_MENU の番号）を行う */
export async function libraryAction(i: number, boxId: string, lib: Library, libs: Library[], media: Media[], onDeleted: () => void) {
  const path = (l: Library) =>
    chain(libs, l.id)
      .map((x) => x.name)
      .join(" / ");
  const others = libs.filter((l) => !descendants(libs, lib.id).includes(l.id));

  switch (i) {
    case 0:
      return renameLibraryFlow(lib);
    case 1:
      return newLibraryFlow(boxId, lib.id, lib.name);
    case 2:
    case 3:
      return reorderLibrary(boxId, lib.id, i === 2 ? -1 : 1);
    case 4: {
      const targets = [...(lib.parentId ? [null] : []), ...others.filter((l) => l.id !== lib.parentId)];
      if (!targets.length) return toast("移動できる場所がありません");
      const j = await choose(
        `「${lib.name}」の移動先`,
        targets.map((t) => ({ label: t ? `「${path(t)}」の中` : "最上位" })),
      );
      if (j === null) return;
      const to = targets[j];
      return undoable(`「${lib.name}」を移動しました`, await moveLibrary(boxId, lib.id, to ? to.id : null));
    }
    case 5: {
      if (!others.length) return toast("合体できるライブラリーがありません");
      const j = await choose(
        `「${lib.name}」をどこに合体しますか`,
        others.map((t) => ({ label: path(t) })),
      );
      if (j === null) return;
      return undoable(`「${lib.name}」を「${others[j].name}」と合体しました`, await mergeLibrary(boxId, lib.id, others[j].id));
    }
    case 6:
      return exportLibraryFlow(lib, libs, media);
    case 7: {
      const n = descendants(libs, lib.id).length - 1;
      const ok = await confirmAction(`「${lib.name}」を削除します`, "削除", `${n ? `子ライブラリー${n}件も削除します。` : ""}画像は削除されません。`);
      if (!ok) return;
      const undo = await deleteLibrary(boxId, lib.id);
      onDeleted();
      return undoable(`「${lib.name}」を削除しました`, undo);
    }
  }
}
