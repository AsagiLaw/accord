import Dexie, { type EntityTable, type Table, type Transaction } from "dexie";
import { newId } from "@/lib/id";
import type { ImageEdit } from "@/lib/media/edit";
import { DEFAULT_STAGES as REQUEST_DEFAULT_STAGES, requestDatabase } from "@/lib/requests/defaults";
import { copyView, fromGrid, homeBlocks, layoutToBlocks, mapTabs, mergePageProp, replaceProgress, standardRequestBlocks, standardRequestTemplate, toBlockTab } from "./windowLayout";

export { newId };

// ローカル版のデータ。テーブルの形は supabase/migrations の SQL と揃えておき、
// サーバー版に移るときは src/lib/local をサーバー用の実装に差し替える。

export type RoomRole = "host" | "member";

export type Profile = { id: string; displayName: string; createdAt: number };
export type Room = {
  id: string;
  name: string;
  /** ルームバーに出すアイコン画像（小さくした画像の data URL）。無ければ名前の最初の1文字 */
  icon?: string;
  createdBy: string;
  createdAt: number;
};
export type RoomMember = { roomId: string; userId: string; role: RoomRole; joinedAt: number };

/**
 * フレンドの間柄。fromId が申請を送り、toId が承認すると accepted になる。
 * 断る・取り消す・フレンドの解除は、この行を消す
 */
export type Friendship = {
  id: string;
  fromId: string;
  toId: string;
  status: "pending" | "accepted";
  createdAt: number;
  respondedAt?: number;
};

/**
 * メディアのボックス。画像とライブラリーは、どれか1つのボックスに入る。
 * 持ち主は1人。フレンドやルームと共有できる（共有先は BoxShare）
 */
export type MediaBox = {
  id: string;
  ownerId: string;
  name: string;
  /** mine：アカウントごとに1つある「マイメディア」（削除・共有・ルームとの紐づけはできない）／box：自分で作ったボックス */
  kind: "mine" | "box";
  createdAt: number;
};

/**
 * ボックスの共有先：フレンド（userId）か、ルーム（roomId。そのルームのメンバー全員）のどちらか一方。
 * 1つのルームに紐づけられるボックスは1つだけ。canEdit が無ければ見るだけ
 */
export type BoxShare = {
  id: string;
  boxId: string;
  userId?: string;
  roomId?: string;
  canEdit: boolean;
  createdAt: number;
};

export type Media = {
  id: string;
  /** 入っているボックス */
  boxId: string;
  /** アップロードした人。完全に削除できるのはこの人だけ */
  uploadedBy: string;
  name: string;
  fileName: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  dpi: number;
  createdAt: number;
  fav: boolean;
  trashed: boolean;
  /** 入っているライブラリー。子ライブラリーに入れたら、その親たちも必ず含む */
  libIds: string[];
  /** 編集してある（元の画像に戻せる） */
  edited?: boolean;
  /** 画像の中身を変えた回数。表示用の URL を作り直すのに使う */
  rev?: number;
};

/**
 * 画像の中身。一覧で毎回読まないよう、情報とは別のテーブルに置く。
 * 編集したら original は編集後の画像になり、元の画像は source に、編集の内容は edit に残す
 */
export type MediaBlob = {
  id: string;
  original: Blob;
  thumb: Blob;
  source?: Blob;
  sourceInfo?: { fileName: string; mime: string; size: number; width: number; height: number };
  edit?: ImageEdit;
};

export type Library = {
  id: string;
  /** 入っているボックス（ライブラリーの中の画像も、同じボックスのもの） */
  boxId: string;
  name: string;
  parentId: string | null;
  /** 親ライブラリーで、この子ライブラリーの代表として見せる画像（試作の「印」） */
  repMediaId: string | null;
  /** 同じ親の中での並び順 */
  order: number;
  createdAt: number;
};

export type Chat = {
  id: string;
  /** ダイレクトメッセージのチャットは、どのルームにも入らないので空 */
  roomId: string;
  name: string;
  /** アイコン（絵文字・メディアの画像・シンプルなアイコン）。無ければ種類のアイコン */
  icon?: string;
  /** normal：普通のチャット／reenact：やり取り再現チャット（話者を切り替えて記録する） */
  /** normal：普通のチャット／reenact：やり取り再現／image：イメージチャット（イメージユーザーで会話を再現） */
  kind: "normal" | "reenact" | "image";
  order: number;
  createdAt: number;
  /** 依頼ページなどの中にあるチャット。サイドバーのチャット一覧には出さない */
  pageId?: string | null;
  /** 再現チャットの話者。先頭の2人（依頼者・自分）は固定 */
  speakers?: string[];
  /** 話せる人（ユーザーの ID）。無ければルームの全員 */
  allowed?: string[];
  /** サイドバーでの置き場所：カテゴリー（無ければカテゴリーの外）と、その中の並び順 */
  categoryId?: string | null;
  navOrder?: number;
  /** ダイレクトメッセージの2人（ID の小さい順）。ある2人の DM は1つだけ */
  dm?: string[];
};

export type Message = {
  id: string;
  chatId: string;
  roomId: string;
  authorId: string;
  /** 再現チャットでの話者名（普通のチャットでは null） */
  speaker: string | null;
  text: string;
  /** 添付した画像。画像は必ずメディアに入ってから添付される */
  mediaIds: string[];
  replyTo: string | null;
  createdAt: number;
  editedAt: number | null;
};

/** どこまで読んだか（未読の数に使う） */
export type ChatRead = { chatId: string; userId: string; lastReadAt: number };

// ---- データベース（依頼など） ----

export type PropType =
  | "title"
  | "text"
  | "number"
  | "date"
  | "select"
  | "multiselect"
  | "user"
  | "status"
  | "media"
  | "checkbox"
  | "url"
  | "email"
  | "phone"
  /** 作成日時・更新日時は自動で入る（"YYYY-MM-DD HH:mm"） */
  | "created"
  | "edited"
  /** 工程：プランなどの選択肢ごとに、工程の名前と％を決めておき、その中から選ぶ */
  | "stage"
  /** ページごとのチャット・イメージチャット。値はチャットの ID。表やボードには出さず、シングルビューで出す */
  | "chat"
  | "imageChat";

