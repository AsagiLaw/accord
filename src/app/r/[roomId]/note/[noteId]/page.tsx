"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon } from "@/components/Icon";
import { confirmAction } from "@/components/ui/overlay";
import { deleteNoteTree } from "@/lib/local/channels";
import type { Note } from "@/lib/local/db";
import { restoreSubNote, useNote, useNoteAncestors } from "@/lib/local/notes";
import { setLinkedChat } from "@/lib/local/channelTemplates";
import { TopBarActions } from "@/components/TopBarSlot";
import { NoteHeader } from "@/components/note/NoteHeader";
import { LockedChip, NoteMenu } from "@/components/note/NoteMenu";
import { NoteUpdatesButton } from "@/components/note/NoteUpdates";
import type { NoteEditor as Editor } from "@/components/note/blocks";
import { useEditMode } from "@/components/window/editMode";
import { useMembers } from "@/lib/local/rooms";
import { markNoteSeen } from "@/lib/local/noteSeen";
import { useCurrentUser } from "@/lib/local/session";
import { DocSkeleton } from "@/components/Skeleton";

// エディタはブラウザでしか動かないので、サーバーでは描画しない
const NoteEditor = dynamic(() => import("@/components/note/NoteEditor").then((m) => m.NoteEditor), {
  ssr: false,
  loading: () => <DocSkeleton title={false} />,
});

