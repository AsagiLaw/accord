"use client";

import { createReactBlockSpec } from "@blocknote/react";
import { useRouter } from "next/navigation";
import { useContext, useEffect, useRef, useState } from "react";
import { NewPageDialog } from "@/components/db/NewPageDialog";
import { NewPageButton, ViewArea } from "@/components/db/DatabaseView";
import { PeekContext } from "@/components/db/PageLink";
import { useNoteContext } from "@/components/embeds";
import { Icon } from "@/components/Icon";
import { IconMark } from "@/components/IconMark";
import { ViewSkeleton } from "@/components/Skeleton";
import type { Database, PageTemplate } from "@/lib/local/db";
import { DB_BLOCK } from "@/lib/local/notes";
import { updateDatabase, useDatabase, useEvents, usePages, useViews } from "@/lib/local/requests";
import { INSIDE_META, SelectInside } from "./selectInside";

// Notion のデータベース（インライン・フルページ）：ノートの中に作ったデータベース。ビューはデータベースのもので、データベースの画面と同じものが出る。
// インラインは、名前・ビューのタブ・ツールバー・ビューを本文の中に出す。フルページ（page）は、子のページと同じ1行で、押すとデータベースの画面を開く

export const DatabaseBlock = createReactBlockSpec(
  {
    type: DB_BLOCK,
    // active：このブロックで選んでいるビュー／hideTitle："1" で名前を出さない／page："1" でフルページ（1行）
    propSchema: { dbId: { default: "" }, active: { default: "" }, hideTitle: { default: "" }, page: { default: "" } },
    content: "none",
  },
  {
    // 押してもブロックごと選ばれて青くならないようにする（Notion と同じ。消す・動かすのは「⋮⋮」から）
    meta: INSIDE_META,
    render: ({ block, editor }) => (
      <SelectInside>
        <DatabaseBlockView props={block.props} onChange={(p) => editor.updateBlock(block, { props: p })} />
      </SelectInside>
    ),
  },
);

/** 作ったばかりのデータベースの ID。そのブロックが出たら、名前の欄に入る（Notion と同じ） */
let focusNext: string | null = null;
export const focusDatabaseTitle = (dbId: string) => {
  focusNext = dbId;
};

const dbHref = (database: Pick<Database, "roomId" | "id">) => `/r/${database.roomId}/db/${database.id}`;

function DatabaseBlockView({
  props,
  onChange,
}: {
  props: { dbId: string; active: string; hideTitle: string; page: string };
  onChange: (patch: Partial<{ active: string; hideTitle: string; page: string }>) => void;
}) {
  const { roomId } = useNoteContext();
  const database = useDatabase(props.dbId);
  if (database === undefined) return <ViewSkeleton rows={3} />;
  // 完全に削除されたもの・ゴミ箱のもの：子のページと同じく、線を引いた1行（ゴミ箱のものは押すと開ける）
  if (!database || database.roomId !== roomId || database.deletedAt) return <DatabaseLink database={database && database.roomId === roomId ? database : null} />;
  if (props.page === "1") return <DatabaseLink database={database} />;
  return <InlineDatabase database={database} props={props} onChange={onChange} />;
}

/** フルページのデータベース（とゴミ箱・削除されたデータベース）の1行。押すとデータベースの画面を開く */
function DatabaseLink({ database }: { database: Database | null }) {
  const router = useRouter();
  const icon = (
    <span className="note-subpage-icon">
      <IconMark icon={database?.icon} fallback={<Icon name="db" size={18} />} />
    </span>
  );
  if (!database)
    return (
      <div contentEditable={false} className="note-subpage" data-gone="" title="削除されたデータベース">
        {icon}
        <span className="note-subpage-text">削除されたデータベース</span>
      </div>
    );
  const href = dbHref(database);
  return (
    <a
      href={href}
      contentEditable={false}
      draggable={false}
      className="note-subpage"
      data-name={`データベース「${database.name || "無題"}」`}
      data-gone={database.deletedAt ? "" : undefined}
      title={database.deletedAt ? "ゴミ箱にあるデータベース" : undefined}
      onClick={(e) => {
        // Ctrl・⌘・Shift を押しながらなら、ブラウザに任せる（新しいタブ・ウィンドウで開く）
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        router.push(href);
      }}
    >
      {icon}
      <span className={`note-subpage-text ${database.name ? "" : "text-muted"}`}>{database.name || "無題"}</span>
    </a>
  );
}

