"use client";

import { combineByGroup, filterSuggestionItems, formatKeyboardShortcut, fragmentToBlocks, insertOrUpdateBlockForSlashMenu, type DropCursorHooks, type PartialBlock } from "@blocknote/core";
import { SideMenuExtension } from "@blocknote/core/extensions";
import { ja } from "@blocknote/core/locales";
import {
  BasicTextStyleButton,
  BlockColorsItem,
  DragHandleMenu,
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  getFormattingToolbarItems,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
  useExtensionState,
  usePortalElement,
  type DefaultReactSuggestionItem,
  type FormattingToolbarProps,
} from "@blocknote/react";
import { offset } from "@floating-ui/react";
import { getMultiColumnSlashMenuItems, locales as multiColumnLocales, multiColumnDropCursor } from "@blocknote/xl-multi-column";
import { createContext, useContext, useEffect } from "react";
import { BLOCK_KINDS, MENU_KINDS } from "@/components/blockKinds";
import { NoteContext } from "@/components/embeds";
import { Icon } from "@/components/Icon";
import { toast } from "@/components/ui/overlay";
import { uploadToRoom } from "@/lib/local/media";
import { MEDIA_DRAG_TYPE } from "@/lib/media/export";
import { isImageFile } from "@/lib/media/image";
import { noteSchema, type NoteEditor as Editor } from "./blocks";
import { ColumnTabsHost, columnTabsExtension } from "./columnTabs";
import { mentionItems } from "./docBlocks";
import { isFixedBlock, isSeparate, isTextOnly, TextOnlyToolbar, TextOptionItems, TextOptionsContext, textOptionsExtension, useTextOptions, type TextOptions } from "./textOptions";

// ノート・ウィンドウ・ページの本文・テンプレートで共通に使う、エディタの作り方とメニュー

export type Blocks = PartialBlock<typeof noteSchema.blockSchema, typeof noteSchema.inlineContentSchema, typeof noteSchema.styleSchema>[];

// 外した標準ブロック（画像・動画・音声・ファイル）の「/」メニュー項目も出さない
const HIDDEN_ITEMS = new Set(["image", "video", "audio", "file"]);

/** 「/」と「＋」のメニュー：文章のブロック（標準）・列（2列・3列）・BLOCK_KINDS のブロック */
export function slashItems(editor: Editor): DefaultReactSuggestionItem[] {
  const ours: DefaultReactSuggestionItem[] = MENU_KINDS.map((k) => ({
    title: BLOCK_KINDS[k].label,
    aliases: BLOCK_KINDS[k].aliases,
    group: BLOCK_KINDS[k].group,
    icon: <Icon name={BLOCK_KINDS[k].icon} />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: k }),
  }));
  const defaults = getDefaultReactSlashMenuItems(editor).filter((i) => !HIDDEN_ITEMS.has((i as { key?: string }).key ?? ""));
  const tabs: DefaultReactSuggestionItem = {
    title: "タブ",
    subtext: "ブロックをタブにまとめる（ほかのブロックの「⋮⋮」をタブの並びに落とすと入る）",
    aliases: ["tab", "tabs", "tabu", "たぶ", "タブ"],
    group: "レイアウト",
    icon: <Icon name="board" />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "tabs", children: [{ type: "paragraph" }] } as never),
  };
  // Notion のコールアウト（基本ブロック）と目次（高度なブロック）。グループの名前は標準の項目に合わせる
  const notion: DefaultReactSuggestionItem[] = [
    {
      title: "コールアウト",
      subtext: "アイコン付きの目立つ枠で書く",
      aliases: ["callout", "kooruauto", "こーるあうと", "注意", "メモ", "ヒント"],
      group: editor.dictionary.slash_menu.quote.group,
      icon: <Icon name="bulb" />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "callout" } as never),
    },
    {
      title: "目次",
      subtext: "このページの見出しを並べる",
      aliases: ["toc", "table of contents", "mokuji", "もくじ", "目次"],
      group: editor.dictionary.slash_menu.table.group,
      icon: <Icon name="list" />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "toc" } as never),
    },
  ];
  // 同じグループ（「基本ブロック」など）は1か所にまとめる（分かれると、メニューの表示でエラーになる）
  return combineByGroup(defaults, notion, getMultiColumnSlashMenuItems(editor), ours, [tabs]);
}

/** 文字を選んだときのツールバー：標準のものに、インラインコードのボタンを足す（打ち消し線の右） */
function toolbarItems() {
  const items = getFormattingToolbarItems();
  const at = items.findIndex((x) => x.key === "strikeStyleButton");
  items.splice(at + 1, 0, <BasicTextStyleButton basicTextStyle="code" key="codeStyleButton" />);
  return items;
}

