"use client";

import type { ExtensionFactoryInstance } from "@blocknote/core";
import { type EditorState, Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { TabSwitch } from "@/components/ui/TabStrip";
import type { NoteEditor as Editor } from "./blocks";
import { parseTitles, TabLabel, textOf, type AnyBlock } from "./TabsBlock";

// 左右に並んだブロック（列）を、スマホの幅ではタブにして1列ずつ見せる（ノート・ウィンドウ・ページの本文で共通）。
// 保存する中身は変えない（パソコンでは今までどおり左右に並ぶ）。どの列を見ているかは画面の上だけで覚える。
// 列の並びのすぐ前にタブの並びを置き（ProseMirror の widget）、選んでいない列に印を付ける（globals.css でスマホのときだけ隠す）

type Active = Record<string, string>;
type State = { active: Active; deco: DecorationSet };

const key = new PluginKey<State>("columnTabs");

/** エディタごとの、タブの並びを置く場所（列の並びの ID → 要素）。React の側（ColumnTabsHost）がここに描く */
class Hosts {
  readonly els = new Map<string, HTMLElement>();
  private version = 0;
  private listeners = new Set<() => void>();
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  getVersion = () => this.version;
  notify() {
    // ProseMirror が描き直している途中で React を動かさないよう、少し後で知らせる
    queueMicrotask(() => {
      this.version++;
      for (const f of this.listeners) f();
    });
  }
  mount(listId: string) {
    const el = document.createElement("div");
    el.className = "col-tabs";
    el.contentEditable = "false";
    this.els.set(listId, el);
    this.notify();
    return el;
  }
  unmount(listId: string, el: HTMLElement) {
    if (this.els.get(listId) !== el) return;
    this.els.delete(listId);
    this.notify();
  }
}

const hostsOf = new WeakMap<object, Hosts>();

/** 列の並びごとに、タブの並び（列の並びの前）と、選んでいない列の印を付ける */
function decorate(doc: PMNode, active: Active, hosts: Hosts) {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "columnList") return true;
    const listId = String(node.attrs.id);
    const cols: { id: string; from: number; to: number }[] = [];
    node.forEach((col, offset) => cols.push({ id: String(col.attrs.id), from: pos + 1 + offset, to: pos + 1 + offset + col.nodeSize }));
    const on = cols.some((c) => c.id === active[listId]) ? active[listId] : cols[0]?.id;
    decos.push(
      Decoration.widget(pos, () => hosts.mount(listId), {
        key: `col-tabs:${listId}`,
        side: -1,
        ignoreSelection: true,
        // タブを押したときに、エディタのカーソルが動かないようにする
        stopEvent: () => true,
        destroy: (dom) => hosts.unmount(listId, dom as HTMLElement),
      }),
    );
    for (const c of cols) if (c.id !== on) decos.push(Decoration.node(c.from, c.to, { class: "col-tab-off" }));
    return true;
  });
  return DecorationSet.create(doc, decos);
}

/** カーソルがある列（入れ子なら外側の列も）。矢印のキーなどで隠れた列に入ったら、その列のタブに切り替えるため */
function columnsAtCursor(state: EditorState): Active {
  const $h = state.selection.$head;
  const out: Active = {};
  for (let d = $h.depth; d > 0; d--) {
    if ($h.node(d).type.name === "column" && $h.node(d - 1).type.name === "columnList") out[String($h.node(d - 1).attrs.id)] = String($h.node(d).attrs.id);
  }
  return out;
}

/** エディタに入れる機能（useBlockEditor の extensions に入れる） */
export const columnTabsExtension: ExtensionFactoryInstance = ({ editor }) => {
  const hosts = new Hosts();
  hostsOf.set(editor, hosts);
  return {
    key: "columnTabs",
    prosemirrorPlugins: [
      new Plugin<State>({
        key,
        state: {
          init: (_, state) => ({ active: {}, deco: decorate(state.doc, {}, hosts) }),
          apply: (tr, prev, _old, state) => {
            const picked = tr.getMeta(key) as Active | undefined;
            const cursor = tr.selectionSet ? columnsAtCursor(state) : {};
            const moved = Object.entries(cursor).some(([l, c]) => prev.active[l] !== c);
            if (!picked && !moved && !tr.docChanged) return prev;
            const active = picked || moved ? { ...prev.active, ...cursor, ...picked } : prev.active;
            return { active, deco: decorate(state.doc, active, hosts) };
          },
        },
        props: { decorations: (state) => key.getState(state)?.deco },
        // 選んでいる列や中身（タブの名前）が変わったら、タブの並びを描き直す
        view: () => ({ update: (view, prev) => key.getState(view.state) !== key.getState(prev) && hosts.notify() }),
      }),
    ],
  };
};

/** 中身の無い文章のブロック（タブの名前に使わない） */
const blank = (b: AnyBlock) => (b.type === "paragraph" || b.type === "heading") && !textOf(b);

