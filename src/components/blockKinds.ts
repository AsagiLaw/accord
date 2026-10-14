import type { IconName } from "@/components/Icon";
import type { BlockKind } from "@/lib/local/db";

/**
 * ブロックの種類の一覧。ノートの「/」メニューとウィンドウの「部品を追加」は、どちらもこれを使う。
 * 新しいブロックを作るときは、ここと embeds.tsx の BlockBody に足せば、ノートにもウィンドウにも出る
 */
export const BLOCK_KINDS: Record<BlockKind, { label: string; short: string; note: string; icon: IconName; group: string; aliases: string[] }> = {
  text: { label: "テキスト", short: "テキスト", note: "見出し・箇条書きなど。ノートと同じ書き方", icon: "text", group: "テキスト", aliases: ["text", "tekisuto", "テキスト"] },
  mediaImage: {
    label: "画像（メディアから）",
    short: "画像",
    note: "メディアから画像を選んで貼る",
    icon: "img",
    group: "メディア",
    aliases: ["image", "gazou", "がぞう", "画像", "img"],
  },
  dbView: {
    label: "オールビュー",
    short: "オールビュー",
    note: "データベースのビュー（表・ボード・割合・カレンダーなど）を置く",
    icon: "db",
    group: "データ",
    aliases: ["view", "database", "db", "all", "oru", "おーる", "依頼", "ビュー", "オール"],
  },
  singleView: {
    label: "シングルビュー",
    short: "シングルビュー",
    note: "ページの項目1つを大きく出す（値・ラインゲージ・サークルゲージ）",
    icon: "eye",
    group: "データ",
    aliases: ["single", "gauge", "shinguru", "しんぐる", "ゲージ", "シングル"],
  },
  chatBlock: {
    label: "チャット",
    short: "チャット",
    note: "ルームのメンバーと話す（書き込める人も選べる）",
    icon: "chat",
    group: "会話",
    aliases: ["chat", "chatto", "ちゃっと", "チャット"],
  },
  imageChatBlock: {
    label: "イメージチャット",
    short: "イメージチャット",
    note: "イメージユーザー（名前とアイコン）で会話を再現する",
    icon: "ppl",
    group: "会話",
    aliases: ["image", "imeji", "いめーじ", "再現", "イメージ"],
  },
  todoBlock: {
    label: "ToDo",
    short: "ToDo",
    note: "やることリスト（追加・チェック・削除）。ソースでカレンダーを選ぶと、今日の予定を並べる",
    icon: "checkbox",
    group: "道具",
    aliases: ["todo", "task", "やること", "タスク", "とぅーどぅー"],
  },
  addButton: {
    label: "追加ボタン",
    short: "追加ボタン",
    note: "押すとデータベースにページを足すボタン（テンプレートも選べる）",
    icon: "add",
    group: "道具",
    aliases: ["button", "add", "botan", "ボタン", "追加", "依頼"],
  },
  linkButton: {
    label: "ボタン",
    short: "ボタン",
    note: "押すと、ボタンの中のノート・ウィンドウか、データベースの「ページ」の項目の別ページをポップアップで出す",
    icon: "open",
    group: "道具",
    aliases: ["button", "link", "popup", "botan", "ぼたん", "ボタン", "リンク", "ポップアップ"],
  },
  calendarBlock: {
    label: "カレンダー",
    short: "カレンダー",
    note: "予定を組めるカレンダー（データベースの日付やルームの予定も一緒に出せる）",
    icon: "calendar",
    group: "道具",
    aliases: ["calendar", "karenda", "かれんだー", "カレンダー", "予定", "スケジュール", "schedule"],
  },
  pageTitle: { label: "ページのタイトル", short: "タイトル", note: "このページのアイコンと名前（後ろに「様の依頼」など）", icon: "text", group: "ページ", aliases: ["title", "taitoru", "タイトル", "名前"] },
  pageProps: {
    label: "ページの項目",
    short: "項目",
    note: "ページの項目を並べて入力する（どのページの、どの項目を出すかは設定で選ぶ）",
    icon: "list",
    group: "ページ",
    aliases: ["props", "prop", "property", "detail", "field", "詳細", "項目", "プロパティ", "koumoku", "こうもく"],
  },
  pageChat: { label: "ページのチャット", short: "ページのチャット", note: "このページの依頼進行チャット・やり取り再現", icon: "chat", group: "ページ", aliases: ["chat", "comment", "コメント", "進行", "再現"] },
};

/** 文章以外の、ノートでは1つのブロックになる種類 */
export const EMBED_KINDS = ["mediaImage", "dbView", "singleView", "chatBlock", "imageChatBlock", "todoBlock", "addButton", "linkButton", "calendarBlock", "pageTitle", "pageProps", "pageChat"] as const;
export type EmbedKind = (typeof EMBED_KINDS)[number];

/** 「/」「＋」「部品を追加」のメニューに出す種類（ページのタイトルは「⋮⋮」の「データベースと繋ぐ」、ページのチャットはシングルビューで作る） */
export const MENU_KINDS = ["mediaImage", "dbView", "singleView", "chatBlock", "imageChatBlock", "todoBlock", "addButton", "linkButton", "calendarBlock", "pageProps"] as const;

export const isChatKind = (k: BlockKind) => k === "chatBlock" || k === "imageChatBlock";
