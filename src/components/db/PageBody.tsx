"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { NoteContext } from "@/components/embeds";
import { Icon } from "@/components/Icon";
import type { Database, DbPage, Note, PageTemplate } from "@/lib/local/db";
import { templateOf } from "@/lib/local/templates";
import { createNote, saveNoteBlocks, usePageNote } from "@/lib/local/notes";
import { restorePage, useDatabase, usePage } from "@/lib/local/requests";
import { useMembers, type MemberWithProfile } from "@/lib/local/rooms";
import { useEditMode } from "@/components/window/editMode";
import { TopBarActions } from "@/components/TopBarSlot";
import { useCurrentUser } from "@/lib/local/session";
import { daysLeft } from "./TrashDialog";
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
 * データベースのページの中身。ページの画面（/r/…/db/…/p/…）と、ビューから開くポップアップ（PagePeek）で使う。
 * peek のときは、ウィンドウ型のページも編集モードにしない
 */
export function PageBody({ roomId, dbId, pageId, peek }: { roomId: string; dbId: string; pageId: string; peek?: boolean }) {
  const database = useDatabase(dbId);
  const page = usePage(pageId);
  const me = useCurrentUser();
  const members = useMembers(roomId);
  const memo = usePageNote(pageId);

  // 本文を開いたらすぐ書けるよう、本文のノートを用意しておく（テンプレートと繋いでいるページは、テンプレートの中身を出すので要らない）
  const creating = useRef<string | null>(null);
  useEffect(() => {
    if (!database || !page || !me || memo !== null || page.sourceId || creating.current === page.id) return;
    creating.current = page.id;
    void createNote(roomId, me.id, page.title, page.id);
  }, [database, page, me, memo, roomId]);

  if (database === undefined || page === undefined || !me || !members) return <DocSkeleton />;
  const dbHref = `/r/${roomId}/db/${dbId}`;
  if (!database || !page || page.dbId !== dbId) {
    return (
      <p className="text-muted">
        見つかりません。<Link href={dbHref} className="underline">一覧へ</Link>
      </p>
    );
  }

  const isRequest = database.kind === "request";

  // ゴミ箱に入れたページは、戻すまで中身を出さない
  if (page.deletedAt)
    return (
      <div className="mx-auto max-w-md py-10 text-center" data-name="ゴミ箱のページ">
        <p className="mb-1 font-bold">「{page.title || "無題"}」はゴミ箱にあります</p>
        <p className="mb-4 text-sm text-muted">あと{daysLeft(page.deletedAt)}日で完全に削除されます</p>
        <button className="btn" onClick={() => void restorePage(page.id)}>
          <Icon name="trashRestore" size={16} />
          ゴミ箱から戻す
        </button>
      </div>
    );

  // ウィンドウ型のテンプレートで作ったページは、ページ全体がウィンドウ（タイトルや項目もブロック）
  // テンプレートと繋いでいれば、本文はテンプレートの中身を出す（直すのは、右クリックの「編集」から）
  const template = templateOf(database, page);
  if (page.bodyKind === "window") return <PageWindow database={database} page={page} note={memo} template={template} members={members} userId={me.id} peek={peek} />;

  // ノート型のページ：本文だけを、ノートと同じく中央の読みやすい幅で出す（ページ全体でスクロール）。
  // 名前は上のバーに出る。項目・チャット・進み具合は、本文にブロックで置ける
  return (
    <NoteContext.Provider value={{ roomId, userId: me.id, members, owner: `page:${page.id}`, page: { dbId, pageId: page.id } }}>
      <div data-name={isRequest ? "依頼ページ" : "ページ"} className="mx-auto w-full max-w-4xl pb-10">
        {template ? (
          <NoteEditor
            key={`tpl:${template.id}:${template.updatedAt ?? template.createdAt}`}
            note={templateNote(template, page)}
            userId={me.id}
            members={members}
            page={{ dbId, pageId: page.id }}
            editable={false}
            owner={`page:${page.id}`}
          />
        ) : memo ? (
          <NoteEditor key={memo.id} note={memo} userId={me.id} members={members} page={{ dbId, pageId: page.id }} linkable={!peek} />
        ) : (
          <DocSkeleton title={false} />
        )}
      </div>
    </NoteContext.Provider>
  );
}

/**
 * ウィンドウ型のページ：ページ全体を画面に固定。中身はページのノート（ノートと同じブロック）で、タイトルや項目・チャットもブロックで並べる。
 * 編集と削除は、サイドバー（や表）のページの右クリックから。編集中だけ右上に「完了」
 */
function PageWindow({
  database,
  page,
  note,
  template,
  members,
  userId,
  peek,
}: {
  database: Database;
  page: DbPage;
  note: Note | null | undefined;
  template?: PageTemplate;
  members: MemberWithProfile[];
  userId: string;
  peek?: boolean;
}) {
  const { editing: editParam, finish } = useEditMode();
  // テンプレートと繋いでいるときは、ここでは直さない（右クリックの「編集」で、テンプレートを直すか、分けて直すかを選ぶ）。ポップアップでも直さない
  const editing = editParam && !template && !peek;
  const label = "ページ";
  return (
    <NoteContext.Provider value={{ roomId: page.roomId, userId, members, owner: note && !template ? `note:${note.id}` : `page:${page.id}`, locked: !editing, page: { dbId: database.id, pageId: page.id }, windowMode: true }}>
      {/* 「データベース › ページ」は上のバーに出る。編集中だけ、上のバーの右に「完了」 */}
      {editing && (
        <TopBarActions>
          <button onClick={finish} className="btn h-7 min-h-0 px-3 text-sm" data-name="編集を終える">
            <Icon name="ok" size={14} />
            完了
          </button>
        </TopBarActions>
      )}
      {/* メイン画面の左右・上下の余白を打ち消して、画面の端まで使う */}
      <div data-name={`${label}ページ（ウィンドウ）`} className="-mx-[clamp(16px,4vw,40px)] -mt-4 -mb-7 flex h-[calc(100%+2.75rem)] flex-col overflow-hidden">
        <div className="min-h-0 flex-1">
          {template ? (
            // テンプレートを直したら、表示を入れ替える（key に直した日時）
            <BlockEditor
              key={`tpl:${template.id}:${template.updatedAt ?? template.createdAt}`}
              id={`tpl-${template.id}`}
              blocks={template.blocks ?? []}
              roomId={page.roomId}
              userId={userId}
              editable={false}
              mode="window"
              onSave={() => undefined}
            />
          ) : note ? (
            <BlockEditor key={note.id} id={note.id} blocks={note.blocks} roomId={page.roomId} userId={userId} editable={editing} mode="window" onSave={(blocks) => saveNoteBlocks(note.id, blocks, userId)} />
          ) : (
            <DocSkeleton title={false} className="p-4" />
          )}
        </div>
      </div>
    </NoteContext.Provider>
  );
}

/** テンプレートの中身を、ノートのエディタで出すための入れ物（読むだけ） */
function templateNote(template: PageTemplate, page: DbPage): Note {
  return {
    id: `tpl-${template.id}`,
    roomId: page.roomId,
    title: template.name,
    blocks: template.blocks ?? [],
    pageId: page.id,
    order: 0,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt ?? template.createdAt,
    updatedBy: "",
  };
}
