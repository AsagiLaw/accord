"use client";

import { getNodeById, type ExtensionFactoryInstance } from "@blocknote/core";
import { SideMenuExtension } from "@blocknote/core/extensions";
import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, Selection, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { useEffect } from "react";
import type { NoteEditor as Editor } from "./blocks";

// ノートのブロックの複数選択（Notion と同じ）：本文の外（左右の余白など）からドラッグすると四角が出て、かかったブロックを選ぶ。
// 選んだブロックは Delete・Backspace で消せ、Ctrl+C・X・D と「⋮⋮」（ドラッグで動かす・複製・削除）がまとめて効く。
// 選択そのものは BlockNote の MultipleNodeSelection（「⋮⋮」のドラッグが、これなら選んだブロックをまとめて動かす）

type PickSelection = new (from: ReturnType<PMNode["resolve"]>, to: ReturnType<PMNode["resolve"]>) => Selection;

let PickClass: PickSelection | null = null;

/**
 * BlockNote の MultipleNodeSelection のクラス。外に公開されていないので、登録された種類（multiple-node）から受け取る。
 * このクラスは fromJSON を持たず Selection のものを受け継ぐので、Selection.fromJSON の中からの呼び出しの this がこのクラスになる
 */
function pickClass(doc: PMNode): PickSelection {
  if (PickClass) return PickClass;
  const original = Selection.fromJSON;
  let found: unknown;
  Selection.fromJSON = function (this: unknown, d: PMNode, json: unknown) {
    if (this !== Selection) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- 呼び出し先のクラスを受け取るのが目的
      found = this;
      return null as never;
    }
    return original.call(Selection, d, json);
  } as typeof Selection.fromJSON;
  try {
    Selection.fromJSON(doc, { type: "multiple-node", anchor: 0, head: 0 });
  } finally {
    Selection.fromJSON = original;
  }
  PickClass = found as PickSelection;
  return PickClass;
}

const isPick = (sel: Selection) => "nodes" in sel;

/** 選んでいるブロック（本文の中の位置と、ブロックの node）。選んでいなければ空 */
function pickedNodes(state: EditorState) {
  const sel = state.selection;
  const out: { pos: number; node: PMNode }[] = [];
  if (!isPick(sel)) return out;
  for (let pos = sel.from; pos < sel.to; ) {
    const node = state.doc.nodeAt(pos);
    if (!node) break;
    out.push({ pos, node });
    pos += node.nodeSize;
  }
  return out;
}

/** 選んでいるブロック。選んでいなければ null */
export function pickedBlocks(editor: Editor) {
  const nodes = pickedNodes(editor.prosemirrorState);
  if (!nodes.length) return null;
  return nodes.flatMap(({ node }) => editor.getBlock(node.attrs.id as string) ?? []);
}

const key = new PluginKey("blockPick");

/** 選んでいるブロックに印（block-picked）を付ける。中身が消えて空になった選択は、カーソルに戻す（useBlockEditor の extensions に入れる） */
export const blockPickExtension: ExtensionFactoryInstance = () => ({
  key: "blockPick",
  prosemirrorPlugins: [
    new Plugin({
      key,
      appendTransaction: (_trs, _old, state) => {
        const sel = state.selection;
        return isPick(sel) && sel.empty ? state.tr.setSelection(Selection.near(sel.$from)) : null;
      },
      props: {
        decorations: (state) => {
          const nodes = pickedNodes(state);
          return nodes.length ? DecorationSet.create(state.doc, nodes.map(({ pos, node }) => Decoration.node(pos, pos + node.nodeSize, { class: "block-picked" }))) : null;
        },
      },
    }),
  ],
});

/** 選ぶのをやめて、カーソルに戻す。side が 1 なら選んでいた範囲の頭、-1 なら終わり */
function dropPick(view: EditorView, side: 1 | -1 = 1) {
  const sel = view.state.selection;
  view.dispatch(view.state.tr.setSelection(Selection.near(side === 1 ? sel.$from : sel.$to, side)));
}

