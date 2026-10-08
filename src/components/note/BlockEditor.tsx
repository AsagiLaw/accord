"use client";

import "@blocknote/mantine/style.css";
import { BlockNoteView } from "@blocknote/mantine";
import { useEffect, useRef } from "react";
import { useIsDark } from "@/lib/theme";
import { dropImages, EditorMenus, useBlockEditor } from "./editorKit";

/**
 * ノートと同じブロックが使えるエディタ。ウィンドウ・ページの本文・テンプレートで使う。
 * mode が window のときは画面に固定（チャットなどは残りの高さいっぱいに広がる）。editable が false のときは読むだけ（「＋」「⋮⋮」も出ない）。
 * 入力が止まって少ししたら onSave で保存する
 */
export function BlockEditor({
  id,
  blocks,
  roomId,
  userId,
  editable,
  onSave,
  mode = "note",
}: {
  id: string;
  blocks: unknown[];
  roomId: string;
  userId: string;
  editable: boolean;
  onSave: (blocks: unknown[]) => void;
  mode?: "note" | "window";
}) {
  const isDark = useIsDark();
  const editor = useBlockEditor(blocks, roomId, userId, [id]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(onSave);
  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);

  // 離れるときに、保存待ちのものを書き込む
  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      saveRef.current(editor.document);
    },
    [editor],
  );

  return (
    <div
      data-name={mode === "window" ? "ウィンドウの中身" : "本文のエディタ"}
      className={mode === "window" ? `doc-window ${editable ? "doc-editing" : ""}` : "note-editor"}
      onDropCapture={dropImages(editor, roomId, userId)}
    >
      <BlockNoteView
        editor={editor}
        theme={isDark ? "dark" : "light"}
        editable={editable}
        slashMenu={false}
        sideMenu={false}
        onChange={() => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            timer.current = null;
            saveRef.current(editor.document);
          }, 700);
        }}
      >
        <EditorMenus editor={editor} />
      </BlockNoteView>
    </div>
  );
}