/** 1つの列の並びのタブ。名前は、列の中の最初のブロック（空の行は飛ばす）。何も無ければ「列 1」のように */
function ColumnTabs({ editor, listId }: { editor: Editor; listId: string }) {
  const list = editor.getBlock(listId) as unknown as AnyBlock | undefined;
  const view = editor.prosemirrorView;
  if (!list || !view) return null;
  const cols = list.children;
  const chosen = key.getState(editor.prosemirrorState)?.active[listId];
  const active = cols.some((c) => c.id === chosen) ? chosen! : (cols[0]?.id ?? "");
  const select = (colId: string) => {
    const v = editor.prosemirrorView;
    if (!v) return;
    v.dispatch(v.state.tr.setMeta(key, { [listId]: colId }).setMeta("addToHistory", false));
    // この列の並びの中でカーソルを持っていたら、選んだ列の最初へ移す（隠れた列に文字を打たないように）
    const at = columnsAtCursor(v.state)[listId];
    const first = cols.find((c) => c.id === colId)?.children[0];
    if (at && at !== colId && first && editor.isEditable) editor.setTextCursorPosition(first.id, "start");
  };
  // タブの名前に使うブロック（列の中の最初のブロック。空の行は飛ばす）
  const named = cols.map((c) => c.children.find((b) => !blank(b)));
  const ids = named.flatMap((b) => (b && /^[\w-]+$/.test(b.id) ? [b.id] : []));
  // 読むだけのとき、中身がタブのブロックだけの列は、そのタブを列の一覧に並べる（切り替えが「列の中のタブ」の2段にならないように）
  const inner = cols.map((c) => {
    const rest = c.children.filter((b) => !blank(b));
    return !editor.isEditable && rest.length === 1 && rest[0].type === "tabs" && rest[0].children.length > 0 ? rest[0] : undefined;
  });
  const innerIds = inner.flatMap((t) => (t && /^[\w-]+$/.test(t.id) ? [t.id] : []));
  const items = cols.flatMap((c, i) => {
    const tabs = inner[i];
    if (!tabs) return [{ id: c.id, content: named[i] ? <TabLabel child={named[i]} /> : <span className="min-w-0 flex-1 truncate text-left">列 {i + 1}</span> }];
    const titles = parseTitles(tabs.props.titles);
    return tabs.children.map((t) => ({ id: `${c.id}:${t.id}`, content: <TabLabel child={t} title={titles[t.id]} /> }));
  });
  // 選んでいるもの：タブを並べた列なら、その中で選んでいるタブ
  const activeTabs = inner[cols.findIndex((c) => c.id === active)];
  const activeTab = activeTabs ? (activeTabs.children.find((t) => t.id === activeTabs.props.active) ?? activeTabs.children[0]) : undefined;
  const activeItem = activeTab ? `${active}:${activeTab.id}` : active;
  const pick = (itemId: string) => {
    const [colId, tabId] = itemId.split(":");
    const tabs = inner[cols.findIndex((c) => c.id === colId)];
    if (tabs && tabId) editor.updateBlock(tabs.id, { props: { active: tabId } as never });
    if (colId !== active) select(colId);
  };
  return (
    <>
      {/* タブのブロックと同じく、タブの名前に使ったブロックの見出しは出さない（読むだけのときは見出しの段ごと）。
          タブを列の一覧に並べたタブのブロックは、自分の切り替えを出さない。スマホの幅のときだけ */}
      {ids.length + innerIds.length > 0 && (
        <style>{`@media (max-width: 767.98px) { ${[
          ...ids.map((id) => `[data-id="${id}"] > .bn-block > .react-renderer [data-block-title], [data-id="${id}"] > .bn-block > .react-renderer [data-block-head][data-locked]:not(:has([data-block-keep]))`),
          ...innerIds.map((id) => `[data-id="${id}"] > .bn-block > .react-renderer [data-tab-switch]`),
        ].join(", ")} { display: none !important; } }`}</style>
      )}
      {/* タブの並びの代わりに、選んでいる列の名前を見出しのように出し、押すと列の一覧から選べる */}
      <TabSwitch items={items} active={activeItem} onSelect={pick} label="左右に並んだブロック" unit="列" />
    </>
  );
}

/** エディタの中に、列の並びごとのタブを描く（EditorMenus の中に置く。ノートの文脈の中で描くため、ここから描く） */
export function ColumnTabsHost({ editor }: { editor: Editor }) {
  const hosts = hostsOf.get(editor);
  useSyncExternalStore(hosts?.subscribe ?? noop, hosts?.getVersion ?? zero, zero);
  if (!hosts) return null;
  return [...hosts.els].map(([listId, el]) => createPortal(<ColumnTabs editor={editor} listId={listId} />, el, listId));
}

const noop = () => () => {};
const zero = () => 0;