/** 選んでいるときのキー。処理したら true */
export function pickedKey(editor: Editor, e: KeyboardEvent) {
  const view = editor.prosemirrorView;
  const ids = pickedNodes(editor.prosemirrorState).map(({ node }) => node.attrs.id as string);
  if (!view || !ids.length || e.isComposing) return false;
  const stop = () => {
    e.preventDefault();
    e.stopPropagation();
    return true;
  };
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key === "Backspace" || e.key === "Delete") {
    stop();
    editor.removeBlocks(ids);
    return true;
  }
  if (e.key === "Escape") {
    stop();
    dropPick(view);
    return true;
  }
  if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "ArrowRight") {
    stop();
    dropPick(view, e.key === "ArrowUp" || e.key === "ArrowLeft" ? 1 : -1);
    view.dispatch(view.state.tr.scrollIntoView());
    return true;
  }
  // 字下げは選んだブロックの形を崩すので、何もしない
  if (e.key === "Tab") return stop();
  return false;
}

/** ノートがスクロールする枠（「＋」「⋮⋮」を出す範囲・四角を始められる範囲） */
export function scrollAreaOf(dom: HTMLElement) {
  for (let el = dom.parentElement; el; el = el.parentElement) {
    const o = getComputedStyle(el).overflowY;
    if (o === "auto" || o === "scroll") return el;
  }
  return null;
}

/** 四角を始められないところ（ここからのドラッグは、文字の選択などのふだんの操作）。ブロックの中身の上はここに入る */
const NOT_START = "a, button, input, textarea, select, label, summary, [role=button], [role=menu], [role=dialog], .bn-block-content, .bn-side-menu, .bn-suggestion-menu, .bn-formatting-toolbar, .note-cover";
/** ここを押しても、選んだブロックを外さない（「⋮⋮」とそのメニュー） */
const KEEP_PICK = ".bn-side-menu, .mantine-Menu-dropdown, [role=menu]";
/** ドラッグと見なす距離（px） */
const DRAG_START = 5;
/** 枠の上下の端からこの距離に入ると、自動でスクロールする（px） */
const SCROLL_EDGE = 48;

type Box = { left: number; right: number; top: number; bottom: number };

/** 四角にかかったブロックを、選択の範囲にする。同じ親の中で選べるよう、親が違うときは共通の親の直下のブロックまで広げる（2つの列にかかるなら、列のまとまりごと） */
function rangeOf(view: EditorView, box: Box) {
  const doc = view.state.doc;
  let from = Infinity;
  let to = -1;
  for (const outer of view.dom.querySelectorAll<HTMLElement>(".bn-block-outer")) {
    const content = outer.querySelector(":scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content");
    const r = content?.getBoundingClientRect();
    if (!r?.width || !r.height || r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom) continue;
    const info = outer.dataset.id ? getNodeById(outer.dataset.id, doc) : undefined;
    if (!info) continue;
    from = Math.min(from, info.posBeforeNode);
    to = Math.max(to, info.posBeforeNode + info.node.nodeSize);
  }
  if (to < 0) return null;
  const $a = doc.resolve(from);
  const $b = doc.resolve(to);
  let depth = $a.sharedDepth(to);
  // 列のまとまりの中で選ぶと、列そのものが選ばれてしまうので、列のまとまりごとにする
  if ($a.node(depth).type.name === "columnList") depth -= 1;
  return { from: depth < $a.depth ? $a.before(depth + 1) : from, to: depth < $b.depth ? $b.after(depth + 1) : to };
}

