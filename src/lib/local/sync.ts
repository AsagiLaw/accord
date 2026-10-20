"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import type { IndexableType, Table } from "dexie";
import { authMode } from "@/lib/auth/mode";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/ui/overlay";
import { db, type BoxShare, type Friendship, type MediaBox, type Presence, type Profile, type Room, type RoomInvite, type RoomMember, type WorkStatus } from "./db";
import { forgetBoxes, freshChannel, pullRows, startRowSync } from "./rowSync";

// Supabase 版：プロフィール・ルーム・メンバー・フレンド・招待は Supabase に保存し、ブラウザの中（IndexedDB）に写して使う。
// 画面は今までどおりブラウザの中を読む（useLiveQuery）。書き込みは Supabase に送ってから pull() で写し直す。
// ほかの人の変更は Realtime（0010）で知らせを受けて写し直す。届かないとき（プロフィールの変更など）のために、しばらくおきにも写す。
// プロフィールとルームは、変わった分だけを読む（アイコンの画像が大きいので、転送量を抑える：0011）。
// ルームの中のもの（チャットなど）は rowSync.ts で行ごとに写す

export const supa = authMode === "supabase";

let client: ReturnType<typeof createClient> | null = null;
export const sb = () => (client ??= createClient());

const ms = (t: string | null | undefined) => (t ? new Date(t).getTime() : undefined);
const iso = (t: number | null | undefined) => (t ? new Date(t).toISOString() : null);

type ProfileRow = {
  id: string;
  display_name: string;
  username: string;
  avatar: string | null;
  status_text: string | null;
  status_expires_at: string | null;
  presence: string;
  bio: string | null;
  links: Profile["links"] | null;
  work_status: string | null;
  created_at: string;
  updated_at: string;
};
type RoomRow = { id: string; name: string; icon: string | null; created_by: string; created_at: string; members_can_invite: boolean; updated_at: string };
type Stamp = { id: string; updated_at: string };
type MemberRow = { room_id: string; user_id: string; role: RoomMember["role"]; joined_at: string };
type FriendshipRow = { id: string; from_id: string; to_id: string; status: Friendship["status"]; created_at: string; responded_at: string | null };
type InviteRow = { id: string; room_id: string; from_id: string; to_id: string; created_at: string; expires_at: string; accepted_at: string | null };
type BoxRow = { id: string; owner_id: string; name: string; kind: MediaBox["kind"]; created_at: string };
type ShareRow = { id: string; box_id: string; user_id: string | null; room_id: string | null; can_edit: boolean; created_at: string };

function toProfile(r: ProfileRow): Profile {
  // ほかの人のオフライン表示は、窓口（profiles_public）では offline になる。ブラウザの中では、オフライン表示と同じ扱いにする
  const presence = (r.presence === "offline" ? "invisible" : r.presence) as Presence;
  return {
    id: r.id,
    displayName: r.display_name,
    username: r.username,
    createdAt: ms(r.created_at) ?? 0,
    ...(r.avatar ? { avatar: r.avatar } : {}),
    ...(r.status_text ? { statusText: r.status_text } : {}),
    ...(r.status_expires_at ? { statusExpiresAt: ms(r.status_expires_at) } : {}),
    ...(presence !== "online" ? { presence } : {}),
    ...(r.bio ? { bio: r.bio } : {}),
    ...(r.links?.length ? { links: r.links } : {}),
    ...(r.work_status ? { workStatus: r.work_status as WorkStatus } : {}),
  };
}

const toRoom = (r: RoomRow): Room => ({
  id: r.id,
  name: r.name,
  createdBy: r.created_by,
  createdAt: ms(r.created_at) ?? 0,
  ...(r.icon ? { icon: r.icon } : {}),
  ...(r.members_can_invite ? { membersCanInvite: true } : {}),
});

const toMember = (r: MemberRow): RoomMember => ({ roomId: r.room_id, userId: r.user_id, role: r.role, joinedAt: ms(r.joined_at) ?? 0 });

const toFriendship = (r: FriendshipRow): Friendship => ({
  id: r.id,
  fromId: r.from_id,
  toId: r.to_id,
  status: r.status,
  createdAt: ms(r.created_at) ?? 0,
  ...(r.responded_at ? { respondedAt: ms(r.responded_at) } : {}),
});

