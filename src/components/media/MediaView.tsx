"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import {
  MenuDivider,
  MenuItem,
  MenuLabel,
  Popover,
  usePopover,
} from "@/components/ui/Popover";
import type { Library, Media } from "@/lib/local/db";
import { renameLibrary, renameMedia, setFav } from "@/lib/local/media";
import { MEDIA_DRAG_TYPE } from "@/lib/media/export";
import {
  arrange,
  chain,
  childrenOf,
  coverOf,
  extOf,
  isUnsorted,
  libraryView,
  searchMedia,
  THUMB_SIZES,
} from "@/lib/media/logic";
import { useMediaPrefs } from "@/lib/media/prefs";
import {
  copyImageFlow,
  deleteForeverFlow,
  duplicateFlow,
  downloadFlow,
  removeFromLibraryFlow,
  restoreFlow,
  revertEditFlow,
  trashFlow,
  uploadFlow,
} from "./flows";
import { CoverCard } from "./LibraryCard";
import { ThumbImage } from "./Thumb";
import { useMediaState } from "./MediaContext";
import { MediaGrid, isPointerFine, useTileSize } from "./MediaGrid";
import { MediaSearch } from "./MediaSearch";
import { PreviewPanel, usePreviewWidth } from "./PreviewPanel";
import { SortMenu } from "./SortMenu";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";
import { TopBarActions } from "@/components/TopBarSlot";

export type MediaViewKind =
  | { kind: "home" | "unsorted" | "all" | "fav" | "trash" }
  | { kind: "lib"; id: string };

// ページを切り替えても続けて使う、プレビュー欄の開け閉めと空ける幅
let peekMemo: boolean | null = null;
let reserveMemo = 0;

const TITLES = {
  home: "メディア",
  unsorted: "未整理",
  all: "すべて",
  fav: "お気に入り",
  trash: "ゴミ箱",
} as const;