/** 本文の外からドラッグして、四角でブロックを選ぶ（on：ノートのとき） */
export function useBlockMarquee(editor: Editor, on: boolean) {
  useEffect(() => {
    if (!on) return;
    let finish: (() => void) | null = null;

    const onDown = (e: MouseEvent) => {
      const view = editor.prosemirrorView;
      const dom = editor.domElement;
      const target = e.target instanceof Element ? e.target : null;
      if (!view || !dom || !target) return;
      // 選んでいるときに、ほかのところを押したら外す（チャットなど、押しても選択が動かないブロックの上でも）
      if (isPick(view.state.selection) && !target.closest(KEEP_PICK)) dropPick(view);
      if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || !editor.isEditable) return;
      const area = scrollAreaOf(dom);
      if (!area?.contains(target) || target.closest(NOT_START)) return;
      // スクロールバーの上
      if (e.clientX >= area.getBoundingClientRect().left + area.clientWidth) return;
      // ブラウザの文字の選択を始めない（始まると、動かしている間に文字の選択が広がって、ブロックの選択を置き換えてしまう）。エディタもこの押下を受け取らない
      e.preventDefault();

      const startX = e.clientX;
      const startY = e.clientY + area.scrollTop;
      let x = e.clientX;
      let y = e.clientY;
      let marquee: HTMLDivElement | null = null;
      let raf = 0;

      const paint = () => {
        const a = area.getBoundingClientRect();
        const box = {
          left: Math.max(a.left, Math.min(startX, x)),
          right: Math.min(a.right, Math.max(startX, x)),
          top: Math.max(a.top, Math.min(startY - area.scrollTop, y)),
          bottom: Math.min(a.bottom, Math.max(startY - area.scrollTop, y)),
        };
        if (marquee) Object.assign(marquee.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px` });
        const range = rangeOf(view, box);
        if (!range) {
          if (!view.state.selection.empty) dropPick(view);
          return;
        }
        const doc = view.state.doc;
        const sel = new (pickClass(doc))(doc.resolve(range.from), doc.resolve(range.to));
        if (!sel.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(sel));
      };
      // 枠の端まで来たら、スクロールしながら選び続ける
      const tick = () => {
        const a = area.getBoundingClientRect();
        const speed = y < a.top + SCROLL_EDGE ? y - (a.top + SCROLL_EDGE) : y > a.bottom - SCROLL_EDGE ? y - (a.bottom - SCROLL_EDGE) : 0;
        if (speed) {
          area.scrollTop += Math.max(-24, Math.min(24, speed / 2));
          paint();
        }
        raf = requestAnimationFrame(tick);
      };
      const begin = () => {
        view.focus();
        editor.getExtension(SideMenuExtension)?.hideMenuIfNotFrozen();
        marquee = document.createElement("div");
        marquee.className = "block-marquee-box";
        document.body.appendChild(marquee);
        raf = requestAnimationFrame(tick);
      };
      const onMove = (ev: MouseEvent) => {
        x = ev.clientX;
        y = ev.clientY;
        if (!marquee) {
          if (Math.hypot(x - startX, ev.clientY + area.scrollTop - startY) < DRAG_START) return;
          begin();
        }
        ev.preventDefault();
        paint();
      };
      const done = () => {
        window.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("mouseup", done, true);
        finish = null;
        if (!marquee) {
          // ドラッグしなかった（ふつうのクリック）：止めた押下の代わりに、エディタの余白ならカーソルを近くの行に置き、外ならフォーカスを外す
          const at = view.dom.contains(target) ? view.posAtCoords({ left: startX, top: e.clientY }) : null;
          if (at) {
            view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(at.pos))));
            view.focus();
          } else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          return;
        }
        cancelAnimationFrame(raf);
        marquee.remove();
        // 離したときの click で、本文の下の「最後に書き足す」などが動かないようにする
        const swallow = (ev: MouseEvent) => {
          ev.preventDefault();
          ev.stopPropagation();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, true));
      };
      finish = done;
      window.addEventListener("mousemove", onMove, true);
      window.addEventListener("mouseup", done, true);
    };

    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      finish?.();
    };
  }, [editor, on]);
}