/** 工程の1段階。pct はその工程まで終わったときの進み具合（0〜100） */
export type StageStep = { name: string; pct: number };
/** 選択肢の色（Notion と同じ9色） */
export type TagColor = "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";
export type Property = {
  id: string;
  name: string;
  type: PropType;
  options?: string[];
  /** 選択肢ごとの色。無い選択肢は灰色 */
  colors?: Record<string, TagColor>;
  format?: "yen" | "percent";
  /** 工程の項目：どの選択の項目で工程を切り替えるか（無ければ1つの並びだけ） */
  basedOn?: string;
  /** 工程の項目：選択肢ごとの工程の並び。basedOn が無いときは "" に入れる */
  stages?: Record<string, StageStep[]>;
  /** チャットの項目：書き込める人（無ければルームの全員） */
  allowed?: string[];
  /** イメージチャットの項目："page" なら依頼者（ページの名前）と参加者を最初から話す人に入れる */
  seed?: string;
};
/** 依頼プランの工程。ratio は開始日（0）から納期（1）までのどのあたりが期限か */
export type Stage = { name: string; ratio: number };

export type Database = {
  id: string;
  roomId: string;
  name: string;
  /** request：依頼（工程の計算や収入の集計が付く）／generic：自由なデータベース */
  kind: "request" | "generic";
  /** 絵文字のアイコン */
  icon?: string;
  props: Property[];
  /** プラン名ごとの工程。ここに無いプランは default を使う */
  plans: Record<string, Stage[]>;
  order: number;
  createdAt: number;
  /** サイドバーでの置き場所：カテゴリー（無ければカテゴリーの外）と、その中の並び順 */
  categoryId?: string | null;
  navOrder?: number;
  /** ページのテンプレート（「追加」の横から選ぶ） */
  templates?: PageTemplate[];
  /** 「追加」で使うテンプレート（無ければテンプレートなし） */
  defaultTemplateId?: string | null;
  /** サイドバーでこのデータベースの下に出すページ：ビューの ID（そのビューのフィルター・並び順で出す）。null は出さない。
   * 無い（undefined）ときは、依頼なら終わっていない依頼を納期順、それ以外は出さない */
  sidebarViewId?: string | null;
  /** ページの名前の後ろに付ける言葉（例：「様」）。無いときは、依頼は「様」、ほかは付けない */
  nameSuffix?: string;
};

/** ページのテンプレート。note はスクロールする本文（ノート）、window は画面固定の本文（ウィンドウ） */
export type PageTemplate = {
  id: string;
  name: string;
  icon?: string;
  kind: "note" | "window";
  /** 作ったページの項目にはじめから入れる値 */
  values: Record<string, unknown>;
  /** 本文（ノートと同じブロック）。note 型はスクロール、window 型は画面固定で表示する */
  blocks?: unknown[];
  /** 前の window 型の並べ方（今はどちらの型も blocks を使う） */
  layout?: WinNode | null;
  createdAt: number;
  /** 最後に直した日時（繋いでいるページの表示を、新しい中身に入れ替えるのに使う） */
  updatedAt?: number;
};

export type DbPage = {
  id: string;
  dbId: string;
  roomId: string;
  title: string;
  /** 絵文字のアイコン */
  icon?: string;
  values: Record<string, unknown>;
  /** 依頼進行チャット */
  chatId: string | null;
  /** やり取り再現チャット */
  reenactChatId: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt?: number;
  /** 本文の形：note（無いときも）はノート、window は画面固定のウィンドウ。中身はどちらもページのノート（pageId） */
  bodyKind?: "note" | "window";
  /** ソースにしているテンプレート（このデータベースの templates）。あれば、本文はテンプレートの中身を出す（中のブロックは、このページの名前・項目・チャットを出す） */
  sourceId?: string | null;
  /** 前の window 型の並べ方（今はページのノートを使う） */
  layout?: WinNode | null;
};

export type ViewType = "table" | "board" | "list" | "gallery" | "progress" | "calendar" | "timeline" | "summary";
export type CalcType = "none" | "count" | "filled" | "empty" | "sum" | "avg" | "min" | "max";
export type FilterOp = "is" | "isNot" | "empty" | "notEmpty" | "contains" | "gt" | "lt";
export type Filter = { prop: string; op: FilterOp; value?: string };
export type DbView = {
  id: string;
  dbId: string;
  name: string;
  type: ViewType;
  filters: Filter[];
  sort: { prop: string; dir: "asc" | "desc" } | null;
  /** gauge：ゲージにする数値／date：期限に使う日付／stages：工程を自動で出す／sum：合計する数値 */
  options: {
    gauge?: string;
    date?: string;
    stages?: boolean;
    sum?: string;
    /** 表示する項目と順番（無ければすべて） */
    visible?: string[];
    /** ボードの列に使う項目（選択・ステータス） */
    group?: string;
    /** テーブルの列ごとの集計 */
    calc?: Record<string, CalcType>;
    /** ギャラリーの表紙に使うメディアの項目 */
    cover?: string;
    /** タイムラインの開始・終わりに使う日付の項目 */
    /** タイムライン・カレンダーに工程の期限を出すときの工程の項目 */
    stage?: string;
    /** カレンダーの期間：月（マンスリー）か週（ウィークリー）。無ければ月 */
    calendarRange?: "day" | "week" | "month" | "year";
    /** カレンダーの右上に「日・週・月・年」の切り替えボタンを出す（編集モードでなくても切り替えられる。切り替えはその場だけ） */
    calendarSwitch?: boolean;
    /** オールビューのブロックでの高さ（小・中・大）。無ければ中身に合わせる。入りきらない分は「すべて見る」から */
    size?: "s" | "m" | "l";
    /** 割合ビューのゲージの形 */
    gaugeStyle?: "line" | "circle";
    /** テーブルの向き：横一列（ふつうの表）か、縦一列（ページごとのカード） */
    layout?: "horizontal" | "vertical";
    /** テーブルの列の幅（項目の ID、縦一列ではページの ID と "__label"） */
    widths?: Record<string, number>;
    start?: string;
    end?: string;
  };
  order: number;
};

