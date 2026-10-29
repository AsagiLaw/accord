"use client";

import { getNodeById, type ExtensionFactoryInstance } from "@blocknote/core";
import { SuggestionMenu } from "@blocknote/core/extensions";
import { Fragment, type Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { newId } from "@/lib/id";
import type { NoteEditor as Editor } from "./blocks";

// コールアウトとタブの中に、ブロックを入れたり出したり足したりする（Notion と同じ。ノート・ウィンドウ・ページの本文で共通）。
// コールアウトの中身はコールアウトの子のブロック。タブの中身は、タブごとの入れ物（tabPanel）の子のブロック。
// - Enter：コールアウトの文ならコールアウトの中のいちばん上に新しい行。中の空の行は、コールアウトの最後の行なら外に出て、ほかは中に新しい行
// - Backspace（行の頭）：上の行（最初の行ならコールアウトの文）につなげる。BlockNote のままだと字下げを戻して外に出てしまう
// - Shift+Tab：外に出す（タブの中なら、タブのブロックの下へ）。Tab：すぐ上のコールアウト・タブの中に入れる（BlockNote の字下げのまま）
// - 「⋮⋮」でコールアウトの文の下半分に落とすと、中のいちばん上に入る（中の行のあいだ・外へは、ふつうに落とせる）

type Loose = { id: string; type: string; children: Loose[] };

/** 中にブロックを入れられるブロック */
const CONTAINERS = new Set(["callout", "tabPanel"]);

/** 空の行で Enter を押したときに、中に新しい行を作るブロック（リスト・コードは BlockNote のまま） */
const LINE_TYPES = new Set(["paragraph", "heading", "quote"]);

const contentType = (node: PMNode) => (node.type.name === "blockContainer" ? node.firstChild!.type.name : node.type.name);
const childrenOf = (node: PMNode) => {
  const out: PMNode[] = [];
  node.forEach((c) => out.push(c));
  return out;
};

// ---- カーソルを覚えて戻す ----

type Cursor = { id: string; offset: number } | null;

/** カーソルのある行（ブロックの ID）と、行の中の位置。ブロックを動かしたあとに、同じところへ戻すため */
function cursorOf(state: EditorState): Cursor {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty || !sel.$head.parent.isTextblock || sel.$head.depth < 2) return null;
  const id = sel.$head.node(sel.$head.depth - 1).attrs.id;
  return id ? { id: String(id), offset: sel.$head.parentOffset } : null;
}

function restoreCursor(tr: Transaction, at: Cursor) {
  const found = at && getNodeById(at.id, tr.doc);
  const content = found?.node.firstChild;
  if (!at || !found || !content?.isTextblock) return;
  const start = found.posBeforeNode + 2;
  tr.setSelection(TextSelection.create(tr.doc, start + Math.min(at.offset, content.content.size)));
}

// ---- タブの形を整える ----

/** 形を整える変更の印。ふだんのウィンドウの守り（textOptions.tsx）も通す（中身は変わらず、入れ物に入れ直すだけなので） */
export const FIX_META = "containersFix";

/**
 * タブの形を整える（中身が変わったとき・読み込んだとき）。
 * - タブのブロックのすぐ下は、タブごとの入れ物だけ。前の形（入れ物なしで、ブロック1つがそのままタブ）は、1つずつ入れ物に入れる。
 *   入れ物の外に来たブロック（Tab で字下げした・入れ物のあいだに落とした）は、選んでいるタブの中へ（前にあれば先頭、後ろにあれば最後）
 * - 中身の無い入れ物には空の行を1つ入れる。タブのブロックの外に出た入れ物は、中身だけにする
 */
