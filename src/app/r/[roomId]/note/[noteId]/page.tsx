"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Icon } from "@/components/Icon";
import { confirmAction } from "@/components/ui/overlay";
import { deleteNote, useNote } from "@/lib/local/notes";
import { setLinkedChat } from "@/lib/local/channelTemplates";
import { TopBarActions } from "@/components/TopBarSlot";
import { NoteUpdatesButton } from "@/components/note/NoteUpdates";
import { useEditMode } from "@/components/window/editMode";
import { useMembers } from "@/lib/local/rooms";
import { markNoteSeen } from "@/lib/local/noteSeen";
import { useCurrentUser } from "@/lib/local/session";

// エディタはブラウザでしか動かないので、サーバーでは描画しない
const NoteEditor = dynamic(() => import("@/components/note/NoteEditor").then((m) => m.NoteEditor), {
  ssr: false,
  loading: () => <p className="loading text-muted">読み込み中…</p>,
});

export default function NotePage() {
  const { roomId, noteId } = useParams<{ roomId: string; noteId: string }>();
  const router = useRouter();
  const note = useNote(noteId);
  // ソース（テンプレート）と繋いでいれば、テンプレートの中身を出す。編集は、サイドバーの右クリック「編集」から
  const source = useNote(note?.sourceId ?? undefined);
  const { editing, finish } = useEditMode();
  const me = useCurrentUser();
  const members = useMembers(roomId);

  // 開いている間の更新は、見たことにする（サイドバーの「更新あり」の印を消す）
  useEffect(() => {
    if (me && note) markNoteSeen(me.id, note.id, note.updatedAt);
  }, [me, note]);

  if (note === undefined || (note?.sourceId && source === undefined) || !me || !members) return <p className="loading text-muted">読み込み中…</p>;
  if (!note || note.roomId !== roomId) {
    return (
      <p className="text-muted">
        ノートが見つかりません。<Link href={`/r/${roomId}`} className="underline">ルームの最初へ</Link>
      </p>
    );
  }

  const linked = !!note.sourceId && !!source;
  return (
    <div data-name="ノート画面" className="mx-auto max-w-3xl">
      {/* 名前は上のバーに出る（押すとその場で変えられる）。更新の知らせと削除も、上のバーの右に置く */}
      <TopBarActions>
        <NoteUpdatesButton note={linked && source ? source : note} members={members} meId={me.id} />
        <button
          type="button"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] text-muted hover:bg-tint hover:text-warn md:h-7 md:w-7"
          aria-label="このノートを削除"
          title="このノートを削除"
          onClick={async () => {
            if (!(await confirmAction(`「${note.title}」を削除します`, "削除", "貼った画像はメディアに残ります。"))) return;
            await deleteNote(note.id);
            router.push(`/r/${roomId}`);
          }}
        >
          <Icon name="del" size={18} />
        </button>
      </TopBarActions>
      {linked && source ? (
        <>
          {editing && (
            <TopBarActions>
              <span className="text-xs text-warn">テンプレートを編集しています（使っているところ全部に反映されます）</span>
              <button onClick={finish} className="btn h-7 min-h-0 px-3 text-sm" data-name="編集を終える">
                <Icon name="ok" size={14} />
                完了
              </button>
            </TopBarActions>
          )}
          <NoteEditor
            key={source.id}
            note={source}
            userId={me.id}
            members={members}
            editable={editing}
            owner={`note:${note.id}`}
            linkedChats={{ get: (blockId) => note.chatMap?.[blockId], set: (blockId, chatId) => void setLinkedChat("note", note.id, blockId, chatId) }}
          />
        </>
      ) : (
        <NoteEditor key={note.id} note={note} userId={me.id} members={members} template={note.template} />
      )}
    </div>
  );
}
