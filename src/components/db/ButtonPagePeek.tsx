"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { NoteContext } from "@/components/embeds";
import { Icon } from "@/components/Icon";
import { saveNoteBlocks, useNote } from "@/lib/local/notes";
import { useMembers } from "@/lib/local/rooms";
import { useCurrentUser } from "@/lib/local/session";
import type { InnerPageTarget } from "./PageLink";
import { PeekFrame } from "./PeekFrame";
import { DocSkeleton } from "@/components/Skeleton";

const BlockEditor = dynamic(() => import("@/components/note/BlockEditor").then((m) => m.BlockEditor), {
  ssr: false,
  loading: () => <DocSkeleton title={false} className="p-4" />,
});

const NoteEditor = dynamic(() => import("@/components/note/NoteEditor").then((m) => m.NoteEditor), {
  ssr: false,
  loading: () => <DocSkeleton title={false} />,
});

/**
 * ボタンのブロックの中のページのポップアップ。ノート型はそのまま書ける。ウィンドウ型は「編集」で並べ方や文章を変える。
 * ボタンをデータベースのページに置いたときは、中のブロックの「このページ」はそのページ
 */
export function ButtonPagePeek({ roomId, noteId, title, page, onClose }: InnerPageTarget & { onClose: () => void }) {
  const note = useNote(noteId);
  const me = useCurrentUser();
  const members = useMembers(roomId);
  const [editing, setEditing] = useState(false);
  const isWindow = note?.inner?.kind === "window";
  const scope = page?.dbId ? { dbId: page.dbId, pageId: page.pageId } : undefined;

  const body = () => {
    if (note === null) return <p className="p-4 text-muted">ボタンの中のページが見つかりません</p>;
    if (!note || !me || !members) return <DocSkeleton title={false} className="p-4" />;
    if (!isWindow)
      return (
        <div className="min-h-0 flex-1 overflow-auto px-[clamp(16px,4vw,40px)] pt-4 pb-7 [scrollbar-gutter:stable]">
          <div className="mx-auto w-full max-w-3xl">
            <NoteEditor key={note.id} note={note} userId={me.id} members={members} page={scope?.pageId ? { dbId: scope.dbId, pageId: scope.pageId } : undefined} />
          </div>
        </div>
      );
    return (
      <div className="min-h-0 flex-1">
        <NoteContext.Provider value={{ roomId, userId: me.id, members, owner: `note:${note.id}`, locked: !editing, page: scope, windowMode: true }}>
          <BlockEditor key={note.id} id={note.id} blocks={note.blocks} roomId={roomId} userId={me.id} editable={editing} mode="window" onSave={(blocks) => saveNoteBlocks(note.id, blocks, me.id)} />
        </NoteContext.Provider>
      </div>
    );
  };

  return (
    <PeekFrame
      name="ボタンの中のページのポップアップ"
      label={title}
      onClose={onClose}
      // 上のバー：ボタンの文字と、（ウィンドウ型は）編集・完了
      head={
        <>
          <Icon name={isWindow ? "window" : "note"} size={16} className="shrink-0 text-muted" />
          <span className="min-w-0 truncate text-sm font-bold">{title}</span>
          {isWindow && (
            <button className="btn-sub ml-auto h-8 min-h-0 gap-1 px-2.5 text-sm" onClick={() => setEditing(!editing)} data-name={editing ? "編集を終える" : "編集"}>
              <Icon name={editing ? "ok" : "edit"} size={16} />
              {editing ? "完了" : "編集"}
            </button>
          )}
        </>
      }
    >
      {body()}
    </PeekFrame>
  );
}