/** カレンダーに自分で入れた予定（依頼工程を選んだときは pageId が付く） */
export type CalEvent = { id: string; roomId: string; date: string; text: string; pageId: string | null; createdAt: number };
export type Todo = { id: string; roomId: string; text: string; done: boolean; createdAt: number };

/** ノート（ブロック式のページ）。blocks はエディタ（BlockNote）の中身をそのまま保存する */
export type Note = {
  id: string;
  roomId: string;
  title: string;
  /** アイコン（絵文字・メディアの画像・シンプルなアイコン）。無ければ種類のアイコン */
  icon?: string;
  blocks: unknown[];
  /** 依頼ページのメモのときは、その依頼の ID。サイドバーには出さない */
  pageId: string | null;
  order: number;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  /** サイドバーでの置き場所：カテゴリー（無ければカテゴリーの外）と、その中の並び順 */
  categoryId?: string | null;
  navOrder?: number;
  /** ルームのテンプレート（ウィンドウ・ノートの「ソース」に選べる。サイドバーには出さない） */
  template?: boolean;
  /** ソースにしているテンプレート。あれば、テンプレートの中身を出す（自分の blocks は使わない） */
  sourceId?: string | null;
  /** テンプレートの中のチャットのブロック（ID）→ このチャンネル用のチャット。チャットは使う先ごとに別 */
  chatMap?: Record<string, string>;
};

/** サイドバーのカテゴリー（Discord のカテゴリーと同じ）。中にデータベース・チャット・ノートのチャンネルが入る */
export type Category = { id: string; roomId: string; name: string; order: number; createdAt: number };

/** イメージチャットで使う「イメージユーザー」。ルームの誰でもどのブロックでも使える */
export type ImageUser = {
  id: string;
  roomId: string;
  name: string;
  /** 絵文字（icon）か、メディアの画像（mediaId） */
  icon?: string;
  mediaId?: string;
  createdAt: number;
};

/**
 * ブロックの種類。ノートのブロックとウィンドウの部品で同じものを使う。
 * text は見出し・箇条書きなどの文章（中身は blocks にノートと同じ形で持つ）。それ以外はノートのブロックの type と同じ
 */
export type BlockKind =
  | "text"
  | "mediaImage"
  | "dbView"
  | "singleView"
  | "chatBlock"
  | "imageChatBlock"
  // ホームなどで使う道具（ToDo・追加ボタン）
  | "todoBlock"
  | "addButton"
  // データベースのページの中で使う（そのページのタイトル・項目・チャット）
  | "pageTitle"
  | "pageProps"
  | "pageChat";

/** ウィンドウの部品の中身1つ分（タブ1つ）。props はノートのブロックの props と同じ */
export type WindowTab = { id: string; type: BlockKind; props: Record<string, string>; blocks?: unknown[] };

/** 前のマス目の配置で使っていた部品（作り直しのためだけに残している） */
export type WindowItemType = "text" | "image" | "chat" | "imageChat" | "single" | "all";
type OldTab = { id: string; type: WindowItemType; props: Record<string, string> };
export type WindowItem = OldTab & { x: number; y: number; w: number; h: number; tabs?: OldTab[]; active?: string };

/** ウィンドウの部品（タブの入れ物）。並び方の木の葉 */
/** fit：上下に並べたときに、高さを中身に合わせる（無いときはブロックの種類で決まる） */
export type WinLeaf = { kind: "leaf"; id: string; tabs: WindowTab[]; active?: string; fit?: boolean };
/** 左右（row）か上下（col）に分けたところ。sizes は子の比率（合計1） */
export type WinSplit = { kind: "split"; id: string; dir: "row" | "col"; children: WinNode[]; sizes: number[] };
export type WinNode = WinLeaf | WinSplit;
export const WINDOW_COLS = 24;
export const WINDOW_ROWS = 16;

/** ウィンドウ（画面サイズに固定したページ）。編集モードで部品を並べる */
export type WindowPage = {
  id: string;
  roomId: string;
  name: string;
  /** アイコン（絵文字・メディアの画像・シンプルなアイコン）。無ければ種類のアイコン */
  icon?: string;
  /** 後ろにあるものほど前面に出る */
  /** 前のマス目の配置（今は layout を使う） */
  items: WindowItem[];
  /** 前の並べ方（今は blocks を使う） */
  layout?: WinNode | null;
  /** 中身。ノートと同じブロック（BlockNote の形） */
  blocks?: unknown[];
  order: number;
  createdAt: number;
  updatedAt: number;
  categoryId?: string | null;
  navOrder?: number;
  /** ルームのホーム（サイドバーの「ホーム」で開く。チャンネルの一覧には出さない） */
  /** 前のルームのホーム（v23 で消した。今は使わない） */
  home?: boolean;
  /** 区画（チャット・オールビューなど、高さを分け合うブロック）の高さの割合。ブロックの ID ごと。無ければ 1 */
  heights?: Record<string, number>;
  /** ルームのテンプレート（ウィンドウ・ノートの「ソース」に選べる。サイドバーには出さない） */
  template?: boolean;
  /** ソースにしているテンプレート。あれば、テンプレートの中身を出す（自分の blocks は使わない） */
  sourceId?: string | null;
  /** テンプレートの中のチャットのブロック（ID）→ このチャンネル用のチャット。チャットは使う先ごとに別 */
  chatMap?: Record<string, string>;
};

export const db = new Dexie("irai-note") as Dexie & {
  profiles: EntityTable<Profile, "id">;
  rooms: EntityTable<Room, "id">;
  roomMembers: Table<RoomMember, [string, string]>;
  media: EntityTable<Media, "id">;
  mediaBlobs: EntityTable<MediaBlob, "id">;
  libraries: EntityTable<Library, "id">;
  chats: EntityTable<Chat, "id">;
  messages: EntityTable<Message, "id">;
  chatReads: Table<ChatRead, [string, string]>;
  databases: EntityTable<Database, "id">;
  dbPages: EntityTable<DbPage, "id">;
  dbViews: EntityTable<DbView, "id">;
  events: EntityTable<CalEvent, "id">;
  todos: EntityTable<Todo, "id">;
  notes: EntityTable<Note, "id">;
  categories: EntityTable<Category, "id">;
  imageUsers: EntityTable<ImageUser, "id">;
  windows: EntityTable<WindowPage, "id">;
  friendships: EntityTable<Friendship, "id">;
  mediaBoxes: EntityTable<MediaBox, "id">;
  boxShares: EntityTable<BoxShare, "id">;
};

