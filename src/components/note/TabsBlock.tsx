"use client";

import { SideMenuExtension } from "@blocknote/core/extensions";
import { useEditorChange, useExtensionState } from "@blocknote/react";
import { useEffect, useReducer, useRef, useState } from "react";
import { BLOCK_KINDS } from "@/components/blockKinds";
import { VIEW_TYPES } from "@/components/db/meta";
import { useNoteContext } from "@/components/embeds";
import { Icon, type IconName } from "@/components/Icon";
import { shownProps } from "@/components/pageBlocks";
import { MenuDivider, MenuItem, Popover, usePopover } from "@/components/ui/Popover";
import { TabStrip, TabSwitch } from "@/components/ui/TabStrip";
import { promptText } from "@/components/ui/overlay";
import { newId } from "@/lib/id";
import type { BlockKind } from "@/lib/local/db";
import { useDatabase } from "@/lib/local/requests";
import type { NoteEditor as Editor } from "./blocks";

// タブのブロック：タブごとの入れ物（tabPanel。子のブロック）に中身のブロックを入れて、選んだタブの中身だけを見せる。
// タブの中では、ふつうに行を足したり「/」でブロックを入れたりできる（中のキーは containers.ts）。
// ほかのブロックの「⋮⋮」を、タブに落とすとそのタブの中へ、タブの並びの空いているところに落とすと新しいタブになる。タブをドラッグすると並べ替え。
// 中のブロックは、「⋮⋮」の「タブから外す」・Shift+Tab・ドラッグで外に出せる

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

/** 中身の無い文章のブロック（タブの名前に使わない） */
export const blank = (b: AnyBlock) => (b.type === "paragraph" || b.type === "heading") && !textOf(b);

/**
 * タブの名前に使うブロック：入れ物の中の最初のブロック（空の行は飛ばす）。
 * 前の形（入れ物なしで、ブロック1つがそのままタブ）は、読み込んですぐ入れ物に入れ直す（containers.ts）までのあいだ、そのブロック
 */
export const tabHead = (t: AnyBlock): AnyBlock | undefined => (t.type === "tabPanel" ? (t.children.find((b) => !blank(b)) ?? t.children[0]) : t);

/** タブに付けた名前（前の形では、中のブロックの ID で覚えている） */
export const tabTitle = (titles: Record<string, string>, t: AnyBlock) => titles[t.id] || titles[tabHead(t)?.id ?? ""] || undefined;

/** 選んでいるタブ（前の形では、中のブロックの ID で覚えている） */
export const activeTab = (t: AnyBlock) =>
  t.children.find((c) => c.id === t.props.active) ?? t.children.find((c) => c.type === "tabPanel" && c.children.some((x) => x.id === t.props.active)) ?? t.children[0];

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
 * タブのアイコンと名前。child はタブの名前に使うブロック（tabHead）。名前は：付けた名前 → 文章なら最初の文字 → シングルビュー・データベースと繋いだテキストなら項目の名前
 * → ページの項目なら見出し（無ければ、1つだけ出している項目の名前）→ オールビューならビューの名前 → ブロックの種類
 */
export function TabLabel({ child, title }: { child?: AnyBlock; title?: string }) {
  const ctx = useNoteContext();
  const type = child?.type ?? "paragraph";
  const p = (child?.props ?? {}) as Record<string, string>;
  const isSingle = type === "singleView";
  const isField = type === "field";
  const isProps = type === "pageProps";
  const database = useDatabase(isSingle || isField || isProps ? (p.pageId === "@this" ? (ctx.page?.dbId ?? "") : (p.dbId ?? "")) : "");
  const prop = isSingle || isField ? database?.props.find((x) => x.id === p.propId) : undefined;
  const shown = isProps && database ? shownProps(database, p.visible) : [];
  const isView = type === "dbView";
  // オールビューは、ブロックが持つビューのうち選んでいるもの
  const view = isView ? blockViewOf(p.views, p.active) : undefined;
  const kind = BLOCK_KINDS[type as BlockKind];
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
      : type === "field"
        ? "link"
        : type === "tabs"
          ? "board"
          : "text";
  const text = child ? textOf(child) : "";
  const name =
    title ||
    (text ? (text.length > 12 ? `${text.slice(0, 12)}…` : text) : "") ||
    (isSingle ? (prop?.name ?? "シングルビュー") : "") ||
    (isField ? (prop?.name ?? "") : "") ||
    (isProps ? p.heading || (shown.length === 1 ? shown[0].name : "") : "") ||
    view?.name ||
    kind?.short ||
    (type === "paragraph" ? "テキスト" : type === "heading" ? "見出し" : "ブロック");
  return (
    <>
      <Icon name={icon} size={14} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{name}</span>
    </>
  );
}

const getBlock = (editor: Editor, id: string) => editor.getBlock(id) as unknown as AnyBlock | undefined;

