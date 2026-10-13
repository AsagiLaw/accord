"use client";

import { choose, confirmAction, promptText, toast } from "@/components/ui/overlay";
import type { Library, Media } from "@/lib/local/db";
import {
  createLibrary,
  deleteForever,
  duplicateMedia,
  deleteLibrary,
  groupIntoLibrary,
  mergeLibrary,
  moveLibrary,
  moveToTrash,
  removeFromLibrary,
  renameLibrary,
  reorderLibrary,
  restoreFromTrash,
  revertEdit,
  saveEdit,
  saveEditAsCopy,
  uploadFiles,
  type Undo,
} from "@/lib/local/media";
import { canPickSaveLocation, copyImage, downloadOriginals, saveFileAs, saveZip, type ZipItem } from "@/lib/media/export";
import type { ImageEdit } from "@/lib/media/edit";
import { chain, descendants } from "@/lib/media/logic";

// 確認・お知らせ・元に戻すを含む、画面からの操作の流れ

const undoable = (message: string, undo: Undo) => toast(message, { label: "元に戻す", run: () => void undo() });

export async function uploadFlow(boxId: string, userId: string, files: File[], openUnsorted: () => void) {
  if (!files.length) return;
  toast(`${files.length}枚を読み込み中…`);
  const { ids, failed } = await uploadFiles(boxId, userId, files);
  if (ids.length) toast(`${ids.length}枚を追加しました${failed ? `（${failed}枚は画像でないため追加できません）` : ""}`, { label: "整理する", run: openUnsorted });
  else toast("画像を追加できませんでした");
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
 * 子ライブラリーの画像は、ZIP の中の子ライブラリーの名前のフォルダに入れる（いくつかの子ライブラリーに入っている画像は、それぞれに入れる）
 */
export async function exportLibraryFlow(lib: Library, libs: Library[], media: Media[]) {
  const sub = descendants(libs, lib.id).filter((id) => id !== lib.id);
  const depth = chain(libs, lib.id).length;
  const items: ZipItem[] = [];
  for (const m of media) {
    if (m.trashed || !m.libIds.includes(lib.id)) continue;
    // 入っている子ライブラリーのうち、一番深いもの（親たちにも入っているので、それは除く）
    const inSub = m.libIds.filter((id) => sub.includes(id));
    const leaves = inSub.filter((id) => !inSub.some((o) => o !== id && descendants(libs, id).includes(o)));
    if (!leaves.length) items.push({ m });
    for (const id of leaves)
      items.push({
        m,
        folder: chain(libs, id)
          .slice(depth)
          .map((l) => l.name),
      });
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

export async function deleteForeverFlow(ids: string[], media: Media[], userId: string) {
  const mine = ids.filter((id) => media.find((m) => m.id === id)?.uploadedBy === userId).length;
  if (!mine) {
    toast("完全に削除できるのは、アップロードした人だけです");
    return;
  }
  const others = ids.length - mine;
  const ok = await confirmAction(
    `${mine}枚を完全に削除します`,
    "完全に削除",
    `元に戻せません。${others ? `他の人がアップロードした${others}枚は、その人だけが削除できるため残ります。` : ""}`,
  );
  if (!ok) return;
  const r = await deleteForever(ids, userId);
  toast(`${r.deleted}枚を完全に削除しました`);
}

export async function removeFromLibraryFlow(boxId: string, lib: Library, ids: string[]) {
  undoable(`${ids.length}枚を「${lib.name}」から出しました`, await removeFromLibrary(boxId, lib.id, ids));
}

export async function groupFlow(boxId: string, ids: string[], current: Library | undefined) {
  const name = await promptText(`選んだ${ids.length}枚で新しいライブラリーを作る`, "", "例：〇〇のイラスト");
  if (!name) return;
  let parentId: string | null = null;
  if (current) {
    const i = await choose("作る場所", [{ label: `「${current.name}」の子ライブラリー` }, { label: "最上位のライブラリー" }]);
    if (i === null) return;
    parentId = i === 0 ? current.id : null;
  }
  await groupIntoLibrary(boxId, ids, name, parentId);
  toast(`${ids.length}枚で「${name}」を作りました`);
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

/** 画像を元の親から外すかを確かめてから、ライブラリーの場所を変える */
async function moveWithAsk(
  boxId: string,
  lib: Library,
  libs: Library[],
  media: Media[],
  newParentId: string | null,
  done: string,
  place?: { targetId: string; after: boolean },
) {
  const sub = descendants(libs, lib.id);
  const n = media.filter((m) => !m.trashed && m.libIds.some((x) => sub.includes(x))).length;
  // 移った先でも親（その親）として残るライブラリーからは、画像は外れない。
  // 外れる可能性があるのは、今の親たちのうち、移り先の親たちに入っていないものだけ
  const newChain = newParentId ? chain(libs, newParentId).map((l) => l.id) : [];
  const leaving = lib.parentId ? chain(libs, lib.parentId).filter((l) => !newChain.includes(l.id)) : [];
  const names = leaving.map((l) => `「${l.name}」`).join("");
  let removeFromOld = false;
  if (leaving.length && n) {
    const i = await choose(
      `「${lib.name}」を${names}から外します`,
      [
        { label: "画像も外す", detail: `画像${n}枚も${names}から外れます`, danger: true },
        { label: "画像は残す", detail: `画像は${names}にも残ります` },
      ],
      `子ライブラリーに入っている画像（${n}枚）を、${names}からも外しますか？`,
    );
    if (i === null) return;
    removeFromOld = i === 0;
  }
  undoable(done, await moveLibrary(boxId, lib.id, newParentId, removeFromOld, place));
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
  media: Media[],
  id: string,
  drop: { zone: "before" | "after" | "inside"; targetId: string } | { zone: "root" },
) {
  const lib = libs.find((l) => l.id === id);
  if (!lib) return;
  if (drop.zone === "root") return moveWithAsk(boxId, lib, libs, media, null, `「${lib.name}」を一番上に移しました`);
  const target = libs.find((l) => l.id === drop.targetId);
  if (!target || descendants(libs, id).includes(target.id)) return;
  if (drop.zone !== "inside") {
    return moveWithAsk(boxId, lib, libs, media, target.parentId, `「${lib.name}」を移動しました`, { targetId: target.id, after: drop.zone === "after" });
  }
  const i = await choose(`「${lib.name}」を「${target.name}」へ`, [
    { label: "子ライブラリーにする", detail: `「${lib.name}」の画像は「${target.name}」にも入ります` },
    { label: "合体する", detail: `「${lib.name}」の画像と子ライブラリーを「${target.name}」にまとめ、「${lib.name}」は削除します` },
  ]);
  if (i === 0) return moveWithAsk(boxId, lib, libs, media, target.id, `「${lib.name}」を「${target.name}」の子ライブラリーにしました`);
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
      return moveWithAsk(boxId, lib, libs, media, to ? to.id : null, `「${lib.name}」を移動しました`);
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
