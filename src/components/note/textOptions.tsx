"use client";

import type { ExtensionFactoryInstance } from "@blocknote/core";
import { SideMenuExtension } from "@blocknote/core/extensions";
import { FormattingToolbar, useBlockNoteEditor, useComponentsContext, useExtensionState, type FormattingToolbarProps } from "@blocknote/react";
import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { createContext, useContext, useLayoutEffect } from "react";
import type { NoteEditor as Editor, noteSchema } from "./blocks";
import { FIX_META } from "./containers";

// ウィンドウの文章のブロック（段落・見出し・箇条書き・チェックリストなど）の「枠」「固定」。
// ブロックの中身には入れず、ウィンドウにブロックの ID ごとに持つ（区画の高さと同じ）。
// ふだん（編集モードでないとき）は、固定していない文章だけ直せる。固定した文章・チャットなどの部品・表・列の並びは、消したり書き換えたりできない

export type TextOption = { frame?: boolean; lock?: boolean };
export type TextOptions = Record<string, TextOption>;

/**
 * エディタごとの設定。textOnly：ふだんのウィンドウ（文章だけ直せる）。
 * separate：文章のブロックもそれぞれ別（足したり消したり、つなげたりしない。テンプレートの文章をこのウィンドウだけで直すとき）。
 * pass：ほかの人の更新を入れている間は、守りを外す
 */
type Box = { options: TextOptions; textOnly: boolean; separate: boolean; pass: boolean };
const boxes = new WeakMap<object, Box>();
const key = new PluginKey<DecorationSet>("textOptions");

/** 枠（ブロックの外側に class）と、ふだんのときの固定（中身を書けなくする）の印 */
function decorate(doc: PMNode, box: Box) {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "blockContainer") return !node.isTextblock;
    const content = node.firstChild;
    const o = box.options[String(node.attrs.id)];
    if (content?.isTextblock && o?.frame) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "text-frame" }));
    // チャットなどの部品（中身の無いブロック）は自分で守るので、文の入るもの（固定した文章・表）だけ
    if (box.textOnly && content && !content.type.isLeaf && (!content.isTextblock || o?.lock)) {
      decos.push(Decoration.node(pos + 1, pos + 1 + content.nodeSize, { contenteditable: "false", "data-text-lock": "" }));
    }
    return true;
  });
  return DecorationSet.create(doc, decos);
}

/**
 * ブロックの一覧（ID → 種類・親・中身）。
 * part：中身の無い部品（チャット・タブなど。設定は部品が直すので種類だけ見る）、exact：そのまま残すもの（固定した文章・表）、column：列の並び、text：直せる文章
 */
type Kind = "part" | "exact" | "column" | "text";
type Entry = { kind: Kind; parent: string; node: PMNode; kids: string; count: number };

function blocksOf(doc: PMNode, options: TextOptions) {
  const map = new Map<string, Entry>();
  // ID がまだ付いていない（貼り付けたばかりなどの）ブロック
  const fresh: Kind[] = [];
  const walk = (node: PMNode, parent: string) =>
    node.forEach((child) => {
      if (child.type.name === "blockGroup") return walk(child, parent);
      const isBlock = child.type.name === "blockContainer";
      if (!isBlock && !child.type.name.startsWith("column")) return;
      const content = isBlock ? child.firstChild : null;
      const id = typeof child.attrs.id === "string" ? child.attrs.id : "";
      const kind: Kind = !content ? "column" : content.type.isLeaf ? "part" : !content.isTextblock || options[id]?.lock ? "exact" : "text";
      if (!id) {
        fresh.push(kind);
        return walk(child, parent);
      }
      // 部品の中のブロック（タブの中身など）の並び
      const group = isBlock && child.lastChild?.type.name === "blockGroup" ? child.lastChild : null;
      const kids: string[] = [];
      group?.forEach((k) => kids.push(String(k.attrs.id ?? "")));
      map.set(id, { kind, parent, node: content ?? child, kids: kids.join(","), count: (map.get(id)?.count ?? 0) + 1 });
      walk(child, id);
    });
  walk(doc, "");
  return { map, fresh };
}

