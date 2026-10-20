"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NoteContext } from "@/components/embeds";
import { Icon } from "@/components/Icon";
import { choose } from "@/components/ui/overlay";
import { saveNoteBlocks } from "@/lib/local/notes";
import { useDatabase, usePage } from "@/lib/local/requests";
import { useMembers } from "@/lib/local/rooms";
import { useCurrentUser } from "@/lib/local/session";
import { ensureSubPage, unlinkSubPage, useSubPage } from "@/lib/local/subPages";
import type { SubPageTarget } from "./PageLink";
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
 * 「ページ」の項目の別ページのポップアップ（画面の真ん中に重ねる。ページのポップアップの上にも重なる）。
 * はじめて開いたときに、項目の設定のテンプレートで別ページを作る。
 * ノート型はそのまま書ける。ウィンドウ型は「編集」で直す（テンプレートと繋いでいれば、テンプレートを直すか、切り離して直すかを選ぶ）
 */
export function SubPagePeek({ roomId, dbId, pageId, propId, onClose }: SubPageTarget & { onClose: () => void }) {
  const router = useRouter();
  const database = useDatabase(dbId);
  const page = usePage(pageId);
  const me = useCurrentUser();
  const members = useMembers(roomId);
  const note = useSubPage(pageId, propId);
  const prop = database?.props.find((p) => p.id === propId);
  const [editing, setEditing] = useState(false);

  // まだ無ければ作る
  const creating = useRef(false);
  useEffect(() => {
    if (!database || !page || prop?.type !== "page" || !me || note !== null || creating.current) return;
    creating.current = true;
    void ensureSubPage(database, page, prop, me.id);
  }, [database, page, prop, me, note]);

  const template = note?.sub?.sourceId ? database?.templates?.find((t) => t.id === note.sub!.sourceId) : undefined;
  const isWindow = note?.sub?.kind === "window";

  // 編集：テンプレートと繋いでいれば、テンプレートを直すか、切り離して（この別ページだけの中身にして）直すかを選ぶ
  const edit = async () => {
    if (!template || !database || !note) return setEditing(true);
    const k = await choose("テンプレートと繋がっています", [
      { label: "テンプレートを編集", detail: `テンプレート「${template.name}」の画面で直します。同じテンプレートを使っているページ・別ページすべてに反映されます` },
      { label: "分けて編集", detail: "今の中身をコピーして、この別ページだけの中身にしてから編集します。テンプレートとの繋がりは外れます" },
    ]);
    if (k === 0) {
      onClose();
      router.push(`/r/${roomId}/db/${dbId}/t/${template.id}`);
    }
    if (k === 1) {
      await unlinkSubPage(database, note);
      setEditing(true);
    }
  };

  const missing = database === null || page === null || (database && !prop) || (prop && prop.type !== "page");
  const body = () => {
    if (missing) return <p className="p-4 text-muted">別ページが見つかりません（項目かページが消えたかもしれません）</p>;
    if (!database || !page || !note || !me || !members) return <DocSkeleton title={false} className="p-4" />;
    const scope = { dbId: database.id, pageId: page.id };
    if (!isWindow)
      return (
        <div className="min-h-0 flex-1 overflow-auto px-[clamp(16px,4vw,40px)] pt-4 pb-7 [scrollbar-gutter:stable]">
          <div className="mx-auto w-full max-w-4xl">
            <NoteEditor key={note.id} note={note} userId={me.id} members={members} page={scope} />
          </div>
        </div>
      );
    return (
      <div className="min-h-0 flex-1">
        <NoteContext.Provider value={{ roomId, userId: me.id, members, owner: `note:${note.id}`, locked: !editing || !!template, page: scope, windowMode: true }}>
          {template ? (
            // テンプレートを直したら、表示を入れ替える（key に直した日時）
            <BlockEditor
              key={`tpl:${template.id}:${template.updatedAt ?? template.createdAt}`}
              id={`tpl-${template.id}`}
              blocks={template.blocks ?? []}
              roomId={roomId}
              userId={me.id}
              editable={false}
              mode="window"
              onSave={() => undefined}
            />
          ) : (
            <BlockEditor key={note.id} id={note.id} blocks={note.blocks} roomId={roomId} userId={me.id} editable={editing} mode="window" onSave={(blocks) => saveNoteBlocks(note.id, blocks, me.id)} />
          )}
        </NoteContext.Provider>
      </div>
    );
  };

  return (
    <PeekFrame
      name="別ページのポップアップ"
      label={prop?.name ?? "別ページ"}
      onClose={onClose}
      // 上のバー：持ち主のページ › 項目の名前と、（ウィンドウ型は）編集・完了
      head={
        <>
          <Icon name="note" size={16} className="shrink-0 text-muted" />
          <span className="min-w-0 truncate text-sm font-bold">
            {page && prop ? (
              <>
                <span className="font-normal text-muted">{page.title || "無題"} › </span>
                {prop.name}
              </>
            ) : (
              "別ページ"
            )}
          </span>
          {isWindow && note && (
            <button className="btn-sub ml-auto h-8 min-h-0 gap-1 px-2.5 text-sm" onClick={() => (editing ? setEditing(false) : void edit())} data-name={editing ? "編集を終える" : "編集"}>
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