const toBox = (r: BoxRow): MediaBox => ({ id: r.id, ownerId: r.owner_id, name: r.name, kind: r.kind, createdAt: ms(r.created_at) ?? 0 });

const toShare = (r: ShareRow): BoxShare => ({
  id: r.id,
  boxId: r.box_id,
  ...(r.user_id ? { userId: r.user_id } : {}),
  ...(r.room_id ? { roomId: r.room_id } : {}),
  canEdit: r.can_edit,
  createdAt: ms(r.created_at) ?? 0,
});

const toInvite = (r: InviteRow): RoomInvite => ({
  id: r.id,
  roomId: r.room_id,
  fromId: r.from_id,
  toId: r.to_id,
  createdAt: ms(r.created_at) ?? 0,
  expiresAt: ms(r.expires_at) ?? 0,
  ...(r.accepted_at ? { acceptedAt: ms(r.accepted_at) } : {}),
});

/** プロフィールの変更を、Supabase の列の形にする（undefined にした項目は消す） */
export function profilePatchRow(patch: Partial<Profile>) {
  const row: Record<string, unknown> = {};
  const has = (k: keyof Profile) => Object.prototype.hasOwnProperty.call(patch, k);
  if (has("displayName")) row.display_name = patch.displayName ?? "";
  if (has("username")) row.username = patch.username;
  if (has("avatar")) row.avatar = patch.avatar ?? null;
  if (has("statusText")) row.status_text = patch.statusText ?? null;
  if (has("statusExpiresAt")) row.status_expires_at = iso(patch.statusExpiresAt);
  if (has("presence")) row.presence = patch.presence ?? "online";
  if (has("bio")) row.bio = patch.bio ?? null;
  if (has("links")) row.links = patch.links ?? [];
  if (has("workStatus")) row.work_status = patch.workStatus ?? null;
  return row;
}

let me: string | null = null;
let running: Promise<void> | null = null;
let again = false;

/** Supabase の内容を、ブラウザの中に写し直す。写している間に呼ばれたら、終わってからもう一度写す */
export function pull(): Promise<void> {
  if (!supa || !me) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await pullOnce(me!);
      } while (again && me);
    } finally {
      running = null;
    }
  })();
  return running;
}

/** 前に読んだときの「最後に変えた時刻」（ID → 時刻）。変わっていなければ、中身は読まない */
let seenProfiles = new Map<string, string>();
let seenRooms = new Map<string, string>();

/** 時刻だけを先に読み、変わった行の中身だけを読む */
async function changedRows<T extends { id: string; updated_at: string }>(table: string, seen: Map<string, string>) {
  const s = sb();
  const stamps = await s.from(table).select("id,updated_at").returns<Stamp[]>();
  if (stamps.error) return { error: stamps.error };
  const changed = stamps.data.filter((r) => seen.get(r.id) !== r.updated_at).map((r) => r.id);
  const rows: T[] = [];
  for (let i = 0; i < changed.length; i += 100) {
    const { data, error } = await s.from(table).select("*").in("id", changed.slice(i, i + 100)).returns<T[]>();
    if (error) return { error };
    rows.push(...data);
  }
  return { ids: stamps.data.map((r) => r.id), rows };
}