function NoteToolbar(props: FormattingToolbarProps) {
  return <FormattingToolbar {...props}>{toolbarItems()}</FormattingToolbar>;
}

function NoteTextOnlyToolbar(props: FormattingToolbarProps) {
  return <TextOnlyToolbar {...props}>{toolbarItems()}</TextOnlyToolbar>;
}

type Loose = { id?: string; props?: Record<string, unknown>; children?: Loose[] };

/** 複製するブロックの中身（チャットは中身を引き継がず、新しい会話になる。ボタンの中のページも、押したときに新しく作る） */
function copyBlock(b: Loose): Loose {
  const props = b.props && ("chatId" in b.props || "noteId" in b.props) ? { ...b.props, ...("chatId" in b.props ? { chatId: "" } : {}), ...("noteId" in b.props ? { noteId: "" } : {}) } : b.props;
  // id を外すと、新しい id が付く
  return { ...b, id: undefined, ...(props ? { props } : {}), children: (b.children ?? []).map(copyBlock) };
}

/** すぐ下に同じブロックを足す（Ctrl+D と「⋮⋮」の「複製」） */
function duplicateBlocks(editor: Editor, blocks: Loose[]) {
  if (!blocks.length) return;
  editor.insertBlocks(blocks.map(copyBlock) as never, blocks[blocks.length - 1] as never, "after");
}

/** ブロックへのリンクを出せるところ（ノートのチャンネル・データベースのページなど、URL でそのページを開けるところ） */
const BlockLinkContext = createContext(false);

/** 「⋮⋮」のメニューの「データベースと繋ぐ」：ふつうの段落・見出しを、データベースの項目と繋いだテキストにする */
function BindFieldItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<typeof noteSchema.blockSchema, typeof noteSchema.inlineContentSchema, typeof noteSchema.styleSchema>();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  const ctx = useContext(NoteContext);
  if (!block || (block.type !== "paragraph" && block.type !== "heading")) return null;
  const level = block.type === "heading" ? String((block.props as { level?: number }).level ?? 1) : "0";
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() =>
        editor.updateBlock(block, {
          type: "field",
          // ページの本文（とそのテンプレート）では、はじめはこのページのタイトルと繋ぐ
          props: { level, dbId: "", pageId: ctx?.page ? "@this" : "", propId: ctx?.page ? "title" : "", suffix: "" },
        })
      }
    >
      データベースと繋ぐ
    </Components.Generic.Menu.Item>
  );
}

/** 「⋮⋮」のメニューの「上のブロックとタブにまとめる」「タブから外す」 */
function TabsItems() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<typeof noteSchema.blockSchema, typeof noteSchema.inlineContentSchema, typeof noteSchema.styleSchema>();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  if (!block || block.type === "column" || block.type === "columnList") return null;
  const parent = editor.getParentBlock(block);
  const prev = editor.getPrevBlock(block);
  type Loose = { id: string; type: string; children: Loose[] };
  const b = block as unknown as Loose;
  return (
    <>
      {prev && parent?.type !== "tabs" && prev.type !== "column" && prev.type !== "columnList" && (
        <Components.Generic.Menu.Item
          className="bn-menu-item"
          onClick={() => {
            const p = prev as unknown as Loose;
            editor.transact(() => {
              if (p.type === "tabs") {
                // 上がタブなら、そのタブに足す
                editor.removeBlocks([b.id]);
                const t = editor.getBlock(p.id) as unknown as Loose;
                editor.updateBlock(p.id, { children: [...t.children, b] as never, props: { active: b.id } as never });
              } else editor.replaceBlocks([p.id, b.id], [{ type: "tabs", props: { active: b.id, titles: "{}" }, children: [p, b] }] as never);
            });
          }}
        >
          上のブロックとタブにまとめる
        </Components.Generic.Menu.Item>
      )}
      {parent?.type === "tabs" && (
        <Components.Generic.Menu.Item
          className="bn-menu-item"
          onClick={() => {
            const t = parent as unknown as Loose;
            const rest = t.children.filter((x) => x.id !== b.id);
            editor.transact(() => {
              if (rest.length >= 2) {
                editor.updateBlock(t.id, { children: rest as never, props: { active: rest[0].id } as never });
                editor.insertBlocks([b as never], t.id, "after");
              } else editor.replaceBlocks([t.id], [...rest, b] as never);
            });
          }}
        >
          タブから外す（下に出す）
        </Components.Generic.Menu.Item>
      )}
    </>
  );
}

