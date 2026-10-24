"use client";

import "@blocknote/mantine/style.css";
import { BlockNoteView } from "@blocknote/mantine";
import { useEffect, useRef } from "react";
import { mergeBlocks } from "@/lib/note/mergeBlocks";
import { useIsDark } from "@/lib/theme";
import { dropImages, EditorMenus, useBlockEditor, type Blocks } from "./editorKit";
import { changedTexts, withoutTextLock, type TextOptions } from "./textOptions";

type Loose = { id?: string }[];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * ノートと同じブロックが使えるエディタ。ウィンドウ・ページの本文・テンプレートで使う。
 * mode が window のときは画面に固定（チャットなどは残りの高さいっぱいに広がる）。editable が false のときは読むだけ（「＋」「⋮⋮」も出ない）。
 * 入力が止まって少ししたら onSave で保存する。
 * ウィンドウのチャンネルでは、textOptions（文章のブロックの枠・固定）を渡す。textEditable なら、編集モードでなくても固定していない文章を直せる。
 * onSaveText を渡すと（テンプレートと繋いだウィンドウ）、中身は保存せず、直した文章のブロックだけを onSaveText に渡す。
 * そのときは、文章のブロックもそれぞれ別にする（テンプレートに無いブロックは持てないので、足したり消したり、つなげたりしない）。
 * updatedAt を渡すと、ほかの人（別のタブ）の更新を、ノートと同じようにブロックごとにまとめて取り込む（書いている途中なら、保存のときに）
 */