export function MediaView({ view }: { view: MediaViewKind }) {
  const s = useMediaState();
  const { media, libs, selected, setSelected, boxId, me, canEdit } = s;
  const prefs = useMediaPrefs();
  // カードの左の四角は、画像一覧の画像と同じ大きさ
  // 画像とカードの左の四角の大きさ：選んだ大きさを、画面の幅に合わせて少し広げたもの
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const cardSize = useTileSize(contentEl, THUMB_SIZES[prefs.level - 1]);
  const router = useRouter();
  const pathname = usePathname();
  const { base } = s;
  const [selectMode, setSelectMode] = useState(false);
  const [dragging, setDragging] = useState(false);
  // プレビュー欄を開いているか（最初は、広い画面なら開いておく）と、その幅。一覧はその分だけ右を空ける
  // ページを切り替えても開け閉めを保つ（最初は、広い画面なら開いておく）
  const [peek, setPeekState] = useState(() => {
    if (peekMemo === null)
      peekMemo = typeof window !== "undefined" && window.innerWidth >= 1280;
    return peekMemo;
  });
  const setPeek = (v: boolean) => {
    peekMemo = v;
    setPeekState(v);
  };

  const [previewWidth, setPreviewWidth] = usePreviewWidth();
  // 一覧の右に空ける幅。前のページの値から始める（ページを切り替えたときに一瞬広がらないように）
  const [reserve, setReserveState] = useState(reserveMemo);
  const setReserve = useCallback((px: number) => {
    reserveMemo = px;
    setReserveState(px);
  }, []);
  const ctx = usePopover();
  // 子ライブラリーの並びを閉じているか。端末ごとに覚える（どのライブラリーでも同じ）
  const [kidsClosed, setKidsClosed] = useState(() => {
    try {
      return localStorage.getItem("irai-note:media-kids-closed") === "1";
    } catch {
      return false;
    }
  });
  const toggleKids = () => {
    setKidsClosed(!kidsClosed);
    try {
      localStorage.setItem(
        "irai-note:media-kids-closed",
        kidsClosed ? "0" : "1",
      );
    } catch {
      // 覚えられなくても、このページの間は効く
    }
  };
  const [ctxKind, setCtxKind] = useState<"media" | "viewing" | "empty">(
    "media",
  );

  const lib =
    view.kind === "lib" ? libs.find((l) => l.id === view.id) : undefined;
  const viewingMedia = s.viewing ? s.byId.get(s.viewing.id) : undefined;
  const list = useMemo(() => {
    const alive = media.filter((m) => !m.trashed);
    switch (view.kind) {
      case "home":
        return arrange(media.filter(isUnsorted), prefs);
      case "unsorted":
        return arrange(media.filter(isUnsorted), prefs);
      case "all":
        return arrange(alive, prefs);
      case "fav":
        return arrange(
          alive.filter((m) => m.fav),
          prefs,
        );
      case "trash":
        return arrange(
          media.filter((m) => m.trashed),
          prefs,
        );
      case "lib":
        return lib
          ? arrange(libraryView(media, libs, lib.id, prefs.libMode), prefs)
          : [];
    }
  }, [view, media, libs, lib, prefs]);

  // 画面を移ったら選択を外す
  const viewKey = view.kind === "lib" ? `lib:${view.id}` : view.kind;
  useEffect(() => {
    setSelected([]);
  }, [viewKey, setSelected]);

  // 検索：今いる場所の中を探す（ホームではボックス全体。ゴミ箱の画像は、ゴミ箱を開いたときだけ）。
  // 言葉は場所ごとに持ち、ほかの場所へ移ったら消える。スマホでは、入力欄を広げている間は場所の表示を隠す
  const [search, setSearch] = useState({ key: viewKey, q: "" });
  const query = search.key === viewKey ? search.q : "";
  const searching = query.trim() !== "";
  const [searchExpanded, setSearchExpanded] = useState(false);
  const onQuery = (q: string) => {
    setSearch({ key: viewKey, q });
    // 見えなくなった画像を選んだままにしない（Delete でゴミ箱へ送ってしまわないように）
    setSelected([]);
  };
  const found = useMemo(() => {
    if (!searching) return list;
    const uploader = (id: string) => s.members.find((x) => x.userId === id)?.displayName ?? "";
    // ホームとライブラリーは、画面に出ている画像より広く探す（ボックス全体・子ライブラリーの画像も）
    const pool =
      view.kind === "home"
        ? arrange(media.filter((m) => !m.trashed), prefs)
        : view.kind === "lib" && lib
          ? arrange(media.filter((m) => !m.trashed && m.libIds.includes(lib.id)), prefs)
          : list;
    return searchMedia(pool, query, uploader);
  }, [searching, list, query, view.kind, media, lib, prefs, s.members]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName) ||
        document.querySelector('[role="dialog"]')
      )
        return;
      if (e.key === "Escape" && selected.length) setSelected([]);
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        canEdit &&
        selected.length &&
        view.kind !== "trash"
      ) {
        e.preventDefault();
        trashFlow(boxId, selected);
        setSelected([]);
      }
      // Ctrl+C：選んだ画像をコピー（Discord などに Ctrl+V で貼れる）
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && selected.length) {
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        copyImageFlow(selected.flatMap((id) => s.byId.get(id) ?? []));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "a" && (view.kind !== "home" || searching)) {
        e.preventDefault();
        setSelected(found.map((m) => m.id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, setSelected, view.kind, searching, boxId, found, s.byId, canEdit]);

  // 右クリック：大きく表示している画像・一覧の画像・ライブラリーの何もない所で、それぞれのメニューを出す
  const openCtx = ctx.openAt;
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as Element;
      if (viewingMedia && t.closest('[data-name="画像の大きな表示"]')) {
        setCtxKind("viewing");
      } else if (t.closest('[data-name="画像一覧"] [data-media]')) {
        const id = t.closest<HTMLElement>("[data-media]")!.dataset.media!;
        // 選んでいない画像を右クリックしたら、その画像だけを選ぶ
        if (!selected.includes(id)) setSelected([id]);
        setCtxKind("media");
      } else if (lib && t.closest('[data-name="メディア画面"]')) {
        setCtxKind("empty");
      } else return;
      openCtx(e);
    };
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, [viewingMedia, selected, setSelected, lib, openCtx]);

  if (view.kind === "lib" && !lib) {
    return (
      <p className="text-muted">
        ライブラリーが見つかりません。
        <Link href={base} className="underline">
          メディアのホームへ
        </Link>
      </p>
    );
  }

  const n = selected.length;
  const done = () => {
    setSelected([]);
    setSelectMode(false);
  };

  // 画像の名前を変える（右クリックの「名前を変更」）：名前が書いてある所が、その場で入力欄になる
  const renameImage = (id: string) => s.setRenaming(id);
  // 画像の操作は右クリックのメニューで出す（上のバーには並べ替えと表示だけ置く）
  const ctxItems = (): React.ReactNode => {
    const run = (fn: () => unknown) => () => {
      ctx.close();
      fn();
    };
    // 編集（iPhone の写真と同じ編集画面）。編集してある画像は、オリジナルに戻せる
    const editItems = (m: Media) => (
      <>
        <MenuItem
          icon={<Icon name="tune" size={16} />}
          onClick={run(() => s.setEditing(m.id))}
        >
          編集
        </MenuItem>
        {m.edited && (
          <MenuItem
            icon={<Icon name="restore" size={16} />}
            onClick={run(() => revertEditFlow(m))}
          >
            オリジナルに戻す
          </MenuItem>
        )}
      </>
    );
    // 見るだけのボックス：中身を変えない操作（コピー・ダウンロード）だけ
    if (!canEdit) {
      const items = ctxKind === "viewing" && viewingMedia ? [viewingMedia] : ctxKind === "media" ? selected.flatMap((id) => s.byId.get(id) ?? []) : [];
      if (!items.length) return null;
      return (
        <>
          <MenuLabel>見るだけのボックス</MenuLabel>
          {items.length === 1 && (
            <MenuItem icon={<Icon name="copy" size={16} />} onClick={run(() => copyImageFlow(items))}>
              画像をコピー
            </MenuItem>
          )}
          <MenuItem icon={<Icon name="download" size={16} />} onClick={run(() => downloadFlow(items))}>
            {items.length === 1 ? "ダウンロード" : `${items.length}枚を ZIP でダウンロード`}
          </MenuItem>
        </>
      );
    }
    if (ctxKind === "viewing" && viewingMedia) {
      return (
        <>
          <MenuItem
            icon={<Icon name="albumAdd" size={16} />}
            onClick={run(() => s.setOrganizing([viewingMedia.id]))}
          >
            整理
          </MenuItem>
          <MenuItem
            icon={<Icon name="edit" size={16} />}
            onClick={run(() => renameImage(viewingMedia.id))}
          >
            名前を変更
          </MenuItem>
          {!viewingMedia.trashed && editItems(viewingMedia)}
          <MenuItem
            icon={<Icon name="star" size={16} />}
            onClick={run(() => setFav([viewingMedia.id], !viewingMedia.fav))}
          >
            {viewingMedia.fav ? "お気に入りから外す" : "お気に入りに追加"}
          </MenuItem>
          {!viewingMedia.trashed && (
            <MenuItem
              icon={<Icon name="duplicate" size={16} />}
              onClick={run(() => duplicateFlow([viewingMedia.id], me.id))}
            >
              複製
            </MenuItem>
          )}
          <MenuItem
            icon={<Icon name="copy" size={16} />}
            onClick={run(() => copyImageFlow([viewingMedia]))}
          >
            画像をコピー
          </MenuItem>
          <MenuItem
            icon={<Icon name="download" size={16} />}
            onClick={run(() => downloadFlow([viewingMedia]))}
          >
            ダウンロード
          </MenuItem>
          {!viewingMedia.trashed && (
            <>
              <MenuDivider />
              <MenuItem
                danger
                icon={<Icon name="del" size={16} />}
                onClick={run(() => {
                  const v = s.viewing!;
                  const rest = v.list.filter((x) => x !== viewingMedia.id);
                  const at = v.list.indexOf(viewingMedia.id);
                  trashFlow(boxId, [viewingMedia.id]);
                  s.setViewing(rest[at] ?? rest[at - 1] ?? null, rest);
                })}
              >
                ゴミ箱へ
              </MenuItem>
            </>
          )}
        </>
      );
    }
    if (ctxKind === "empty" && lib) {
      return (
        <MenuItem
          icon={<Icon name="add" size={16} />}
          onClick={run(() => s.setAddingTo(lib.id))}
        >
          このライブラリーに画像を追加
        </MenuItem>
      );
    }
    if (!n) return null;
    const label = <MenuLabel>{n}枚の画像</MenuLabel>;
    if (view.kind === "trash") {
      return (
        <>
          {label}
          <MenuItem
            icon={<Icon name="restore" size={16} />}
            onClick={run(() => restoreFlow(selected).then(done))}
          >
            復元
          </MenuItem>
          <MenuDivider />
          <MenuItem
            danger
            icon={<Icon name="del" size={16} />}
            onClick={run(() =>
              deleteForeverFlow(selected, media, me.id).then(done),
            )}
          >
            完全に削除
          </MenuItem>
        </>
      );
    }
    const allFav = selected.every((id) => s.byId.get(id)?.fav);
    const selectedMedia = selected.flatMap((id) => s.byId.get(id) ?? []);
    return (
      <>
        {label}
        <MenuItem
          icon={<Icon name="albumAdd" size={16} />}
          onClick={run(() => s.setOrganizing(selected))}
        >
          整理
        </MenuItem>
        {n === 1 && (
          <MenuItem
            icon={<Icon name="edit" size={16} />}
            onClick={run(() => renameImage(selected[0]))}
          >
            名前を変更
          </MenuItem>
        )}
        {n === 1 && selectedMedia[0] && editItems(selectedMedia[0])}
        <MenuItem
          icon={<Icon name="star" size={16} />}
          onClick={run(() => setFav(selected, !allFav).then(done))}
        >
          {allFav ? "お気に入りから外す" : "お気に入りに追加"}
        </MenuItem>
        <MenuItem
          icon={<Icon name="duplicate" size={16} />}
          onClick={run(() => duplicateFlow(selected, me.id).then(done))}
        >
          {n === 1 ? "複製" : `${n}枚を複製`}
        </MenuItem>
        {n === 1 && (
          <MenuItem
            icon={<Icon name="copy" size={16} />}
            onClick={run(() => copyImageFlow(selectedMedia))}
          >
            画像をコピー
          </MenuItem>
        )}
        <MenuItem
          icon={<Icon name="download" size={16} />}
          // 複数のときは ZIP にまとめる
          onClick={run(() => downloadFlow(selectedMedia))}
        >
          {n === 1 ? "ダウンロード" : `${n}枚を ZIP でダウンロード`}
        </MenuItem>
        {lib && (
          <MenuItem
            icon={<Icon name="out" size={16} />}
            onClick={run(() =>
              removeFromLibraryFlow(boxId, lib, selected).then(done),
            )}
          >
            このライブラリーから出す
          </MenuItem>
        )}
        <MenuDivider />
        <MenuItem
          danger
          icon={<Icon name="del" size={16} />}
          onClick={run(() => trashFlow(boxId, selected).then(done))}
        >
          ゴミ箱へ
        </MenuItem>
      </>
    );
  };

  const crumbs = lib ? chain(libs, lib.id) : [];
  // 上の場所のリンクを押したら、拡大表示を閉じる（同じページでも閉じて一覧に戻る）
  const closeViewing = () => s.setViewing(null);

  // 上のバーの場所：今開いているものより前（リンク）と、今開いているもの
  const crumbItems: Crumb[] = [];
  if (view.kind !== "home" || viewingMedia)
    crumbItems.push({ key: "media", label: s.title, href: base });
  if (view.kind !== "home" && view.kind !== "lib" && viewingMedia)
    crumbItems.push({ key: "view", label: TITLES[view.kind], href: pathname });
  crumbs.forEach((c, i) => {
    if (i < crumbs.length - 1 || viewingMedia)
      crumbItems.push({
        key: c.id,
        label: c.name,
        href: `${base}/lib/${c.id}`,
      });
  });
  const curLib = !viewingMedia ? crumbs.at(-1) : undefined;
  const currentLabel =
    viewingMedia?.name ??
    curLib?.name ??
    (view.kind === "lib" ? "" : view.kind === "home" ? s.title : TITLES[view.kind]);
  const currentCrumb = !canEdit ? (
    // 見るだけのボックスでは、名前を書き換えられない
    <b className="truncate px-1">{currentLabel}</b>
  ) : viewingMedia ? (
    <InlineName
      key={`${viewingMedia.id}${s.renaming === viewingMedia.id ? ":edit" : ""}`}
      name={viewingMedia.name}
      suffix={prefs.showExt ? `.${extOf(viewingMedia)}` : undefined}
      startEditing={s.renaming === viewingMedia.id}
      onEditEnd={() => s.setRenaming(null)}
      onRename={(name) => renameMedia(viewingMedia.id, name)}
    />
  ) : curLib ? (
    <InlineName
      key={curLib.id}
      name={curLib.name}
      onRename={(name) => renameLibrary(curLib.id, name)}
    />
  ) : (
    <b className="truncate px-1">{currentLabel}</b>
  );

  return (
    <div
      data-name="メディア画面"
      className="relative"
      style={{ marginRight: reserve }}
      onDragOver={(e) => {
        // アプリの中の画像をドラッグしているときは、ファイルの追加として扱わない。見るだけのボックスには入れられない
        if (e.dataTransfer.types.includes(MEDIA_DRAG_TYPE) || !canEdit) return;
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        if (
          !e.dataTransfer.files.length ||
          e.dataTransfer.types.includes(MEDIA_DRAG_TYPE) ||
          !canEdit
        )
          return;
        e.preventDefault();
        setDragging(false);
        uploadFlow(boxId, me.id, [...e.dataTransfer.files], () =>
          router.push(`${base}/unsorted`),
        );
      }}
    >
      {/* 場所と操作は、メイン画面の上の細いバーに出す（ボタンはバーの高さに合わせて低くする） */}
      <TopBarActions>
        <div
          data-name="メディアの場所と操作"
          className="flex min-w-0 flex-1 items-center gap-2 [&_.btn]:min-h-7 [&_.btn-sub]:min-h-7 [&_.h-8]:h-7 [&_.w-10]:w-8 [&_.w-8]:w-7"
        >
          <nav
            data-name="パンくず（現在の場所）"
            aria-label="現在の場所"
            className={`${searchExpanded && !viewingMedia ? "hidden md:flex" : "flex"} min-w-0 flex-1 items-center gap-1`}
          >
            <Icon name="img" size={16} className="shrink-0" />
            {/* 名前を変えられるのは今開いているものだけ。画像を拡大している間は、上の場所はすべて移動するためのリンク（押すと拡大を閉じる） */}
            <Breadcrumbs
              items={crumbItems}
              current={currentCrumb}
              currentLabel={currentLabel}
              onNavigate={closeViewing}
            />
          </nav>
          {!viewingMedia && (
            <MediaSearch
              query={query}
              onQuery={onQuery}
              expanded={searchExpanded}
              onExpand={setSearchExpanded}
            />
          )}
          {!viewingMedia && (
            <div
              data-name="操作ボタン"
              className="flex shrink-0 items-center justify-end gap-2"
            >
              {n > 0 && (
                <span className="text-sm whitespace-nowrap text-muted">
                  {n}枚選択中
                </span>
              )}
              <SortMenu showLibMode={view.kind === "lib"} />
              {/* タッチの端末だけ：複数の画像を選ぶための切り替え */}
              {!isPointerFine() && (
                <button
                  className={selectMode ? "btn" : "btn-sub"}
                  onClick={() => (selectMode ? done() : setSelectMode(true))}
                >
                  {selectMode ? "完了" : "選択"}
                </button>
              )}
            </div>
          )}
        </div>
      </TopBarActions>
      <Popover
        anchor={ctx.anchor}
        onClose={ctx.close}
        width={240}
        label="画像のメニュー"
      >
        {ctxItems()}
      </Popover>

      <div className="flex gap-5">
        <div ref={setContentEl} className="min-w-0 flex-1">
          {searching ? (
            <>
              <p data-name="検索の結果" className="mb-2 text-sm text-muted">
                {view.kind === "home"
                  ? "ボックス全体"
                  : `「${view.kind === "lib" ? (lib?.name ?? "") : TITLES[view.kind]}」の中`}
                から「{query.trim()}」で探した結果：{found.length}枚
              </p>
              <MediaGrid
                size={cardSize}
                list={found}
                selectMode={selectMode}
                empty="見つかりませんでした"
              />
            </>
          ) : view.kind === "home" ? (
            <MediaHome selectMode={selectMode} size={cardSize} />
          ) : (
            <>
              {/* リスト表示で「基本」の配置のときは、子ライブラリーは画像の一覧の中に行として出すので、ここには出さない */}
              {lib &&
                childrenOf(libs, lib.id).length > 0 &&
                !(prefs.imageView === "list" && prefs.libMode === "rep") && (
                  <>
                    {/* 見出しを押すと、子ライブラリーの並びを閉じる・開く */}
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="font-bold">
                        <button
                          type="button"
                          aria-expanded={!kidsClosed}
                          onClick={toggleKids}
                          className="-ml-1 flex items-center gap-1 rounded-[8px] px-1 hover:bg-tint"
                        >
                          <Icon name={kidsClosed ? "rt" : "dn"} size={16} />
                          子ライブラリー
                          {kidsClosed && (
                            <span className="text-sm font-normal text-muted">
                              {childrenOf(libs, lib.id).length}
                            </span>
                          )}
                        </button>
                      </h3>
                    </div>
                    {!kidsClosed &&
                      (prefs.imageView === "list" ? (
                        <div className="mb-5">
                          <LibraryList parentId={lib.id} />
                        </div>
                      ) : (
                        <div
                          data-name="子ライブラリーの並び"
                          className="mb-5 flex flex-wrap gap-2.5"
                        >
                          {childrenOf(libs, lib.id).map((k) => (
                            <CoverCard
                              size={cardSize}
                              key={k.id}
                              href={`${base}/lib/${k.id}`}
                              openOnDoubleClick
                              name={k.name}
                              covers={coverOf(media, k)}
                            />
                          ))}
                        </div>
                      ))}
                    <h3 className="mb-2 font-bold">画像</h3>
                  </>
                )}
              <MediaGrid
                size={cardSize}
                list={list}
                selectMode={selectMode}
                lib={lib}
                empty={
                  view.kind === "lib"
                    ? "まだ画像がありません。上の＋から画像を追加できます。"
                    : view.kind === "trash"
                      ? "ゴミ箱は空です"
                      : "画像がありません"
                }
              />
            </>
          )}
        </div>
        <PreviewPanel
          open={peek}
          onToggle={() => setPeek(!peek)}
          width={previewWidth}
          onWidth={setPreviewWidth}
          onReserve={setReserve}
        />
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-accent/20 text-xl font-bold">
          ここにドロップして画像を追加
        </div>
      )}
    </div>
  );
}