/** id のブロックが、ancestor のブロックの中にあるか */
function isInside(editor: Editor, id: string, ancestor: string) {
  for (let p = editor.getParentBlock(id); p; p = editor.getParentBlock(p.id)) if (p.id === ancestor) return true;
  return false;
}

/** タブを外に出す：中身をタブのブロックのすぐ下に置く。残りのタブが1つなら、タブをやめて中身だけにする */
export function undockTab(editor: Editor, tabsId: string, panelId: string) {
  const t = getBlock(editor, tabsId);
  const p = t?.children.find((x) => x.id === panelId);
  if (!t || !p) return;
  const inner = (c: AnyBlock) => (c.type === "tabPanel" ? c.children : [c]);
  const rest = t.children.filter((x) => x.id !== panelId);
  const active = activeTab(t)?.id;
  editor.transact(() => {
    if (rest.length >= 2) {
      editor.removeBlocks([panelId]);
      editor.updateBlock(tabsId, { props: { active: active === panelId ? rest[0].id : active } as never });
      editor.insertBlocks(inner(p) as never, tabsId, "after");
    } else editor.replaceBlocks([tabsId], [...rest.flatMap(inner), ...inner(p)] as never);
  });
}

/** 新しいタブの入れ物（中身が無ければ空の行を1つ） */
export const newPanel = (children: AnyBlock[] = [], id = newId()) => ({ id, type: "tabPanel", props: {}, children: children.length ? children : [{ type: "paragraph" }] }) as unknown as AnyBlock;