db.version(1).stores({
  profiles: "id, createdAt",
  rooms: "id, createdAt",
  roomMembers: "[roomId+userId], roomId, userId",
});

db.version(2).stores({
  media: "id, roomId, *libIds",
  mediaBlobs: "id",
  libraries: "id, roomId, parentId",
});

db.version(3)
  .stores({
    chats: "id, roomId",
    messages: "id, roomId, [chatId+createdAt]",
    chatReads: "[chatId+userId], userId",
  })
  .upgrade(async (tx) => {
    // すでにあるルームにも、最初のチャット「雑談」を用意する
    const rooms = await tx.table("rooms").toArray();
    await tx.table("chats").bulkAdd(rooms.map((r: Room) => defaultChat(r.id)));
  });

db.version(4)
  .stores({
    databases: "id, roomId",
    dbPages: "id, dbId, roomId",
    dbViews: "id, dbId",
    events: "id, roomId, pageId",
    todos: "id, roomId",
  })
  .upgrade(async (tx) => {
    // すでにあるルームにも、依頼データベースを用意する
    const rooms = await tx.table("rooms").toArray();
    for (const r of rooms as Room[]) {
      const { database, views } = requestDatabase(r.id);
      await tx.table("databases").add(database);
      await tx.table("dbViews").bulkAdd(views);
    }
  });

db.version(5).stores({
  notes: "id, roomId, pageId",
});

db.version(6)
  .stores({ categories: "id, roomId" })
  .upgrade(async (tx) => {
    // これまでの「データベース」「チャット」「ノート」の見出しを、そのままカテゴリーにする
    const rooms = (await tx.table("rooms").toArray()) as Room[];
    for (const r of rooms) {
      const cats = defaultCategories(r.id);
      await tx.table("categories").bulkAdd(cats);
      const assign = async (table: string, cat: Category, filter: (x: { roomId: string; pageId?: string | null }) => boolean) => {
        const rows = (await tx.table(table).where("roomId").equals(r.id).toArray()).filter(filter) as { id: string; createdAt: number }[];
        rows.sort((a, b) => a.createdAt - b.createdAt);
        for (const [i, row] of rows.entries()) await tx.table(table).update(row.id, { categoryId: cat.id, navOrder: i + 1 });
      };
      await assign("databases", cats[0], () => true);
      await assign("chats", cats[1], (c) => !c.pageId);
      await assign("notes", cats[2], (n) => !n.pageId);
    }
  });

db.version(8).stores({ imageUsers: "id, roomId" });
db.version(9).stores({ windows: "id, roomId" });
db.version(10)
  .stores({})
  .upgrade(async (tx) => {
    // マス目の配置を、上下・左右に分ける並び方に作り直す
    await tx
      .table("windows")
      .toCollection()
      .modify((w: WindowPage) => {
        if (w.layout === undefined) w.layout = fromGrid(w.items ?? []);
      });
  });
db.version(11)
  .stores({})
  .upgrade(async (tx) => {
    // 部品の種類を、ノートのブロックと同じ名前・形にそろえる
    await tx
      .table("windows")
      .toCollection()
      .modify((w: WindowPage) => {
        if (w.layout) w.layout = mapTabs(w.layout, toBlockTab);
      });
  });
db.version(12)
  .stores({})
  .upgrade(async (tx) => {
    // 依頼のデータベースに、今までの依頼ページと同じ並びのウィンドウ型テンプレートを用意して、追加の既定にする
    await tx
      .table("databases")
      .toCollection()
      .modify((d: Database) => {
        if (d.kind !== "request" || d.templates?.some((t) => t.name === "標準の依頼")) return;
        const t = standardRequestTemplate();
        d.templates = [...(d.templates ?? []), t];
        d.defaultTemplateId = t.id;
      });
  });
db.version(13)
  .stores({})
  .upgrade(async (tx) => {
    // 標準の依頼テンプレートの文章のタブに「メモ」の名前を付ける
    await tx
      .table("databases")
      .toCollection()
      .modify((d: Database) => {
        d.templates = d.templates?.map((t) =>
          t.name === "標準の依頼" && t.layout ? { ...t, layout: mapTabs(t.layout, (x) => (x.type === "text" && !x.props.title ? { ...x, props: { ...x.props, title: "メモ" } } : x)) } : t,
        );
      });
  });
db.version(14)
  .stores({})
  .upgrade(async (tx) => {
    // 標準の依頼テンプレートのやり取り再現を、イメージチャット（依頼者と参加者が最初から話す人）にする
    await tx
      .table("databases")
      .toCollection()
      .modify((d: Database) => {
        d.templates = d.templates?.map((t) =>
          t.name === "標準の依頼" && t.layout
            ? { ...t, layout: mapTabs(t.layout, (x) => (x.type === "pageChat" && x.props.which === "reenact" ? { ...x, type: "imageChatBlock", props: { seed: "page", title: "やり取り再現" } } : x)) }
            : t,
        );
      });
  });