/** 「⋮⋮」のメニューの「ブロックタイプの変換」：文のブロックを、見出し・箇条書きなどに変える（中の文はそのまま） */
const CONVERT: { label: string; type: string; props?: Record<string, unknown> }[] = [
  { label: "テキスト", type: "paragraph" },
  { label: "見出し1", type: "heading", props: { level: 1 } },
  { label: "見出し2", type: "heading", props: { level: 2 } },
  { label: "見出し3", type: "heading", props: { level: 3 } },
  { label: "箇条書き", type: "bulletListItem" },
  { label: "番号付きリスト", type: "numberedListItem" },
  { label: "チェックリスト", type: "checkListItem" },
  { label: "トグル", type: "toggleListItem" },
  { label: "引用", type: "quote" },
  { label: "コールアウト", type: "callout" },
  { label: "コード", type: "codeBlock" },
];

function ConvertItem() {
  const Components = useComponentsContext()!;
  const portalElement = usePortalElement();
  const editor = useBlockNoteEditor<typeof noteSchema.blockSchema, typeof noteSchema.inlineContentSchema, typeof noteSchema.styleSchema>();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  // 文を持つブロック（今のブロックも変換先にあるもの）だけ
  if (!block || !Array.isArray(block.content) || !CONVERT.some((c) => c.type === block.type)) return null;
  const level = (block.props as { level?: number }).level;
  return (
    <Components.Generic.Menu.Root position="right" sub portalElement={portalElement}>
      <Components.Generic.Menu.Trigger sub>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger>
          ブロックタイプの変換
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown">
        {CONVERT.map((c) => (
          <Components.Generic.Menu.Item
            key={c.label}
            className="bn-menu-item"
            checked={block.type === c.type && (c.type !== "heading" || level === c.props?.level)}
            onClick={() => editor.updateBlock(block, { type: c.type, props: c.props ?? {} } as never)}
          >
            {c.label}
          </Components.Generic.Menu.Item>
        ))}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

/** 「⋮⋮」のメニューの「複製」：すぐ下に同じブロックを足す（チャットは中身を引き継がず、新しい会話になる） */
function DuplicateItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<typeof noteSchema.blockSchema, typeof noteSchema.inlineContentSchema, typeof noteSchema.styleSchema>();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  if (!block) return null;
  return (
    <Components.Generic.Menu.Item className="bn-menu-item" onClick={() => duplicateBlocks(editor as unknown as Editor, [block as unknown as Loose])}>
      <span className="flex w-full items-center gap-3">
        <span className="flex-1">複製</span>
        <kbd className="text-xs text-muted">{formatKeyboardShortcut("Mod-d")}</kbd>
      </span>
    </Components.Generic.Menu.Item>
  );
}

/** 「⋮⋮」のメニューの「ブロックへのリンクをコピー」：開くと、そのブロックまで移って光る */
function CopyLinkItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<typeof noteSchema.blockSchema, typeof noteSchema.inlineContentSchema, typeof noteSchema.styleSchema>();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  const linkable = useContext(BlockLinkContext);
  if (!block || !linkable) return null;
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        const url = `${location.origin}${location.pathname}#block-${block.id}`;
        navigator.clipboard.writeText(url).then(
          () => toast("ブロックへのリンクをコピーしました"),
          () => toast("リンクをコピーできませんでした"),
        );
      }}
    >
      ブロックへのリンクをコピー
    </Components.Generic.Menu.Item>
  );
}

function DocDragHandleMenu() {
  return (
    <DragHandleMenu>
      <ConvertItem />
      <BlockColorsItem>カラー</BlockColorsItem>
      <TextOptionItems />
      <DuplicateItem />
      <CopyLinkItem />
      <BindFieldItem />
      <TabsItems />
      <RemoveBlockItem>削除</RemoveBlockItem>
    </DragHandleMenu>
  );
}

/** 左のメニュー（「＋」「⋮⋮」、高さ30px）を、ブロックの1行目の真ん中にそろえる。文字の行が無いブロック（チャットなど）は上にそろえる */
function sideMenuOffset({ elements }: { elements: { reference: unknown } }) {
  const r = elements.reference as Element | { contextElement?: Element };
  const ref = r instanceof Element ? r : r.contextElement;
  if (!ref) return { crossAxis: 0 };
  const content = ref.querySelector(":scope > .bn-block-content, :scope > .react-renderer > .bn-block-content");
  const line = content?.querySelector(".bn-inline-content");
  if (!line) return { crossAxis: 0 };
  const lh = parseFloat(getComputedStyle(line).lineHeight) || line.getBoundingClientRect().height;
  const top = line.getBoundingClientRect().top - ref.getBoundingClientRect().top;
  return { crossAxis: Math.round(top + (Math.min(lh, line.getBoundingClientRect().height) - 30) / 2) };
}

