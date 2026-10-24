"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db, newId, type Note, type WindowPage } from "./db";

/**
 * ウィンドウ・ノートのテンプレート（ルームに置く）。チャンネルは「ソース」にテンプレートを選ぶと、テンプレートの中身を出す。
 * テンプレートを直すと、繋いでいるチャンネル全部に出る。チャットは使う先（チャンネル）ごとに別（chatMap に、テンプレートのブロック → このチャンネルのチャット）。
 * ウィンドウの、固定していない文章も使う先ごとに別（textMap に、テンプレートのブロック → このウィンドウの中身。直していないブロックはテンプレートのまま）
 */
export type TemplateKind = "window" | "note";
export type ChannelTemplate = { id: string; kind: TemplateKind; name: string; uses: number; createdAt: number };
export type TextMap = NonNullable<WindowPage["textMap"]>;

type Block = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: Block[] };
type Rec = (WindowPage | Note) & { blocks?: unknown[]; heights?: Record<string, number>; textOptions?: WindowPage["textOptions"]; textMap?: TextMap };

/** テンプレートの中身に、このウィンドウの文章を重ねる（列・タブの中も）。固定した文章と、文章でなくなったブロックはテンプレートのまま */
export function applyTextMap(blocks: unknown[], textMap: TextMap = {}, textOptions: WindowPage["textOptions"] = {}): unknown[] {
  return (blocks as Block[]).map((b) => {
    const own = b.id && !textOptions[b.id]?.lock && (Array.isArray(b.content) || typeof b.content === "string") ? textMap[b.id] : undefined;
    const next = own ? { ...b, ...own } : b;
    return next.children?.length ? { ...next, children: applyTextMap(next.children, textMap, textOptions) as Block[] } : next;
  });
}
const CHAT_TYPES = new Set(["chatBlock", "imageChatBlock"]);

/** ブロックを全部たどって（列・タブの中も）、チャットのブロックだけ直す */
function mapChats(blocks: unknown[], fn: (b: Block) => Block): unknown[] {
  return (blocks as Block[]).map((b) => {
    const next = CHAT_TYPES.has(b.type ?? "") ? fn(b) : b;
    return next.children?.length ? { ...next, children: mapChats(next.children, fn) as Block[] } : next;
  });
}

/** テンプレートの中身にするとき：チャットの ID を外す（使う先ごとに作る）。外した ID は、元のチャンネルで使い続けるので返す */
function stripChats(blocks: unknown[]) {
  const chatMap: Record<string, string> = {};
  const out = mapChats(blocks, (b) => {
    const id = String(b.props?.chatId ?? "");
    if (id && b.id) chatMap[b.id] = id;
    return { ...b, props: { ...b.props, chatId: "" } };
  });
  return { blocks: out, chatMap };
}

/** テンプレートから切り離すとき：このチャンネルのチャットを、ブロックに入れて戻す */
const applyChats = (blocks: unknown[], chatMap: Record<string, string> = {}) => mapChats(blocks, (b) => ({ ...b, props: { ...b.props, chatId: (b.id && chatMap[b.id]) || "" } }));

const get = async (kind: TemplateKind, id: string): Promise<Rec | undefined> => (kind === "window" ? db.windows.get(id) : db.notes.get(id));
const update = async (kind: TemplateKind, id: string, patch: Partial<WindowPage & Note>) => {
  if (kind === "window") await db.windows.update(id, patch as Partial<WindowPage>);
  else await db.notes.update(id, patch as Partial<Note>);
};

/** 今、画面に出ている中身（テンプレートと繋いでいれば、テンプレートの中身にこのチャンネルのチャットと文章を入れたもの） */
async function resolved(kind: TemplateKind, rec: Rec) {
  const src = rec.sourceId ? await get(kind, rec.sourceId) : undefined;
  if (src) return { blocks: applyTextMap(applyChats(src.blocks ?? [], rec.chatMap), rec.textMap, src.textOptions), heights: src.heights, textOptions: src.textOptions };
  return { blocks: rec.blocks ?? [], heights: rec.heights, textOptions: rec.textOptions };
}

