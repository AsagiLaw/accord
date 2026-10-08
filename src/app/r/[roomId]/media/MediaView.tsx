"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { promptText } from "@/components/ui/overlay";
import { renameMedia, setFav } from "@/lib/local/media";
import { useBlobUrl } from "@/lib/media/blob-url";
import { arrange, chain, childrenOf, coverOf, isUnsorted, libraryView } from "@/lib/media/logic";
import { useMediaPrefs } from "@/lib/media/prefs";
import {
  deleteForeverFlow,
  groupFlow,
  removeFromLibraryFlow,
  renameLibraryFlow,
  restoreFlow,
  trashFlow,
  uploadFlow,
} from "./flows";
import { CoverCard } from "./LibraryCard";
import { useMediaState } from "./MediaContext";
import { MediaGrid, isPointerFine } from "./MediaGrid";
import { PreviewPanel } from "./PreviewPanel";
import { SortMenu } from "./SortMenu";

export type MediaViewKind = { kind: "home" | "unsorted" | "all" | "fav" | "trash" } | { kind: "lib"; id: string };

const TITLES = { home: "メディア", unsorted: "整理されていない画像", all: "すべて", fav: "お気に入り", trash: "ゴミ箱" } as const;

export function MediaView({ view }: { view: MediaViewKind }) {
  const s = useMediaState();
  const { media, libs, selected, setSelected, roomId, me } = s;
  const prefs = useMediaPrefs();
  const router = useRouter();
  const base = `/r/${roomId}/media`;
  const [selectMode, setSelectMode] = useState(false);
  const [dragging, setDragging] = useState(false);

  const lib = view.kind === "lib" ? libs.find((l) => l.id === view.id) : undefined;
  const viewingMedia = s.viewing ? s.byId.get(s.viewing.id) : undefined;
  const originalUrl = useBlobUrl(viewingMedia?.id, "original");
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
        return arrange(alive.filter((m) => m.fav), prefs);
      case "trash":
        return arrange(
          media.filter((m) => m.trashed),
          prefs,
        );
      case "lib":
        return lib ? arrange(libraryView(media, libs, lib.id, prefs.libMode), prefs) : [];
    }
  }, [view, media, libs, lib, prefs]);

  // 画面を移ったら選択を外す
  const viewKey = view.kind === "lib" ? `lib:${view.id}` : view.kind;
  useEffect(() => {
    setSelected([]);
  }, [viewKey, setSelected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName) || document.querySelector('[role="dialog"]')) return;
      if (e.key === "Escape" && selected.length) setSelected([]);
      if ((e.key === "Delete" || e.key === "Backspace") && selected.length && view.kind !== "trash") {
        e.preventDefault();
        trashFlow(roomId, selected);
        setSelected([]);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "a" && view.kind !== "home") {
        e.preventDefault();
        setSelected(list.map((m) => m.id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, setSelected, view.kind, roomId, list]);

  if (view.kind === "lib" && !lib) {
    return (
      <p className="text-muted">
        ライブラリーが見つかりません。<Link href={base} className="underline">メディアのホームへ</Link>
      </p>
    );
  }

  const n = selected.length;
  const done = () => {
    setSelected([]);
    setSelectMode(false);
  };

  const actions =
    view.kind === "trash" ? (
      <>
        <button className="btn-sub" disabled={!n} onClick={() => restoreFlow(selected).then(done)}>
          <Icon name="restore" />
          復元
        </button>
        <button className="btn-sub text-warn" disabled={!n} onClick={() => deleteForeverFlow(selected, media, me.id).then(done)}>
          完全に削除
        </button>
      </>
    ) : (
      <>
        <button className="btn" disabled={!n} onClick={() => s.setOrganizing(selected)}>
          整理
        </button>
        {n > 0 && (
          <>
            <button className="btn-sub" onClick={() => setFav(selected, true).then(done)} title="お気に入りに追加">
              <Icon name="star" />
              <span className="hidden lg:inline">お気に入り</span>
            </button>
            <button className="btn-sub" onClick={() => groupFlow(roomId, selected, lib).then(done)} title="選んだ画像で新しいライブラリーを作る">
              <Icon name="folder" />
              <span className="hidden lg:inline">まとめる</span>
            </button>
            {lib && (
              <button className="btn-sub" onClick={() => removeFromLibraryFlow(roomId, lib, selected).then(done)} title="このライブラリーから出す">
                <span className="hidden lg:inline">ライブラリーから出す</span>
                <span className="lg:hidden">出す</span>
              </button>
            )}
            <button className="btn-sub" onClick={() => trashFlow(roomId, selected).then(done)} title="ゴミ箱へ">
              <Icon name="del" />
            </button>
          </>
        )}
      </>
    );

  const crumbs = lib ? chain(libs, lib.id) : [];

  return (
    <div
      data-name="メディア画面"
      className="relative"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        uploadFlow(roomId, me.id, [...e.dataTransfer.files], () => router.push(`${base}/unsorted`));
      }}
    >
      {/* 上部の操作バー */}
      <div data-name="上部の操作バー" className="sticky -top-4 z-20 -mx-[clamp(16px,4vw,40px)] mb-4 flex flex-wrap items-center gap-2 border-b border-line bg-bg/90 px-[clamp(16px,4vw,40px)] py-3 backdrop-blur">
        <nav data-name="パンくず（現在の場所）" aria-label="現在の場所" className="flex min-w-0 flex-1 items-center gap-1 text-lg">
          {view.kind === "home" ? (
            <b>メディア</b>
          ) : (
            <Link href={base} className="shrink-0 text-muted hover:text-ink">
              メディア
            </Link>
          )}
          {view.kind !== "home" && view.kind !== "lib" && (
            <>
              <Icon name="rt" size={14} className="shrink-0 text-muted" />
              <b className="truncate">{TITLES[view.kind]}</b>
            </>
          )}
          {crumbs.map((c, i) => (
            <span key={c.id} className="flex min-w-0 items-center gap-1">
              <Icon name="rt" size={14} className="shrink-0 text-muted" />
              {i < crumbs.length - 1 ? (
                <Link href={`${base}/lib/${c.id}`} className="truncate text-muted hover:text-ink">
                  {c.name}
                </Link>
              ) : (
                <button className="truncate font-bold hover:underline" title="クリックして名前を変更" onClick={() => renameLibraryFlow(c)}>
                  {c.name}
                </button>
              )}
            </span>
          ))}
          {lib && !viewingMedia && (
            <button className="btn-sub ml-1 h-8 min-h-0 w-8 shrink-0 px-0" aria-label="このライブラリーに画像を追加" title="画像を追加" onClick={() => s.setAddingTo(lib.id)}>
              <Icon name="add" />
            </button>
          )}
          {viewingMedia && (
            <span className="flex min-w-0 items-center gap-1">
              <Icon name="rt" size={14} className="shrink-0 text-muted" />
              <button
                className="truncate font-bold hover:underline"
                title="クリックして名前を変更"
                onClick={async () => {
                  const name = await promptText("画像の名前", viewingMedia.name);
                  if (name) await renameMedia(viewingMedia.id, name);
                }}
              >
                {viewingMedia.name}
              </button>
            </span>
          )}
        </nav>
        {viewingMedia ? (
          // 大きく表示している間は、その画像の操作だけを出す
          <div data-name="画像の操作ボタン" className="flex items-center gap-2">
            <button
              className={`${viewingMedia.fav ? "btn" : "btn-sub"} w-10 px-0`}
              aria-label={viewingMedia.fav ? "お気に入りから外す" : "お気に入りに追加"}
              aria-pressed={viewingMedia.fav}
              title="お気に入り"
              onClick={() => setFav([viewingMedia.id], !viewingMedia.fav)}
            >
              <Icon name="star" />
            </button>
            {originalUrl && (
              <a href={originalUrl} download={viewingMedia.fileName} className="btn-sub w-10 px-0" aria-label="元の画像を保存" title="元の画像を保存">
                <Icon name="download" />
              </a>
            )}
            {!viewingMedia.trashed && (
              <button
                className="btn-sub w-10 px-0"
                aria-label="ゴミ箱へ"
                title="ゴミ箱へ"
                onClick={() => {
                  const v = s.viewing!;
                  const rest = v.list.filter((x) => x !== viewingMedia.id);
                  const at = v.list.indexOf(viewingMedia.id);
                  trashFlow(roomId, [viewingMedia.id]);
                  s.setViewing(rest[at] ?? rest[at - 1] ?? null, rest);
                }}
              >
                <Icon name="del" />
              </button>
            )}
          </div>
        ) : (
          <div data-name="操作ボタン" className="flex flex-wrap items-center justify-end gap-2">
            {n > 0 && <span className="text-sm whitespace-nowrap text-muted">{n}枚選択中</span>}
            {(view.kind !== "home" || n > 0) && actions}
            <SortMenu showLibMode={view.kind === "lib"} />
            {!isPointerFine() && (
              <button className={selectMode ? "btn" : "btn-sub"} onClick={() => (selectMode ? done() : setSelectMode(true))}>
                {selectMode ? "完了" : "選択"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-5">
        <div className="min-w-0 flex-1">
          {view.kind === "home" ? (
            <MediaHome selectMode={selectMode} />
          ) : (
            <>
              {lib && childrenOf(libs, lib.id).length > 0 && (
                <>
                  <h3 className="mb-2 font-bold">小ライブラリー</h3>
                  <div data-name="小ライブラリーの並び" className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                    {childrenOf(libs, lib.id).map((k) => (
                      <CoverCard key={k.id} href={`${base}/lib/${k.id}`} name={k.name} covers={coverOf(media, k.id)} />
                    ))}
                  </div>
                  <h3 className="mb-2 font-bold">画像</h3>
                </>
              )}
              <MediaGrid
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
        <PreviewPanel />
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-accent/20 text-xl font-bold">ここにドロップして画像を追加</div>
      )}
    </div>
  );
}

function MediaHome({ selectMode }: { selectMode: boolean }) {
  const { media, libs, roomId } = useMediaState();
  const prefs = useMediaPrefs();
  const base = `/r/${roomId}/media`;
  const alive = media.filter((m) => !m.trashed);
  const unsorted = arrange(media.filter(isUnsorted), prefs);
  const fav = alive.filter((m) => m.fav);
  const trash = media.filter((m) => m.trashed);
  const recent = (arr: typeof media) => arr.slice(-3).reverse();

  if (!media.length) {
    return (
      <div className="card text-center">
        <p className="mb-1 font-bold">まだ画像がありません</p>
        <p className="text-sm text-muted">サイドバーの「メディアを追加」を押すか、この画面に画像をドラッグしてください。</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {unsorted.length > 0 && (
        <section>
          <h3 className="mb-2 font-bold">
            整理されていない画像 <span className="text-muted">{unsorted.length}</span>
          </h3>
          <MediaGrid list={unsorted} selectMode={selectMode} />
        </section>
      )}
      <section>
        <h3 className="mb-2 font-bold">一覧</h3>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
          <CoverCard href={`${base}/all`} name="すべて" covers={recent(alive)} count={alive.length} />
          <CoverCard href={`${base}/favorites`} name="お気に入り" covers={recent(fav)} count={fav.length} />
          <CoverCard href={`${base}/trash`} name="ゴミ箱" covers={recent(trash)} count={trash.length} />
        </div>
      </section>
      <section>
        <h3 className="mb-2 font-bold">ライブラリー</h3>
        {childrenOf(libs, null).length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
            {childrenOf(libs, null).map((l) => (
              <CoverCard key={l.id} href={`${base}/lib/${l.id}`} name={l.name} covers={coverOf(media, l.id)} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">ライブラリーはまだありません。サイドバーの「ライブラリー」の＋から作れます。</p>
        )}
      </section>
    </div>
  );
}