const inside = (r: { left: number; right: number; top: number; bottom: number }, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

/**
 * ブロック本体の範囲。行いっぱいの枠ではなく、見えている中身（文なら文字の幅、チャットなどなら箱）。
 * 空の行や短い文でも乗せやすいよう、幅は少なくとも60px
 */
function bodyRect(outer: HTMLElement) {
  const content = outer.querySelector<HTMLElement>(":scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content");
  if (!content) return null;
  const c = content.getBoundingClientRect();
  const line = content.querySelector(".bn-inline-content");
  let left = c.left;
  let right = c.right;
  if (line) {
    const l = line.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(line);
    const t = range.getBoundingClientRect();
    left = l.left;
    right = Math.max(t.width ? t.right : l.left, l.left + 60);
  } else if (content.firstElementChild) {
    const f = content.firstElementChild.getBoundingClientRect();
    if (f.width) [left, right] = [f.left, f.right];
  }
  return { left, right, top: c.top, bottom: c.bottom };
}

/** マウスが本体の上にあるブロック（いちばん内側）。列のまとまり・列の余白はブロックとみなさない */
function blockUnder(dom: HTMLElement, x: number, y: number): HTMLElement | null {
  const hit = document.elementsFromPoint(x, y).find((el) => dom.contains(el));
  for (let outer = hit?.closest<HTMLElement>(".bn-block-outer"); outer && dom.contains(outer); outer = outer.parentElement?.closest<HTMLElement>(".bn-block-outer")) {
    const r = bodyRect(outer);
    if (r && inside(r, x, y)) return outer;
  }
  return null;
}

/**
 * 「＋」「⋮⋮」の出し方。
 * - 出すのは、マウスをブロック本体に乗せたとき（小さい範囲）。
 * - 出たあとは、大きい範囲にいる間は出し続ける。大きい範囲＝そのブロックの行（ボタンの左端から行の右端まで、ブロックと同じ高さ）と、ボタンの下の同じ幅の帯。
 *   この間は、ボタンが左の列のブロックにかぶっていても、そちらには切り替えない。
 * - 大きい範囲から出たら消す。もう一度出すには、またブロック本体に乗せる。
 * BlockNote のままだと、ブロックの近く・列では右に50pxずれた所でも出るので、BlockNote の判定のあとで、出すブロックを BlockNote に知らせ直す。
 * on が false（ふだんのウィンドウ）のときは出さない
 */
function useSideMenuOnHover(editor: Editor, on: boolean) {
  useEffect(() => {
    if (!on) return;
    const ours = new WeakSet<Event>();
    let current: HTMLElement | null = null;
    const show = (dom: HTMLElement, block: HTMLElement, e: MouseEvent) => {
      // BlockNote は列の中だと x を右に50px足して探すので、ブロックの左端から少し入った所を知らせる
      const r = block.getBoundingClientRect();
      const target = block.querySelector(".bn-block-content") ?? dom;
      const ev = new MouseEvent("mousemove", { clientX: r.left + Math.min(25, r.width / 2), clientY: Math.min(Math.max(e.clientY, r.top + 2), r.bottom - 2), bubbles: true });
      ours.add(ev);
      target.dispatchEvent(ev);
    };
    /** 出ているボタンの範囲。隠れているときは、出る場所（列の左端・エディタの左端の左、1行目の高さ）を見積もる */
    const menuRect = (dom: HTMLElement, block: HTMLElement, body: { top: number }) => {
      const m = (dom.closest(".bn-container") ?? document).querySelector(".bn-side-menu")?.getBoundingClientRect();
      if (m?.width) return m;
      const column = block.closest("[data-node-type=column]");
      const right = ((column ?? dom).firstElementChild ?? dom).getBoundingClientRect().left;
      return { left: right - 48, right, top: body.top, bottom: body.top + 30 };
    };
    /** 大きい範囲：ブロックの行（ボタンの左端〜行の右端、ブロックと同じ高さ）と、ボタンの下の同じ幅の帯（ブロックの下端か、ボタン2つ分下まで） */
    const inBigZone = (dom: HTMLElement, block: HTMLElement, x: number, y: number) => {
      const body = bodyRect(block);
      if (!body) return false;
      const m = menuRect(dom, block, body);
      const row = { left: m.left, right: block.getBoundingClientRect().right, top: Math.min(body.top, m.top), bottom: Math.max(body.bottom, m.bottom) };
      const strip = { left: m.left, right: m.right, top: m.top, bottom: Math.max(body.bottom, m.bottom + 60) };
      return inside(row, x, y) || inside(strip, x, y);
    };
    const onMove = (e: MouseEvent) => {
      const dom = editor.domElement;
      if (!dom || !editor.isEditable || !Number.isFinite(e.clientX)) return;
      const t = e.target instanceof Element ? e.target : null;
      // メニューの上（「＋」「⋮⋮」や開いたメニュー）では、そのまま
      if (t?.closest(".bn-side-menu, .bn-menu-dropdown, [role=menu], .bn-suggestion-menu")) return;
      // 出ている間は、大きい範囲にいる限りそのブロックのまま
      if (current?.isConnected && inBigZone(dom, current, e.clientX, e.clientY)) return show(dom, current, e);
      // 大きい範囲の外：ブロック本体に乗せていれば、そのブロックで出す。どこにも乗っていなければ消す
      const block = blockUnder(dom, e.clientX, e.clientY);
      if (block) {
        current = block;
        return show(dom, block, e);
      }
      current = null;
      editor.getExtension(SideMenuExtension)?.hideMenuIfNotFrozen();
    };
    // BlockNote（document の capture）が元のイベントを処理し終えてから動くよう、window の bubble で受ける
    const onMoveAfter = (e: MouseEvent) => {
      if (!ours.has(e)) onMove(e);
    };
    window.addEventListener("mousemove", onMoveAfter);
    return () => window.removeEventListener("mousemove", onMoveAfter);
  }, [editor, on]);
}

/**
 * 列の先頭のブロックで、行の頭で Backspace を押したとき（BlockNote のままだと、列が1つに減るときに位置がずれてエラーになる）。
 * 空のブロックは消すだけ。文があるブロックは、前の列の最後（最初の列なら列の上）に移す
 */
function columnBackspace(editor: Editor, e: KeyboardEvent) {
  if (e.key !== "Backspace" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const sel = editor.prosemirrorState.selection;
  if (!sel.empty || sel.$from.parentOffset !== 0) return;
  type Loose = { id: string; type: string; content?: unknown; children: Loose[] };
  const block = editor.getTextCursorPosition().block as unknown as Loose;
  const column = editor.getParentBlock(block.id) as unknown as Loose | undefined;
  if (column?.type !== "column" || column.children[0]?.id !== block.id) return;
  const list = editor.getParentBlock(column.id) as unknown as Loose | undefined;
  if (!list) return;
  e.preventDefault();
  e.stopPropagation();
  const i = list.children.findIndex((c) => c.id === column.id);
  const prev = i > 0 ? list.children[i - 1] : undefined;
  const empty = Array.isArray(block.content) && block.content.length === 0 && !block.children.length;
  // 消したあとに列が1つになると、列のまとまりが外れて中身だけが残る。その中身の id を目印にする
  const anchor = prev ? prev.children[prev.children.length - 1] : list.children.find((c) => c.id !== column.id)?.children[0];
  editor.transact(() => {
    editor.removeBlocks([block.id]);
    if (empty) {
      if (anchor && editor.getBlock(anchor.id)) editor.setTextCursorPosition(anchor.id, "end");
      return;
    }
    const { id: _drop, ...copy } = block;
    void _drop;
    if (prev && anchor && editor.getBlock(anchor.id)) editor.insertBlocks([copy as never], anchor.id, "after");
    else if (editor.getBlock(list.id)) editor.insertBlocks([copy as never], list.id, "before");
    else if (anchor && editor.getBlock(anchor.id)) editor.insertBlocks([copy as never], anchor.id, "before");
  });
}

/**
 * ふだんのウィンドウで、行の頭の Backspace・行の終わりの Delete。前（後ろ）がチャットや固定した文章などのとき・列の端のときは何もしない
 * （つなげて書き換えたり、列を減らしたりしない）。入れ子の先頭の Backspace（外に出す）は、外が文章ならそのまま。
 * 文章のブロックもそれぞれ別（separate）のときは、いつも何もしない。Enter は新しいブロックを作らず、同じブロックの中で改行する
 */
function textOnlyEdgeKey(editor: Editor, e: KeyboardEvent, separate: boolean) {
  if (e.isComposing || e.keyCode === 229) return;
  const sel = editor.prosemirrorState.selection;
  if (separate && e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey && !sel.$from.parent.type.spec.code) {
    e.preventDefault();
    e.stopPropagation();
    const view = editor.prosemirrorView;
    view?.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.hardBreak.create()).scrollIntoView());
    return;
  }
  if (e.key !== "Backspace" && e.key !== "Delete") return;
  const back = e.key === "Backspace";
  if (!sel.empty || sel.$from.parentOffset !== (back ? 0 : sel.$from.parent.content.size)) return;
  if (!separate) {
    const { prevBlock, nextBlock, parentBlock } = editor.getTextCursorPosition();
    const side = back ? prevBlock : nextBlock;
    if (side ? !isFixedBlock(editor, side) : back && parentBlock && !isFixedBlock(editor, parentBlock)) return;
  }
  e.preventDefault();
  e.stopPropagation();
}

