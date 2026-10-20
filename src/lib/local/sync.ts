"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import type { IndexableType, Table } from "dexie";
import { authMode } from "@/lib/auth/mode";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/ui/overlay";
import { db, newMyMediaBox, type Friendship, type Presence, type Profile, type Room, type RoomInvite, type RoomMember, type WorkStatus } from "./db";
import { freshChannel, pullRows, startRowSync } from "./rowSync";

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
  const [profiles, rooms, members, friendships, invites] = await Promise.all([
    // 自分も窓口（profiles_public）に入っている（自分には本当の状態を返す：0005）
    changedRows<ProfileRow>("profiles_public", seenProfiles),
    changedRows<RoomRow>("rooms", seenRooms),
    s.from("room_members").select("*").returns<MemberRow[]>(),
    s.from("friendships").select("*").returns<FriendshipRow[]>(),
    s.from("room_friend_invites").select("*").returns<InviteRow[]>(),
  ]);
  const failed = [profiles, rooms, members, friendships, invites].find((r) => r.error);
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

  await db.transaction("rw", [db.profiles, db.rooms, db.roomMembers, db.friendships, db.roomInvites], async () => {
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
  });
  for (const r of profiles.rows) seenProfiles.set(r.id, r.updated_at);
  seenRooms = new Map([...rooms.rows.map((r): [string, string] => [r.id, r.updated_at]), ...[...seenRooms].filter(([id]) => rooms.ids!.includes(id) && !freshRooms.has(id))]);

  if (!(await db.mediaBoxes.where("ownerId").equals(userId).filter((b) => b.kind === "mine").count())) {
    await db.mediaBoxes.add(newMyMediaBox(userId));
  }
  // 新しく入ったルームの中身（チャットなど）を読む
  await pullRows(true);
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
  for (const table of ["profiles", "rooms", "friendships", "room_friend_invites"]) {
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
