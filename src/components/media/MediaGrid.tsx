"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Library, Media } from "@/lib/local/db";
import { renameMedia, setFav } from "@/lib/local/media";
import { aspectRatio, formatSize } from "@/lib/media/image";
import {
  arrange,
  childrenOf,
  descendants,
  libraryView,
  repOf,
  LIST_COLUMNS,
  shownName,
  type ListColumn,
} from "@/lib/media/logic";
import { useMediaPrefs } from "@/lib/media/prefs";
import { setRepresentative } from "@/lib/local/media";
import { useMediaState } from "./MediaContext";
import { libraryPaths } from "./PreviewPanel";
import { rememberOpenedFrom } from "./Lightbox";
import { DragOriginal, NameField, Thumb, ThumbImage } from "./Thumb";

/** マウス操作の端末か（タッチ端末では、タップで開き「選択」モードで選ぶ） */
export const isPointerFine = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(hover: hover) and (pointer: fine)").matches;

export function MediaGrid({
  list,
  selectMode,
  /** ライブラリーを開いているとき：そのライブラリー（印の付け替えに使う） */
  lib,
  empty = "画像がありません",
  size,
}: {
  list: Media[];
  selectMode: boolean;
  lib?: Library;
  empty?: string;
  /** 画像1枚の一辺（px）。画面の幅に合わせて決めたもの（useTileSize） */
  size: number;
}) {
  const {
    selected,
    setSelected,
    setViewing,
    libs,
    media,
    renaming: renamingAny,
    setRenaming,
    members,
    viewing,
    base,
    canEdit,
  } = useMediaState();
  // 拡大表示中の「名前を変更」は、上のバーの名前で書き換える。
  // 後ろの一覧でも入力欄を出すと、見えない入力欄に文字が入ってしまうので出さない
  const renaming = viewing ? null : renamingAny;
  const renamed = (id: string) => (name: string | null) => {
    setRenaming(null);
    if (name) void renameMedia(id, name);
  };
  const prefs = useMediaPrefs();
  const router = useRouter();
  // リスト表示で開いている子ライブラリー（ホームのライブラリーのリストと同じ覚え方）
  const [openLibs, setOpenLibs] = useState<string[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem("irai-note:media-list-open") ?? "[]",
      );
    } catch {
      return [];
    }
  });
  const toggleLib = (id: string) => {
    const next = openLibs.includes(id)
      ? openLibs.filter((x) => x !== id)
      : [...openLibs, id];
    setOpenLibs(next);
    try {
      localStorage.setItem("irai-note:media-list-open", JSON.stringify(next));
    } catch {
      // 覚えられなくても、このページの間は効く
    }
  };
  const anchor = useRef<string | null>(null);
  const ids = list.map((m) => m.id);
  const childReps = lib
    ? libs
        .filter((l) => l.parentId === lib.id)
        .map((k) => ({ lib: k, rep: repOf(media, k) }))
    : [];
  const parentRep = lib?.parentId ? repOf(media, lib) : undefined;
  // フォルダの印を付ける子ライブラリーの名前：「全て表示」のときは、子ライブラリーに入っている画像すべて。それ以外は代表の画像だけ
  const allMode = !!lib && prefs.libMode === "all";
  const folderMark = (m: Media): string[] =>
    allMode
      ? childrenOf(libs, lib!.id)
          .filter((k) =>
            m.libIds.some((x) => descendants(libs, k.id).includes(x)),
          )
          .map((k) => k.name)
      : childReps.filter((c) => c.rep === m.id).map((c) => c.lib.name);
  const markTitle = (names: string[]) =>
    `子ライブラリー「${names.join("」「")}」${allMode ? "の画像" : "の代表"}`;

  // サムネイルの位置を覚えてから開く（そこから拡大して出てくる）
  const openIn = (id: string, inList: string[]) => {
    rememberOpenedFrom(document.querySelector(`[data-media="${id}"] img`));
    setViewing(id, inList);
  };
  const open = (id: string) => {
    rememberOpenedFrom(document.querySelector(`[data-media="${id}"] img`));
    setViewing(id, ids);
  };

  const click = (e: React.MouseEvent, id: string) => {
    if (!isPointerFine()) {
      if (selectMode)
        setSelected(
          selected.includes(id)
            ? selected.filter((x) => x !== id)
            : [...selected, id],
        );
      else open(id);
      return;
    }
    const multi = e.ctrlKey || e.metaKey;
    if (e.shiftKey && anchor.current && ids.includes(anchor.current)) {
      const a = ids.indexOf(anchor.current);
      const b = ids.indexOf(id);
      const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
      if (a > b) range.reverse();
      setSelected(
        multi
          ? [...selected, ...range.filter((x) => !selected.includes(x))]
          : range,
      );
      return;
    }
    anchor.current = id;
    if (multi)
      setSelected(
        selected.includes(id)
          ? selected.filter((x) => x !== id)
          : [...selected, id],
      );
    else setSelected([id]);
  };

  // リスト表示で子ライブラリーを行として出すときは、画像が無くても一覧を出す
  const folderRows =
    prefs.imageView === "list" &&
    !!lib &&
    prefs.libMode === "rep" &&
    childReps.length > 0;
  if (!list.length && !folderRows)
    return <p className="py-6 text-sm text-muted">{empty}</p>;

  // リスト表示：1行に1枚（Windows のファイル一覧のように、小さいアイコンと名前・サイズ・容量・日時）
  if (prefs.imageView === "list") {
    // ライブラリーの中で「基本」の配置のときは、子ライブラリーの代表の画像の所に、その子ライブラリーの行を出す
    // （画像の無い子ライブラリーは先頭に）。行はダブルクリックで開く
    const asFolders = !!lib && prefs.libMode === "rep";
    // 名前の右に出す列（「並べ替えと表示」の詳細の表示/非表示で、出す・隠す・並べ替え）
    const cols = prefs.columns.filter((c) =>
      LIST_COLUMNS.some((x) => x.id === c),
    );
    const gridCols = {
      gridTemplateColumns: [
        "1fr",
        ...cols.map((c) => LIST_COLUMNS.find((x) => x.id === c)!.width),
      ].join(" "),
    };
    // 数の列は右寄せ
    const RIGHT: ListColumn[] = ["dpi", "pixels", "size"];
    // 列ごとの中身。入り切らない分は「…」で切り、カーソルを合わせると全部見える
    const cell = (c: ListColumn, text: string) => (
      <span
        key={c}
        title={text || undefined}
        className={`truncate text-muted ${RIGHT.includes(c) ? "text-right" : ""}`}
      >
        {text}
      </span>
    );
    // 画像の詳細（プレビューの詳細と同じ書き方）
    const detail = (c: ListColumn, m: Media): string => {
      switch (c) {
        case "fileName":
          return m.fileName;
        case "type":
          return (m.mime.replace("image/", "") || "不明").toUpperCase();
        case "dims":
          return `${m.width} × ${m.height}`;
        case "dpi":
          return m.dpi ? `${m.dpi} dpi` : "不明";
        case "pixels":
          return `${((m.width * m.height) / 1e6).toFixed(2)} MP`;
        case "ratio":
          return aspectRatio(m.width, m.height);
        case "size":
          return formatSize(m.size);
        case "date":
          return new Date(m.createdAt).toLocaleString("ja-JP", {
            dateStyle: "short",
            timeStyle: "short",
          });
        case "uploader":
          return (
            members.find((x) => x.userId === m.uploadedBy)?.displayName ?? "—"
          );
        case "libs":
          return libraryPaths(m, libs).join("、") || "未整理";
      }
    };
    // 子ライブラリーの行：種類（形式か画像サイズの、先に出ている方）と枚数だけ
    const kindCol = cols.find((c) => c === "type" || c === "dims");
    // 画像の行。depth は子ライブラリーを開いた中の深さ（右にずらす）、inList は拡大したときに左右で送る並び
    const imageRow = (
      m: Media,
      depth: number,
      inList: string[],
      usedBy: string[],
    ) => {
      const on = selected.includes(m.id);
      return (
        <div
          key={m.id}
          role="option"
          tabIndex={0}
          aria-selected={on}
          aria-label={m.name}
          data-media={m.id}
          data-name="画像"
          style={gridCols}
          onClick={(e) => (depth ? pick(e, m.id) : click(e, m.id))}
          onDoubleClick={() => openIn(m.id, inList)}
          onKeyDown={(e) => {
            if (e.key === "Enter") openIn(m.id, inList);
          }}
          className={`relative grid h-6 cursor-default items-center gap-3 rounded-[4px] px-2 select-none ${
            on ? "bg-accent/15 text-ink" : "hover:bg-tint"
          }`}
        >
          {renaming !== m.id && (
            <DragOriginal m={m} multiSelected={on && selected.length > 1} />
          )}
          <span
            className="flex min-w-0 items-center gap-2"
            style={{ paddingLeft: depth * 18 }}
          >
            {/* 子ライブラリーの行の ▸ と、画像の小さな四角の位置をそろえる */}
            {asFolders && <span className="-mr-1 w-5 shrink-0" />}
            <span className="h-4 w-4 shrink-0 overflow-hidden rounded-[3px] bg-line/40">
              <ThumbImage id={m.id} alt="" />
            </span>
            {renaming === m.id ? (
              <NameField
                name={m.name}
                onDone={renamed(m.id)}
                className="h-5 flex-1 text-sm"
              />
            ) : (
              <span className="truncate">{shownName(m, prefs.showExt)}</span>
            )}
            {m.fav && (
              <Icon
                name="star"
                size={12}
                className="shrink-0 text-yellow-500"
              />
            )}
            {usedBy.length > 0 && (
              <span title={markTitle(usedBy)} className="shrink-0 text-accent">
                <Icon name="folder" size={12} />
              </span>
            )}
          </span>
          {cols.map((c) => cell(c, detail(c, m)))}
        </div>
      );
    };
    // 開いた子ライブラリーの中では、Shift の範囲選択はせず、Ctrl で足す・外す、それ以外は1枚だけ選ぶ
    const pick = (e: React.MouseEvent, id: string) => {
      if (!isPointerFine()) return openIn(id, [id]);
      if (e.ctrlKey || e.metaKey)
        setSelected(
          selected.includes(id)
            ? selected.filter((x) => x !== id)
            : [...selected, id],
        );
      else setSelected([id]);
    };
    // 開いた子ライブラリーの中身：そのライブラリーの「基本」の並び。孫ライブラリーは、その代表の画像の所に行として出す
    const contents = (k: Library, depth: number): React.ReactNode => {
      const inner = arrange(libraryView(media, libs, k.id, "rep"), prefs);
      const innerIds = inner.map((x) => x.id);
      const kidReps = childrenOf(libs, k.id).map((c) => ({
        lib: c,
        rep: repOf(media, c),
      }));
      return (
        <>
          {kidReps.filter((c) => !c.rep).map((c) => folderRow(c.lib, depth))}
          {inner.map((m) => {
            const reps = kidReps.filter((c) => c.rep === m.id);
            if (reps.length) return reps.map((c) => folderRow(c.lib, depth));
            return imageRow(m, depth, innerIds, []);
          })}
        </>
      );
    };
    const folderRow = (k: Library, depth = 0): React.ReactNode => {
      const n = media.filter(
        (x) => !x.trashed && x.libIds.includes(k.id),
      ).length;
      const go = () => router.push(`${base}/lib/${k.id}`);
      const kids = childrenOf(libs, k.id);
      const expanded = openLibs.includes(k.id);
      return (
        <div key={`lib:${k.id}`}>
          <div
            role="link"
            tabIndex={0}
            aria-label={`子ライブラリー「${k.name}」`}
            title="ダブルクリックで開く"
            data-name="子ライブラリーの行"
            onDoubleClick={go}
            onKeyDown={(e) => e.key === "Enter" && go()}
            className="grid h-6 cursor-default items-center gap-3 rounded-[4px] px-2 outline-none select-none hover:bg-tint focus:bg-tint"
            style={gridCols}
          >
            <span
              className="flex min-w-0 items-center gap-1"
              style={{ paddingLeft: depth * 18 }}
            >
              {/* ホームのライブラリーのリストと同じ：▸ で、その中の子ライブラリーを下に開く */}
              <span className="grid w-5 shrink-0 place-items-center">
                {(kids.length > 0 || n > 0) && (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={`「${k.name}」の子ライブラリーを${expanded ? "閉じる" : "開く"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLib(k.id);
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    className={`grid h-5 w-5 place-items-center rounded-[4px] hover:bg-card ${expanded ? "text-accent" : "text-muted"}`}
                  >
                    <Icon name={expanded ? "dn" : "rt"} size={14} />
                  </button>
                )}
              </span>
              {/* フォルダは代表の画像を出さず、フォルダのアイコンだけ（画像の行の小さな四角と同じ位置） */}
              <span className="grid h-4 w-4 shrink-0 place-items-center text-accent">
                <Icon name="folder" size={16} />
              </span>
              <span className="ml-1 truncate font-bold">{k.name}</span>
            </span>
            {cols.map((c) =>
              cell(
                c,
                c === kindCol ? "子ライブラリー" : c === "size" ? `${n}枚` : "",
              ),
            )}
          </div>
          {expanded && contents(k, depth + 1)}
        </div>
      );
    };
    return (
      <div
        data-name="画像一覧"
        role="listbox"
        aria-multiselectable
        className="overflow-x-auto rounded-[10px] border border-line bg-card p-1 text-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget && isPointerFine()) setSelected([]);
        }}
      >
        {/* 幅に入り切らないときは、名前を切らずに横へスクロールする */}
        <div className="w-max min-w-full">
          <div
            aria-hidden
            className="grid gap-3 border-b border-line px-2 pb-1 text-xs text-muted"
            style={gridCols}
          >
            <span className="pl-6">名前</span>
            {cols.map((c) => (
              <span key={c} className={RIGHT.includes(c) ? "text-right" : ""}>
                {LIST_COLUMNS.find((x) => x.id === c)?.name}
              </span>
            ))}
          </div>
          {asFolders &&
            childReps.filter((c) => !c.rep).map((c) => folderRow(c.lib))}
          {list.map((m) => {
            const reps = childReps.filter((c) => c.rep === m.id);
            if (asFolders && reps.length)
              return reps.map((c) => folderRow(c.lib));
            return imageRow(m, 0, ids, folderMark(m));
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      data-name="画像一覧"
      className="grid gap-2.5"
      // 画像は決めた大きさちょうどで並べる（ライブラリーのカードの左の四角と同じ大きさにそろえる）
      style={{ gridTemplateColumns: `repeat(auto-fill, ${size}px)` }}
      onClick={(e) => {
        // 何もないところをクリックしたら選択を外す（マウス操作のとき）
        if (e.target === e.currentTarget && isPointerFine()) setSelected([]);
      }}
    >
      {list.map((m) => {
        const usedBy = folderMark(m);
        return (
          <Thumb
            key={m.id}
            m={m}
            selected={selected.includes(m.id)}
            order={
              selected.length > 1 && selected.includes(m.id)
                ? selected.indexOf(m.id) + 1
                : undefined
            }
            onClick={(e) => click(e, m.id)}
            onDoubleClick={() => open(m.id)}
            onFav={canEdit ? () => setFav([m.id], !m.fav) : undefined}
            renaming={renaming === m.id}
            onRenamed={renamed(m.id)}
            extra={
              // フォルダの印と代表のボタンは左上に並べる（いつも出る印を角に。複数選んでいるときは、選んだ順の番号の右）
              (lib?.parentId || usedBy.length > 0) && (
                <span
                  className={`absolute top-1 flex items-center gap-1 ${selected.length > 1 && selected.includes(m.id) ? "left-9" : "left-1"}`}
                >
                  {usedBy.length > 0 && (
                    // 子ライブラリーの印はアイコンだけ（名前はカーソルを置くと出る）
                    <span
                      title={markTitle(usedBy)}
                      aria-label={markTitle(usedBy)}
                      className="grid h-6 w-6 place-items-center rounded-full bg-accent text-accent-ink"
                    >
                      <Icon name="folder" size={14} />
                    </span>
                  )}
                  {lib?.parentId && canEdit && (
                    <button
                      title="親ライブラリーで、この子ライブラリーの代表として表示する画像にする"
                      aria-label="代表の画像にする"
                      aria-pressed={parentRep === m.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRepresentative(lib.id, m.id);
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      className={`grid h-8 w-8 place-items-center rounded-full bg-black/40 transition ${
                        parentRep === m.id
                          ? "text-accent opacity-100"
                          : "text-white opacity-0 group-hover:opacity-100 focus:opacity-100"
                      }`}
                    >
                      <Icon name="mark" size={16} />
                    </button>
                  )}
                </span>
              )
            }
          />
        );
      })}
    </div>
  );
}

const GAP = 10; // 画像の間（gap-2.5）

/**
 * 画像1枚の一辺を、並べる場所の幅に合わせて決める。選んだ大きさで入るだけ並べ、余った幅は少しずつ広げて埋める。
 * 広げるのは選んだ大きさの 1.4 倍まで（それより広い分は、行の右に余白として残す）
 */
// 最後に測った幅。ページを切り替えて作り直したときも、最初からこの幅で並べる（一瞬大きさが変わらないように）
let lastWidth = 0;

export function useTileSize(el: HTMLElement | null, base: number) {
  const [width, setWidth] = useState(lastWidth);
  // 画面に出す前に測る
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      lastWidth = el.clientWidth;
      setWidth(lastWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  if (!width) return base;
  const n = Math.max(1, Math.floor((width + GAP) / (base + GAP)));
  return Math.floor(Math.min((width - GAP * (n - 1)) / n, base * 1.4));
}