export function BlockEditor({
  id,
  blocks,
  roomId,
  userId,
  editable,
  onSave,
  onSaveText,
  onEdit,
  mode = "note",
  updatedAt,
  textOptions,
  onTextOptions,
  textEditable = false,
}: {
  id: string;
  blocks: unknown[];
  roomId: string;
  userId: string;
  editable: boolean;
  /** at：保存の時刻（updatedAt に入れる。自分の保存を、ほかの人の更新と間違えないように） */
  onSave: (blocks: unknown[], at: number) => void;
  onSaveText?: (changed: ReturnType<typeof changedTexts>, at: number) => void;
  /** 直すたびにすぐ呼ぶ（保存を待たずに、今の中身を知りたいとき。テンプレートの「保存」など） */
  onEdit?: (blocks: unknown[]) => void;
  mode?: "note" | "window";
  updatedAt?: number;
  textOptions?: TextOptions;
  onTextOptions?: (options: TextOptions) => void;
  textEditable?: boolean;
}) {
  const isDark = useIsDark();
  const editor = useBlockEditor(blocks, roomId, userId, [id]);
  // ふだんのウィンドウ：固定していない文章だけ直せる。文章をこのウィンドウだけで直すときは、文章のブロックもそれぞれ別
  const textOnly = !editable && textEditable;
  const separate = textOnly && !!onSaveText;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(onSave);
  const saveTextRef = useRef(onSaveText);
  useEffect(() => {
    saveRef.current = onSave;
    saveTextRef.current = onSaveText;
  }, [onSave, onSaveText]);
  const wrapper = useRef<HTMLDivElement>(null);

  // ---- ほかの人の更新の取り込み（updatedAt を渡したときだけ） ----
  const live = updatedAt !== undefined;
  // いちばん新しい保存されている中身（ほかの人の更新が来ていれば、ここに入っている）
  const latest = useRef({ blocks, updatedAt: updatedAt ?? 0 });
  useEffect(() => {
    latest.current = { blocks, updatedAt: updatedAt ?? 0 };
  });
  // 最後にそろえた時刻と、そのときの保存されている中身・エディタの中身（自分がどのブロックを直したかを見分けるのに使う）
  const lastSaved = useRef(updatedAt ?? 0);
  const known = useRef(blocks);
  const base = useRef<unknown[]>([]);
  // エディタは読み込んだ中身の形を少し整えるので、比べる元はエディタの中身にする
  useEffect(() => {
    base.current = editor.document;
  }, [editor]);
  // ほかの人の中身を入れている間は、入力として扱わない（保存しない）
  const applying = useRef(false);

  /** 保存されている中身を、今の中身とブロックごとにまとめてエディタに入れる */
  const pull = (remote: unknown[], at: number) => {
    lastSaved.current = at;
    // 名前・区画の高さなどだけが変わったときは、入れ直さない
    if (same(remote, known.current)) return;
    known.current = remote;
    const merged = mergeBlocks(base.current as Loose, editor.document as Loose, (remote.length ? remote : [{ type: "paragraph" }]) as Loose);
    // カーソルのあるブロックを覚えておき、入れ替えたあとに戻す
    let cursor: string | undefined;
    try {
      cursor = editor.getTextCursorPosition().block.id;
    } catch {
      cursor = undefined;
    }
    applying.current = true;
    try {
      withoutTextLock(editor, () => editor.replaceBlocks(editor.document, (merged.length ? merged : [{ type: "paragraph" }]) as Blocks));
    } finally {
      applying.current = false;
    }
    if (cursor && wrapper.current?.contains(document.activeElement)) {
      try {
        editor.setTextCursorPosition(cursor, "end");
      } catch {
        // そのブロックがほかの人に消されていれば、戻さない
      }
    }
    base.current = editor.document;
  };

  const save = () => {
    timer.current = null;
    // 文章をこのウィンドウだけで直すとき：前にそろえたときから変わった文章のブロック（ほかの人の更新を取り込む前に見ておく）
    const changed = saveTextRef.current ? changedTexts(base.current, editor.document) : undefined;
    if (!live && !changed) return saveRef.current(editor.document, Date.now());
    // 書いている間にほかの人の更新が来ていたら、保存の前に取り込んで、まとめた中身を保存する
    const remote = latest.current;
    if (live && remote.updatedAt > lastSaved.current) pull(remote.blocks, remote.updatedAt);
    if (changed ? !Object.keys(changed).length : same(editor.document, base.current)) return;
    const at = Date.now();
    lastSaved.current = at;
    base.current = editor.document;
    known.current = editor.document;
    if (changed) saveTextRef.current?.(changed, at);
    else saveRef.current(editor.document, at);
  };

  // 離れるときに、保存待ちのものを書き込む（ほかの人の更新が来ていれば、ブロックごとにまとめてから）
  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      if (saveTextRef.current) {
        const changed = changedTexts(base.current, editor.document);
        if (Object.keys(changed).length) saveTextRef.current(changed, Date.now());
        return;
      }
      const remote = latest.current;
      const blocks = live && remote.updatedAt > lastSaved.current ? mergeBlocks(base.current as Loose, editor.document as Loose, remote.blocks as Loose) : editor.document;
      saveRef.current(blocks, Date.now());
    },
    [editor, live],
  );

  // 別のタブ・別の人の更新を取り込む。書いている途中（保存待ち）なら、書くのを止めたとき（save）に取り込む
  useEffect(() => {
    if (updatedAt === undefined || updatedAt <= lastSaved.current || timer.current) return;
    pull(blocks, updatedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pull は毎回作り直されるが、中で使うものは ref とエディタだけ
  }, [updatedAt, blocks, editor]);

  return (
    <div
      ref={wrapper}
      data-name={mode === "window" ? "ウィンドウの中身" : "本文のエディタ"}
      className={mode === "window" ? `doc-window ${editable ? "doc-editing" : ""}` : "note-editor"}
      // ふだんのウィンドウでは、画像を落としてもブロックを足さない（チャットの入力欄などに落とせるように）
      onDropCapture={textOnly ? undefined : dropImages(editor, roomId, userId)}
    >
      <BlockNoteView
        editor={editor}
        theme={isDark ? "dark" : "light"}
        editable={editable || textOnly}
        slashMenu={false}
        sideMenu={false}
        // ふだんのウィンドウでは、文字を選んだときのツールバーは EditorMenus が出す（固定した文章などでは出さない）
        formattingToolbar={!textOnly}
        onChange={() => {
          if (applying.current) return;
          onEdit?.(editor.document);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(save, 700);
        }}
      >
        <EditorMenus editor={editor} textOptions={textOptions} onTextOptions={onTextOptions} textOnly={textOnly} separate={separate} />
      </BlockNoteView>
    </div>
  );
}
