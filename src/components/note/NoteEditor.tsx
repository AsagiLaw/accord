"use client";

import "@blocknote/mantine/style.css";
import { BlockNoteView } from "@blocknote/mantine";
import { useEffect, useRef, useState } from "react";
import type { Note } from "@/lib/local/db";
import { saveNoteBlocks } from "@/lib/local/notes";
import type { MemberWithProfile } from "@/lib/local/rooms";
import { useIsDark } from "@/lib/theme";
import { TopBarActions } from "@/components/TopBarSlot";
import { NoteContext } from "./blocks";
import { dropImages, EditorMenus, useBlockEditor, type Blocks } from "./editorKit";

/**
 * ブロック式のノート。入力が止まって少ししたら自動で保存する。
 * 他の人（別のタブ）が更新したときは、編集していなければそのまま取り込む。
 */
/**
 * page：データベースのページの本文（メモ）のとき。ページのブロックがそのページを出す。
 * テンプレートと繋いだノートでは、note はテンプレート、owner・linkedChats はこのノートのもの。editable が false なら読むだけ
 */
export function NoteEditor({
  note,
  userId,
  members,
  page,
  editable = true,
  owner,
  linkedChats,
  template,
}: {
  note: Note;
  userId: string;
  members: MemberWithProfile[];
  page?: { dbId: string; pageId: string };
  editable?: boolean;
  owner?: string;
  linkedChats?: { get: (blockId: string) => string | undefined; set: (blockId: string, chatId: string) => void };
  template?: boolean;
}) {
  const isDark = useIsDark();
  const editor = useBlockEditor(note.blocks, note.roomId, userId, [note.id]);
  const lastSaved = useRef(note.updatedAt);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState<"idle" | "pending" | "saved">("idle");
  const [remoteChanged, setRemoteChanged] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  const save = async () => {
    timer.current = null;
    lastSaved.current = await saveNoteBlocks(note.id, editor.document, userId);
    setSaving("saved");
  };

  // ページを離れるときに、保存待ちのものを書き込む
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void saveNoteBlocks(note.id, editor.document, userId);
      }
    },
    [editor, note.id, userId],
  );

  // 別のタブ・別の人の更新を取り込む
  useEffect(() => {
    if (note.updatedAt <= lastSaved.current) return;
    const editing = wrapper.current?.contains(document.activeElement) || timer.current;
    if (editing) {
      setRemoteChanged(true);
      return;
    }
    lastSaved.current = note.updatedAt;
    editor.replaceBlocks(editor.document, note.blocks.length ? (note.blocks as Blocks) : [{ type: "paragraph" }]);
  }, [note.updatedAt, note.blocks, editor]);

  return (
    <NoteContext.Provider value={{ roomId: note.roomId, userId, members, owner: owner ?? `note:${note.id}`, page, locked: !editable, linkedChats, template }}>
      <div
        ref={wrapper}
        data-name="ノートのエディタ"
        className="note-editor"
        onDropCapture={dropImages(editor, note.roomId, userId)}
      >
        {/* 他の人が更新したら、上のバーの右に「更新する」（押すと最新を読み込む。自分の未保存の変更は消える） */}
        {remoteChanged && (
          <TopBarActions>
            <button
              className="btn h-7 min-h-0 px-3 text-sm"
              data-name="最新に更新"
              title="他の人がこのノートを更新しました。押すと最新を読み込みます（自分の未保存の変更は消えます）"
              onClick={() => {
                setRemoteChanged(false);
                if (timer.current) clearTimeout(timer.current);
                timer.current = null;
                lastSaved.current = note.updatedAt;
                editor.replaceBlocks(editor.document, note.blocks.length ? (note.blocks as Blocks) : [{ type: "paragraph" }]);
              }}
            >
              更新する
            </button>
          </TopBarActions>
        )}
        <BlockNoteView
          editor={editor}
          theme={isDark ? "dark" : "light"}
          slashMenu={false}
          sideMenu={false}
          editable={editable}
          onChange={() => {
            if (!editable) return;
            setSaving("pending");
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(save, 700);
          }}
        >
          <EditorMenus editor={editor} />
        </BlockNoteView>
        <p className="mx-[54px] mt-2 h-4 text-right text-xs text-muted" aria-live="polite">
          {saving === "pending" ? "保存待ち…" : saving === "saved" ? "保存しました" : ""}
        </p>
      </div>
    </NoteContext.Provider>
  );
}
