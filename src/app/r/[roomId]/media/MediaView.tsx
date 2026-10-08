"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { promptText } from "@/components/ui/overlay";
import {
  MenuDivider,
  MenuItem,
  MenuLabel,
  Popover,
  usePopover,
} from "@/components/ui/Popover";
import { renameMedia, setFav } from "@/lib/local/media";
import { useBlobUrl } from "@/lib/media/blob-url";
import {
  arrange,
  chain,
  childrenOf,
  coverOf,
  isUnsorted,
  libraryView,
  THUMB_SIZES,
} from "@/lib/media/logic";
import { useMediaPrefs } from "@/lib/media/prefs";
import {
  deleteForeverFlow,
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
import { TopBarActions } from "@/components/TopBarSlot";

export type MediaViewKind =
  | { kind: "home" | "unsorted" | "all" | "fav" | "trash" }
  | { kind: "lib"; id: string };

const TITLES = {
  home: "メディア",
  unsorted: "未整理",
  all: "すべて",
  fav: "お気に入り",
  trash: "ゴミ箱",
} as const;

export function MediaView({ view }: { view: MediaViewKind }) {
  const s = useMediaState();
  const { media, libs, selected, setSelected, roomId, me } = s;
  const prefs = useMediaPrefs();
  // カードの左の四角は、画像一覧の画像と同じ大きさ
  const cardSize = THUMB_SIZES[prefs.level - 1];
  const router = useRouter();
  const base = `/r/${roomId}/media`;
  const [selectMode, setSelectMode] = useState(false);
  const [dragging, setDragging] = useState(false);
  const ctx = usePopover();
  // 小ライブラリーの並びを閉じているか。端末ごとに覚える（どのライブラリーでも同じ）
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
        selected.length &&
        view.kind !== "trash"
      ) {
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

  // 画像の操作は右クリックのメニューで出す（上のバーには並べ替えと表示だけ置く）
  const ctxItems = (): React.ReactNode => {
    const run = (fn: () => unknown) => () => {
      ctx.close();
      fn();
    };
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
            icon={<Icon name="star" size={16} />}
            onClick={run(() => setFav([viewingMedia.id], !viewingMedia.fav))}
          >
            {viewingMedia.fav ? "お気に入りから外す" : "お気に入りに追加"}
          </MenuItem>
          {originalUrl && (
            <MenuItem
              icon={<Icon name="download" size={16} />}
              onClick={run(() => {
                const a = document.createElement("a");
                a.href = originalUrl;
                a.download = viewingMedia.fileName;
                a.click();
              })}
            >
              元の画像を保存
            </MenuItem>
          )}
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
                  trashFlow(roomId, [viewingMedia.id]);
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
    return (
      <>
        {label}
        <MenuItem
          icon={<Icon name="albumAdd" size={16} />}
          onClick={run(() => s.setOrganizing(selected))}
        >
          整理
        </MenuItem>
        <MenuItem
          icon={<Icon name="star" size={16} />}
          onClick={run(() => setFav(selected, !allFav).then(done))}
        >
          {allFav ? "お気に入りから外す" : "お気に入りに追加"}
        </MenuItem>
        {lib && (
          <MenuItem
            icon={<Icon name="out" size={16} />}
            onClick={run(() =>
              removeFromLibraryFlow(roomId, lib, selected).then(done),
            )}
          >
            このライブラリーから出す
          </MenuItem>
        )}
        <MenuDivider />
        <MenuItem
          danger
          icon={<Icon name="del" size={16} />}
          onClick={run(() => trashFlow(roomId, selected).then(done))}
        >
          ゴミ箱へ
        </MenuItem>
      </>
    );
  };

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
        uploadFlow(roomId, me.id, [...e.dataTransfer.files], () =>
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
            className="flex min-w-0 flex-1 items-center gap-1"
          >
            <Icon name="img" size={16} className="shrink-0" />
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
                  <Link
                    href={`${base}/lib/${c.id}`}
                    className="truncate text-muted hover:text-ink"
                  >
                    {c.name}
                  </Link>
                ) : (
                  <button
                    className="truncate font-bold hover:underline"
                    title="クリックして名前を変更"
                    onClick={() => renameLibraryFlow(c)}
                  >
                    {c.name}
                  </button>
                )}
              </span>
            ))}
            {viewingMedia && (
              <span className="flex min-w-0 items-center gap-1">
                <Icon name="rt" size={14} className="shrink-0 text-muted" />
                <button
                  className="truncate font-bold hover:underline"
                  title="クリックして名前を変更"
                  onClick={async () => {
                    const name = await promptText(
                      "画像の名前",
                      viewingMedia.name,
                    );
                    if (name) await renameMedia(viewingMedia.id, name);
                  }}
                >
                  {viewingMedia.name}
                </button>
              </span>
            )}
          </nav>
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
        <div className="min-w-0 flex-1">
          {view.kind === "home" ? (
            <MediaHome selectMode={selectMode} />
          ) : (
            <>
              {lib && childrenOf(libs, lib.id).length > 0 && (
                <>
                  {/* 見出しを押すと、小ライブラリーの並びを閉じる・開く */}
                  <h3 className="mb-2 font-bold">
                    <button
                      type="button"
                      aria-expanded={!kidsClosed}
                      onClick={toggleKids}
                      className="-ml-1 flex items-center gap-1 rounded-[8px] px-1 hover:bg-tint"
                    >
                      <Icon name={kidsClosed ? "rt" : "dn"} size={16} />
                      小ライブラリー
                      {kidsClosed && (
                        <span className="text-sm font-normal text-muted">
                          {childrenOf(libs, lib.id).length}
                        </span>
                      )}
                    </button>
                  </h3>
                  {!kidsClosed && (
                    <div
                      data-name="小ライブラリーの並び"
                      className="mb-5 flex flex-wrap gap-2.5"
                    >
                      {childrenOf(libs, lib.id).map((k) => (
                        <CoverCard
                          size={cardSize}
                          key={k.id}
                          href={`${base}/lib/${k.id}`}
                          name={k.name}
                          covers={coverOf(media, k)}
                        />
                      ))}
                    </div>
                  )}
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
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-accent/20 text-xl font-bold">
          ここにドロップして画像を追加
        </div>
      )}
    </div>
  );
}

function MediaHome({ selectMode }: { selectMode: boolean }) {
  const { media, libs, roomId } = useMediaState();
  const prefs = useMediaPrefs();
  // カードの左の四角は、画像一覧の画像と同じ大きさ
  const cardSize = THUMB_SIZES[prefs.level - 1];
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
        <p className="text-sm text-muted">
          サイドバーの「メディアを追加」を押すか、この画面に画像をドラッグしてください。
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
          <MediaGrid list={unsorted} selectMode={selectMode} />
        </section>
      )}
      <section>
        <h3 className="mb-2 font-bold">一覧</h3>
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
      </section>
      <section>
        <h3 className="mb-2 font-bold">ライブラリー</h3>
        {childrenOf(libs, null).length ? (
          <div className="flex flex-wrap gap-2.5">
            {childrenOf(libs, null).map((l) => (
              <CoverCard
                size={cardSize}
                key={l.id}
                href={`${base}/lib/${l.id}`}
                name={l.name}
                covers={coverOf(media, l)}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">
            ライブラリーはまだありません。サイドバーの「ライブラリー」の＋から作れます。
          </p>
        )}
      </section>
    </div>
  );
}