/** 直したあとも、守るもの（部品・固定した文章・表・列。separate なら文章のブロックの並びも）がそのまま残っているか */
function keepsFixed(before: PMNode, after: PMNode, options: TextOptions, separate: boolean) {
  const a = blocksOf(before, options).map;
  const b = blocksOf(after, options);
  for (const [id, x] of a) {
    if (x.kind === "text" && !separate) continue;
    const y = b.map.get(id);
    if (!y || y.count > 1 || y.kind !== x.kind || y.parent !== x.parent) return false;
    // 部品は種類と、中のブロック（タブの中身など）の並び。固定した文章・表は中身もそのまま
    if (x.kind === "part" && (y.node.type !== x.node.type || y.kids !== x.kids)) return false;
    if (x.kind === "exact" && !y.node.eq(x.node)) return false;
  }
  // 新しい部品・列はできない（文章から変わったものも）。separate なら新しい文章のブロックもできない
  for (const [id, y] of b.map) if ((separate || y.kind !== "text") && a.get(id)?.kind !== y.kind) return false;
  return separate ? !b.fresh.length : b.fresh.every((k) => k === "text");
}

/** エディタに入れる機能（useBlockEditor の extensions に入れる） */
export const textOptionsExtension: ExtensionFactoryInstance = ({ editor }) => {
  const box: Box = { options: {}, textOnly: false, separate: false, pass: false };
  boxes.set(editor, box);
  return {
    key: "textOptions",
    prosemirrorPlugins: [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => decorate(state.doc, box),
          apply: (tr, prev, _old, state) => (tr.docChanged || tr.getMeta(key) ? decorate(state.doc, box) : prev),
        },
        props: { decorations: (state) => key.getState(state) },
        // ふだんのウィンドウでは、守るものを変える入力を通さない（部品の設定の書き換え・タブの形を整える変更などは通す）
        filterTransaction: (tr, state) => box.pass || !box.textOnly || !tr.docChanged || !!tr.getMeta(FIX_META) || keepsFixed(state.doc, tr.doc, box.options, box.separate),
      }),
    ],
  };
};

/** 枠・固定の設定と、ふだんのウィンドウかどうか（と、文章のブロックもそれぞれ別か）を、エディタに知らせる（変わったら印を付け直す） */
export function useTextOptions(editor: Editor, options: TextOptions | undefined, textOnly: boolean, separate: boolean) {
  useLayoutEffect(() => {
    const box = boxes.get(editor);
    if (!box) return;
    box.options = options ?? {};
    box.textOnly = textOnly;
    box.separate = textOnly && separate;
    const view = editor.prosemirrorView;
    view?.dispatch(view.state.tr.setMeta(key, true).setMeta("addToHistory", false));
  }, [editor, options, textOnly, separate]);
}

/** ふだんのウィンドウ（固定していない文章だけ直せる）か */
export const isTextOnly = (editor: object) => !!boxes.get(editor)?.textOnly;

/** 文章のブロックもそれぞれ別（足したり消したり、つなげたりしない）か */
export const isSeparate = (editor: object) => !!boxes.get(editor)?.separate;

type DocBlock = { id: string; type: string; props?: Record<string, unknown>; content?: unknown; children?: DocBlock[] };

/** 文章のブロック（列・タブの中も）を、ID ごとに */
function textBlocks(blocks: unknown[], out = new Map<string, DocBlock>()) {
  for (const b of blocks as DocBlock[]) {
    if (Array.isArray(b.content)) out.set(b.id, b);
    if (b.children?.length) textBlocks(b.children, out);
  }
  return out;
}

/** 前にそろえたときから変わった文章のブロックの、今の中身（種類・設定・文）。ブロックの ID ごと */
export function changedTexts(base: unknown[], now: unknown[]) {
  const before = textBlocks(base);
  const out: Record<string, { type: string; props?: Record<string, unknown>; content?: unknown }> = {};
  for (const [id, b] of textBlocks(now)) {
    const was = before.get(id);
    const v = { type: b.type, props: b.props, content: b.content };
    if (!was || JSON.stringify(v) !== JSON.stringify({ type: was.type, props: was.props, content: was.content })) out[id] = v;
  }
  return out;
}

