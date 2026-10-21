"use client";

import { SideMenuExtension } from "@blocknote/core/extensions";
import { useExtensionState } from "@blocknote/react";
import { useEffect, useRef, useState } from "react";
import { BLOCK_KINDS } from "@/components/blockKinds";
import { VIEW_TYPES } from "@/components/db/meta";
import { useNoteContext } from "@/components/embeds";
import { Icon, type IconName } from "@/components/Icon";
import { shownProps } from "@/components/pageBlocks";
import { MenuDivider, MenuItem, Popover, usePopover } from "@/components/ui/Popover";
import { TabStrip, TabSwitch } from "@/components/ui/TabStrip";
import { promptText } from "@/components/ui/overlay";
import type { BlockKind } from "@/lib/local/db";
import { useDatabase } from "@/lib/local/requests";
import type { NoteEditor as Editor } from "./blocks";

// タブのブロック：中のブロック（子のブロック）を1つずつタブにして、選んだ1つだけを見せる。
// ほかのブロックの「⋮⋮」を、タブの並びの上に落とすとタブに入る。タブをドラッグすると並べ替え。
// 中のブロックの「⋮⋮」から「タブから外す」で外に出せる（ドラッグで外に出してもよい）

/** BlockNote のブロック（型をゆるくして扱う） */
export type AnyBlock = { id: string; type: string; props: Record<string, unknown>; content?: unknown; children: AnyBlock[] };

const TAB_MIME = "application/x-irai-tab";

export const parseTitles = (s: unknown): Record<string, string> => {
  try {
    return typeof s === "string" ? JSON.parse(s) : {};
  } catch {
    return {};
  }
};

/** 文章のブロックの中の文字（タブの名前に使う） */
export const textOf = (b: AnyBlock) =>
  Array.isArray(b.content)
    ? (b.content as { text?: string }[])
        .map((c) => c.text ?? "")
        .join("")
        .trim()
    : typeof b.content === "string"
      ? b.content
      : "";

/** オールビューの、選んでいるビューの名前と形（ビューはブロックが持つ） */
function blockViewOf(views: string | undefined, active: string | undefined): { name: string; type: keyof typeof VIEW_TYPES } {
  try {
    const list = JSON.parse(views || "[]") as { id: string; name?: string; type?: keyof typeof VIEW_TYPES }[];
    const v = list.find((x) => x.id === active) ?? list[0];
    return { name: v?.name || "表", type: v?.type ?? "table" };
  } catch {
    return { name: "表", type: "table" };
  }
}

/**
 * タブのアイコンと名前。名前は：付けた名前 → 文章なら最初の文字 → シングルビュー・データベースと繋いだテキストなら項目の名前
 * → ページの項目なら見出し（無ければ、1つだけ出している項目の名前）→ オールビューならビューの名前 → ブロックの種類
 */
export function TabLabel({ child, title }: { child: AnyBlock; title?: string }) {
  const ctx = useNoteContext();
  const p = child.props as Record<string, string>;
  const isSingle = child.type === "singleView";
  const isField = child.type === "field";
  const isProps = child.type === "pageProps";
  const database = useDatabase(isSingle || isField || isProps ? (p.pageId === "@this" ? (ctx.page?.dbId ?? "") : (p.dbId ?? "")) : "");
  const prop = isSingle || isField ? database?.props.find((x) => x.id === p.propId) : undefined;
  const shown = isProps && database ? shownProps(database, p.visible) : [];
  const isView = child.type === "dbView";
  // オールビューは、ブロックが持つビューのうち選んでいるもの
  const view = isView ? blockViewOf(p.views, p.active) : undefined;
  const kind = BLOCK_KINDS[child.type as BlockKind];
  // アイコン：シングルビューは出している項目（チャットならチャットのアイコン）、ほかはブロックの種類
  const icon: IconName = isSingle
    ? prop?.type === "imageChat"
      ? "ppl"
      : prop?.type === "chat"
        ? "chat"
        : "eye"
    : view
      ? VIEW_TYPES[view.type].icon
      : kind
      ? kind.icon
      : child.type === "field"
        ? "link"
        : child.type === "tabs"
          ? "board"
          : "text";
  const text = textOf(child);
  const name =
    title ||
    (text ? (text.length > 12 ? `${text.slice(0, 12)}…` : text) : "") ||
    (isSingle ? (prop?.name ?? "シングルビュー") : "") ||
    (isField ? (prop?.name ?? "") : "") ||
    (isProps ? p.heading || (shown.length === 1 ? shown[0].name : "") : "") ||
    view?.name ||
    kind?.short ||
    (child.type === "paragraph" ? "テキスト" : child.type === "heading" ? "見出し" : "ブロック");
  return (
    <>
      <Icon name={icon} size={14} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{name}</span>
    </>
  );
}