/** 列のまとまりの上端・下端の帯の高さ。ここに落とすと、列の中ではなく、列のまとまりの上・下（1列）に置く */
const COLUMN_EDGE = 28;

type EditorView = NonNullable<Editor["prosemirrorView"]>;

/** マウスが列のまとまりの上端・下端の帯にあれば、その列のまとまりと、上・下のどちらに置くか（置く位置）を返す */
function columnListEdge(view: EditorView, x: number, y: number): { id: string; side: "before" | "after"; pos: number } | null {
  const hit = document.elementsFromPoint(x, y).find((el) => view.dom.contains(el));
  for (let list = hit?.closest<HTMLElement>(".bn-block-column-list"); list && view.dom.contains(list); list = list.parentElement?.closest<HTMLElement>(".bn-block-column-list")) {
    const r = list.getBoundingClientRect();
    const band = Math.min(COLUMN_EDGE, r.height / 4);
    const side = y <= r.top + band ? "before" : y >= r.bottom - band ? "after" : null;
    if (!side || !list.dataset.id) continue;
    const before = view.posAtDOM(list, 0) - 1;
    const node = view.state.doc.nodeAt(before);
    if (node?.type.name !== "columnList") continue;
    return { id: list.dataset.id, side, pos: side === "before" ? before : before + node.nodeSize };
  }
  return null;
}