db.version(15)
  .stores({})
  .upgrade(async (tx) => {
    // ノートとウィンドウを同じブロックの形にそろえる。前の並べ方（上下・左右に分けた木）は、ブロックの並び（左右は列）にする
    await tx
      .table("windows")
      .toCollection()
      .modify((w: WindowPage) => {
        if (!w.blocks) w.blocks = layoutToBlocks(w.layout);
        delete w.layout;
      });
    const now = Date.now();
    const dbs = (await tx.table("databases").toArray()) as Database[];
    for (const d of dbs) {
      // テンプレート：どちらの型も blocks。標準の依頼は、新しい中身にする
      const templates = d.templates?.map((t) => {
        const { layout, ...rest } = t;
        if (t.name === "標準の依頼" && t.kind === "window") return { ...rest, blocks: standardRequestBlocks() };
        return t.kind === "window" && layout !== undefined ? { ...rest, blocks: layoutToBlocks(layout) } : rest;
      });
      // 依頼：依頼進行チャット・やり取り再現を、チャットの項目にする
      let props = d.props;
      if (d.kind === "request") {
        if (!props.some((p) => p.id === "p_chat")) props = [...props, { id: "p_chat", name: "依頼進行チャット", type: "chat" }];
        if (!props.some((p) => p.id === "p_reenact")) props = [...props, { id: "p_reenact", name: "やり取り再現", type: "imageChat", seed: "page" }];
      }
      await tx.table("databases").update(d.id, { templates, props });

      const pages = (await tx.table("dbPages").where("dbId").equals(d.id).toArray()) as DbPage[];
      for (const page of pages) {
        const patch: Partial<DbPage> = {};
        // ウィンドウ型の本文は、ページのノート（ブロック）に移す
        if (page.bodyKind === "window" && page.layout !== undefined) {
          await tx.table("notes").add({ id: newId(), roomId: page.roomId, title: page.title, blocks: layoutToBlocks(page.layout), pageId: page.id, order: 0, createdAt: now, updatedAt: now, updatedBy: page.createdBy });
          patch.layout = undefined;
        }
        if (d.kind === "request") {
          patch.values = { ...page.values, ...(page.chatId ? { p_chat: page.chatId } : {}), ...(page.reenactChatId ? { p_reenact: page.reenactChatId } : {}) };
          // 前のやり取り再現（話者の名前だけ）を、イメージチャットにする。依頼者・自分は、最初から入っている話す人に
          const chat = page.reenactChatId ? ((await tx.table("chats").get(page.reenactChatId)) as Chat | undefined) : undefined;
          if (chat && chat.kind === "reenact") {
            await tx.table("chats").update(chat.id, { kind: "image" });
            const msgs = (await tx.table("messages").filter((x: Message) => x.chatId === chat.id).toArray()) as Message[];
            for (const m of msgs) {
              let speaker: string | null = m.speaker;
              if (m.speaker === "依頼者" || m.speaker === null) speaker = "@page";
              else if (m.speaker === "自分") speaker = `@user:${m.authorId}`;
              else {
                // ほかの話者は、同じ名前のイメージユーザー（無ければ作る）
                const users = (await tx.table("imageUsers").where("roomId").equals(page.roomId).toArray()) as ImageUser[];
                let u = users.find((x) => x.name === m.speaker);
                if (!u) {
                  u = { id: newId(), roomId: page.roomId, name: m.speaker, createdAt: now };
                  await tx.table("imageUsers").add(u);
                }
                speaker = u.id;
              }
              await tx.table("messages").update(m.id, { speaker });
            }
          }
        }
        if (Object.keys(patch).length) await tx.table("dbPages").update(page.id, patch);
      }
    }
  });
db.version(16)
  .stores({})
  .upgrade(async (tx) => {
    // 今ある依頼を、標準の依頼と同じウィンドウの形にする。前のメモに書いてあったものは、下に「メモ」として残す
    const now = Date.now();
    const dbs = ((await tx.table("databases").toArray()) as Database[]).filter((d) => d.kind === "request");
    for (const d of dbs) {
      const pages = ((await tx.table("dbPages").where("dbId").equals(d.id).toArray()) as DbPage[]).filter((p) => p.bodyKind !== "window");
      for (const page of pages) {
        const note = (await tx.table("notes").where("pageId").equals(page.id).first()) as Note | undefined;
        const memo = (note?.blocks ?? []).filter((b) => {
          const x = b as { type?: string; content?: unknown[] };
          return !(x.type === "paragraph" && !x.content?.length);
        });
        const blocks = [...standardRequestBlocks(), ...(memo.length ? [{ type: "heading", props: { level: 3 }, content: "メモ" }, ...memo] : [])];
        if (note) await tx.table("notes").update(note.id, { blocks, updatedAt: now });
        else await tx.table("notes").add({ id: newId(), roomId: page.roomId, title: page.title, blocks, pageId: page.id, order: 0, createdAt: now, updatedAt: now, updatedBy: page.createdBy });
        await tx.table("dbPages").update(page.id, { bodyKind: "window" });
      }
    }
  });
db.version(17)
  .stores({})
  .upgrade(async (tx) => {
    // 「ページの項目（1つ）」を、その項目だけを出す「ページの項目」にまとめる（ノート・ウィンドウ・ページの本文・テンプレート）
    await tx
      .table("notes")
      .toCollection()
      .modify((n: Note) => {
        if (!n.blocks) return;
        const blocks = mergePageProp(n.blocks);
        if (blocks !== n.blocks) n.blocks = blocks;
      });
    await tx
      .table("windows")
      .toCollection()
      .modify((w: WindowPage) => {
        if (!w.blocks) return;
        const blocks = mergePageProp(w.blocks);
        if (blocks !== w.blocks) w.blocks = blocks;
      });
    await tx
      .table("databases")
      .toCollection()
      .modify((d: Database) => {
        if (!d.templates?.some((t) => t.blocks && mergePageProp(t.blocks) !== t.blocks)) return;
        d.templates = d.templates.map((t) => (t.blocks ? { ...t, blocks: mergePageProp(t.blocks) } : t));
      });
  });

db.version(18)
  .stores({})
  .upgrade(async (tx) => {
    // 「進み具合と工程」のブロックをなくして、同じ見た目のシングルビューにする（シングルビューで同じものが作れるようになったので）
    const dbs = (await tx.table("databases").toArray()) as Database[];
    // データベースごとの、工程・進行・納期・ステータスの項目
    const idsOf = (d: Database | undefined) => {
      const has = (id: string) => (d?.props.some((p) => p.id === id) ? id : undefined);
      return { stage: d?.props.find((p) => p.type === "stage")?.id, progress: has("p_prog"), due: has("p_due"), status: has("p_status") };
    };
    const pages = (await tx.table("dbPages").toArray()) as DbPage[];
    await tx
      .table("notes")
      .toCollection()
      .modify((n: Note) => {
        if (!n.blocks) return;
        const page = n.pageId ? pages.find((p) => p.id === n.pageId) : undefined;
        const blocks = replaceProgress(n.blocks, idsOf(dbs.find((d) => d.id === page?.dbId)));
        if (blocks !== n.blocks) n.blocks = blocks;
      });
    await tx
      .table("windows")
      .toCollection()
      .modify((w: WindowPage) => {
        if (!w.blocks) return;
        const blocks = replaceProgress(w.blocks, {});
        if (blocks !== w.blocks) w.blocks = blocks;
      });
    await tx
      .table("databases")
      .toCollection()
      .modify((d: Database) => {
        if (!d.templates?.some((t) => t.blocks && replaceProgress(t.blocks, {}) !== t.blocks)) return;
        d.templates = d.templates.map((t) => (t.blocks ? { ...t, blocks: replaceProgress(t.blocks, idsOf(d)) } : t));
      });
  });