export function TabsBlockView({ block, editor }: { block: AnyBlock; editor: Editor }) {
  const ctx = useNoteContext();
  const children = block.children;
  const titles = parseTitles(block.props.titles);
  const active = children.find((c) => c.id === block.props.active)?.id ?? children[0]?.id ?? "";
  const strip = useRef<HTMLDivElement>(null);
  const [hot, setHot] = useState(false);
  const menu = usePopover();
  const [menuTab, setMenuTab] = useState<string | null>(null);
  // 「⋮⋮」でつかんでいるブロック（ドラッグ中もここに残る）
  const dragged = useExtensionState(SideMenuExtension, { editor, selector: (s) => s?.block as AnyBlock | undefined });
  const draggedRef = useRef<AnyBlock | undefined>(undefined);
  useEffect(() => {
    draggedRef.current = dragged;
  }, [dragged]);

  const latest = () => (editor.getBlock(block.id) as unknown as AnyBlock | undefined) ?? block;
  const setChildren = (next: AnyBlock[], activeId?: string) =>
    editor.updateBlock(block.id, { children: next as never, props: { active: activeId ?? (next.some((c) => c.id === active) ? active : (next[0]?.id ?? "")) } as never });
  const select = (id: string) => editor.updateBlock(block.id, { props: { active: id } as never });

  /** ほかのブロックをタブに入れる */
  const dock = (b: AnyBlock) => {
    if (b.id === block.id || latest().children.some((c) => c.id === b.id)) return;
    editor.transact(() => {
      editor.removeBlocks([b.id]);
      setChildren([...latest().children, b], b.id);
    });
  };
  /** タブを外に出す（タブのブロックのすぐ下に置く）。残りが1つならタブをやめる */
  const undock = (id: string) => {
    const t = latest();
    const c = t.children.find((x) => x.id === id);
    if (!c) return;
    const rest = t.children.filter((x) => x.id !== id);
    editor.transact(() => {
      if (rest.length >= 2) {
        setChildren(rest, rest[0].id);
        editor.insertBlocks([c as never], block.id, "after");
      } else editor.replaceBlocks([block.id], [...rest, c] as never);
    });
  };
  const move = (id: string, to: number) => {
    const list = [...latest().children];
    const from = list.findIndex((x) => x.id === id);
    if (from < 0) return;
    const [c] = list.splice(from, 1);
    list.splice(Math.max(0, Math.min(list.length, to)), 0, c);
    setChildren(list, active);
  };
  /**
   * タブを削除する。子のブロックを消すだけだとタブの並びが描き直されない（前の並びが残り、次の操作でエラーになる）ので、
   * 残りの子と選ぶタブを一緒に書き直す。最後の1つを消したら、タブのブロックごと消す
   */
  const removeTab = (id: string) => {
    const t = latest();
    const i = t.children.findIndex((x) => x.id === id);
    if (i < 0) return;
    const rest = t.children.filter((x) => x.id !== id);
    if (!rest.length) {
      editor.removeBlocks([block.id]);
      return;
    }
    setChildren(rest, active === id ? rest[Math.min(i, rest.length - 1)].id : active);
  };
  const addTab = () => {
    setChildren([...latest().children, { type: "paragraph" } as AnyBlock]);
    const added = latest().children.at(-1);
    if (added) select(added.id);
  };

  // タブの並びに落としたとき：エディタのいつもの「落とす」より先に受け取る
  useEffect(() => {
    const el = strip.current;
    if (!el || ctx.locked) return;
    const indexAt = (x: number) =>
      [...el.querySelectorAll<HTMLElement>("[role=tab]")].filter((t) => {
        const r = t.getBoundingClientRect();
        return r.left + r.width / 2 < x;
      }).length;
    const over = (e: DragEvent) => {
      const tab = e.dataTransfer?.types.includes(TAB_MIME);
      if (!tab && !draggedRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      setHot(true);
    };
    const leave = () => setHot(false);
    const drop = (e: DragEvent) => {
      setHot(false);
      const tabId = e.dataTransfer?.getData(TAB_MIME);
      if (tabId) {
        e.preventDefault();
        e.stopPropagation();
        const order = latest().children.map((c) => c.id);
        const to = indexAt(e.clientX);
        move(tabId, order.indexOf(tabId) < to ? to - 1 : to);
        return;
      }
      const b = draggedRef.current;
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      dock(b);
    };
    el.addEventListener("dragover", over);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragover", over);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
    };
  });

  const current = children.find((c) => c.id === menuTab);
  const index = children.findIndex((c) => c.id === menuTab);

  return (
    // 読むだけのときは、スマホの幅ではタブの並びの代わりに小さな切り替えを出し、枠もなくす（data-compact。globals.css）
    <div className="w-full" contentEditable={false} data-tabs="" data-compact={ctx.locked ? "" : undefined} data-name="タブブロック">
      {/* 選んでいないタブの中身（子のブロック）は隠す */}
      <style>{`[data-id="${block.id}"] > .bn-block > .bn-block-group > .bn-block-outer:not([data-id="${active}"]) { display: none !important; }`}</style>
      {ctx.locked && (
        <TabSwitch
          items={children.map((c) => ({ id: c.id, content: <TabLabel child={c} title={titles[c.id]} /> }))}
          active={active}
          onSelect={select}
          label="タブ"
          className="md:hidden"
        />
      )}
      <TabStrip
        items={children.map((c) => ({ id: c.id, content: <TabLabel child={c} title={titles[c.id]} /> }))}
        active={active}
        onSelect={select}
        label="タブ"
        stripRef={strip}
        // タブのブロックは、灰色の枠の上にタブが並び、下に角の丸い白い中身が出る（枠は globals.css）
        className={`px-1 pt-1 ${hot ? "ring-2 ring-accent" : ""} ${ctx.locked ? "max-md:hidden" : ""}`}
        title={ctx.locked ? undefined : "ほかのブロックの「⋮⋮」をここに落とすとタブに入ります"}
        draggable={!ctx.locked}
        onDragStartTab={(e, id) => {
          e.stopPropagation();
          e.dataTransfer.setData(TAB_MIME, id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onContextMenuTab={(e, id) => {
          if (ctx.locked) return;
          setMenuTab(id);
          menu.openAt(e);
        }}
        activeAccessory={(id) =>
          !ctx.locked && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="タブのメニュー"
              onClick={(e) => {
                e.stopPropagation();
                setMenuTab(id);
                menu.open(e);
              }}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full hover:bg-tint"
            >
              <Icon name="dots" size={12} />
            </span>
          )
        }
        after={
          !ctx.locked && (
            <button
              onClick={addTab}
              aria-label="タブを足す"
              title="タブを足す（足したタブの中で「/」を押すとブロックを選べます）"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-t-[8px] text-muted hover:bg-tint"
            >
              <Icon name="add" size={14} />
            </button>
          )
        }
      />
      {!children.length && <p className="rounded-b-[10px] border border-t-0 border-line p-3 text-sm text-muted">ほかのブロックの「⋮⋮」をタブの並びに落とすと、タブになります</p>}

      {menu.anchor && current && (
        <Popover anchor={menu.anchor} onClose={menu.close} width={220} label="タブのメニュー">
          <MenuItem
            icon={<Icon name="edit" size={16} />}
            onClick={async () => {
              menu.close();
              const name = await promptText("タブの名前", titles[current.id] ?? "", "タブの名前");
              if (name === null) return;
              editor.updateBlock(block.id, { props: { titles: JSON.stringify({ ...titles, [current.id]: name.trim() }) } as never });
            }}
          >
            名前を変える
          </MenuItem>
          {index > 0 && (
            <MenuItem icon={<Icon name="l" size={16} />} onClick={() => (menu.close(), move(current.id, index - 1))}>
              左へ
            </MenuItem>
          )}
          {index < children.length - 1 && (
            <MenuItem icon={<Icon name="r" size={16} />} onClick={() => (menu.close(), move(current.id, index + 1))}>
              右へ
            </MenuItem>
          )}
          <MenuDivider />
          <MenuItem icon={<Icon name="open" size={16} />} onClick={() => (menu.close(), undock(current.id))}>
            タブから外す（下に出す）
          </MenuItem>
          <MenuItem
            icon={<Icon name="del" size={16} />}
            danger
            onClick={() => {
              menu.close();
              removeTab(current.id);
            }}
          >
            このタブを削除
          </MenuItem>
        </Popover>
      )}
    </div>
  );
}