/** 落とす位置の線：列のまとまりの上端・下端では、列のまとまりの上・下に横線を出す。ほかは列の機能のまま（左右の端なら列を足す） */
const dropCursor: { hooks: DropCursorHooks } = {
  hooks: {
    computeDropPosition: (ctx) => {
      const edge = columnListEdge(ctx.view, ctx.event.clientX, ctx.event.clientY);
      if (edge) return { pos: edge.pos, orientation: "block-horizontal" };
      return multiColumnDropCursor.hooks.computeDropPosition?.(ctx) ?? ctx.defaultPosition;
    },
  },
};

/**
 * ブロックを列のまとまりの上端・下端に落としたとき、列の中ではなく、列のまとまりの上・下に置く
 * （BlockNote のままだと、列が画面いっぱいに広がっていると、列の外に置ける場所が無い）
 */
function useDropBesideColumns(editor: Editor) {
  useEffect(() => {
    const dom = editor.domElement;
    if (!dom) return;
    type Loose = { id: string; children: Loose[] };
    const onDrop = (e: DragEvent) => {
      const view = editor.prosemirrorView;
      const slice = view?.dragging?.slice;
      if (!view || !slice) return;
      const edge = columnListEdge(view, e.clientX, e.clientY);
      if (!edge) return;
      const dragged = fragmentToBlocks(slice.content) as unknown as Loose[];
      if (!dragged.length) return;
      e.preventDefault();
      e.stopPropagation();
      view.dragging = null;
      const ids = new Set(dragged.map((b) => b.id));
      // 列のまとまりそのものを動かしているときは、そのまま
      if (ids.has(edge.id)) return;
      // 取り除いて列が1つになると、列のまとまりが外れて中身だけが残る。そのときは残る中身の最初・最後を目印にする
      const list = editor.getBlock(edge.id) as unknown as Loose | undefined;
      const rest = (list?.children ?? []).flatMap((c) => c.children).filter((b) => !ids.has(b.id));
      const anchor = edge.side === "before" ? rest[0] : rest[rest.length - 1];
      editor.transact(() => {
        const existing = dragged.filter((b) => editor.getBlock(b.id));
        if (existing.length) editor.removeBlocks(existing.map((b) => b.id));
        const target = editor.getBlock(edge.id) ? edge.id : anchor?.id;
        if (target) editor.insertBlocks(dragged as never, target, edge.side);
      });
    };
    dom.addEventListener("drop", onDrop, true);
    return () => dom.removeEventListener("drop", onDrop, true);
  }, [editor]);
}