function normalize(state: EditorState): Transaction | null {
  const { schema } = state;
  const ids = new Set<string>();
  state.doc.descendants((n) => void (n.attrs.id && ids.add(String(n.attrs.id))));
  const line = () => schema.nodes.blockContainer.create({ id: newId() }, schema.nodes.paragraph.create());
  const panel = (attrs: Record<string, unknown> | null, children: PMNode[]) =>
    schema.nodes.blockContainer.create(attrs, [schema.nodes.tabPanel.create(), schema.nodes.blockGroup.create(null, children.length ? children : [line()])]);
  // 前の形のタブの入れ物の ID は、中のブロックの ID から決める（2人が同時に開いても同じになるように）
  const panelId = (c: PMNode) => {
    const id = c.attrs.id ? `${c.attrs.id}-tab` : "";
    const out = id && !ids.has(id) ? id : newId();
    ids.add(out);
    return out;
  };
  const isPanel = (c: PMNode) => contentType(c) === "tabPanel";
  const parse = (s: unknown): Record<string, string> => {
    try {
      return typeof s === "string" ? JSON.parse(s) : {};
    } catch {
      return {};
    }
  };
  // tabs：タブのブロックの設定（名前・選んでいるタブ）も書き換えるとき、その位置と新しい設定
  const fixes: { from: number; to: number; nodes: PMNode[]; tabs?: { pos: number; attrs: Record<string, unknown> } }[] = [];
  state.doc.descendants((node, pos, parent) => {
    if (node.type.name !== "blockGroup" && node.type.name !== "column") return true;
    const kids = childrenOf(node);
    const tabs = parent?.type.name === "blockContainer" && parent.firstChild?.type.name === "tabs" ? parent.firstChild : null;
    let next: PMNode[] | null = null;
    let fixTabs: (typeof fixes)[number]["tabs"];
    if (tabs && kids.some((c) => !isPanel(c) || c.childCount < 2)) {
      const panels = kids.filter(isPanel);
      if (!panels.length) {
        const wrapped = kids.map((c) => ({ from: String(c.attrs.id ?? ""), to: panelId(c), c }));
        next = wrapped.map((w) => panel({ id: w.to }, [w.c]));
        // 名前・選んでいるタブは中のブロックの ID で覚えていたので、入れ物の ID に付け替える
        const rename = (id: string) => wrapped.find((w) => w.from && w.from === id)?.to ?? id;
        const titles = Object.fromEntries(Object.entries(parse(tabs.attrs.titles)).map(([k, v]) => [rename(k), v]));
        fixTabs = { pos: pos - tabs.nodeSize, attrs: { ...tabs.attrs, titles: JSON.stringify(titles), active: rename(String(tabs.attrs.active ?? "")) } };
      } else {
        const active = String(tabs.attrs.active ?? "");
        const target = panels.find((p) => p.attrs.id === active || (p.childCount > 1 && childrenOf(p.lastChild!).some((c) => c.attrs.id === active))) ?? panels[0];
        const at = kids.indexOf(target);
        const before = kids.slice(0, at).filter((c) => !isPanel(c));
        const after = kids.slice(at + 1).filter((c) => !isPanel(c));
        next = panels.map((p) => {
          if (p !== target && p.childCount > 1) return p;
          const inner = p.childCount > 1 ? childrenOf(p.lastChild!) : [];
          return panel(p.attrs, p === target ? [...before, ...inner, ...after] : inner);
        });
      }
    } else if (!tabs && kids.some(isPanel)) {
      next = kids.flatMap((c) => (!isPanel(c) ? [c] : c.childCount > 1 ? childrenOf(c.lastChild!) : []));
      if (!next.length) next = [line()];
    }
    if (!next) return true;
    fixes.push({ from: pos + 1, to: pos + node.nodeSize - 1, nodes: next, tabs: fixTabs });
    // 中は次の回に整える（直した範囲が重ならないように）
    return false;
  });
  if (!fixes.length) return null;
  const at = cursorOf(state);
  const tr = state.tr.setMeta(FIX_META, true);
  for (const f of fixes.reverse()) {
    tr.replaceWith(f.from, f.to, f.nodes);
    if (f.tabs) tr.setNodeMarkup(f.tabs.pos, undefined, f.tabs.attrs);
  }
  restoreCursor(tr, at);
  return tr;
}

const key = new PluginKey("containers");

/** エディタに入れる機能（useBlockEditor の extensions に入れる） */
export const containersExtension: ExtensionFactoryInstance = () => ({
  key: "containers",
  prosemirrorPlugins: [
    new Plugin({
      key,
      appendTransaction: (trs, _old, state) => (trs.some((tr) => tr.docChanged) ? normalize(state) : null),
      // 読み込んだ中身（前の形のタブ）も、すぐに整える。元に戻す（Ctrl+Z）の対象にはしない
      view: (view) => {
        queueMicrotask(() => {
          if (view.isDestroyed) return;
          const tr = normalize(view.state);
          if (tr) view.dispatch(tr.setMeta("addToHistory", false));
        });
        return {};
      },
    }),
  ],
});

// ---- キー ----

