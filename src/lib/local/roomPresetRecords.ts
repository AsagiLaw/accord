import { newId } from "@/lib/id";
import roomPreset from "@/lib/requests/roomPreset.json";
import type { Category, Chat, Database, DbView, WindowPage } from "./db";

// ルームを作る（rooms.ts）ときと、初回起動で最初のルームを用意する（db.ts）ときの両方で使う。
// db.ts から読み込むので、ここでは db を読み込まない（型だけ）

/**
 * 「依頼管理」で作るルームの中身（roomPreset.json：見本のルームから写したもの）。ID は全部新しくして、中の繋がり（ブロックの dbId など）も付け替える。
 * データのページ・チャットの会話・カレンダーの予定は入れない（カレンダーやチャットは、はじめて出したときに新しくできる）
 */
export function presetRecords(roomId: string, now: number) {
  type Preset = { categories: Category[]; databases: Database[]; views: DbView[]; chats: Chat[]; windows: WindowPage[] };
  const src = roomPreset as unknown as Preset;
  let text = JSON.stringify(src);
  const ids = [
    ...src.categories.map((x) => x.id),
    ...src.databases.flatMap((d) => [d.id, ...(d.templates ?? []).map((t) => t.id)]),
    ...src.views.map((x) => x.id),
    ...src.chats.map((x) => x.id),
    ...src.windows.map((x) => x.id),
  ];
  for (const old of ids) text = text.split(old).join(newId());
  const out = JSON.parse(text) as Preset;
  return {
    categories: out.categories.map((c) => ({ ...c, roomId, createdAt: now })),
    databases: out.databases.map((d) => ({ ...d, roomId, createdAt: now, templates: d.templates?.map((t) => ({ ...t, createdAt: now, updatedAt: undefined })) })),
    views: out.views,
    chats: out.chats.map((c) => ({ ...c, roomId, createdAt: now })),
    windows: out.windows.map((w) => ({ ...w, roomId, createdAt: now, updatedAt: now, items: [] })),
  };
}

