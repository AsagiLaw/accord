import type { Library, Media } from "@/lib/local/db";

// 試作「依頼ノート」のメディアの決まりごとを、画面から切り離した純粋な関数にしたもの

export type SortKey = "new" | "name" | "size";
export type SortDir = "asc" | "desc";
/** ライブラリーの配置：基本（子ライブラリーは印の画像だけ）／全て表示／シングル（子ライブラリーの画像を出さない） */
export type LibMode = "rep" | "all" | "single";

/** リスト表示で名前の右に並べる列（プレビューの詳細と同じ項目） */
export type ListColumn =
  | "fileName"
  | "type"
  | "dims"
  | "dpi"
  | "pixels"
  | "ratio"
  | "size"
  | "date"
  | "uploader"
  | "libs";
/** 列の名前と幅。はじめは画像サイズ・容量・追加日時だけを出す */
export const LIST_COLUMNS: { id: ListColumn; name: string; width: string }[] = [
  { id: "fileName", name: "ファイル名", width: "12rem" },
  { id: "type", name: "形式", width: "5.5rem" },
  { id: "dims", name: "画像サイズ", width: "7.5rem" },
  { id: "dpi", name: "解像度", width: "5rem" },
  { id: "pixels", name: "画素数", width: "5rem" },
  { id: "ratio", name: "縦横比", width: "4.5rem" },
  { id: "size", name: "容量", width: "4.5rem" },
  { id: "date", name: "追加日時", width: "8.5rem" },
  { id: "uploader", name: "追加した人", width: "7rem" },
  { id: "libs", name: "ライブラリー", width: "12rem" },
];

/** プレビュー欄の詳細に出す項目 */
export type PreviewField =
  | "fileName"
  | "type"
  | "dims"
  | "dpi"
  | "mm"
  | "profile"
  | "pixels"
  | "ratio"
  | "size"
  | "date"
  | "uploader"
  | "libs";
/** プレビュー欄の詳細の項目と名前。はじめはすべて、この順に出す */
export const PREVIEW_FIELDS: { id: PreviewField; name: string }[] = [
  { id: "fileName", name: "ファイル名" },
  { id: "type", name: "形式" },
  { id: "dims", name: "画像サイズ" },
  { id: "dpi", name: "解像度" },
  { id: "mm", name: "サイズ（mm）" },
  { id: "profile", name: "カラープロファイル" },
  { id: "pixels", name: "画素数" },
  { id: "ratio", name: "縦横比" },
  { id: "size", name: "ファイル容量" },
  { id: "date", name: "追加日時" },
  { id: "uploader", name: "追加した人" },
  { id: "libs", name: "ライブラリー" },
];

export type MediaPrefs = {
  sort: SortKey;
  dirs: Record<SortKey, SortDir>;
  /** 画像のサイズ 1〜4（極小・小・中・大） */
  level: number;
  libMode: LibMode;
  /** 画像とライブラリーの見せ方：アイコン（サムネイル・カードを並べる）／リスト（1行に1つ、名前やサイズを並べる） */
  imageView: "icon" | "list";
  /** リスト表示で出す列（並べた順）。データベースのプロパティの表示/非表示と同じく、出す・隠す・並べ替えができる */
  columns: ListColumn[];
  /** 画像の名前の後ろに拡張子を付けて出す（Windows のエクスプローラーの「ファイル名拡張子」） */
  showExt: boolean;
  /** プレビュー欄の画像の枠：元の画像と同じ縦横比／正方形（1:1。画像は枠に収める） */
  previewRatio: "original" | "square";
  /** プレビュー欄の詳細に出す項目（並べた順） */
  previewFields: PreviewField[];
};

export const DEFAULT_PREFS: MediaPrefs = {
  sort: "new",
  dirs: { new: "desc", name: "asc", size: "desc" },
  level: 3,
  libMode: "rep",
  imageView: "icon",
  columns: ["dims", "size", "date"],
  showExt: false,
  previewRatio: "original",
  previewFields: PREVIEW_FIELDS.map((f) => f.id),
};