db.version(19)
  .stores({})
  .upgrade(async (tx) => {
    // オールビューで「ビューを選ばない」は、このブロックだけのビューになった。
    // 前に選んでいなかったもの（最初のデータベースの最初のビューを出していた）は、そのデータベースとビューを選んだ形にして、見た目を変えない
    const dbs = ((await tx.table("databases").toArray()) as Database[]).sort((a, b) => a.order - b.order);
    const views = ((await tx.table("dbViews").toArray()) as DbView[]).sort((a, b) => a.order - b.order);
    const fix = (blocks: unknown[], roomId: string): unknown[] => {
      let changed = false;
      type B = { type?: string; props?: Record<string, string>; children?: B[] };
      const walk = (list: B[]): B[] =>
        list.map((b) => {
          let next = b;
          if (b.type === "dbView" && !b.props?.viewId) {
            const database = dbs.find((x) => x.id === b.props?.dbId) ?? dbs.find((x) => x.roomId === roomId);
            const view = database && views.find((x) => x.dbId === database.id);
            if (database && view) {
              changed = true;
              next = { ...b, props: { ...b.props, dbId: database.id, viewId: view.id } };
            }
          }
          return next.children?.length ? { ...next, children: walk(next.children) } : next;
        });
      const out = walk(blocks as B[]);
      return changed ? out : blocks;
    };
    await tx
      .table("notes")
      .toCollection()
      .modify((n: Note) => {
        if (!n.blocks) return;
        const blocks = fix(n.blocks, n.roomId);
        if (blocks !== n.blocks) n.blocks = blocks;
      });
    await tx
      .table("windows")
      .toCollection()
      .modify((w: WindowPage) => {
        if (!w.blocks) return;
        const blocks = fix(w.blocks, w.roomId);
        if (blocks !== w.blocks) w.blocks = blocks;
      });
    await tx
      .table("databases")
      .toCollection()
      .modify((d: Database) => {
        if (!d.templates?.some((t) => t.blocks && fix(t.blocks, d.roomId) !== t.blocks)) return;
        d.templates = d.templates.map((t) => (t.blocks ? { ...t, blocks: fix(t.blocks, d.roomId) } : t));
      });
  });

db.version(20)
  .stores({})
  .upgrade(async (tx) => {
    // オールビューを Notion のリンクされたビューと同じにする：ビューはブロックが持つ（views）。
    // データベースのビューにつないでいたものはそのビューをコピーし、このブロックだけのビュー（own）はそのまま移す
    const views = (await tx.table("dbViews").toArray()) as DbView[];
    const fix = (blocks: unknown[]): unknown[] => {
      let changed = false;
      type B = { type?: string; props?: Record<string, string>; children?: B[] };
      const walk = (list: B[]): B[] =>
        list.map((b) => {
          let next = b;
          if (b.type === "dbView" && b.props && b.props.views === undefined) {
            changed = true;
            const { viewId, own, ...rest } = b.props;
            const linked = views.find((x) => x.id === viewId);
            let parsed: Partial<DbView> = {};
            try {
              parsed = JSON.parse(own || "{}");
            } catch {
              parsed = {};
            }
            const view = linked
              ? copyView(linked)
              : own
                ? copyView({ name: parsed.name || "表", type: parsed.type ?? "table", filters: parsed.filters ?? [], sort: parsed.sort ?? null, options: parsed.options ?? {} })
                : null;
            next = { ...b, props: { ...rest, views: view ? JSON.stringify([view]) : "", active: view?.id ?? "" } };
          }
          return next.children?.length ? { ...next, children: walk(next.children) } : next;
        });
      const out = walk(blocks as B[]);
      return changed ? out : blocks;
    };
    await tx
      .table("notes")
      .toCollection()
      .modify((n: Note) => {
        if (!n.blocks) return;
        const blocks = fix(n.blocks);
        if (blocks !== n.blocks) n.blocks = blocks;
      });
    await tx
      .table("windows")
      .toCollection()
      .modify((w: WindowPage) => {
        if (!w.blocks) return;
        const blocks = fix(w.blocks);
        if (blocks !== w.blocks) w.blocks = blocks;
      });
    await tx
      .table("databases")
      .toCollection()
      .modify((d: Database) => {
        if (!d.templates?.some((t) => t.blocks && fix(t.blocks) !== t.blocks)) return;
        d.templates = d.templates.map((t) => (t.blocks ? { ...t, blocks: fix(t.blocks) } : t));
      });
  });

