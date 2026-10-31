"use client";

import { startTransition, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Library, Media } from "@/lib/local/db";
import { renameMedia, setFav } from "@/lib/local/media";
import { aspectRatio, formatSize } from "@/lib/media/image";
import {
  arrange,
  childrenOf,
  deepMedia,
  editableName,
  libraryView,
  repOf,
  LIST_COLUMNS,
  shownName,
  typeName,
  type ListColumn,
} from "@/lib/media/logic";
import { useMediaPrefs } from "@/lib/media/prefs";
import { setRepresentative } from "@/lib/local/media";
import { useMediaState } from "./MediaContext";
import { useMediaRouter } from "./MediaLink";
import { libraryPaths } from "./PreviewPanel";
import { rememberOpenedFrom } from "./Lightbox";
import { useCutMedia } from "./flows";
import { acceptsMoveDrag, beginMoveDrag, dropMoveDrag } from "./moveDrag";
import { DragOriginal, NameField, Thumb, ThumbImage, UploadGauge } from "./Thumb";

/** マウス操作の端末か（タッチ端末では、タップで開き「選択」モードで選ぶ） */
export const isPointerFine = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/**
 * 子ライブラリーのタイル。画像と同じ大きさで、代表の画像がのぞくフォルダの形。
 * 1回のクリックで選んだ印を付け、ダブルクリックで開く（タッチの端末はタップで開く）。画像を落とすと、このライブラリーへ移す
 */