async function pullOnce(userId: string) {
  const s = sb();
  const [profiles, rooms, members, friendships, invites, boxes, shares] = await Promise.all([
    // 自分も窓口（profiles_public）に入っている（自分には本当の状態を返す：0005）
    changedRows<ProfileRow>("profiles_public", seenProfiles),
    changedRows<RoomRow>("rooms", seenRooms),
    s.from("room_members").select("*").returns<MemberRow[]>(),
    s.from("friendships").select("*").returns<FriendshipRow[]>(),
    s.from("room_friend_invites").select("*").returns<InviteRow[]>(),
    // 使えるボックス（自分の・共有された・紐づいたルームの）と、その共有先（0003）
    s.from("media_boxes").select("*").returns<BoxRow[]>(),
    s.from("box_shares").select("*").returns<ShareRow[]>(),
  ]);
  const failed = [profiles, rooms, members, friendships, invites, boxes, shares].find((r) => r.error);
  // 読めなかったときは、ブラウザの中をそのままにする（消してしまわないように）
  if (failed?.error || !profiles.rows || !rooms.rows || !rooms.ids) {
    console.warn("Supabase から読めませんでした", failed?.error?.message);
    return;
  }
  if (me !== userId) return;

  const profileList = profiles.rows.map(toProfile);
  const freshRooms = new Map(rooms.rows.map((r) => [r.id, toRoom(r)]));
  const memberList = (members.data ?? []).map(toMember);
  const friendList = (friendships.data ?? []).map(toFriendship);
  const inviteList = (invites.data ?? []).map(toInvite);
  let boxList = (boxes.data ?? []).map(toBox);
  let shareList = (shares.data ?? []).map(toShare);
  // 自分のボックスで、まだ Supabase に無いもの（2-4 より前にこのブラウザで作ったルームのメディアなど）は、消さずに送る
  if (await sendLocalBoxes(userId, new Set(boxList.map((b) => b.id)))) {
    const [b2, s2] = await Promise.all([s.from("media_boxes").select("*").returns<BoxRow[]>(), s.from("box_shares").select("*").returns<ShareRow[]>()]);
    if (b2.error || s2.error) return;
    boxList = b2.data.map(toBox);
    shareList = s2.data.map(toShare);
  }
  const mineId = boxList.find((b) => b.ownerId === userId && b.kind === "mine")?.id;
  const boxIds = new Set(boxList.map((b) => b.id));
  const goneBoxes = ((await db.mediaBoxes.toCollection().primaryKeys()) as string[]).filter((id) => !boxIds.has(id));

  await db.transaction("rw", [db.profiles, db.rooms, db.roomMembers, db.friendships, db.roomInvites, db.mediaBoxes, db.boxShares, db.media, db.libraries], async () => {
    // ID は重ならない（&username）。名前を変えた人の古い写しが残っていたら、先に外す
    const names = new Map(profileList.map((p) => [p.username, p.id]));
    const stale = await db.profiles.where("username").anyOf([...names.keys()]).filter((p) => names.get(p.username) !== p.id).primaryKeys();
    await db.profiles.bulkDelete(stale);
    // プロフィールは消さない（もう見られない人の発言にも、名前を出すため）
    await db.profiles.bulkPut(profileList);
    // ルームは、変わっていないものはブラウザの中の写しをそのまま使う
    const kept = (await db.rooms.bulkGet(rooms.ids!.filter((id) => !freshRooms.has(id)))).filter((r): r is Room => !!r);
    await mirror(db.rooms, [...kept, ...freshRooms.values()], (r) => r.id);
    await mirror(db.roomMembers, memberList, (m): [string, string] => [m.roomId, m.userId]);
    await mirror(db.friendships, friendList, (f) => f.id);
    await mirror(db.roomInvites, inviteList, (i) => i.id);
    // マイメディアは Supabase のもの（登録したときに作られる：0003）を使う。このブラウザで作っていたマイメディアの画像は、そちらに移す
    if (mineId) {
      const oldMine = (await db.mediaBoxes.where("ownerId").equals(userId).filter((b) => b.kind === "mine" && b.id !== mineId).primaryKeys()) as string[];
      if (oldMine.length) {
        await db.media.where("boxId").anyOf(oldMine).modify({ boxId: mineId });
        await db.libraries.where("boxId").anyOf(oldMine).modify({ boxId: mineId });
      }
    }
    await mirror(db.mediaBoxes, boxList, (b) => b.id);
    await mirror(db.boxShares, shareList, (x) => x.id);
  });
  // 使えなくなったボックスの画像の情報とライブラリーを片づける（マイメディアに移したものは残る）
  await forgetBoxes(goneBoxes.filter((id) => !mineId || id !== mineId));
  for (const r of profiles.rows) seenProfiles.set(r.id, r.updated_at);
  seenRooms = new Map([...rooms.rows.map((r): [string, string] => [r.id, r.updated_at]), ...[...seenRooms].filter(([id]) => rooms.ids!.includes(id) && !freshRooms.has(id))]);

  // 新しく入ったルーム・使えるようになったボックスの中身を読む
  await pullRows(true);
}

