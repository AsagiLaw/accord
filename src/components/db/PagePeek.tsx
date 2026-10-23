"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useDatabase, usePage } from "@/lib/local/requests";
import { PageBody } from "./PageBody";
import { ButtonPagePeek } from "./ButtonPagePeek";
import { InnerPeekContext, PeekContext, SubPeekContext, type InnerPageTarget, type PeekMode, type SubPageTarget } from "./PageLink";
import { SubPagePeek } from "./SubPagePeek";
import { PageName } from "./views/common";
import { isBackdropClick } from "@/components/ui/backdrop";

/** ルームの中に置く。開いているページは、ページを移ったら閉じる */
export function PagePeekProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<{ roomId: string; dbId: string; pageId: string; mode: PeekMode; at: string } | null>(null);
  const current = open && open.at === pathname ? open : null;
  // 「ページ」の項目の別ページ（ページのポップアップの上にも重ねて開ける）
  const [sub, setSub] = useState<(SubPageTarget & { at: string }) | null>(null);
  const subNow = sub && sub.at === pathname ? sub : null;
  // ボタンのブロックの中のページ（ノート・ウィンドウ）
  const [inner, setInner] = useState<(InnerPageTarget & { at: string }) | null>(null);
  const innerNow = inner && inner.at === pathname ? inner : null;
  return (
    <PeekContext.Provider value={(database, pageId, mode = "peek") => setOpen({ roomId: database.roomId, dbId: database.id, pageId, mode, at: pathname })}>
      <SubPeekContext.Provider value={(target) => setSub({ ...target, at: pathname })}>
        <InnerPeekContext.Provider value={(target) => setInner({ ...target, at: pathname })}>
          {children}
          {current && <PagePeek key={current.pageId} {...current} onClose={() => setOpen(null)} />}
          {subNow && <SubPagePeek key={`${subNow.pageId}:${subNow.propId}`} {...subNow} onClose={() => setSub(null)} />}
          {innerNow && <ButtonPagePeek key={innerNow.noteId} {...innerNow} onClose={() => setInner(null)} />}
        </InnerPeekContext.Provider>
      </SubPeekContext.Provider>
    </PeekContext.Provider>
  );
}

/**
 * ページのポップアップ。peek は画面の真ん中に重ねて（まわりは暗くなり、押すと閉じる）、
 * side は右から出す（Notion のサイドピーク。まわりは暗くせず、後ろのビューもそのまま使える）
 */
function PagePeek({ roomId, dbId, pageId, mode, onClose }: { roomId: string; dbId: string; pageId: string; mode: PeekMode; onClose: () => void }) {
  const router = useRouter();
  const database = useDatabase(dbId);
  const page = usePage(pageId);
  const href = `/r/${roomId}/db/${dbId}/p/${pageId}`;

  // Esc で閉じる（文字を打っているところ・メニューが開いているときは、そちらを先に）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.isContentEditable || t?.closest("input,textarea,select,[role=menu],[role=dialog][data-overlay]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const panel = (
    <>
      {/* 上のバー：ページの名前と、拡大・閉じる */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        {database && page ? <PageName database={database} page={page} className="text-sm font-bold" /> : <span className="loading text-sm text-muted">読み込み中…</span>}
        <button
          className="btn-sub ml-auto h-8 min-h-0 gap-1 px-2.5 text-sm"
          title="ページの画面で開く"
          onClick={() => {
            onClose();
            router.push(href);
          }}
        >
          <Icon name="open" size={16} />
          拡大
        </button>
        <button className="grid h-8 w-8 place-items-center rounded-full hover:bg-tint" aria-label="閉じる" onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
      </div>
      {/* 中身：ページの画面と同じ余白（ウィンドウ型のページは、この枠いっぱいに出す） */}
      <div className="min-h-0 flex-1 overflow-auto px-[clamp(16px,4vw,40px)] pt-4 pb-7 [scrollbar-gutter:stable]">
        <PageBody roomId={roomId} dbId={dbId} pageId={pageId} peek />
      </div>
    </>
  );

  if (mode === "side")
    return (
      <div
        role="dialog"
        aria-label="ページ"
        data-name="ページのポップアップ（右から）"
        className="fixed inset-y-0 right-0 z-[45] flex w-[min(720px,100vw)] anim-panel flex-col border-l border-line bg-bg shadow-2xl"
      >
        {panel}
      </div>
    );
  return (
    <div
      className="fixed inset-0 z-[45] flex animate-[fade_.15s] items-center justify-center bg-black/40 p-[clamp(8px,4vw,48px)]"
      onClick={(e) => isBackdropClick(e) && onClose()}
      data-name="ページのポップアップ"
    >
      <div role="dialog" aria-modal="true" aria-label="ページ" className="flex h-full max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-[14px] border border-line bg-bg shadow-2xl">
        {panel}
      </div>
    </div>
  );
}