export function TabsBlockView({ block: initial, editor }: { block: AnyBlock; editor: Editor }) {
  const ctx = useNoteContext();
  // 中のブロックが変わっても、タブのブロック自身（BlockNote が描き直す単位）は変わらないので、エディタの変更を見て、タブの並びが変わったときに描き直す
  const latest = () => getBlock(editor, initial.id) ?? initial;
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const sig = useRef("");
  useEditorChange(() => {
    const t = getBlock(editor, initial.id);
    if (!t) return;
    const next = JSON.stringify([t.props, t.children.map((c) => [c.id, tabHead(c) && { ...tabHead(c), children: undefined }])]);
    if (next === sig.current) return;
    sig.current = next;
    refresh();
  }, editor as never);
  const block = latest();
  const children = block.children;
  const titles = parseTitles(block.props.titles);
  const active = activeTab(block)?.id ?? "";
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

  const select = (id: string) => editor.updateBlock(block.id, { props: { active: id } as never });
  /** タブの中の最初の行に入る（足したタブ・ブロックを入れたタブ） */
  const focusTab = (id: string) => {
    const first = getBlock(editor, id)?.children[0];
    if (!first || !Array.isArray(first.content)) return;
    editor.setTextCursorPosition(first.id, "start");
    editor.focus();
  };

  /** 動かすブロックを元の場所から外す。このタブのブロックの中で、そのブロックだけが入っていたタブは、タブごと外す */
  const take = (id: string) => {
    const parent = editor.getParentBlock(id) as unknown as AnyBlock | undefined;
    const t = latest();
    const emptied = parent?.type === "tabPanel" && parent.children.length === 1 && t.children.length > 1 && t.children.some((c) => c.id === parent.id);
    editor.removeBlocks([emptied ? parent.id : id]);
  };
  /** ほかのブロックを、新しいタブにして入れる */
  const dock = (b: AnyBlock) => {
    const t = latest();
    if (b.id === block.id || isInside(editor, block.id, b.id) || t.children.some((p) => p.children.length === 1 && p.children[0].id === b.id)) return;
    const panel = newPanel([b]);
    editor.transact(() => {
      take(b.id);
      const last = latest().children.at(-1);
      if (last) editor.insertBlocks([panel as never], last.id, "after");
      else editor.updateBlock(block.id, { children: [panel] as never });
      select(panel.id);
    });
  };
  /** ほかのブロックを、そのタブの中（最後）に入れる。入れる先が空の行1つだけなら、その行と入れ替える */
  const dockInto = (panelId: string, b: AnyBlock) => {
    if (b.id === block.id || isInside(editor, block.id, b.id) || getBlock(editor, panelId)?.children.some((c) => c.id === b.id)) return select(panelId);
    editor.transact(() => {
      take(b.id);
      const inner = getBlock(editor, panelId)?.children ?? [];
      const last = inner.at(-1);
      if (inner.length === 1 && last && last.type === "paragraph" && !textOf(last) && !last.children.length) editor.replaceBlocks([last.id], [b] as never);
      else if (last) editor.insertBlocks([b] as never, last.id, "after");
      else editor.updateBlock(panelId, { children: [b] as never });
      select(panelId);
    });
  };
  const move = (id: string, to: number) => {
    const list = [...latest().children];
    const from = list.findIndex((x) => x.id === id);
    if (from < 0) return;
    const [c] = list.splice(from, 1);
    list.splice(Math.max(0, Math.min(list.length, to)), 0, c);
    editor.updateBlock(block.id, { children: list as never, props: { active } as never });
  };
  /** タブを削除する（中身も一緒に）。最後の1つを消したら、タブのブロックごと消す */
  const removeTab = (id: string) => {
    const t = latest();
    const i = t.children.findIndex((x) => x.id === id);
    if (i < 0) return;
    const rest = t.children.filter((x) => x.id !== id);
    if (!rest.length) return editor.removeBlocks([block.id]);
    editor.transact(() => {
      editor.removeBlocks([id]);
      select(active === id ? rest[Math.min(i, rest.length - 1)].id : active);
    });
  };
  const addTab = () => {
    const panel = newPanel();
    const last = latest().children.at(-1);
    editor.transact(() => {
      if (last) editor.insertBlocks([panel as never], last.id, "after");
      else editor.updateBlock(block.id, { children: [panel] as never });
      select(panel.id);
    });
    focusTab(panel.id);
  };

  // タブの並びに落としたとき：エディタのいつもの「落とす」より先に受け取る
  useEffect(() => {
    const el = strip.current;
    if (!el || ctx.locked) return;
    const tabEls = () => [...el.querySelectorAll<HTMLElement>("[role=tab]")];
    const indexAt = (x: number) =>
      tabEls().filter((t) => {
        const r = t.getBoundingClientRect();
        return r.left + r.width / 2 < x;
      }).length;
    const tabAt = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>("[role=tab]") : null);
    /** ブロックを乗せているタブに印を付ける（落とすと、そのタブの中へ） */
    const mark = (tab: HTMLElement | null) => tabEls().forEach((t) => t.toggleAttribute("data-drop-into", t === tab));
    const over = (e: DragEvent) => {
      const tab = e.dataTransfer?.types.includes(TAB_MIME);
      if (!tab && !draggedRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const into = tab ? null : tabAt(e.target);
      mark(into);
      setHot(!into);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
      mark(null);
      setHot(false);
    };
    const drop = (e: DragEvent) => {
      mark(null);
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
      if (editor.prosemirrorView) editor.prosemirrorView.dragging = null;
      const into = tabAt(e.target);
      const target = into ? latest().children[tabEls().indexOf(into)] : undefined;
      if (target) dockInto(target.id, b);
      else dock(b);
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
  const items = children.map((c) => ({ id: c.id, content: <TabLabel child={tabHead(c)} title={tabTitle(titles, c)} /> }));
  // タブの名前に使ったブロックの見出し（タブの名前と同じ）は出さない。読むだけのときは見出しの段ごと出さない（チャットの検索・通知などのボタン data-block-keep があれば、段は残す）
  const heads = children.flatMap((c) => {
    const h = tabHead(c);
    return h && /^[\w-]+$/.test(h.id) ? [h.id] : [];
  });

  return (
    // 読むだけのときは、スマホの幅ではタブの並びの代わりに小さな切り替えを出し、枠もなくす（data-compact。globals.css）
    <div className="w-full" contentEditable={false} data-tabs="" data-compact={ctx.locked ? "" : undefined} data-name="タブブロック">
      {/* 選んでいないタブの中身（入れ物）は隠す */}
      <style>
        {`[data-id="${block.id}"] > .bn-block > .bn-block-group > .bn-block-outer:not([data-id="${active}"]) { display: none !important; }${
          heads.length
            ? ` ${heads.map((id) => `[data-id="${id}"] > .bn-block > .react-renderer [data-block-title], [data-id="${id}"] > .bn-block > .react-renderer [data-block-head][data-locked]:not(:has([data-block-keep]))`).join(", ")} { display: none !important; }`
            : ""
        }`}
      </style>
      {ctx.locked && <TabSwitch items={items} active={active} onSelect={select} label="タブ" className="md:hidden" />}
      <TabStrip
        items={items}
        active={active}
        onSelect={select}
        label="タブ"
        stripRef={strip}
        // タブのブロックは、灰色の枠の上にタブが並び、下に角の丸い白い中身が出る（枠は globals.css）
        className={`px-1 pt-1 ${hot ? "ring-2 ring-accent" : ""} ${ctx.locked ? "max-md:hidden" : ""}`}
        title={ctx.locked ? undefined : "ブロックの「⋮⋮」をタブに落とすとそのタブの中へ、空いているところに落とすと新しいタブになります"}
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
            <button onClick={addTab} aria-label="タブを足す" title="タブを足す" className="grid h-8 w-8 shrink-0 place-items-center rounded-t-[8px] text-muted hover:bg-tint">
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
              const name = await promptText("タブの名前", tabTitle(titles, current) ?? "", "タブの名前");
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
          <MenuItem icon={<Icon name="open" size={16} />} onClick={() => (menu.close(), undockTab(editor, block.id, current.id))}>
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