/**
 * 自分が持ち主のボックス（マイメディアでないもの）で、まだ Supabase に無いものを送る。共有先も、送れるもの（フレンドとの共有・自分が作ったルームとの紐づけ）を送る。
 * 送ったら true（読み直す）。中の画像の情報とライブラリーは、rowSync の送り足しが送る
 */
async function sendLocalBoxes(userId: string, onServer: Set<string>) {
  const local = await db.mediaBoxes.where("ownerId").equals(userId).filter((b) => b.kind === "box" && !onServer.has(b.id)).toArray();
  if (!local.length) return false;
  const s = sb();
  const { error } = await s
    .from("media_boxes")
    .upsert(local.map((b) => ({ id: b.id, owner_id: userId, name: b.name, kind: "box", created_at: new Date(b.createdAt).toISOString() })), { onConflict: "id", ignoreDuplicates: true });
  if (error) {
    console.warn("ボックスを送れませんでした", error.message);
    return false;
  }
  const ids = local.map((b) => b.id);
  const hosted = new Set((await db.rooms.filter((r) => r.createdBy === userId).primaryKeys()) as string[]);
  const shares = (await db.boxShares.where("boxId").anyOf(ids).toArray()).filter((x) => x.userId || (x.roomId && hosted.has(x.roomId)));
  for (const x of shares) {
    const one = await s
      .from("box_shares")
      .upsert({ id: x.id, box_id: x.boxId, user_id: x.userId ?? null, room_id: x.roomId ?? null, can_edit: x.canEdit, created_at: new Date(x.createdAt).toISOString() }, { onConflict: "id", ignoreDuplicates: true });
    // フレンドでなくなった人への共有や、もうほかのボックスが紐づいているルームは送れない（飛ばす）
    if (one.error) console.warn("共有先を送れませんでした", one.error.message);
  }
  return true;
}

/** ブラウザの中の表を、Supabase と同じ行にそろえる（無くなった行は消す） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mirror<T, K extends IndexableType>(table: Table<T, K, any>, rows: T[], key: (row: T) => K) {
  const keep = new Set(rows.map((r) => JSON.stringify(key(r))));
  const gone = (await table.toArray()).map(key).filter((k) => !keep.has(JSON.stringify(k)));
  await table.bulkDelete(gone);
  await table.bulkPut(rows);
}

let channel: RealtimeChannel | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let soon: ReturnType<typeof setTimeout> | null = null;

/** 知らせが続けて届いたら、まとめて1回だけ写す */
function pullSoon() {
  if (soon) clearTimeout(soon);
  soon = setTimeout(() => {
    soon = null;
    void pull();
  }, 300);
}

const onVisible = () => {
  if (document.visibilityState === "visible") pullSoon();
};

/** ログインした人が替わったら、写す相手と知らせの受け取りを替える（ログアウトなら止める） */
export async function startSync(userId: string | null) {
  if (!supa || userId === me) return;
  me = userId;
  seenProfiles = new Map();
  seenRooms = new Map();
  if (channel) void sb().removeChannel(channel);
  channel = null;
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisible);
  if (!userId) {
    await startRowSync(null);
    return;
  }
  await pull();
  await startRowSync(userId);
  const ch = freshChannel(`sync:${userId}`);
  // room_members は知らせを出さない（0010）。ほかの人がルームに入ったのは、しばらくおきの読み直しで分かる
  for (const table of ["profiles", "rooms", "friendships", "room_friend_invites", "media_boxes", "box_shares"]) {
    ch.on("postgres_changes", { event: "*", schema: "public", table }, pullSoon);
  }
  channel = ch.subscribe();
  // 窓口（profiles_public）とメンバーの変更は知らせが届かないので、しばらくおきに写す（変わった分だけ読む）
  timer = setInterval(pullSoon, 2 * 60_000);
  document.addEventListener("visibilitychange", onVisible);
}

/** Supabase のエラーの文（関数の raise exception の言葉） */
export const errorText = (e: { message: string } | null | undefined) => e?.message ?? "";

/** Supabase に保存できなかったとき（画面の側で受け止めていなければ、知らせを出す） */
export class SaveError extends Error {}

if (supa && typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (e) => {
    if (!(e.reason instanceof SaveError)) return;
    e.preventDefault();
    toast(e.reason.message);
  });
}