/** ルームのテンプレート（ウィンドウとノート）と、それぞれを使っているチャンネルの数 */
export function useChannelTemplates(roomId: string) {
  return useLiveQuery(async () => {
    const [windows, notes] = await Promise.all([db.windows.where("roomId").equals(roomId).toArray(), db.notes.where("roomId").equals(roomId).toArray()]);
    const list: ChannelTemplate[] = [
      ...windows.filter((w) => w.template).map((w) => ({ id: w.id, kind: "window" as const, name: w.name, uses: windows.filter((u) => u.sourceId === w.id).length, createdAt: w.createdAt })),
      ...notes.filter((n) => n.template).map((n) => ({ id: n.id, kind: "note" as const, name: n.title, uses: notes.filter((u) => u.sourceId === n.id).length, createdAt: n.createdAt })),
    ];
    return list.sort((a, b) => a.createdAt - b.createdAt);
  }, [roomId]);
}

/** そのテンプレートを使っているチャンネルの数 */
export async function countTemplateUses(kind: TemplateKind, templateId: string) {
  return kind === "window" ? db.windows.filter((w) => w.sourceId === templateId).count() : db.notes.filter((n) => n.sourceId === templateId).count();
}

/** 今の中身から、新しいテンプレートを作って、このチャンネルをそれと繋ぐ（今の中身は消えずにテンプレートになる。チャットはこのチャンネルで使い続ける） */
export async function createTemplateFrom(kind: TemplateKind, channelId: string, name: string) {
  const rec = await get(kind, channelId);
  if (!rec) return;
  const { blocks, heights, textOptions } = await resolved(kind, rec);
  const { blocks: tBlocks, chatMap } = stripChats(blocks);
  const now = Date.now();
  const id = newId();
  if (kind === "window") await db.windows.add({ id, roomId: rec.roomId, name, items: [], blocks: tBlocks, heights, textOptions, order: 0, createdAt: now, updatedAt: now, template: true });
  else await db.notes.add({ id, roomId: rec.roomId, title: name, blocks: tBlocks, pageId: null, order: 0, createdAt: now, updatedAt: now, updatedBy: (rec as Note).updatedBy ?? "", template: true });
  await update(kind, channelId, { sourceId: id, chatMap, blocks: [], heights: undefined, textOptions: undefined, textMap: {}, updatedAt: now });
  return id;
}

/** テンプレートと繋ぐ。このチャンネルの前の中身は消えて、テンプレートの中身を出す */
export async function linkTemplate(kind: TemplateKind, channelId: string, templateId: string) {
  await update(kind, channelId, { sourceId: templateId, chatMap: {}, blocks: [], heights: undefined, textOptions: undefined, textMap: {}, updatedAt: Date.now() });
}

/** テンプレートから切り離す（「選択なし」「分けて編集」）。今出ている中身をコピーして、このチャンネルだけの中身にする */
export async function unlinkTemplate(kind: TemplateKind, channelId: string) {
  const rec = await get(kind, channelId);
  if (!rec?.sourceId) return;
  const { blocks, heights, textOptions } = await resolved(kind, rec);
  await update(kind, channelId, { sourceId: null, chatMap: {}, textMap: {}, blocks, heights, textOptions, updatedAt: Date.now() });
}

/** テンプレートの中のチャットのブロックに、このチャンネル用のチャットを結びつける */
export async function setLinkedChat(kind: TemplateKind, channelId: string, blockId: string, chatId: string) {
  const rec = await get(kind, channelId);
  if (rec) await update(kind, channelId, { chatMap: { ...rec.chatMap, [blockId]: chatId } });
}

export async function renameChannelTemplate(kind: TemplateKind, id: string, name: string) {
  await update(kind, id, kind === "window" ? { name } : { title: name });
}

/** テンプレートを消す。使っているチャンネルは、今の中身をコピーして切り離す（中身は消えない） */
export async function deleteChannelTemplate(kind: TemplateKind, id: string) {
  const users = kind === "window" ? await db.windows.filter((w) => w.sourceId === id).toArray() : await db.notes.filter((n) => n.sourceId === id).toArray();
  for (const u of users) await unlinkTemplate(kind, u.id);
  if (kind === "window") await db.windows.delete(id);
  else await db.notes.delete(id);
}