/** カーソルのある行と、その行が入っているブロック（入れ物） */
function where(state: EditorState) {
  const $h = state.selection.$head;
  const d = $h.depth;
  if (!$h.parent.isTextblock || d < 3) return null;
  const parent = d >= 4 ? $h.node(d - 3) : null;
  return {
    $h,
    type: $h.parent.type.name,
    node: $h.node(d - 1),
    pos: $h.before(d - 1),
    group: $h.node(d - 2),
    groupPos: $h.before(d - 2),
    index: $h.index(d - 2),
    parent,
    parentPos: parent ? $h.before(d - 3) : -1,
    parentType: parent?.type.name === "blockContainer" ? parent.firstChild!.type.name : null,
  };
}

type Where = NonNullable<ReturnType<typeof where>>;

const newLine = (state: EditorState, content?: Fragment) => state.schema.nodes.blockContainer.create({ id: newId() }, state.schema.nodes.paragraph.create(null, content));

/** 入れ子のいちばん下の行（上の行につなげるときの、つなげる先） */
function bottom(node: PMNode, pos: number) {
  while (node.type.name === "blockContainer" && node.childCount > 1) {
    const last = node.lastChild!.lastChild!;
    pos += node.nodeSize - 2 - last.nodeSize;
    node = last;
  }
  return { node, pos };
}

/** 行を消す。中の子のブロックは、その行の場所に残す。行が入れ物の中の1つだけなら、子の並びごと消す */
function removeLine(tr: Transaction, w: Where) {
  const kids = w.node.childCount > 1 ? w.node.lastChild!.content : Fragment.empty;
  if (kids.size) tr.replaceWith(w.pos, w.pos + w.node.nodeSize, kids);
  else if (w.group.childCount > 1) tr.delete(w.pos, w.pos + w.node.nodeSize);
  else tr.delete(w.groupPos, w.groupPos + w.group.nodeSize);
}

function enter(view: EditorView) {
  const { state } = view;
  const sel = state.selection;
  const w = where(state);
  if (!w || sel.$from.parent !== sel.$to.parent) return false;
  // コールアウトの文：カーソルから後ろを、コールアウトの中のいちばん上の新しい行にする
  if (w.type === "callout") {
    const tr = state.tr;
    if (!sel.empty) tr.deleteSelection();
    const $p = tr.selection.$head;
    const rest = $p.parent.content.cut($p.parentOffset);
    tr.delete($p.pos, $p.end());
    const callout = tr.doc.nodeAt(w.pos)!;
    // コールアウトの文のすぐ後ろ（中のブロックがあれば、その並びの頭）
    const head = w.pos + 1 + callout.firstChild!.nodeSize;
    if (callout.childCount > 1) tr.insert(head + 1, newLine(state, rest));
    else tr.insert(head, state.schema.nodes.blockGroup.create(null, newLine(state, rest)));
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, head + 3)).scrollIntoView());
    return true;
  }
  // コールアウト・タブの中の空の行
  if (!w.parentType || !CONTAINERS.has(w.parentType) || !LINE_TYPES.has(w.type) || !sel.empty || w.node.firstChild!.content.size || w.node.childCount > 1) return false;
  // コールアウトの最後の行なら、外に出る（BlockNote のまま）。ほかは、中に新しい行を作る
  if (w.parentType === "callout" && w.index === w.group.childCount - 1) return false;
  const after = w.pos + w.node.nodeSize;
  const tr = state.tr.insert(after, newLine(state));
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 2)).scrollIntoView());
  return true;
}

function backspace(view: EditorView) {
  const { state } = view;
  const w = where(state);
  // 見出しなどは、BlockNote のまま先にふつうの行に戻す
  if (!w || !state.selection.empty || w.$h.parentOffset !== 0 || w.type !== "paragraph" || !w.parentType || !CONTAINERS.has(w.parentType)) return false;
  const tr = state.tr;
  const text = w.node.firstChild!.content;
  // つなげる先：上の行（入れ子ならいちばん下の行）。最初の行なら、コールアウトの文
  const prev = w.index > 0 ? w.group.child(w.index - 1) : null;
  const target = prev ? bottom(prev, w.pos - prev.nodeSize) : w.parentType === "callout" ? { node: w.parent!, pos: w.parentPos } : null;
  if (target?.node.type.name === "blockContainer" && target.node.firstChild!.inlineContent) {
    const end = target.pos + target.node.firstChild!.nodeSize;
    removeLine(tr, w);
    tr.insert(end, text);
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end)).scrollIntoView());
    return true;
  }
  // 上がチャットなど文の無いブロック・タブの最初の行：空の行なら消す（上のブロック・次の行へ）
  if (!text.size && (prev || w.group.childCount > 1)) {
    removeLine(tr, w);
    view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(w.pos), prev ? -1 : 1)).scrollIntoView());
    return true;
  }
  // ほかは何もしない（外には出さない）
  return true;
}

