"use client";

import { createReactBlockSpec } from "@blocknote/react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { IconMark } from "@/components/IconMark";
import { SUB_PAGE, useNote } from "@/lib/local/notes";

// Notion の「ページ」ブロック：ノートの中の子のページ。本文にはアイコンと名前の1行を出し、押すとそのページを開く

export const SubPageBlock = createReactBlockSpec(
  { type: SUB_PAGE, propSchema: { noteId: { default: "" } }, content: "none" },
  { render: ({ block }) => <SubPageView noteId={block.props.noteId} /> },
);

function SubPageView({ noteId }: { noteId: string }) {
  const note = useNote(noteId || undefined);
  const router = useRouter();
  const icon = (
    <span className="note-subpage-icon">
      <IconMark icon={note?.icon} fallback={<Icon name="note" size={18} />} />
    </span>
  );
  if (note === null)
    return (
      <div contentEditable={false} className="note-subpage" data-gone="" title="削除されたページ">
        {icon}
        <span className="note-subpage-text">削除されたページ</span>
      </div>
    );
  const href = note ? `/r/${note.roomId}/note/${note.id}` : undefined;
  return (
    <a
      href={href}
      contentEditable={false}
      draggable={false}
      className="note-subpage"
      data-name="ページ"
      data-gone={note?.deletedAt ? "" : undefined}
      title={note?.deletedAt ? "ゴミ箱にあるページ" : undefined}
      onClick={(e) => {
        // Ctrl・⌘・Shift を押しながらなら、ブラウザに任せる（新しいタブ・ウィンドウで開く）
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        if (href) router.push(href);
      }}
    >
      {icon}
      <span className={`note-subpage-text ${note?.title ? "" : "text-muted"}`}>{note ? note.title || "無題" : ""}</span>
    </a>
  );
}