/**
 * BlockNoteView の中に置くメニュー：「/」（全角の「／」でも開く）と、左の「＋」「⋮⋮」。
 * textOptions：ウィンドウの文章のブロックの枠・固定（渡すと「⋮⋮」に「枠」「固定」が出る）。
 * textOnly：ふだんのウィンドウ。固定していない文章だけ直せる（「＋」「⋮⋮」「/」は出さない）。
 * separate：そのうえ、文章のブロックもそれぞれ別（足したり消したり、つなげたりしない）。
 * linkable：「⋮⋮」に「ブロックへのリンクをコピー」を出す（URL でそのページを開けるところ）
 */
export function EditorMenus({
  editor,
  textOptions,
  onTextOptions,
  textOnly = false,
  separate = false,
  linkable = false,
}: {
  editor: Editor;
  textOptions?: TextOptions;
  onTextOptions?: (options: TextOptions) => void;
  textOnly?: boolean;
  separate?: boolean;
  linkable?: boolean;
}) {
  const ctx = useContext(NoteContext);
  useSideMenuOnHover(editor, !textOnly);
  useDropBesideColumns(editor);
  useTextOptions(editor, textOptions, textOnly, separate);
  // キーは ProseMirror より先に受け取る（capture）
  useEffect(() => {
    const dom = editor.domElement;
    if (!dom) return;
    // チャットなどのブロックを選んでいる（ブロックごと選択）ときに文字を打っても、ブロックが文字に置き換わって消えないようにする。
    // 消すのは Delete・Backspace か「⋮⋮」の「削除」で
    const blockSelected = () => "node" in editor.prosemirrorState.selection;
    // ブロックの中の入力欄（チャット・ToDo・ビューの検索など）で打った文字は止めない
    const inField = (e: Event) => e.target instanceof HTMLElement && e.target !== dom && !!e.target.closest("input, textarea, select");
    const onKey = (e: KeyboardEvent) => {
      if (inField(e)) return;
      if (blockSelected() && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || e.key === "Enter" || e.key === "Process")) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (textOnly) return textOnlyEdgeKey(editor, e, separate);
      if (notionKey(editor, e)) return;
      columnBackspace(editor, e);
    };
    const onInput = (e: InputEvent) => {
      if (inField(e)) return;
      if (blockSelected() && (e.inputType.startsWith("insert") || e.inputType === "insertCompositionText")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    dom.addEventListener("keydown", onKey, true);
    dom.addEventListener("beforeinput", onInput, true);
    return () => {
      dom.removeEventListener("keydown", onKey, true);
      dom.removeEventListener("beforeinput", onInput, true);
    };
  }, [editor, textOnly, separate]);
  const menus = textOnly ? (
    // ふだんのウィンドウ：文字を選んだときのツールバーだけ（固定した文章などにかかるときは出さない。BlockNoteView の標準のものは止めておく）
    <FormattingToolbarController formattingToolbar={NoteTextOnlyToolbar} />
  ) : (
    <>
      {/* 文字を選んだときのツールバー（BlockNoteView の標準のものは止めておく） */}
      <FormattingToolbarController formattingToolbar={NoteToolbar} />
      <SuggestionMenuController triggerCharacter="/" getItems={async (query) => filterSuggestionItems(slashItems(editor), query)} />
      <SuggestionMenuController triggerCharacter="／" getItems={async (query) => filterSuggestionItems(slashItems(editor), query)} />
      {/* 「@」（全角の「＠」でも）：メンバー・日付・ルームのノートを文の中に入れる */}
      <SuggestionMenuController triggerCharacter="@" getItems={(query) => mentionItems(editor as never, ctx, query)} />
      <SuggestionMenuController triggerCharacter="＠" getItems={(query) => mentionItems(editor as never, ctx, query)} />
      <SideMenuController
        sideMenu={(props) => <SideMenu {...props} dragHandleMenu={DocDragHandleMenu} />}
        // 「＋」「⋮⋮」を、そのブロックの1行目の真ん中にそろえる（BlockNote の決まった値は、見出しの大きさが違うとずれるので、実際の文字から測る）
        floatingUIOptions={{ useFloatingOptions: { middleware: [offset(sideMenuOffset)] } }}
      />
    </>
  );
  return (
    <TextOptionsContext.Provider value={textOptions && onTextOptions ? { options: textOptions, onChange: onTextOptions } : null}>
      <BlockLinkContext.Provider value={linkable}>
        {menus}
        {/* 左右に並んだブロック（列）を、スマホの幅ではタブにする */}
        <ColumnTabsHost editor={editor} textOnly={textOnly} />
      </BlockLinkContext.Provider>
    </TextOptionsContext.Provider>
  );
}

/**
 * Notion と同じキー。処理したら true。
 * - Ctrl+D（Mac は ⌘D）：今のブロック（選んでいるブロック）を、すぐ下に複製する
 * - コールアウトの中の Enter：最後なら下に新しい段落を作って移り、途中ならコールアウトの中で改行する
 */
function notionKey(editor: Editor, e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return false;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
    e.preventDefault();
    e.stopPropagation();
    const selected = editor.getSelection()?.blocks;
    duplicateBlocks(editor, (selected?.length ? selected : [editor.getTextCursorPosition().block]) as unknown as Loose[]);
    return true;
  }
  if (e.key !== "Enter" || e.shiftKey || mod || e.altKey) return false;
  // 「/」「@」のメニューが開いているときは、メニューで選ぶ
  if (document.querySelector(".bn-suggestion-menu")) return false;
  const { block } = editor.getTextCursorPosition();
  if (block.type !== "callout") return false;
  const sel = editor.prosemirrorState.selection;
  e.preventDefault();
  e.stopPropagation();
  if (sel.empty && sel.$from.parentOffset === sel.$from.parent.content.size) {
    const [next] = editor.insertBlocks([{ type: "paragraph" }], block, "after");
    editor.setTextCursorPosition(next, "start");
  } else {
    const view = editor.prosemirrorView;
    view?.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.hardBreak.create()).scrollIntoView());
  }
  return true;
}