function shiftTab(editor: Editor) {
  const selected = editor.getSelection()?.blocks as unknown as Loose[] | undefined;
  const blocks = selected?.length ? selected : [editor.getTextCursorPosition().block as unknown as Loose];
  const parent = editor.getParentBlock(blocks[0].id) as unknown as Loose | undefined;
  if (!parent || !CONTAINERS.has(parent.type) || blocks.some((b) => editor.getParentBlock(b.id)?.id !== parent.id)) return false;
  moveOut(editor, blocks.map((b) => b.id));
  return true;
}

/** コールアウト・タブの中のキー。処理したら true（キーは止める） */
export function containerKey(editor: Editor, e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229 || e.ctrlKey || e.metaKey || e.altKey) return false;
  const view = editor.prosemirrorView;
  if (!view) return false;
  const handled =
    e.key === "Tab"
      ? e.shiftKey && shiftTab(editor)
      : e.shiftKey
        ? false
        : e.key === "Enter"
          ? // 「/」「@」のメニューが開いているときは、メニューで選ぶ（閉じたあとも少しのあいだ画面に残るので、メニューの状態で見る）
            !editor.getExtension(SuggestionMenu)?.store.state?.show && enter(view)
          : e.key === "Backspace" && backspace(view);
  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
  return handled;
}

// ---- 入れる・出す ----

/** 中のブロックを外に出す：コールアウトの中ならコールアウトのすぐ下、タブの中ならタブのブロックのすぐ下へ */
export function moveOut(editor: Editor, ids: string[]) {
  const parent = editor.getParentBlock(ids[0]) as unknown as Loose | undefined;
  const outer = parent?.type === "tabPanel" ? (editor.getParentBlock(parent.id) as unknown as Loose | undefined) : parent;
  if (!outer) return;
  const blocks = ids.map((id) => editor.getBlock(id)).filter((b) => !!b);
  const at = editor.prosemirrorView ? cursorOf(editor.prosemirrorView.state) : null;
  editor.transact((tr) => {
    editor.removeBlocks(ids);
    editor.insertBlocks(blocks as never, outer.id, "after");
    restoreCursor(tr, at);
  });
}

/**
 * ブロックをドラッグして、コールアウトの文の下半分に乗せているとき：そのコールアウトと、中のいちばん上に置く位置（落とす線を出す位置）。
 * 左右の端（列にするところ）・ドラッグしているブロックの中のコールアウトは除く
 */
export function calloutDropTarget(view: EditorView, x: number, y: number): { id: string; pos: number } | null {
  if (!view.dragging?.slice) return null;
  const hit = document.elementsFromPoint(x, y).find((el) => view.dom.contains(el));
  const content = hit?.closest<HTMLElement>('.bn-block-content[data-content-type="callout"]');
  const outer = content?.closest<HTMLElement>(".bn-block-outer");
  const id = outer?.dataset.id;
  if (!content || !outer || !id) return null;
  const c = content.getBoundingClientRect();
  const o = outer.getBoundingClientRect();
  if (y < c.top + c.height / 2 || x <= o.left || x >= o.right - o.width * 0.1) return null;
  const found = getNodeById(id, view.state.doc);
  const { from, to } = view.state.selection;
  if (!found || (found.posBeforeNode >= from && found.posBeforeNode < to)) return null;
  const head = found.posBeforeNode + 1 + found.node.firstChild!.nodeSize;
  return { id, pos: found.node.childCount > 1 ? head + 1 : head };
}

/** ドラッグしてきたブロックを、コールアウトの中のいちばん上に入れる */
export function dropIntoCallout(editor: Editor, calloutId: string, dragged: Loose[]) {
  if (dragged.some((b) => b.id === calloutId)) return;
  editor.transact(() => {
    const existing = dragged.filter((b) => editor.getBlock(b.id));
    if (existing.length) editor.removeBlocks(existing.map((b) => b.id));
    const callout = editor.getBlock(calloutId) as unknown as Loose | undefined;
    if (!callout) return;
    if (callout.children.length) editor.insertBlocks(dragged as never, callout.children[0].id, "before");
    else editor.updateBlock(calloutId, { children: dragged as never });
  });
}