export default function NotePage() {
  const { roomId, noteId } = useParams<{ roomId: string; noteId: string }>();
  const note = useNote(noteId);
  // ソース（テンプレート）と繋いでいれば、テンプレートの中身を出す。編集は、サイドバーの右クリック「編集」から
  const source = useNote(note?.sourceId ?? undefined);
  const { editing, finish } = useEditMode();
  const me = useCurrentUser();
  const members = useMembers(roomId);
  const editorRef = useRef<Editor | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const ancestors = useNoteAncestors(note?.parentId);

  // 開いている間の更新は、見たことにする（サイドバーの「更新あり」の印を消す）
  useEffect(() => {
    if (me && note) markNoteSeen(me.id, note.id, note.updatedAt);
  }, [me, note]);

  if (note === undefined || (note?.sourceId && source === undefined) || !me || !members) return <DocSkeleton />;
  if (!note || note.roomId !== roomId) {
    return (
      <p className="text-muted">
        ノートが見つかりません。<Link href={`/r/${roomId}`} className="underline">ルームの最初へ</Link>
      </p>
    );
  }

  const linked = !!note.sourceId && !!source;
  const body = linked && source ? source : note;
  // ゴミ箱にあるとき（このページか、上の階層のページ）は、読むだけ
  const trashed = note.deletedAt ? note : ancestors?.findLast((a) => a.deletedAt);
  const lockedByUser = !!note.locked && !linked;
  const locked = lockedByUser || (!!trashed && !linked);
  const look = note.look ?? {};

  /** タイトルから本文へ。new なら、いちばん上に空の行を作って移る（いちばん上が空の段落なら、そこへ） */
  const toBody = (mode: "new" | "first") => {
    const ed = editorRef.current;
    if (!ed || !ed.isEditable) return;
    const first = ed.document[0];
    try {
      const empty = first?.type === "paragraph" && Array.isArray(first.content) && first.content.length === 0;
      if (mode === "new" && first && !empty) {
        const [b] = ed.insertBlocks([{ type: "paragraph" }], first, "before");
        ed.setTextCursorPosition(b, "start");
      } else if (first) ed.setTextCursorPosition(first, "start");
      ed.focus();
    } catch {
      // いちばん上がチャットなど、文字を書けないブロックのとき
      ed.focus();
    }
  };
  /** 本文の下の空いたところを押したら、最後に書き足す（最後が空の段落でなければ、空の段落を足す） */
  const toEnd = () => {
    const ed = editorRef.current;
    if (!ed || !ed.isEditable) return;
    const last = ed.document[ed.document.length - 1];
    try {
      const empty = last?.type === "paragraph" && Array.isArray(last.content) && last.content.length === 0;
      if (last && !empty) {
        const [b] = ed.insertBlocks([{ type: "paragraph" }], last, "after");
        ed.setTextCursorPosition(b, "start");
      } else if (last) ed.setTextCursorPosition(last, "end");
      ed.focus();
    } catch {
      ed.focus();
    }
  };
  /** 本文のいちばん上で ↑ を押したら、タイトルの最後へ */
  const toTitle = () => {
    const el = titleRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  };

  return (
    <div data-name="ノート画面" className="note-page" data-font={look.font} data-small={look.small ? "" : undefined} data-full={look.full ? "" : undefined}>
      {/* 名前は上のバーにも出る（押すとその場で変えられる）。更新の知らせと「…」のメニューは、上のバーの右に置く */}
      <TopBarActions>
        {lockedByUser && <LockedChip note={note} />}
        <NoteUpdatesButton note={body} members={members} meId={me.id} />
        <NoteMenu note={note} body={body} roomId={roomId} userId={me.id} members={members} linked={linked} />
      </TopBarActions>
      {linked && editing && (
        <TopBarActions>
          <span className="text-xs text-warn">テンプレートを編集しています（使っているところ全部に反映されます）</span>
          <button onClick={finish} className="btn h-7 min-h-0 px-3 text-sm" data-name="編集を終える">
            <Icon name="ok" size={14} />
            完了
          </button>
        </TopBarActions>
      )}
      {trashed && <TrashBar trashed={trashed} self={trashed.id === note.id} roomId={roomId} userId={me.id} />}
      <NoteHeader note={note} roomId={roomId} userId={me.id} editable={!locked} onEnter={toBody} titleRef={titleRef} />
      <div className="note-body">
        {linked && source ? (
          <NoteEditor
            key={source.id}
            note={source}
            userId={me.id}
            members={members}
            editable={editing}
            owner={`note:${note.id}`}
            linkedChats={{ get: (blockId) => note.chatMap?.[blockId], set: (blockId, chatId) => void setLinkedChat("note", note.id, blockId, chatId) }}
            editorRef={editorRef}
            onExitTop={toTitle}
            linkable
          />
        ) : (
          <NoteEditor
            key={note.id}
            note={note}
            userId={me.id}
            members={members}
            template={note.template}
            editable={!locked}
            editorRef={editorRef}
            onExitTop={toTitle}
            linkable
            subPages={!note.template}
          />
        )}
        {/* Notion と同じく、本文の下を空けておき、押すと最後に書き足せる */}
        <div aria-hidden className={`h-[30vh] ${locked || (linked && !editing) ? "" : "cursor-text"}`} onClick={toEnd} />
      </div>
    </div>
  );
}

/** ゴミ箱にあるページの上の帯（Notion と同じ）：元に戻す・完全に削除。self が false なら、上の階層のページと一緒にゴミ箱にある */
function TrashBar({ trashed, self, roomId, userId }: { trashed: Note; self: boolean; roomId: string; userId: string }) {
  const router = useRouter();
  const name = trashed.title || "無題";
  return (
    <div role="alert" data-name="ゴミ箱のページ" className="note-trash-bar">
      <span>{self ? "このページはゴミ箱にあります" : `「${name}」と一緒にゴミ箱にあります`}</span>
      <button type="button" onClick={() => void restoreSubNote(trashed, userId)}>
        元に戻す
      </button>
      <button
        type="button"
        onClick={async () => {
          if (!(await confirmAction(`「${name}」を完全に削除します`, "削除", "中のページも消えます。元に戻せません。"))) return;
          router.push(trashed.parentId ? `/r/${roomId}/note/${trashed.parentId}` : `/r/${roomId}`);
          await deleteNoteTree(trashed.id);
        }}
      >
        完全に削除
      </button>
    </div>
  );
}
