"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/Icon";
import { IconMark } from "@/components/IconMark";
import { useDatabase, useEvents, usePages, useViews } from "@/lib/local/requests";
import { useMembers } from "@/lib/local/rooms";
import { DatabaseView } from "./DatabaseView";
import { PagePeekProvider } from "./PagePeek";
import { DatabaseSkeleton } from "@/components/Skeleton";

/**
 * データベースの画面を、画面の真ん中に重ねて出す（サイドバーのデータベースカテゴリーの「編集」から）。
 * 選んでいるビューはこの中だけで覚え、URL は変えない。ビューからページを押すと、この上にページのポップアップが重なる。
 * まわりを押すか Esc で閉じる。「拡大」でデータベースの画面へ
 */
export function DatabasePopup({ roomId, dbId, userId, onClose }: { roomId: string; dbId: string; userId: string; onClose: () => void }) {
  const router = useRouter();
  const database = useDatabase(dbId);
  const pages = usePages(dbId);
  const views = useViews(dbId);
  const events = useEvents(roomId);
  const members = useMembers(roomId);
  const [viewId, setViewId] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Esc で閉じる。上にページのポップアップや入力の画面が重なっているときは、そちらを先に閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.isContentEditable || t?.closest("input,textarea,select,[role=menu],[role=dialog][data-overlay]")) return;
      if (root.current?.querySelector("[role=dialog]:not([data-db-popup])") || document.querySelector("[data-overlay]")) return;
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (typeof document === "undefined") return null;
  const view = views?.find((v) => v.id === viewId) ?? views?.[0];
  const ready = database && pages && views && events && members;
  return createPortal(
    <div
      ref={root}
      className="fixed inset-0 z-[46] flex animate-[fade_.15s] items-center justify-center bg-black/40 p-[clamp(8px,4vw,48px)]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-name="データベースのポップアップ"
    >
      <div role="dialog" aria-modal="true" aria-label={database ? `データベース「${database.name}」` : "データベース"} data-db-popup="" className="flex h-full max-h-[92dvh] w-full max-w-7xl flex-col overflow-hidden rounded-[14px] border border-line bg-bg shadow-2xl">
        {/* 上のバー：データベースの名前と、拡大・閉じる */}
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
          {database ? (
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-bold">
              <span className="grid w-4 shrink-0 place-items-center">
                <IconMark icon={database.icon} fallback={<Icon name="db" size={16} />} />
              </span>
              <span className="truncate">{database.name}</span>
            </span>
          ) : (
            <span className="loading text-sm text-muted">読み込み中…</span>
          )}
          <button
            className="btn-sub ml-auto h-8 min-h-0 gap-1 px-2.5 text-sm"
            title="データベースの画面で開く"
            onClick={() => {
              onClose();
              router.push(`/r/${roomId}/db/${dbId}${view ? `?v=${view.id}` : ""}`);
            }}
          >
            <Icon name="open" size={16} />
            拡大
          </button>
          <button className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-tint" aria-label="閉じる" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>
        {/* 中身：データベースの画面と同じ余白 */}
        <div className="min-h-0 flex-1 overflow-auto px-[clamp(16px,4vw,40px)] pt-4 pb-7 [scrollbar-gutter:stable]">
          <PagePeekProvider>
            {database === null ? (
              <p className="text-muted">見つかりません。</p>
            ) : ready ? (
              <DatabaseView database={database} views={views} view={view} pages={pages} events={events} members={members} userId={userId} onSwitchView={setViewId} />
            ) : (
              <DatabaseSkeleton type={view?.type} />
            )}
          </PagePeekProvider>
        </div>
      </div>
    </div>,
    document.body,
  );
}