function FolderTile({ lib }: { lib: Library }) {
  const { media, libs, base, boxId, setSelected } = useMediaState();
  const { iconStyle } = useMediaPrefs();
  const router = useMediaRouter();
  const [over, setOver] = useState(false);
  const explorer = iconStyle === "explorer";
  const rep = repOf(media, libs, lib);
  const count = deepMedia(media, libs, lib.id).length;
  const go = () => router.push(`${base}/lib/${lib.id}`);
  // 標準の見せ方は名前の札を下に重ねるので、札の分だけフォルダを上に寄せる
  const bottom = explorer ? "6%" : "24%";
  const art = (
    <span className="absolute inset-0" aria-hidden>
      <span className="absolute left-[8%] h-[12%] w-[34%] rounded-t-[6px] bg-accent/70" style={{ bottom: `calc(${bottom} + 62%)` }} />
      <span className="absolute inset-x-[8%] rounded-[8px] rounded-tl-none bg-accent/70" style={{ bottom, height: "64%" }} />
      <span className="absolute inset-x-[15%] overflow-hidden rounded-[4px] bg-card" style={{ bottom: `calc(${bottom} + 10%)`, height: "48%" }}>
        {rep && <ThumbImage id={rep} alt="" />}
      </span>
      <span className="absolute inset-x-[8%] flex items-end justify-end rounded-[8px] bg-accent px-1.5 py-0.5 text-xs font-bold text-accent-ink" style={{ bottom, height: "28%" }}>
        {count}
      </span>
    </span>
  );
  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`子ライブラリー「${lib.name}」 ${count}枚`}
      title="ダブルクリックで開く"
      data-name="子ライブラリー"
      data-lib-card={lib.id}
      onClick={() => (isPointerFine() ? setSelected([]) : go())}
      onDoubleClick={go}
      onKeyDown={(e) => e.key === "Enter" && go()}
      onDragOver={(e) => {
        if (!acceptsMoveDrag(e, boxId, lib.id)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!acceptsMoveDrag(e, boxId, lib.id)) return;
        e.preventDefault();
        dropMoveDrag(lib);
      }}
      className={
        explorer
          ? `group relative flex cursor-default flex-col items-center gap-1 rounded-[6px] border p-1.5 outline-none select-none focus:border-accent/50 focus:bg-accent/15 ${
              over ? "border-accent bg-accent/15" : "border-transparent hover:bg-tint"
            }`
          : `group relative aspect-square cursor-default overflow-hidden rounded-[12px] border border-line bg-card transition duration-300 select-none focus:outline-[3px] focus:-outline-offset-1 focus:outline-accent motion-safe:hover:-translate-y-[3px] active:scale-95 ${
              over ? "outline-[3px] -outline-offset-1 outline-accent" : ""
            }`
      }
    >
      {explorer ? (
        <>
          <span className="relative block aspect-square w-full">{art}</span>
          <span title={lib.name} className="line-clamp-2 w-full text-center text-xs leading-4 [overflow-wrap:anywhere]">
            {lib.name}
          </span>
        </>
      ) : (
        <>
          {art}
          <span className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-16px)] truncate rounded-[10px] bg-black/25 px-2.5 py-px text-xs font-bold text-white backdrop-blur-md [text-shadow:0_1px_3px_#000,0_0_8px_#000a]">
            {lib.name}
          </span>
        </>
      )}
    </div>
  );
}

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
    boxId,
    byId,
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
  const router = useMediaRouter();
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
  // リスト表示で、画像を落とそうとしている子ライブラリーの行
  const [overRow, setOverRow] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const ids = list.map((m) => m.id);
  // 最初は画面に入るぶんだけ描く（リスト表示は1行 24px、並べる表示は1枚の大きさから数える）
  const shown = useShownCount(
    list.length,
    typeof window === "undefined"
      ? 60
      : prefs.imageView === "list"
        ? Math.ceil(window.innerHeight / 24) + 10
        : Math.floor((window.innerWidth + GAP) / (size + GAP)) * (Math.ceil(window.innerHeight / (size + GAP)) + 1),
  );
  // ライブラリーの中では、子ライブラリーを画像の前に並べる（検索の結果には出さない）
  const folders = lib ? childrenOf(libs, lib.id) : [];
  const parentRep = lib?.parentId ? repOf(media, libs, lib) : undefined;
  // 切り取っている画像は、元のライブラリーの一覧で薄く出す
  const cut = useCutMedia();
  const isCut = (id: string) => !!lib && cut?.cutFrom === lib.id && cut.ids.includes(id);
  // 画像のドラッグを始めたら、落とす先のライブラリーに渡す分を覚える。選んでいる画像なら、選んでいる画像すべて
  const startDrag = (e: React.DragEvent) => {
    const id = (e.target as Element).closest<HTMLElement>("[data-media]")?.dataset.media;
    if (!id || !canEdit || byId.get(id)?.trashed) return;
    beginMoveDrag({ boxId, ids: selected.includes(id) ? selected : [id], from: lib?.id ?? null });
  };

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

  if (!list.length && !folders.length)
    return <p className="py-6 text-sm text-muted">{empty}</p>;

  // リスト表示：1行に1枚（Windows のファイル一覧のように、小さいアイコンと名前・サイズ・容量・日時）
  if (prefs.imageView === "list") {
    // ライブラリーの中では、子ライブラリーの行を先頭に出す。行はダブルクリックで開く
    const asFolders = !!lib;
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
          return typeName(m);
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
        case "made":
          return m.madeAt ? new Date(m.madeAt).toLocaleDateString("ja-JP") : "—";
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
    const imageRow = (m: Media, depth: number, inList: string[]) => {
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
          } ${isCut(m.id) ? "opacity-50" : ""}`}
        >
          {renaming !== m.id && <DragOriginal m={m} />}
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
                name={editableName(m)}
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
            <UploadGauge id={m.id} className="h-1.5 w-16 shrink-0 rounded-full bg-line" />
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
    // 開いた子ライブラリーの中身：孫ライブラリーの行のあとに、直接入っている画像
    const contents = (k: Library, depth: number): React.ReactNode => {
      const inner = arrange(libraryView(media, k.id), prefs);
      const innerIds = inner.map((x) => x.id);
      return (
        <>
          {childrenOf(libs, k.id).map((c) => folderRow(c, depth))}
          {inner.map((m) => imageRow(m, depth, innerIds))}
        </>
      );
    };
    const folderRow = (k: Library, depth = 0): React.ReactNode => {
      const n = deepMedia(media, libs, k.id).length;
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
            data-lib-card={k.id}
            onClick={() => (isPointerFine() ? setSelected([]) : go())}
            onDoubleClick={go}
            onKeyDown={(e) => e.key === "Enter" && go()}
            onDragOver={(e) => {
              if (!acceptsMoveDrag(e, boxId, k.id)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOverRow(k.id);
            }}
            onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOverRow(null)}
            onDrop={(e) => {
              setOverRow(null);
              if (!acceptsMoveDrag(e, boxId, k.id)) return;
              e.preventDefault();
              dropMoveDrag(k);
            }}
            className={`grid h-6 cursor-default items-center gap-3 rounded-[4px] px-2 outline-none select-none hover:bg-tint focus:bg-tint ${overRow === k.id ? "bg-tint outline-2 -outline-offset-2 outline-accent" : ""}`}
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
                    aria-label={`「${k.name}」の中を${expanded ? "閉じる" : "開く"}`}
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
        onDragStartCapture={startDrag}
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
          {folders.map((k) => folderRow(k))}
          {list.slice(0, shown).map((m) => imageRow(m, 0, ids))}
        </div>
      </div>
    );
  }

  return (
    <div
      data-name="画像一覧"
      className="grid gap-2.5"
      onDragStartCapture={startDrag}
      // 画像は決めた大きさちょうどで並べる（子ライブラリーのタイルも同じ大きさ）
      style={{ gridTemplateColumns: `repeat(auto-fill, ${size}px)` }}
      onClick={(e) => {
        // 何もないところをクリックしたら選択を外す（マウス操作のとき）
        if (e.target === e.currentTarget && isPointerFine()) setSelected([]);
      }}
    >
      {folders.map((k) => (
        <FolderTile key={k.id} lib={k} />
      ))}
      {list.slice(0, shown).map((m) => (
        <Thumb
          key={m.id}
          m={m}
          selected={selected.includes(m.id)}
          order={
            selected.length > 1 && selected.includes(m.id)
              ? selected.indexOf(m.id) + 1
              : undefined
          }
          dimmed={isCut(m.id)}
          onClick={(e) => click(e, m.id)}
          onDoubleClick={() => open(m.id)}
          onFav={canEdit ? () => setFav([m.id], !m.fav) : undefined}
          renaming={renaming === m.id}
          onRenamed={renamed(m.id)}
          extra={
            // 代表のボタンは左上に置く（複数選んでいるときは、選んだ順の番号の右）
            lib?.parentId && canEdit && (
              <span
                className={`absolute top-1 flex items-center gap-1 ${selected.length > 1 && selected.includes(m.id) ? "left-9" : "left-1"}`}
              >
                <button
                  title="親ライブラリーで、この子ライブラリーの表紙にする"
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
              </span>
            )
          }
        />
      ))}
    </div>
  );
}

const GAP = 10; // 画像の間（gap-2.5）

/**
 * 最初は画面に入るぶんの画像だけを描き、残りは画面を出したあとで、裏で描く。
 * 何百枚もある場所でも、押したらすぐ切り替わる（残りを描いている間も操作できる）
 */
function useShownCount(total: number, perScreen: number) {
  const [all, setAll] = useState(false);
  const rest = !all && total > perScreen;
  useEffect(() => {
    if (!rest) return;
    // 一度画面に出してから残りを描く（裏で少しずつ描くので、その間に画面が出る）
    const timer = setTimeout(() => startTransition(() => setAll(true)));
    return () => clearTimeout(timer);
  }, [rest]);
  return rest ? perScreen : total;
}

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