function MediaHome({
  selectMode,
  size,
}: {
  selectMode: boolean;
  size: number;
}) {
  const { media, libs, base, canEdit } = useMediaState();
  const prefs = useMediaPrefs();
  // カードの左の四角は、画像一覧の画像と同じ大きさ
  const cardSize = size;
  const alive = media.filter((m) => !m.trashed);
  const unsorted = arrange(media.filter(isUnsorted), prefs);
  const fav = alive.filter((m) => m.fav);
  const trash = media.filter((m) => m.trashed);
  const recent = (arr: typeof media) => arr.slice(-3).reverse();

  if (!media.length) {
    return (
      <div className="card text-center">
        <p className="mb-1 font-bold">まだ画像がありません</p>
        <p className="text-sm text-muted">
          {canEdit ? "サイドバーの「メディアを追加」を押すか、この画面に画像をドラッグしてください。" : "このボックスは見るだけです。"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {unsorted.length > 0 && (
        <section>
          <h3 className="mb-2 font-bold">
            未整理 <span className="text-muted">{unsorted.length}</span>
          </h3>
          <MediaGrid list={unsorted} selectMode={selectMode} size={size} />
        </section>
      )}
      <section>
        <h3 className="mb-2 font-bold">一覧</h3>
        {prefs.imageView === "list" ? (
          // リスト表示：ライブラリーのリストと同じ形（1行に1つ。こちらはライブラリーではないので1回のクリックで開く）
          <ul
            data-name="一覧のリスト"
            className="rounded-[10px] border border-line bg-card p-1 text-sm"
          >
            {(
              [
                ["all", "すべて", "img", alive.length],
                ["favorites", "お気に入り", "star", fav.length],
                ["trash", "ゴミ箱", "del", trash.length],
              ] as const
            ).map(([path, name, icon, n]) => (
              <li key={path}>
                <Link
                  href={`${base}/${path}`}
                  className="flex h-6 items-center gap-2 rounded-[4px] pr-3 pl-[26px] hover:bg-tint"
                >
                  <Icon name={icon} size={16} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <span className="w-12 shrink-0 text-right text-muted">
                    {n}枚
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-wrap gap-2.5">
            <CoverCard
              size={cardSize}
              href={`${base}/all`}
              name="すべて"
              covers={recent(alive)}
              count={alive.length}
            />
            <CoverCard
              size={cardSize}
              href={`${base}/favorites`}
              name="お気に入り"
              covers={recent(fav)}
              count={fav.length}
            />
            <CoverCard
              size={cardSize}
              href={`${base}/trash`}
              name="ゴミ箱"
              covers={recent(trash)}
              count={trash.length}
            />
          </div>
        )}
      </section>
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="font-bold">ライブラリー</h3>
        </div>
        {childrenOf(libs, null).length ? (
          prefs.imageView === "list" ? (
            <LibraryList parentId={null} />
          ) : (
            <LibraryRows size={cardSize} />
          )
        ) : (
          <p className="text-sm text-muted">
            {canEdit ? "ライブラリーはまだありません。サイドバーの「ライブラリー」の＋から作れます。" : "ライブラリーはありません。"}
          </p>
        )}
      </section>
    </div>
  );
}

// ホームのライブラリーで開いている道筋（段ごとに開いたライブラリーの ID）。端末ごとに覚える
const HOME_OPEN_KEY = "irai-note:media-home-open-path";

/**
 * ホームのライブラリー：段ごとに横1列に並べる（はみ出したら横スクロール）。
 * 子ライブラリーがあるカードは右下のボタンで開け、開くとその下の段に子ライブラリーが並ぶ。
 * 1つの段で開けるのは1つ（開いた道筋が、上から下への階層になる）
 */
function LibraryRows({ size }: { size: number }) {
  const { media, libs, base } = useMediaState();
  const [saved, setSaved] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HOME_OPEN_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  // 消えたライブラリーや、親子が変わったところから先は捨てる
  const path: string[] = [];
  for (const id of saved) {
    const l = libs.find((x) => x.id === id);
    if (
      !l ||
      l.parentId !== (path.at(-1) ?? null) ||
      !childrenOf(libs, id).length
    )
      break;
    path.push(id);
  }
  const toggle = (depth: number, id: string) => {
    const next =
      path[depth] === id ? path.slice(0, depth) : [...path.slice(0, depth), id];
    setSaved(next);
    try {
      localStorage.setItem(HOME_OPEN_KEY, JSON.stringify(next));
    } catch {
      // 覚えられなくても、このページの間は効く
    }
  };
  const card = (l: Library, depth: number) => {
    const kids = childrenOf(libs, l.id).length;
    const open = path[depth] === l.id;
    return (
      <div key={l.id} className="shrink-0">
        <CoverCard
          size={size}
          href={`${base}/lib/${l.id}`}
          openOnDoubleClick
          name={l.name}
          covers={coverOf(media, l)}
        >
          {/* 「整理」の画面と同じ：右下のボタンで子ライブラリーを開く（閉じているときは右向き、開くと下向き。下の段に並ぶ） */}
          {kids > 0 && (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`「${l.name}」の子ライブラリーを${open ? "閉じる" : "開く"}`}
              title={`子ライブラリー ${kids}`}
              onClick={() => toggle(depth, l.id)}
              className={`absolute right-0 -bottom-1 grid h-7 w-7 place-items-center rounded-full hover:bg-tint ${open ? "text-accent" : ""}`}
            >
              <Icon name={open ? "dn" : "rt"} />
            </button>
          )}
        </CoverCard>
      </div>
    );
  };
  // 「整理」の画面と同じ並べ方：一番上の段に最上位のライブラリー、開いたライブラリーごとに下の段へ子ライブラリー。
  // 各段は、入りきらなければ折り返して並べる
  const rows: { parent: Library | null; list: Library[] }[] = [
    { parent: null, list: childrenOf(libs, null) },
  ];
  for (const id of path)
    rows.push({
      parent: libs.find((l) => l.id === id)!,
      list: childrenOf(libs, id),
    });

  return (
    <div data-name="ライブラリーの並び" className="space-y-3">
      {rows.map(({ parent, list }, depth) => (
        <div
          key={parent?.id ?? "root"}
          data-name={parent ? `「${parent.name}」の子ライブラリー` : undefined}
        >
          {parent && (
            <p className="mb-1 text-sm text-muted">
              「{parent.name}」の子ライブラリー
            </p>
          )}
          <div className="flex flex-wrap items-start gap-2.5">
            {list.map((l) => card(l, depth))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 上のバーの名前。ダブルクリックでその場で入力欄になる（Enter か外を押すと保存、Esc でやめる。空にしたら元のまま） */
function InlineName({
  name,
  onRename,
  startEditing = false,
  onEditEnd,
  suffix,
}: {
  name: string;
  /** 名前の後ろに付けて見せる文字（拡張子）。書き換えるのは名前だけ */
  suffix?: string;
  onRename: (name: string) => unknown;
  /** 最初から入力欄で出す（右クリックの「名前を変更」から） */
  startEditing?: boolean;
  onEditEnd?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(startEditing ? name : null);
  // 入力欄になったら、そこに入力の場所を移して名前を全部選ぶ（そのまま打てば書き換わる）
  const input = useRef<HTMLInputElement>(null);
  const editing = draft !== null;
  useEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);
  const save = () => {
    const v = draft?.trim() ?? "";
    setDraft(null);
    onEditEnd?.();
    if (v && v !== name) void onRename(v);
  };
  return draft !== null ? (
    <input
      ref={input}
      value={draft}
      aria-label="名前"
      size={Math.max(6, [...draft].length * 2 + 2)}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={save}
      onKeyDown={(e) => {
        // 日本語の変換を決めるための Enter では保存しない
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          setDraft(null);
          onEditEnd?.();
        }
      }}
      className="h-6 min-w-0 rounded-[6px] border border-accent bg-card px-1 text-sm font-bold outline-none"
    />
  ) : (
    <button
      onDoubleClick={() => setDraft(name)}
      title="ダブルクリックで名前を変える"
      className="truncate rounded-[6px] px-1 py-0.5 font-bold hover:bg-tint"
    >
      {name}
      {suffix}
    </button>
  );
}

// リスト表示で開いているライブラリー。端末ごとに覚える
const LIST_OPEN_KEY = "irai-note:media-list-open";

/**
 * ライブラリーのリスト表示：1行に1つ（代表の画像・名前・画像の枚数）。
 * 子ライブラリーは左の ▸ で開き、一段右にずらして下に並べる（サイドバーと同じ形）
 */
function LibraryList({ parentId }: { parentId: string | null }) {
  const { media, libs, base } = useMediaState();
  const router = useRouter();
  const [openIds, setOpenIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(LIST_OPEN_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  const toggle = (id: string) => {
    const next = openIds.includes(id)
      ? openIds.filter((x) => x !== id)
      : [...openIds, id];
    setOpenIds(next);
    try {
      localStorage.setItem(LIST_OPEN_KEY, JSON.stringify(next));
    } catch {
      // 覚えられなくても、このページの間は効く
    }
  };
  const count = (l: Library) =>
    media.filter((m) => !m.trashed && m.libIds.includes(l.id)).length;

  const rows = (pid: string | null, depth: number): React.ReactNode =>
    childrenOf(libs, pid).map((l) => {
      const kids = childrenOf(libs, l.id).length;
      const open = openIds.includes(l.id);
      const cover = coverOf(media, l)[0];
      return (
        <li key={l.id}>
          <div
            className="flex h-6 items-center gap-0.5 rounded-[4px] pr-3 text-sm hover:bg-tint"
            style={{ paddingLeft: 4 + depth * 18 }}
          >
            <span className="grid w-5 shrink-0 place-items-center">
              {kids > 0 && (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`「${l.name}」の子ライブラリーを${open ? "閉じる" : "開く"}`}
                  onClick={() => toggle(l.id)}
                  className={`grid h-5 w-5 place-items-center rounded-[4px] hover:bg-card ${open ? "text-accent" : "text-muted"}`}
                >
                  <Icon name={open ? "dn" : "rt"} size={14} />
                </button>
              )}
            </span>
            <div
              role="link"
              tabIndex={0}
              title="ダブルクリックで開く"
              onDoubleClick={() =>
                router.push(`${base}/lib/${l.id}`)
              }
              onKeyDown={(e) =>
                e.key === "Enter" &&
                router.push(`${base}/lib/${l.id}`)
              }
              className="flex h-full min-w-0 flex-1 cursor-default items-center gap-2 outline-none select-none"
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center overflow-hidden rounded-[3px] bg-line/40 text-muted">
                {cover ? (
                  <ThumbImage id={cover.id} alt="" />
                ) : (
                  <Icon name="folder" size={14} />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              {kids > 0 && (
                <span className="shrink-0 text-xs text-muted">
                  子ライブラリー {kids}
                </span>
              )}
              <span className="w-12 shrink-0 text-right text-sm text-muted">
                {count(l)}枚
              </span>
            </div>
          </div>
          {open && kids > 0 && <ul>{rows(l.id, depth + 1)}</ul>}
        </li>
      );
    });

  return (
    // 幅に入り切らないときは、名前を切らずに横へスクロールする
    <div className="overflow-x-auto rounded-[10px] border border-line bg-card p-1">
      <ul data-name="ライブラリーのリスト" className="w-max min-w-full">
        {rows(parentId, 0)}
      </ul>
    </div>
  );
}
