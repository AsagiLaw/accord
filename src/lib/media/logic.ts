import type { Library, Media } from "@/lib/local/db";
import { madeOf } from "./autoname";
import { PSD_MIME } from "./psd";

// 試作「依頼ノート」のメディアの決まりごとを、画面から切り離した純粋な関数にしたもの

/** 並べる基準：追加日時・制作日・名前・容量 */
export type SortKey = "new" | "made" | "name" | "size";
export type SortDir = "asc" | "desc";
/** リスト表示で名前の右に並べる列（プレビューの詳細と同じ項目） */
export type ListColumn =
  | "fileName"
  | "type"
  | "dims"
  | "dpi"
  | "pixels"
  | "ratio"
  | "size"
  | "made"
  | "date"
  | "uploader"
  | "libs";
/** 列の名前と幅。はじめは画像サイズ・容量・追加日時だけを出す */
export const LIST_COLUMNS: { id: ListColumn; name: string; width: string }[] = [
  { id: "fileName", name: "元のファイル名", width: "12rem" },
  { id: "type", name: "形式", width: "5.5rem" },
  { id: "dims", name: "画像サイズ", width: "7.5rem" },
  { id: "dpi", name: "解像度", width: "5rem" },
  { id: "pixels", name: "画素数", width: "5rem" },
  { id: "ratio", name: "縦横比", width: "4.5rem" },
  { id: "size", name: "容量", width: "4.5rem" },
  { id: "made", name: "制作日", width: "6rem" },
  { id: "date", name: "追加日時", width: "8.5rem" },
  { id: "uploader", name: "追加した人", width: "7rem" },
  { id: "libs", name: "ライブラリー", width: "12rem" },
];

/** プレビュー欄の詳細に出す項目。タイトルと制作日は、その場で書き換えられる */
export type PreviewField =
  | "title"
  | "made"
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
  { id: "title", name: "タイトル" },
  { id: "made", name: "制作日" },
  { id: "fileName", name: "元のファイル名" },
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
  /** 画像とライブラリーの見せ方：アイコン（サムネイル・カードを並べる）／リスト（1行に1つ、名前やサイズを並べる） */
  imageView: "icon" | "list";
  /**
   * アイコン表示の画像の見せ方：標準（正方形に切り抜き、名前を画像に重ねる）／
   * Windows 風（エクスプローラーの画像表示のように、切り抜かずに枠へ収め、名前を下に出す）
   */
  iconStyle: "card" | "explorer";
  /** 標準のアイコン表示で、画像の上に名前を重ねて出す */
  cardName: boolean;
  /** リスト表示で出す列（並べた順）。データベースのプロパティの表示/非表示と同じく、出す・隠す・並べ替えができる */
  columns: ListColumn[];
  /** 画像の名前の後ろに拡張子を付けて出す（Windows のエクスプローラーの「ファイル名拡張子」） */
  showExt: boolean;
  /** 自動で名前を付けた画像の名前に、制作日と番号も出す（20250101_誕生日_01）。切ると、タイトルだけ */
  showMadeNumber: boolean;
  /** プレビュー欄の画像の枠：元の画像と同じ縦横比／正方形（1:1。画像は枠に収める） */
  previewRatio: "original" | "square";
  /** プレビュー欄の詳細に出す項目（並べた順） */
  previewFields: PreviewField[];
  /** 保存した設定の版。項目が増えたときに、前からの設定へ足すのに使う */
  v?: number;
};

