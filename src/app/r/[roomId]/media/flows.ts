"use client";

import { choose, confirmAction, promptText, toast } from "@/components/ui/overlay";
import type { Library, Media } from "@/lib/local/db";
import {
  createLibrary,
  deleteForever,
  deleteLibrary,
  groupIntoLibrary,
  mergeLibrary,
  moveLibrary,
  moveToTrash,
  removeFromLibrary,
  renameLibrary,
  reorderLibrary,
  restoreFromTrash,
  uploadFiles,
  type Undo,
} from "@/lib/local/media";
import { chain, descendants } from "@/lib/media/logic";

// 確認・お知らせ・元に戻すを含む、画面からの操作の流れ

const undoable = (message: string, undo: Undo) => toast(message, { label: "元に戻す", run: () => void undo() });

export async function uploadFlow(roomId: string, userId: string, files: File[], openUnsorted: () => void) {
  if (!files.length) return;
  toast(`${files.length}枚を読み込み中…`);
  const { ids, failed } = await uploadFiles(roomId, userId, files);
  if (ids.length) toast(`${ids.length}枚を追加しました${failed ? `（${failed}枚は画像でないため追加できません）` : ""}`, { label: "整理する", run: openUnsorted });
  else toast("画像を追加できませんでした");
}

export async function trashFlow(roomId: string, ids: string[]) {
  undoable(`${ids.length}枚をゴミ箱へ移動しました`, await moveToTrash(roomId, ids));
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

export async function removeFromLibraryFlow(roomId: string, lib: Library, ids: string[]) {
  undoable(`${ids.length}枚を「${lib.name}」から出しました`, await removeFromLibrary(roomId, lib.id, ids));
}

export async function groupFlow(roomId: string, ids: string[], current: Library | undefined) {
  const name = await promptText(`選んだ${ids.length}枚で新しいライブラリーを作る`, "", "例：〇〇のイラスト");
  if (!name) return;
  let parentId: string | null = null;
  if (current) {
    const i = await choose("作る場所", [{ label: `「${current.name}」の小ライブラリー` }, { label: "最上位のライブラリー" }]);
    if (i === null) return;
    parentId = i === 0 ? current.id : null;
  }
  await groupIntoLibrary(roomId, ids, name, parentId);
  toast(`${ids.length}枚で「${name}」を作りました`);
}

export async function newLibraryFlow(roomId: string, parentId: string | null, parentName?: string) {
  const name = await promptText(parentName ? `「${parentName}」に小ライブラリーを追加` : "ライブラリーを追加", "", "ライブラリー名");
  if (!name) return null;
  return createLibrary(roomId, name, parentId);
}

export async function renameLibraryFlow(lib: Library) {
  const name = await promptText("ライブラリーの名前", lib.name);
  if (name && name !== lib.name) await renameLibrary(lib.id, name);
}

/** 画像を元の親から外すかを確かめてから、ライブラリーの場所を変える */
async function moveWithAsk(
  roomId: string,
  lib: Library,
  libs: Library[],
  media: Media[],
  newParentId: string | null,
  done: string,
  place?: { targetId: string; after: boolean },
) {
  const parent = lib.parentId ? libs.find((l) => l.id === lib.parentId) : undefined;
  const sub = descendants(libs, lib.id);
  const n = media.filter((m) => !m.trashed && m.libIds.some((x) => sub.includes(x))).length;
  let removeFromOld = false;
  if (parent && newParentId !== parent.id && n) {
    const i = await choose(
      `「${lib.name}」を「${parent.name}」から外します`,
      [
        { label: "画像も外す", detail: `画像${n}枚も「${parent.name}」から外れます`, danger: true },
        { label: "画像は残す", detail: `画像は「${parent.name}」にも残ります` },
      ],
      `小ライブラリーに入っている画像（${n}枚）を、「${parent.name}」からも外しますか？`,
    );
    if (i === null) return;
    removeFromOld = i === 0;
  }
  undoable(done, await moveLibrary(roomId, lib.id, newParentId, removeFromOld, place));
}

/**
 * サイドバーでライブラリーをドラッグして落としたとき（試作と同じ動き）。
 * before / after：その前・後ろに並べる（親が変わるなら移る）
 * inside：小ライブラリーにするか、合体するかを選ぶ
 * root：一番上の階層に出す
 */
export async function dropLibraryFlow(
  roomId: string,
  libs: Library[],
  media: Media[],
  id: string,
  drop: { zone: "before" | "after" | "inside"; targetId: string } | { zone: "root" },
) {
  const lib = libs.find((l) => l.id === id);
  if (!lib) return;
  if (drop.zone === "root") return moveWithAsk(roomId, lib, libs, media, null, `「${lib.name}」を一番上に移しました`);
  const target = libs.find((l) => l.id === drop.targetId);
  if (!target || descendants(libs, id).includes(target.id)) return;
  if (drop.zone !== "inside") {
    return moveWithAsk(roomId, lib, libs, media, target.parentId, `「${lib.name}」を移動しました`, { targetId: target.id, after: drop.zone === "after" });
  }
  const i = await choose(`「${lib.name}」を「${target.name}」へ`, [
    { label: "小ライブラリーにする", detail: `「${lib.name}」の画像は「${target.name}」にも入ります` },
    { label: "合体する", detail: `「${lib.name}」の画像と小ライブラリーを「${target.name}」にまとめ、「${lib.name}」は削除します` },
  ]);
  if (i === 0) return moveWithAsk(roomId, lib, libs, media, target.id, `「${lib.name}」を「${target.name}」の小ライブラリーにしました`);
  if (i === 1) undoable(`「${lib.name}」を「${target.name}」と合体しました`, await mergeLibrary(roomId, lib.id, target.id));
}

/** サイドバーのライブラリーの「…」メニュー */
export async function libraryMenuFlow(roomId: string, lib: Library, libs: Library[], media: Media[], onDeleted: () => void) {
  const i = await choose(lib.name, [
    { label: "名前を変更" },
    { label: "小ライブラリーを追加" },
    { label: "上へ移動" },
    { label: "下へ移動" },
    { label: "別の場所へ移動", detail: "別のライブラリーの小ライブラリーにする・最上位に出す" },
    { label: "他のライブラリーと合体", detail: "画像と小ライブラリーを移して、このライブラリーは消します" },
    { label: "削除", detail: "画像は削除されません", danger: true },
  ]);
  const path = (l: Library) =>
    chain(libs, l.id)
      .map((x) => x.name)
      .join(" / ");
  const others = libs.filter((l) => !descendants(libs, lib.id).includes(l.id));

  switch (i) {
    case 0:
      return renameLibraryFlow(lib);
    case 1:
      return newLibraryFlow(roomId, lib.id, lib.name);
    case 2:
    case 3:
      return reorderLibrary(roomId, lib.id, i === 2 ? -1 : 1);
    case 4: {
      const targets = [...(lib.parentId ? [null] : []), ...others.filter((l) => l.id !== lib.parentId)];
      if (!targets.length) return toast("移動できる場所がありません");
      const j = await choose(
        `「${lib.name}」の移動先`,
        targets.map((t) => ({ label: t ? `「${path(t)}」の中` : "最上位" })),
      );
      if (j === null) return;
      const to = targets[j];
      return moveWithAsk(roomId, lib, libs, media, to ? to.id : null, `「${lib.name}」を移動しました`);
    }
    case 5: {
      if (!others.length) return toast("合体できるライブラリーがありません");
      const j = await choose(
        `「${lib.name}」をどこに合体しますか`,
        others.map((t) => ({ label: path(t) })),
      );
      if (j === null) return;
      return undoable(`「${lib.name}」を「${others[j].name}」と合体しました`, await mergeLibrary(roomId, lib.id, others[j].id));
    }
    case 6: {
      const n = descendants(libs, lib.id).length - 1;
      const ok = await confirmAction(`「${lib.name}」を削除します`, "削除", `${n ? `小ライブラリー${n}件も削除します。` : ""}画像は削除されません。`);
      if (!ok) return;
      const undo = await deleteLibrary(roomId, lib.id);
      onDeleted();
      return undoable(`「${lib.name}」を削除しました`, undo);
    }
  }
}
