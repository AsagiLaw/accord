"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { confirmAction } from "@/components/ui/overlay";
import { deleteNote, renameNote, useNote } from "@/lib/local/notes";
import { setLinkedChat } from "@/lib/local/channelTemplates";
import { TopBarActions } from "@/components/TopBarSlot";
import { useEditMode } from "@/components/window/editMode";
import { useMembers } from "@/lib/local/rooms";
import { useCurrentUser } from "@/lib/local/session";

// エディタはブラウザでしか動かないので、サーバーでは描画しない
const NoteEditor = dynamic(() => import("@/components/note/NoteEditor").then((m) => m.NoteEditor), {
  ssr: false,
  loading: () => <p className="text-muted">読み込み中…</p>,
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

  if (note === undefined || (note?.sourceId && source === undefined) || !me || !members) return <p className="text-muted">読み込み中…</p>;
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
      <div data-name="ノートの名前" className="mb-3 flex items-start gap-2 px-[42px] sm:px-[54px]">
        <NoteTitle value={note.title} onSave={(t) => renameNote(note.id, t)} />
        <button
          className="btn-sub mt-1 w-10 shrink-0 px-0"
          aria-label="このノートを削除"
          title="このノートを削除"
          onClick={async () => {
            if (!(await confirmAction(`「${note.title}」を削除します`, "削除", "貼った画像はメディアに残ります。"))) return;
            await deleteNote(note.id);
            router.push(`/r/${roomId}`);
          }}
        >
          <Icon name="del" />
        </button>
      </div>
      <p className="mb-3 px-[42px] text-xs text-muted sm:px-[54px]">
        「/」（日本語入力中は「／」）か、行の左の「＋」でブロックのメニューが出ます。「⋮⋮」をドラッグすると並び替えられます。最終更新：
        {members.find((m) => m.userId === note.updatedBy)?.displayName ?? "—"}（{new Date(note.updatedAt).toLocaleString("ja-JP")}）
      </p>
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

function NoteTitle({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [base, setBase] = useState(value);
  if (value !== base) {
    setBase(value);
    setDraft(value);
  }
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => (draft.trim() && draft !== value ? onSave(draft.trim()) : setDraft(value))}
      onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (e.target as HTMLInputElement).blur()}
      placeholder="無題"
      aria-label="ノートの名前"
      className="min-w-0 flex-1 rounded-[8px] bg-transparent text-[30px] font-bold outline-none hover:bg-tint focus:bg-tint"
    />
  );
}