export const THUMB_SIZES = [96, 128, 164, 220];

/** 自分と、その下の子ライブラリーすべて */
export function descendants(libs: Library[], id: string): string[] {
  return [
    id,
    ...libs
      .filter((l) => l.parentId === id)
      .flatMap((l) => descendants(libs, l.id)),
  ];
}

/** 一番上の親から自分までの並び */
export function chain(libs: Library[], id: string | null): Library[] {
  const out: Library[] = [];
  let cur = id ? libs.find((l) => l.id === id) : undefined;
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? libs.find((l) => l.id === cur!.parentId) : undefined;
  }
  return out;
}

export function childrenOf(
  libs: Library[],
  parentId: string | null,
): Library[] {
  return libs
    .filter((l) => l.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

/** 子ライブラリーに入れた画像は、その親たちにも入っている状態にそろえる */
export function withAncestors(libs: Library[], libIds: string[]): string[] {
  const out = new Set<string>();
  for (const id of libIds) chain(libs, id).forEach((l) => out.add(l.id));
  return [...out];
}

export const isUnsorted = (m: Media) => !m.trashed && m.libIds.length === 0;

/** 子ライブラリーの代表画像。指定が無い・外れているなら最初の画像 */
export function repOf(media: Media[], lib: Library): string | undefined {
  const list = media.filter((m) => !m.trashed && m.libIds.includes(lib.id));
  if (lib.repMediaId && list.some((m) => m.id === lib.repMediaId))
    return lib.repMediaId;
  return list[0]?.id;
}

/** ライブラリーを開いたときに並べる画像 */
export function libraryView(
  media: Media[],
  libs: Library[],
  libId: string,
  mode: LibMode,
): Media[] {
  const inLib = media.filter((m) => !m.trashed && m.libIds.includes(libId));
  if (mode === "all") return inLib;
  const below = descendants(libs, libId).filter((id) => id !== libId);
  const inChild = (m: Media) => m.libIds.some((id) => below.includes(id));
  if (mode === "single") return inLib.filter((m) => !inChild(m));
  const reps = childrenOf(libs, libId).map((k) => repOf(media, k));
  return inLib.filter((m) => !inChild(m) || reps.includes(m.id));
}

/** 画像の名前に拡張子を付けて出す（「並べ替えと表示」のファイル名拡張子） */
export function shownName(m: Media, showExt: boolean): string {
  return showExt ? `${m.name}.${extOf(m)}` : m.name;
}

/** ファイル名の拡張子（小文字・点なし）。無ければ形式から */
export function extOf(m: Media): string {
  const dot = m.fileName.lastIndexOf(".");
  if (dot > 0) return m.fileName.slice(dot + 1).toLowerCase();
  return m.mime.replace("image/", "").toLowerCase();
}

export function arrange(list: Media[], prefs: MediaPrefs): Media[] {
  const dir = prefs.dirs[prefs.sort] === "asc" ? 1 : -1;
  const text = (a: string, b: string) =>
    a.localeCompare(b, "ja", { numeric: true });
  const cmp: Record<SortKey, (a: Media, b: Media) => number> = {
    new: (a, b) => a.createdAt - b.createdAt,
    name: (a, b) => text(a.name, b.name),
    size: (a, b) => a.size - b.size,
  };
  return [...list].sort((a, b) => (cmp[prefs.sort] ?? cmp.new)(a, b) * dir);
}

/** カードの表紙に出す画像3枚。代表の画像（repOf）があれば、それを先頭（左の大きい四角）にする */
export function coverOf(media: Media[], lib: Library): Media[] {
  const list = media.filter((m) => !m.trashed && m.libIds.includes(lib.id));
  const rep = repOf(media, lib);
  return [
    ...list.filter((m) => m.id === rep),
    ...list.filter((m) => m.id !== rep),
  ].slice(0, 3);
}