/** 守りを外して直す（ほかの人の更新を入れるとき） */
export function withoutTextLock(editor: object, fn: () => void) {
  const box = boxes.get(editor);
  if (box) box.pass = true;
  try {
    fn();
  } finally {
    if (box) box.pass = false;
  }
}

/** ブロックが守るもの（文章でないもの・固定した文章）か。ブロックの形（editor.getBlock など）で見る */
export function isFixedBlock(editor: Editor, block: { id: string; type: string } | undefined) {
  if (!block) return false;
  return editor.schema.blockSchema[block.type as keyof typeof editor.schema.blockSchema]?.content !== "inline" || !!boxes.get(editor)?.options[block.id]?.lock;
}

/** 選んでいる範囲に、守るもの（文章でないもの・固定した文章）の中身がかかっているか */
function selectionTouchesFixed(editor: Editor) {
  const box = boxes.get(editor);
  if (!box?.textOnly) return false;
  const { doc, selection } = editor.prosemirrorState;
  const { from, to } = selection;
  let hit = false;
  doc.nodesBetween(from, to, (node, pos) => {
    if (hit) return false;
    if (node.type.name !== "blockContainer") return !node.isTextblock;
    const content = node.firstChild;
    // 外側のブロック（タブなど）は、自分の中身が範囲にかかっているときだけ
    const start = pos + 1;
    const overlaps = !!content && start < to && start + content.nodeSize > from;
    if (overlaps && (!content.isTextblock || box.options[String(node.attrs.id)]?.lock)) hit = true;
    return !hit;
  });
  return hit;
}

/** ふだんのウィンドウの、文字を選んだときのツールバー。固定した文章などにかかっているときは出さない。children はツールバーのボタン（無ければ標準のもの） */
export function TextOnlyToolbar(props: FormattingToolbarProps & { children?: React.ReactNode }) {
  const editor = useBlockNoteEditor<typeof noteSchema.blockSchema, typeof noteSchema.inlineContentSchema, typeof noteSchema.styleSchema>();
  return selectionTouchesFixed(editor as unknown as Editor) ? null : <FormattingToolbar {...props} />;
}

/** 「⋮⋮」のメニューに「枠」「固定」を出すための、今の設定と変え方（ウィンドウのときだけ渡す） */
export const TextOptionsContext = createContext<{ options: TextOptions; onChange: (options: TextOptions) => void } | null>(null);

/** 「⋮⋮」のメニューの「枠」「固定」（ウィンドウの文章のブロックだけ） */
export function TextOptionItems() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<typeof noteSchema.blockSchema, typeof noteSchema.inlineContentSchema, typeof noteSchema.styleSchema>();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  const ctx = useContext(TextOptionsContext);
  if (!ctx || !block || !Array.isArray(block.content)) return null;
  const cur = ctx.options[block.id] ?? {};
  const toggle = (k: keyof TextOption) => {
    const all: TextOptions = { ...ctx.options, [block.id]: { ...cur, [k]: !cur[k] } };
    // オフのものと、もう無いブロックの分は持たない
    const next: TextOptions = {};
    for (const [id, o] of Object.entries(all)) {
      const v: TextOption = { ...(o.frame && { frame: true }), ...(o.lock && { lock: true }) };
      if (Object.keys(v).length && editor.getBlock(id)) next[id] = v;
    }
    ctx.onChange(next);
  };
  return (
    <>
      <Components.Generic.Menu.Item className="bn-menu-item" checked={!!cur.frame} onClick={() => toggle("frame")}>
        <span title="ブロックのまわりを枠で囲む">枠</span>
      </Components.Generic.Menu.Item>
      <Components.Generic.Menu.Item className="bn-menu-item" checked={!!cur.lock} onClick={() => toggle("lock")}>
        <span title="編集モードでないときは、この文章を直せないようにする">固定</span>
      </Components.Generic.Menu.Item>
    </>
  );
}
