"use client";

import "@blocknote/mantine/style.css";
import { BlockNoteView } from "@blocknote/mantine";
import { useEffect, useRef, useState } from "react";
import { mergeBlocks } from "@/lib/note/mergeBlocks";
import type { Note } from "@/lib/local/db";
import { syncInlineDbs } from "@/lib/local/inlineDbs";
import { inlineDbIds, saveNoteBlocks, subPageIds, syncSubPages } from "@/lib/local/notes";
import type { MemberWithProfile } from "@/lib/local/rooms";
import { useIsDark } from "@/lib/theme";
import { NoteContext, type NoteEditor as Editor } from "./blocks";
import { jumpToBlock } from "./docBlocks";
import { dropImages, EditorMenus, useBlockEditor, type Blocks } from "./editorKit";

/**
 * ブロック式のノート。入力が止まって少ししたら自動で保存する。
 * 他の人（別のタブ）が更新したときは、書いていなければすぐに、書いている途中なら書くのを止めたとき（保存のとき）に、
 * ブロックごとにまとめて取り込む（自分が直したブロックは自分の内容を残す）。
 */
/**
 * page：データベースのページの本文（メモ）のとき。ページのブロックがそのページを出す。
 * テンプレートと繋いだノートでは、note はテンプレート、owner・linkedChats はこのノートのもの。editable が false なら読むだけ。
 * ノートのチャンネル（ページの頭にタイトルがあるとき）：editorRef でエディタを渡し、いちばん上の行の頭で ↑ を押すと onExitTop を呼ぶ（タイトルへ戻る）。
 * linkable なら「⋮⋮」に「ブロックへのリンクをコピー」を出し、URL の #block-（ID）のブロックへ移る。
 * subPages なら「/」で子のページ（「ページ」ブロック）を作れ、ブロックを消すと子のページはゴミ箱へ（元に戻すと戻る）。
 * テンプレートやテンプレートと繋いだノートでなければ、「/」でこのノートの中にデータベースを作れ、ブロックを消すとデータベースはゴミ箱へ（元に戻すと戻る）
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
  editorRef,
  onExitTop,
  linkable = false,
  subPages = false,
}: {
  note: Note;
  userId: string;
  members: MemberWithProfile[];
  page?: { dbId: string; pageId: string };
  editable?: boolean;
  owner?: string;
  linkedChats?: { get: (blockId: string) => string | undefined; set: (blockId: string, chatId: string) => void };
  template?: boolean;
  editorRef?: React.RefObject<Editor | null>;
  onExitTop?: () => void;
  linkable?: boolean;
  subPages?: boolean;
}) {
  const isDark = useIsDark();
  const editor = useBlockEditor(note.blocks, note.roomId, userId, [note.id]);
  useEffect(() => {
    if (!editorRef) return;
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);
  const exitTop = useRef(onExitTop);
  useEffect(() => {
    exitTop.current = onExitTop;
  });
  const lastSaved = useRef(note.updatedAt);
  // 前にそろえたときの本文（自分がどのブロックを直したかを見分けるのに使う）
  const base = useRef<Blocks>([]);
  // エディタは読み込んだ本文の形を少し整えるので、比べる元はエディタの中身にする
  useEffect(() => {
    base.current = editor.document as Blocks;
  }, [editor]);
  // ほかの人の本文を入れている間は、入力として扱わない（保存しない。2人で開いているときに保存し合わないように）
  const applying = useRef(false);
  // 保存のときに見る、いちばん新しいノート（ほかの人の更新が来ていれば、ここに入っている）
  const latest = useRef(note);
  useEffect(() => {
    latest.current = note;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState<"idle" | "pending" | "saved">("idle");
  const wrapper = useRef<HTMLDivElement>(null);
  // 本文にある子のページ（「ページ」ブロック）とデータベース。自分が消した・戻したものを見分けるのに使う
  const pages = useRef<string[]>([]);
  const dbs = useRef<string[]>([]);
  useEffect(() => {
    pages.current = subPageIds(editor.document);
    dbs.current = inlineDbIds(editor.document);
  }, [editor]);
  // このノートの中にデータベースを作れるか（テンプレートは、使う先ごとにデータベースを分けられないので作らない）
  const dbHost = !template && !linkedChats ? note.id : undefined;
  /** 自分の編集で「ページ」・データベースのブロックが消えたらゴミ箱へ、戻ったら（元に戻す・切り取って貼る）ゴミ箱から戻す */
  const checkSubPages = () => {
    const now = subPageIds(editor.document);
    const before = pages.current;
    pages.current = now;
    const nowDbs = inlineDbIds(editor.document);
    const beforeDbs = dbs.current;
    dbs.current = nowDbs;
    if (dbHost) {
      const removed = beforeDbs.filter((id) => !nowDbs.includes(id));
      const added = nowDbs.filter((id) => !beforeDbs.includes(id));
      if (removed.length || added.length) void syncInlineDbs(dbHost, removed, added);
    }
    if (!subPages) return;
    const removed = before.filter((id) => !now.includes(id));
    const added = now.filter((id) => !before.includes(id));
    if (removed.length || added.length) void syncSubPages(note.id, removed, added);
  };

  // ブロックへのリンク（#block-ID）で開いたら、そのブロックまで移って光らせる
  useEffect(() => {
    if (!linkable) return;
    const go = () => {
      const id = decodeURIComponent(location.hash.match(/^#block-(.+)$/)?.[1] ?? "");
      // エディタが描き終わるのを待ってから
      if (id) setTimeout(() => wrapper.current && jumpToBlock(wrapper.current, id), 150);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [linkable, editor]);

  // いちばん上の行の頭で ↑ を押したら、ページのタイトルへ戻る（Notion と同じ）
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    if (!exitTop.current || e.key !== "ArrowUp" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return;
    if (document.querySelector(".bn-suggestion-menu")) return;
    const sel = editor.prosemirrorState.selection;
    if (!sel.empty || sel.$from.parentOffset !== 0) return;
    const first = editor.document[0];
    if (!first || editor.getTextCursorPosition().block.id !== first.id) return;
    e.preventDefault();
    exitTop.current();
  };

  /** ほかの人の本文を、今の本文とブロックごとにまとめてエディタに入れ、まとめた本文を返す */
  const pull = (remote: Note) => {
    const local = editor.document as Blocks;
    const merged = mergeBlocks(base.current as { id?: string }[], local as { id?: string }[], ((remote.blocks.length ? remote.blocks : [{ type: "paragraph" }]) as Blocks) as { id?: string }[]) as Blocks;
    // カーソルのあるブロックを覚えておき、入れ替えたあとに戻す
    let cursor: string | undefined;
    try {
      cursor = editor.getTextCursorPosition().block.id;
    } catch {
      cursor = undefined;
    }
    applying.current = true;
    try {
      editor.replaceBlocks(editor.document, merged.length ? merged : [{ type: "paragraph" }]);
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
    lastSaved.current = remote.updatedAt;
    base.current = editor.document as Blocks;
    // ほかの人が消した・足した「ページ」・データベースのブロックは、その人の側で済ませている
    pages.current = subPageIds(editor.document);
    dbs.current = inlineDbIds(editor.document);
    return merged;
  };

  const save = async () => {
    timer.current = null;
    // 書いている間にほかの人の更新が来ていたら、保存の前に取り込んで、まとめた本文を保存する
    const remote = latest.current;
    const pulled = remote.updatedAt > lastSaved.current;
    if (pulled) pull(remote);
    // 取り込んでいなくて、中身が前にそろえたときと同じなら、書き込まない
    if (!pulled && JSON.stringify(editor.document) === JSON.stringify(base.current)) {
      setSaving("saved");
      return;
    }
    // 書き込む前に「自分の保存」の時刻を覚える（書き込みの知らせが先に届いても、他の人の更新と間違えないように）
    const at = Date.now();
    lastSaved.current = at;
    base.current = editor.document as Blocks;
    await saveNoteBlocks(note.id, editor.document, userId, at);
    setSaving("saved");
  };

  // ページを離れるときに、保存待ちのものを書き込む
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        // 書いている間にほかの人の更新が来ていたら、ブロックごとにまとめてから書き込む
        const remote = latest.current;
        const blocks =
          remote.updatedAt > lastSaved.current
            ? mergeBlocks(base.current as { id?: string }[], editor.document as { id?: string }[], remote.blocks as { id?: string }[])
            : editor.document;
        void saveNoteBlocks(note.id, blocks, userId);
      }
    },
    [editor, note.id, userId],
  );

  // 別のタブ・別の人の更新を取り込む。書いている途中（保存待ち）なら、書くのを止めたとき（save）に取り込む
  useEffect(() => {
    if (note.updatedAt <= lastSaved.current || timer.current) return;
    pull(note);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pull は毎回作り直されるが、中で使うものは ref とエディタだけ
  }, [note.updatedAt, note.blocks, editor]);

  return (
    <NoteContext.Provider value={{ roomId: note.roomId, userId, members, owner: owner ?? `note:${note.id}`, page, locked: !editable, linkedChats, template }}>
      <div
        ref={wrapper}
        data-name="ノートのエディタ"
        className="note-editor"
        onDropCapture={dropImages(editor, note.roomId, userId)}
        onKeyDownCapture={onKeyDownCapture}
      >
        <BlockNoteView
          editor={editor}
          theme={isDark ? "dark" : "light"}
          slashMenu={false}
          sideMenu={false}
          // 文字を選んだときのツールバーは EditorMenus が出す（インラインコードのボタンを足したもの）
          formattingToolbar={false}
          editable={editable}
          onChange={() => {
            if (!editable || applying.current) return;
            checkSubPages();
            setSaving("pending");
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(save, 700);
          }}
        >
          <EditorMenus editor={editor} linkable={linkable} subPageOf={subPages ? note.id : undefined} dbNoteId={editable ? dbHost : undefined} noteMode />
        </BlockNoteView>
        <p className="mx-[54px] mt-2 h-4 text-right text-xs text-muted" aria-live="polite">
          {saving === "pending" ? "保存待ち…" : saving === "saved" ? "保存しました" : ""}
        </p>
      </div>
    </NoteContext.Provider>
  );
}