export const DEFAULT_PREFS: MediaPrefs = {
  sort: "new",
  dirs: { new: "desc", made: "desc", name: "asc", size: "desc" },
  level: 3,
  imageView: "icon",
  iconStyle: "card",
  cardName: true,
  columns: ["dims", "size", "date"],
  showExt: false,
  showMadeNumber: false,
  previewRatio: "original",
  previewFields: PREVIEW_FIELDS.map((f) => f.id),
  v: 2,
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

/** 親と子の両方が入っているとき、親を除く（子だけにする） */
export function withoutAncestors(libs: Library[], libIds: string[]): string[] {
  return libIds.filter(
    (id) => !libIds.some((o) => o !== id && chain(libs, o).some((l) => l.id === id)),
  );
}

/**
 * 前の形の画像か（前は、子ライブラリーに入れると親たちにも入る形だった）。親と子の両方に入っていて、印（libsDirect）が無い画像がそう。
 * 入っているライブラリーがまだ届いていないときは、親子が分からないので見分けない
 */
export function hasOldLibIds(libs: Library[], m: Media): boolean {
  if (m.libsDirect || m.libIds.length < 2) return false;
  if (m.libIds.some((id) => !libs.some((l) => l.id === id))) return false;
  return withoutAncestors(libs, m.libIds).length !== m.libIds.length;
}

export const isUnsorted = (m: Media) => !m.trashed && m.libIds.length === 0;

/** ライブラリーの中（子ライブラリーの中も）の画像。ゴミ箱の画像は除く */
export function deepMedia(media: Media[], libs: Library[], libId: string): Media[] {
  const ids = new Set(descendants(libs, libId));
  return media.filter((m) => !m.trashed && m.libIds.some((id) => ids.has(id)));
}

/** ライブラリーの代表画像。指定が無い・外れているなら、直接入っている最初の画像。無ければ子ライブラリーの最初の画像 */
export function repOf(media: Media[], libs: Library[], lib: Library): string | undefined {
  const list = deepMedia(media, libs, lib.id);
  if (lib.repMediaId && list.some((m) => m.id === lib.repMediaId))
    return lib.repMediaId;
  return (list.find((m) => m.libIds.includes(lib.id)) ?? list[0])?.id;
}

/** ライブラリーを開いたときに並べる画像（直接入っている画像だけ。子ライブラリーの画像は出さない） */
export function libraryView(media: Media[], libId: string): Media[] {
  return media.filter((m) => !m.trashed && m.libIds.includes(libId));
}

/** 画像の名前に拡張子を付けて出す（「並べ替えと表示」のファイル名拡張子） */
export function shownName(m: Media, showExt: boolean): string {
  return showExt ? `${m.name}.${extOf(m)}` : m.name;
}

/**
 * アイコン表示の画像の上や、上のバーに出す名前。自動で名前を付けた画像はタイトルだけで、
 * 「制作日とナンバリング」の設定のときは全部の名前（20250101_誕生日_01）。拡張子は「ファイル名拡張子」の設定で付ける
 */
export function labelOf(m: Media, showExt: boolean, showMadeNumber: boolean): string {
  const name = showMadeNumber ? m.name : m.title || m.name;
  return showExt ? `${name}.${extOf(m)}` : name;
}

/** 名前を変えるときに書き換える所：自動で名前を付けた画像はタイトル、それ以外は名前 */
export const editableName = (m: Media) => m.title ?? m.name;

/** ファイル名の拡張子（小文字・点なし）。無ければ形式から */
export function extOf(m: Media): string {
  const dot = m.fileName.lastIndexOf(".");
  if (dot > 0) return m.fileName.slice(dot + 1).toLowerCase();
  if (m.mime === PSD_MIME) return "psd";
  return m.mime.replace("image/", "").toLowerCase();
}

/** 形式の名前（JPEG・PNG・PSD など）。PSD は拡張子から（PSD か PSB） */
export function typeName(m: Media): string {
  if (m.mime === PSD_MIME) return extOf(m).toUpperCase();
  return (m.mime.replace("image/", "") || "不明").toUpperCase();
}

/** 検索で比べるために、全角と半角・大文字と小文字・カタカナとひらがなの違いを無くす */
export function searchKey(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * 検索：名前・ファイル名・形式・追加した人のどれかに言葉が入っている画像だけにする（並びはそのまま）。
 * 空白で区切った言葉は、すべてを含むものだけ（「psd ラフ」なら、PSD で名前に「ラフ」がある画像）
 */
export function searchMedia(list: Media[], query: string, uploaderName: (userId: string) => string): Media[] {
  const words = searchKey(query).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((m) => {
    // 項目は改行でつなぐ（言葉が2つの項目にまたがって合わないように）。JPEG は「jpg」でも探せるようにする
    const text = searchKey([m.name, m.fileName, typeName(m), extOf(m), m.mime === "image/jpeg" ? "jpg" : "", uploaderName(m.uploadedBy)].join("\n"));
    return words.every((w) => text.includes(w));
  });
}

export function arrange(list: Media[], prefs: MediaPrefs): Media[] {
  const dir = prefs.dirs[prefs.sort] === "asc" ? 1 : -1;
  const text = (a: string, b: string) =>
    a.localeCompare(b, "ja", { numeric: true });
  const cmp: Record<SortKey, (a: Media, b: Media) => number> = {
    new: (a, b) => a.createdAt - b.createdAt,
    made: (a, b) => madeOf(a) - madeOf(b),
    name: (a, b) => text(a.name, b.name),
    size: (a, b) => a.size - b.size,
  };
  return [...list].sort((a, b) => (cmp[prefs.sort] ?? cmp.new)(a, b) * dir);
}

/** カードの表紙に出す画像3枚。代表の画像（repOf）があれば、それを先頭（左の大きい四角）にする。直接入っている画像を先に使う */
export function coverOf(media: Media[], libs: Library[], lib: Library): Media[] {
  const list = deepMedia(media, libs, lib.id);
  const rep = repOf(media, libs, lib);
  return [
    ...list.filter((m) => m.id === rep),
    ...list.filter((m) => m.id !== rep && m.libIds.includes(lib.id)),
    ...list.filter((m) => m.id !== rep && !m.libIds.includes(lib.id)),
  ].slice(0, 3);
}