db.version(7)
  .stores({})
  .upgrade(async (tx) => {
    // 依頼データベースの「プランと工程」を、新しい「工程」の項目に移す
    const dbs = (await tx.table("databases").toArray()) as Database[];
    for (const d of dbs) {
      if (d.kind !== "request" || d.props.some((p) => p.type === "stage")) continue;
      const planProp = d.props.find((p) => p.id === "p_plan");
      const stages: Record<string, StageStep[]> = {};
      for (const opt of planProp?.options ?? []) {
        const list = d.plans[opt] ?? REQUEST_DEFAULT_STAGES;
        stages[opt] = list.map((x) => ({ name: x.name, pct: Math.round(x.ratio * 100) }));
      }
      const stageProp: Property = { id: "p_stage", name: "工程", type: "stage", basedOn: "p_plan", stages };
      const props = [...d.props];
      const at = props.findIndex((p) => p.id === "p_prog");
      props.splice(at < 0 ? props.length : at, 0, stageProp);
      await tx.table("databases").update(d.id, { props });
      // 各依頼の今の工程は、進行の％から決める（その％までに終わっている一番後ろの工程）
      const pages = (await tx.table("dbPages").where("dbId").equals(d.id).toArray()) as DbPage[];
      for (const pg of pages) {
        const list = stages[String(pg.values["p_plan"] ?? "")] ?? REQUEST_DEFAULT_STAGES.map((x) => ({ name: x.name, pct: Math.round(x.ratio * 100) }));
        const prog = Number(pg.values["p_prog"]) || 0;
        const done = list.filter((x) => x.pct <= prog).at(-1);
        if (done) await tx.table("dbPages").update(pg.id, { values: { ...pg.values, p_stage: done.name } });
      }
      // ビューも工程の項目を使う
      const views = (await tx.table("dbViews").where("dbId").equals(d.id).toArray()) as DbView[];
      for (const v of views) {
        if (v.type === "timeline" || v.type === "calendar") await tx.table("dbViews").update(v.id, { options: { ...v.options, stage: v.options.stages ? "p_stage" : undefined } });
        if (v.type === "list" && v.options.gauge) await tx.table("dbViews").update(v.id, { options: { ...v.options, gauge: "p_stage" } });
      }
    }
  });

export function defaultCategories(roomId: string): Category[] {
  const now = Date.now();
  return ["データベース", "チャット", "ノート"].map((name, i) => ({ id: newId(), roomId, name, order: i + 1, createdAt: now + i }));
}

/** 新しいルームの最初の中身：カテゴリー3つ、依頼データベース、チャット「雑談」 */
export function defaultRoomContents(roomId: string) {
  const categories = defaultCategories(roomId);
  const { database, views } = requestDatabase(roomId);
  return {
    categories,
    database: { ...database, categoryId: categories[0].id, navOrder: 1 },
    views,
    chat: { ...defaultChat(roomId), categoryId: categories[1].id, navOrder: 1 },
  };
}

/** アカウントごとに1つの「マイメディア」 */
export function newMyMediaBox(userId: string, now = Date.now()): MediaBox {
  return { id: newId(), ownerId: userId, name: "マイメディア", kind: "mine", createdAt: now };
}

/** ルームのメディアにするボックスと、ルームとの紐づけ（メンバーは編集もできる）。持ち主はルームを作った人 */
export function newRoomMediaBox(room: Pick<Room, "id" | "name" | "createdBy">, now = Date.now()) {
  const box: MediaBox = { id: newId(), ownerId: room.createdBy, name: `${room.name}のメディア`, kind: "box", createdAt: now };
  const share: BoxShare = { id: newId(), boxId: box.id, roomId: room.id, canEdit: true, createdAt: now };
  return { box, share };
}

export function defaultChat(roomId: string): Chat {
  return { id: newId(), roomId, name: "雑談", kind: "normal", order: 1, createdAt: Date.now() };
}

// 初回起動時に、2人（マネージャー・イラストレーター）と最初のルームを用意する
db.on("populate", (tx) => {
  const now = Date.now();
  const manager = newId();
  const illustrator = newId();
  const room = newId();
  tx.table("profiles").bulkAdd([
    { id: manager, displayName: "マネージャー", createdAt: now },
    { id: illustrator, displayName: "イラストレーター", createdAt: now + 1 },
  ]);
  tx.table("rooms").add({ id: room, name: "依頼ノート", createdBy: manager, createdAt: now });
  tx.table("mediaBoxes").bulkAdd([newMyMediaBox(manager, now), newMyMediaBox(illustrator, now)]);
  const roomMedia = newRoomMediaBox({ id: room, name: "依頼ノート", createdBy: manager }, now);
  tx.table("mediaBoxes").add(roomMedia.box);
  tx.table("boxShares").add(roomMedia.share);
  tx.table("roomMembers").bulkAdd([
    { roomId: room, userId: manager, role: "host", joinedAt: now },
    { roomId: room, userId: illustrator, role: "member", joinedAt: now + 1 },
  ]);
  const c = defaultRoomContents(room);
  tx.table("categories").bulkAdd(c.categories);
  tx.table("chats").add(c.chat);
  tx.table("databases").add(c.database);
  tx.table("dbViews").bulkAdd(c.views);
});

// 開発中だけ、ブラウザのコンソールから中身を確かめられるようにする
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  (window as unknown as { __db: typeof db }).__db = db;
  // 古い形のデータで、作り替え（移し替え）を試せるようにする
  (window as unknown as { __migrations: object }).__migrations = { moveMediaToBoxes };
}

db.version(21)
  .stores({})
  .upgrade(async (tx) => {
    // 依頼以外のデータベースにも「チャット」の項目を持たせ、ページの「コメント」（page.chatId）をその項目に入れる。
    // 使われていなかった古い「やり取り再現」（発言なし）は消す
    const dbs = (await tx.table("databases").toArray()) as Database[];
    for (const d of dbs) {
      if (d.kind === "request") continue;
      let chat = d.props.find((p) => p.type === "chat");
      if (!chat) {
        const ids = new Set(d.props.map((p) => p.id));
        let id = "p_chat";
        for (let i = 2; ids.has(id); i++) id = `p_chat${i}`;
        chat = { id, name: "チャット", type: "chat" };
        await tx.table("databases").update(d.id, { props: [...d.props, chat] });
      }
      const hasImage = d.props.some((p) => p.type === "imageChat");
      const pages = (await tx.table("dbPages").where("dbId").equals(d.id).toArray()) as DbPage[];
      for (const p of pages) {
        const patch: Partial<DbPage> = {};
        if (p.chatId && typeof p.values[chat.id] !== "string") patch.values = { ...p.values, [chat.id]: p.chatId };
        if (p.reenactChatId && !hasImage) {
          const used = await tx.table("messages").filter((m: Message) => m.chatId === p.reenactChatId).count();
          if (!used) {
            await tx.table("chats").delete(p.reenactChatId);
            patch.reenactChatId = null;
          }
        }
        if (Object.keys(patch).length) await tx.table("dbPages").update(p.id, patch);
      }
    }
  });

