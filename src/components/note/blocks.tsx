"use client";

import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { withMultiColumn } from "@blocknote/xl-multi-column";
import { BlockBody } from "@/components/embeds";
import { FieldBlockView } from "@/components/pageBlocks";
import { TabsBlockView, type AnyBlock } from "./TabsBlock";

export { NoteContext } from "@/components/embeds";

// ノートのブロック。中身は BlockBody（ウィンドウの部品と同じもの）で描く

export const MediaImageBlock = createReactBlockSpec(
  {
    type: "mediaImage",
    propSchema: {
      mediaId: { default: "" },
      width: { default: "m", values: ["s", "m", "l", "full"] as const },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <BlockBody
        type="mediaImage"
        props={block.props}
        onChange={(p) => editor.updateBlock(block, { props: p })}
        // 2枚以上選んだら、後ろに続けて並べる
        onPickMany={(ids) => editor.insertBlocks(ids.map((mid) => ({ type: "mediaImage" as const, props: { mediaId: mid, width: block.props.width } })), block, "after")}
      />
    ),
  },
);

export const ChatBlock = createReactBlockSpec(
  { type: "chatBlock", propSchema: { chatId: { default: "" }, propId: { default: "" } }, content: "none" },
  { render: ({ block, editor }) => <BlockBody type="chatBlock" props={block.props} blockId={block.id} onChange={(p) => editor.updateBlock(block, { props: p })} /> },
);

export const ImageChatBlock = createReactBlockSpec(
  { type: "imageChatBlock", propSchema: { chatId: { default: "" }, seed: { default: "" }, propId: { default: "" } }, content: "none" },
  { render: ({ block, editor }) => <BlockBody type="imageChatBlock" props={block.props} blockId={block.id} onChange={(p) => editor.updateBlock(block, { props: p })} /> },
);

export const SingleViewBlock = createReactBlockSpec(
  {
    type: "singleView",
    propSchema: {
      dbId: { default: "" },
      pageId: { default: "" },
      propId: { default: "" },
      display: { default: "value", values: ["value", "line", "circle"] as const },
      // 一緒に出す項目（ID の並びの JSON）・工程の期限を出す・日付を残りの日数で出す・見出しを出さない（"1" でオン）
      visible: { default: "[]" },
      stages: { default: "" },
      countdown: { default: "" },
      hideHead: { default: "" },
    },
    content: "none",
  },
  { render: ({ block, editor }) => <BlockBody type="singleView" props={block.props} onChange={(p) => editor.updateBlock(block, { props: p })} /> },
);

export const DbViewBlock = createReactBlockSpec(
  // Notion のリンクされたビュー：ビューはブロックが持つ（views：ビューの並びの JSON、active：選んでいるビュー）
  { type: "dbView", propSchema: { dbId: { default: "" }, views: { default: "" }, active: { default: "" }, hideHead: { default: "" } }, content: "none" },
  { render: ({ block, editor }) => <BlockBody type="dbView" props={block.props} onChange={(p) => editor.updateBlock(block, { props: p })} /> },
);

// ---- 道具のブロック（ToDo・追加ボタン） ----

export const TodoBlock = createReactBlockSpec(
  { type: "todoBlock", propSchema: {}, content: "none" },
  { render: ({ block, editor }) => <BlockBody type="todoBlock" props={block.props as Record<string, string>} onChange={(p) => editor.updateBlock(block, { props: p })} /> },
);

export const AddButtonBlock = createReactBlockSpec(
  { type: "addButton", propSchema: { dbId: { default: "" }, templateId: { default: "" }, label: { default: "" }, align: { default: "" } }, content: "none" },
  { render: ({ block, editor }) => <BlockBody type="addButton" props={block.props as Record<string, string>} onChange={(p) => editor.updateBlock(block, { props: p })} /> },
);

// ---- データベースのページのブロック（タイトル・進み具合・項目・チャット） ----

export const PageTitleBlock = createReactBlockSpec(
  { type: "pageTitle", propSchema: { suffix: { default: "" } }, content: "none" },
  { render: ({ block, editor }) => <BlockBody type="pageTitle" props={block.props as Record<string, string>} onChange={(p) => editor.updateBlock(block, { props: p })} /> },
);

export const PagePropsBlock = createReactBlockSpec(
  { type: "pageProps", propSchema: { heading: { default: "" }, dbId: { default: "" }, pageId: { default: "@this" }, visible: { default: "" } }, content: "none" },
  { render: ({ block, editor }) => <BlockBody type="pageProps" props={block.props as Record<string, string>} onChange={(p) => editor.updateBlock(block, { props: p })} /> },
);

export const PageChatBlock = createReactBlockSpec(
  { type: "pageChat", propSchema: { which: { default: "main" } }, content: "none" },
  { render: ({ block, editor }) => <BlockBody type="pageChat" props={block.props as Record<string, string>} onChange={(p) => editor.updateBlock(block, { props: p })} /> },
);

// ---- データベースと繋いだテキスト（段落・見出しの「⋮⋮」から作る） ----

export const FieldBlock = createReactBlockSpec(
  {
    type: "field",
    propSchema: { level: { default: "0" }, dbId: { default: "" }, pageId: { default: "" }, propId: { default: "" }, suffix: { default: "" }, icon: { default: "" } },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <FieldBlockView
        props={block.props}
        onChange={(p) => editor.updateBlock(block, { props: p })}
        // 繋ぎを外すと、そのときの値の、ふつうの段落・見出しに戻す
        onUnbind={(text) =>
          editor.updateBlock(block, (block.props.level === "0" ? { type: "paragraph", content: text } : { type: "heading", props: { level: Number(block.props.level) }, content: text }) as never)
        }
      />
    ),
  },
);

// ---- タブ（中のブロックを1つずつタブにして、選んだ1つだけ見せる） ----

export const TabsBlock = createReactBlockSpec(
  { type: "tabs", propSchema: { active: { default: "" }, titles: { default: "{}" } }, content: "none" },
  { render: ({ block, editor }) => <TabsBlockView block={block as unknown as AnyBlock} editor={editor as unknown as NoteEditor} /> },
);

// 画像・動画・音声・ファイルの標準ブロックは外す（画像はメディアから貼るブロックに一本化）
const { image: _image, video: _video, audio: _audio, file: _file, ...textBlocks } = defaultBlockSpecs;
void [_image, _video, _audio, _file];

// 列（ブロックを横に並べる）も使えるようにする
export const noteSchema = withMultiColumn(
  BlockNoteSchema.create({
  blockSpecs: {
    ...textBlocks,
    mediaImage: MediaImageBlock(),
    dbView: DbViewBlock(),
    chatBlock: ChatBlock(),
    imageChatBlock: ImageChatBlock(),
    singleView: SingleViewBlock(),
    pageTitle: PageTitleBlock(),
    pageProps: PagePropsBlock(),
    pageChat: PageChatBlock(),
    field: FieldBlock(),
    tabs: TabsBlock(),
    todoBlock: TodoBlock(),
    addButton: AddButtonBlock(),
  },
  }),
);

export type NoteEditor = typeof noteSchema.BlockNoteEditor;
