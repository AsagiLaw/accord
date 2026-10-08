import type { Library, Media } from "@/lib/local/db";

// 試作「依頼ノート」のメディアの決まりごとを、画面から切り離した純粋な関数にしたもの

export type SortKey = "new" | "name" | "size";
export type SortDir = "asc" | "desc";
/** ライブラリーの配置：基本（小ライブラリーは印の画像だけ）／全て表示／シングル（小ライブラリーの画像を出さない） */
export type LibMode = "rep" | "all" | "single";

export type MediaPrefs = {
  sort: SortKey;
  dirs: Record<SortKey, SortDir>;
  /** 画像のサイズ 1〜4（極小・小・中・大） */
  level: number;
  libMode: LibMode;
};

export const DEFAULT_PREFS: MediaPrefs = {
  sort: "new",
  dirs: { new: "desc", name: "asc", size: "desc" },
  level: 3,
  libMode: "rep",
};

export const THUMB_SIZES = [96, 128, 164, 220];

/** 自分と、その下の小ライブラリーすべて */
export function descendants(libs: Library[], id: string): string[] {
  return [id, ...libs.filter((l) => l.parentId === id).flatMap((l) => descendants(libs, l.id))];
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

export function childrenOf(libs: Library[], parentId: string | null): Library[] {
  return libs.filter((l) => l.parentId === parentId).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

/** 小ライブラリーに入れた画像は、その親たちにも入っている状態にそろえる */
export function withAncestors(libs: Library[], libIds: string[]): string[] {
  const out = new Set<string>();
  for (const id of libIds) chain(libs, id).forEach((l) => out.add(l.id));
  return [...out];
}

export const isUnsorted = (m: Media) => !m.trashed && m.libIds.length === 0;

/** 小ライブラリーの代表画像。指定が無い・外れているなら最初の画像 */
export function repOf(media: Media[], lib: Library): string | undefined {
  const list = media.filter((m) => !m.trashed && m.libIds.includes(lib.id));
  if (lib.repMediaId && list.some((m) => m.id === lib.repMediaId)) return lib.repMediaId;
  return list[0]?.id;
}

/** ライブラリーを開いたときに並べる画像 */
export function libraryView(media: Media[], libs: Library[], libId: string, mode: LibMode): Media[] {
  const inLib = media.filter((m) => !m.trashed && m.libIds.includes(libId));
  if (mode === "all") return inLib;
  const below = descendants(libs, libId).filter((id) => id !== libId);
  const inChild = (m: Media) => m.libIds.some((id) => below.includes(id));
  if (mode === "single") return inLib.filter((m) => !inChild(m));
  const reps = childrenOf(libs, libId).map((k) => repOf(media, k));
  return inLib.filter((m) => !inChild(m) || reps.includes(m.id));
}

export function arrange(list: Media[], prefs: MediaPrefs): Media[] {
  const dir = prefs.dirs[prefs.sort] === "asc" ? 1 : -1;
  const cmp =
    prefs.sort === "name"
      ? (a: Media, b: Media) => a.name.localeCompare(b.name, "ja", { numeric: true })
      : prefs.sort === "size"
        ? (a: Media, b: Media) => a.size - b.size
        : (a: Media, b: Media) => a.createdAt - b.createdAt;
  return [...list].sort((a, b) => cmp(a, b) * dir);
}

/** ライブラリーの表紙に使う画像（最大3枚） */
export function coverOf(media: Media[], libId: string): Media[] {
  return media.filter((m) => !m.trashed && m.libIds.includes(libId)).slice(0, 3);
}