db.version(22)
  .stores({})
  .upgrade(async (tx) => {
    // ノート型のテンプレートは「同じブロックを入れるだけ」にしたので、繋いでいたページはテンプレートの中身をコピーして切り離す
    const fresh = (blocks: unknown[] | undefined): unknown[] =>
      (blocks ?? []).map((b) => {
        const block = b as { props?: Record<string, unknown>; children?: unknown[] };
        const props = block.props && "chatId" in block.props ? { ...block.props, chatId: "" } : block.props;
        return { ...block, ...(props ? { props } : {}), ...(block.children ? { children: fresh(block.children) } : {}) };
      });
    const dbs = (await tx.table("databases").toArray()) as Database[];
    const now = Date.now();
    for (const d of dbs) {
      const notes = new Map((d.templates ?? []).filter((t) => t.kind === "note").map((t) => [t.id, t]));
      if (!notes.size) continue;
      const pages = (await tx.table("dbPages").where("dbId").equals(d.id).toArray()) as DbPage[];
      for (const p of pages) {
        const t = p.sourceId ? notes.get(p.sourceId) : undefined;
        if (!t) continue;
        const blocks = fresh(t.blocks);
        const note = (await tx.table("notes").where("pageId").equals(p.id).first()) as Note | undefined;
        if (note) await tx.table("notes").update(note.id, { blocks, updatedAt: now });
        else await tx.table("notes").add({ id: newId(), roomId: p.roomId, title: p.title, blocks, pageId: p.id, order: 0, createdAt: now, updatedAt: now, updatedBy: p.createdBy });
        await tx.table("dbPages").update(p.id, { sourceId: null, bodyKind: "note" });
      }
    }
  });

db.version(23)
  .stores({})
  .upgrade(async (tx) => {
    // ホームは無くした（ウィンドウのチャンネルで同じものが作れるため）。ホームのウィンドウと、その中のチャットを消す
    const homes = (await tx.table("windows").toArray()).filter((w: WindowPage) => w.home) as WindowPage[];
    for (const h of homes) {
      const chats = (await tx.table("chats").filter((c: Chat) => c.pageId === `window:${h.id}`).toArray()) as Chat[];
      const ids = chats.map((c) => c.id);
      if (ids.length) {
        await tx.table("messages").filter((m: Message) => ids.includes(m.chatId)).delete();
        await tx.table("chats").bulkDelete(ids);
      }
      await tx.table("windows").delete(h.id);
    }
  });

db.version(24)
  .stores({})
  .upgrade(async (tx) => {
    // v23 で消したホームを、ふつうのウィンドウのチャンネル「ホーム」として作り直す（前のホームの最初の中身。カテゴリーの外の一番上）
    const rooms = (await tx.table("rooms").toArray()) as { id: string }[];
    const now = Date.now();
    for (const room of rooms) {
      const database = ((await tx.table("databases").where("roomId").equals(room.id).toArray()) as Database[]).find((x) => x.kind === "request");
      const views = database ? ((await tx.table("dbViews").where("dbId").equals(database.id).toArray()) as DbView[]).sort((a, b) => a.order - b.order) : [];
      const pick = (type: string) => views.find((v) => v.type === type);
      const home: WindowPage = {
        id: newId(),
        roomId: room.id,
        name: "ホーム",
        items: [],
        blocks: homeBlocks(database?.id, { list: pick("list"), summary: pick("summary"), timeline: pick("timeline"), calendar: pick("calendar") }),
        order: 0,
        createdAt: now,
        updatedAt: now,
        categoryId: null,
        navOrder: 0,
      };
      await tx.table("windows").add(home);
    }
  });

db.version(25)
  .stores({})
  .upgrade(async (tx) => {
    // 「名前の後ろに付ける言葉」の既定を種類で変えるのをやめる。今まで既定の「様」だった依頼のデータベースには、設定として「様」を入れておく
    await tx
      .table("databases")
      .filter((d: Database) => d.kind === "request" && d.nameSuffix === undefined)
      .modify({ nameSuffix: "様" });
  });

// フレンドと、ダイレクトメッセージ（チャットの dm で、自分の DM を探せるようにする）
db.version(26).stores({
  friendships: "id, fromId, toId",
  chats: "id, roomId, *dm",
});

/**
 * メディアをルームから切り離し、持ち主のいる「メディアボックス」に入れる（v27）。
 * 一人ひとりにマイメディアを作り、ルームの画像とライブラリーは「（ルーム名）のメディア」に移して、そのルームに紐づける
 */
async function moveMediaToBoxes(tx: Transaction) {
  const now = Date.now();
  const mine = new Map<string, string>();
  for (const p of (await tx.table("profiles").toArray()) as Profile[]) {
    const box = newMyMediaBox(p.id, now);
    await tx.table("mediaBoxes").add(box);
    mine.set(p.id, box.id);
  }
  const roomBox = new Map<string, string>();
  for (const r of (await tx.table("rooms").toArray()) as Room[]) {
    const { box, share } = newRoomMediaBox(r, now);
    await tx.table("mediaBoxes").add(box);
    await tx.table("boxShares").add(share);
    roomBox.set(r.id, box.id);
  }
  type Old = { roomId?: string; boxId?: string };
  // ルームが無くなっていた画像は、入れた人のマイメディアへ（ライブラリーからは外す）
  await tx
    .table("media")
    .toCollection()
    .modify((m: Media & Old) => {
      const box = roomBox.get(m.roomId ?? "");
      m.boxId = box ?? mine.get(m.uploadedBy) ?? "";
      if (!box) m.libIds = [];
      delete m.roomId;
    });
  // ルームが無くなっていたライブラリーは消す
  const libs = (await tx.table("libraries").toArray()) as (Library & Old)[];
  await tx.table("libraries").bulkDelete(libs.filter((l) => !roomBox.has(l.roomId ?? "")).map((l) => l.id));
  await tx
    .table("libraries")
    .toCollection()
    .modify((l: Library & Old) => {
      l.boxId = roomBox.get(l.roomId ?? "")!;
      delete l.roomId;
    });
}

db.version(27)
  .stores({
    mediaBoxes: "id, ownerId",
    boxShares: "id, boxId, userId, roomId",
    media: "id, boxId, *libIds",
    libraries: "id, boxId, parentId",
  })
  .upgrade(moveMediaToBoxes);