/** インラインのデータベース：名前（その場で直せる）・ビューのタブとツールバー・「新規」・ビュー */
function InlineDatabase({
  database,
  props,
  onChange,
}: {
  database: Database;
  props: { active: string; hideTitle: string };
  onChange: (patch: Partial<{ active: string; hideTitle: string }>) => void;
}) {
  const { roomId, userId, members, locked } = useNoteContext();
  const router = useRouter();
  const views = useViews(database.id);
  const pages = usePages(database.id);
  const events = useEvents(roomId);
  const view = views?.find((v) => v.id === props.active) ?? views?.[0];
  const peek = useContext(PeekContext);
  // 作ったページは、ノートを離れずにビューの開き方で開く（Notion の「新規」と同じ）
  const openPage = (pageId: string) => {
    const mode = view?.options.openAs ?? "peek";
    if (peek && mode !== "page") peek(database, pageId, mode);
    else router.push(`${dbHref(database)}/p/${pageId}`);
  };
  // 「新規」で開くフォーム（選んだテンプレート。null はテンプレートなし）
  const [adding, setAdding] = useState<{ template: PageTemplate | null } | null>(null);
  const defaultTemplate = database.templates?.find((t) => t.id === database.defaultTemplateId) ?? null;
  const titled = props.hideTitle !== "1";

  return (
    <div contentEditable={false} className="group/db relative w-full py-1" data-name={`データベース「${database.name || "無題"}」`}>
      {titled && <InlineTitle database={database} locked={!!locked} onOpen={() => router.push(dbHref(database))} />}
      {views && pages && events ? (
        <ViewArea
          inline
          locked={!!locked}
          database={database}
          views={views}
          view={view}
          pages={pages}
          events={events}
          members={members}
          userId={userId}
          onSwitch={(id) => onChange({ active: id })}
          onNew={() => setAdding({ template: defaultTemplate })}
          end={!locked && <NewPageButton small database={database} label="新規" onNew={(template) => setAdding({ template })} />}
          titleToggle={{ shown: titled, onChange: (shown) => onChange({ hideTitle: shown ? "" : "1" }) }}
        />
      ) : (
        <ViewSkeleton type={view?.type} rows={3} />
      )}
      {adding && (
        <NewPageDialog database={database} members={members} userId={userId} template={adding.template ?? undefined} onClose={() => setAdding(null)} onCreated={(page) => openPage(page.id)} />
      )}
    </div>
  );
}

/** データベースの名前。押すとその場で直せる（空なら「無題」）。カーソルを合わせると、右に「フルページで開く」 */
function InlineTitle({ database, locked, onOpen }: { database: Database; locked: boolean; onOpen: () => void }) {
  // 書いている間は、自分の書いた名前を出す（保存の知らせを待つと、カーソルが飛ぶので）
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const name = draft ?? database.name;
  // 作ったばかりのデータベースなら、名前の欄に入る
  useEffect(() => {
    if (focusNext !== database.id) return;
    // エディタがカーソルを置き終えてから入る（開発中は effect が2回走るので、印を消すのは入るときに）
    const t = setTimeout(() => {
      if (focusNext !== database.id) return;
      focusNext = null;
      input.current?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [database.id]);
  return (
    <div className="group/title flex min-h-9 items-center gap-1.5 pb-1">
      {database.icon && (
        <span className="grid h-7 w-7 shrink-0 place-items-center text-[1.25em]">
          <IconMark icon={database.icon} />
        </span>
      )}
      {/* 入れた名前の幅にそろえる（右の「フルページで開く」を名前のすぐ後ろに置く） */}
      <span className="inline-grid min-w-0 text-[1.25em] leading-[1.3] font-bold">
        <span aria-hidden className="invisible col-start-1 row-start-1 overflow-hidden whitespace-pre">
          {name || "無題"}{" "}
        </span>
        <input
          ref={input}
          // 欄の幅は、後ろの見えない名前で決める（入力欄のはじめの幅を小さくしておく）
          size={1}
          value={name}
          readOnly={locked}
          placeholder="無題"
          aria-label="データベースの名前"
          onFocus={() => setDraft(database.name)}
          onChange={(e) => {
            setDraft(e.target.value);
            void updateDatabase(database.id, { name: e.target.value });
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className="col-start-1 row-start-1 w-full min-w-0 bg-transparent outline-none placeholder:text-muted"
        />
      </span>
      <button
        type="button"
        onClick={onOpen}
        aria-label="フルページで開く"
        title="フルページで開く"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-muted hover:bg-tint hover:text-ink md:opacity-0 md:group-hover/title:opacity-100 md:focus:opacity-100"
      >
        <Icon name="open" size={15} />
      </button>
    </div>
  );
}