/** 画像を、まずメディアに入れてから「画像（メディアから）」ブロックにして貼る */
export async function insertUploaded(editor: Editor, roomId: string, userId: string, files: File[]) {
  toast(`${files.length}枚をメディアに追加しています…`);
  const { ids, toMine } = await uploadToRoom(roomId, userId, files);
  if (!ids.length) return;
  const at = editor.getTextCursorPosition().block;
  editor.insertBlocks(
    ids.map((id) => ({ type: "mediaImage" as const, props: { mediaId: id } })),
    at,
    "after",
  );
  toast(`${ids.length}枚を${toMine ? "マイメディア" : "メディア"}に追加して貼りました`);
}

/** ドロップされた画像をメディア経由で貼る（ドロップ先の要素の onDropCapture に渡す） */
export const dropImages = (editor: Editor, roomId: string, userId: string) => (e: React.DragEvent) => {
  // メディアの画像をドラッグしてきたときは、ファイルの追加として扱わない（同じ画像が二重に増えないように）
  if (e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const files = [...e.dataTransfer.files].filter(isImageFile);
  if (!files.length) return;
  e.preventDefault();
  e.stopPropagation();
  void insertUploaded(editor, roomId, userId, files);
};

/** ノートと同じブロック（列・データベースと繋いだテキストも）が使えるエディタを作る */
export function useBlockEditor(initial: unknown[], roomId: string, userId: string, deps: unknown[]) {
  return useCreateBlockNote(
    {
      schema: noteSchema,
      dictionary: { ...ja, multi_column: multiColumnLocales.ja },
      dropCursor,
      // チャットなど文字の入らないブロックの間に、横線のカーソル（ギャップカーソル）を置かない。そこで文字を打って行ができることも無くす
      disableExtensions: ["gapCursor"],
      // 左右に並んだブロック（列）を、スマホの幅ではタブにして1列ずつ見せる
      // ウィンドウの文章のブロックの枠・固定
      extensions: [columnTabsExtension, textOptionsExtension],
      initialContent: initial.length ? (initial as Blocks) : undefined,
      // 画像を貼り付けたときは、まずメディアに入れてから「画像（メディアから）」ブロックにする（ふだんのウィンドウでは、ブロックは足せないので貼らない）
      pasteHandler: ({ event, editor, defaultPasteHandler }) => {
        const files = [...(event.clipboardData?.files ?? [])].filter(isImageFile);
        // 文章のブロックもそれぞれ別のときは、文字だけを今のブロックに貼る（行の区切りは改行にする）
        if (isSeparate(editor)) {
          const text = event.clipboardData?.getData("text/plain");
          if (text) editor.insertInlineContent(text.replace(/\r\n?/g, "\n"));
          return true;
        }
        if (!files.length) return defaultPasteHandler();
        if (isTextOnly(editor)) return true;
        void insertUploaded(editor, roomId, userId, files);
        return true;
      },
    },
    deps,
  );
}
