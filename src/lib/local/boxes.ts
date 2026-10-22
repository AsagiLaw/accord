"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { APPEND } from "@/lib/media/autoname";
import { db, newId, newMyMediaBox, type BoxShare, type Media, type MediaBox } from "./db";
import type { MemberWithProfile } from "./rooms";
import { renumber } from "./renumber";
import { forgetBoxes, pullRows } from "./rowSync";
import { deletedBoxes, pull, SaveError, sb, supa } from "./sync";

// メディアのボックス：持ち主・共有先（フレンド・ルーム）と、だれが見られる・編集できるか

/** owner：持ち主／edit：共有されていて編集もできる／view：見るだけ */
export type BoxAccess = "owner" | "edit" | "view";

/** 共有先の説明に使う：どのルーム・どの人に共有しているか */
export type ShareInfo = BoxShare & { label: string };

export type MyBoxes = {
  mine: MediaBox | undefined;
  /** 自分で作ったボックス（作った順） */
  own: MediaBox[];
  /** 共有されたボックス（フレンドから・参加しているルームから） */
  shared: MediaBox[];
  /** ボックスごとの共有先 */
  shares: Map<string, ShareInfo[]>;
  /** 自分の権限 */
  access: Map<string, BoxAccess>;
  /** 共有されたボックスの持ち主の名前 */
  owners: Map<string, string>;
};

/** 自分のルーム（ID）。ルームに紐づいたボックスは、そのルームのメンバーが使える */
async function myRoomIds(userId: string) {
  return (await db.roomMembers.where("userId").equals(userId).toArray()).map((l) => l.roomId);
}

/** 自分が使えるボックス：マイメディア・自分で作ったボックス・共有されたボックス */
export function useMyBoxes(userId: string | undefined) {
  return useLiveQuery(async (): Promise<MyBoxes | undefined> => {
    if (!userId) return undefined;
    const owned = await db.mediaBoxes.where("ownerId").equals(userId).sortBy("createdAt");
    const roomIds = await myRoomIds(userId);
    const toMe = [
      ...(await db.boxShares.where("userId").equals(userId).toArray()),
      ...(roomIds.length ? await db.boxShares.where("roomId").anyOf(roomIds).toArray() : []),
    ];
    const ownedIds = new Set(owned.map((b) => b.id));
    const sharedIds = [...new Set(toMe.map((s) => s.boxId))].filter((id) => !ownedIds.has(id));
    const shared = (await db.mediaBoxes.bulkGet(sharedIds)).filter((b): b is MediaBox => !!b).sort((a, b) => a.createdAt - b.createdAt);

    const all = [...owned, ...shared];
    const shareRows = all.length ? await db.boxShares.where("boxId").anyOf(all.map((b) => b.id)).toArray() : [];
    const rooms = new Map((await db.rooms.bulkGet([...new Set(shareRows.flatMap((s) => (s.roomId ? [s.roomId] : [])))])).flatMap((r) => (r ? [[r.id, r.name]] : [])));
    const people = new Map((await db.profiles.bulkGet([...new Set(shareRows.flatMap((s) => (s.userId ? [s.userId] : [])))])).flatMap((p) => (p ? [[p.id, p.displayName]] : [])));
    const shares = new Map<string, ShareInfo[]>();
    for (const s of shareRows) {
      const label = s.roomId ? `ルーム「${rooms.get(s.roomId) ?? "削除されたルーム"}」` : `${people.get(s.userId ?? "") ?? "削除された人"}さん`;
      shares.set(s.boxId, [...(shares.get(s.boxId) ?? []), { ...s, label }]);
    }

    const access = new Map<string, BoxAccess>();
    for (const b of owned) access.set(b.id, "owner");
    for (const s of toMe) if (!ownedIds.has(s.boxId) && (s.canEdit || !access.has(s.boxId))) access.set(s.boxId, s.canEdit ? "edit" : "view");

    const ownerNames = new Map((await db.profiles.bulkGet([...new Set(shared.map((b) => b.ownerId))])).flatMap((p) => (p ? [[p.id, p.displayName]] : [])));
    const owners = new Map(shared.map((b) => [b.id, ownerNames.get(b.ownerId) ?? "削除された人"]));

    return { mine: owned.find((b) => b.kind === "mine"), own: owned.filter((b) => b.kind !== "mine"), shared, shares, access, owners };
  }, [userId]);
}

export function useBox(boxId: string | undefined) {
  return useLiveQuery(async () => (boxId ? ((await db.mediaBoxes.get(boxId)) ?? null) : null), [boxId]);
}

/** ボックスへの自分の権限。使えなければ null、読み込み中は undefined */
export function useBoxAccess(boxId: string, userId: string | undefined) {
  return useLiveQuery(async (): Promise<BoxAccess | null> => {
    if (!userId) return null;
    const box = await db.mediaBoxes.get(boxId);
    if (!box) return null;
    if (box.ownerId === userId) return "owner";
    const roomIds = new Set(await myRoomIds(userId));
    const mine = (await db.boxShares.where("boxId").equals(boxId).toArray()).filter((s) => s.userId === userId || (s.roomId && roomIds.has(s.roomId)));
    if (!mine.length) return null;
    return mine.some((s) => s.canEdit) ? "edit" : "view";
  }, [boxId, userId]);
}

/** ボックスを使える人（持ち主・共有したフレンド・紐づけたルームのメンバー）。画像を入れた人の名前を出すのに使う */
export function useBoxMembers(boxId: string) {
  return useLiveQuery(async (): Promise<MemberWithProfile[]> => {
    const box = await db.mediaBoxes.get(boxId);
    if (!box) return [];
    const shares = await db.boxShares.where("boxId").equals(boxId).toArray();
    const roomIds = shares.flatMap((s) => (s.roomId ? [s.roomId] : []));
    const inRooms = roomIds.length ? await db.roomMembers.where("roomId").anyOf(roomIds).toArray() : [];
    const ids = [...new Set([box.ownerId, ...shares.flatMap((s) => (s.userId ? [s.userId] : [])), ...inRooms.map((l) => l.userId)])];
    const profiles = await db.profiles.bulkGet(ids);
    return ids.map((userId, i) => ({ userId, role: userId === box.ownerId ? "host" : "member", displayName: profiles[i]?.displayName ?? "" }));
  }, [boxId]);
}

/** ボックスの共有先（作った順） */
export function useBoxShares(boxId: string) {
  return useLiveQuery(async () => (await db.boxShares.where("boxId").equals(boxId).toArray()).sort((a, b) => a.createdAt - b.createdAt), [boxId]);
}

/** ルームごとに紐づいているボックス（ルームの ID → ボックス）。紐づけの画面で「ほかのボックスが紐づいている」を出すのに使う */
export function useRoomLinks(roomIds: string[]) {
  const key = roomIds.join(",");
  return useLiveQuery(async () => {
    const shares = roomIds.length ? await db.boxShares.where("roomId").anyOf(roomIds).toArray() : [];
    const boxes = await db.mediaBoxes.bulkGet(shares.map((s) => s.boxId));
    return new Map(shares.flatMap((s, i) => (boxes[i] && s.roomId ? [[s.roomId, boxes[i]] as const] : [])));
  }, [key]); // roomIds は中身（key）で比べる
}

/** ルームに紐づいたボックス。紐づいていなければ null、読み込み中は undefined */
export function useRoomBox(roomId: string) {
  return useLiveQuery(async () => {
    const share = await db.boxShares.where("roomId").equals(roomId).first();
    const box = share && (await db.mediaBoxes.get(share.boxId));
    return box && share ? { box, share } : null;
  }, [roomId]);
}

// ---- 共有 ----

/** 共有先の一覧から、ボックスを使える人（持ち主・共有したフレンド・紐づいたルームのメンバー）の ID を出す */
async function usersOf(ownerId: string | undefined, shares: BoxShare[]) {
  const roomIds = shares.flatMap((s) => (s.roomId ? [s.roomId] : []));
  const inRooms = roomIds.length ? await db.roomMembers.where("roomId").anyOf(roomIds).toArray() : [];
  return new Set([...(ownerId ? [ownerId] : []), ...shares.flatMap((s) => (s.userId ? [s.userId] : [])), ...inRooms.map((l) => l.userId)]);
}

/** 共有をやめたときに、ボックスを使えなくなる人（ほかの共有で、まだ使える人は除く） */
async function losersIfRemoved(share: BoxShare) {
  const box = await db.mediaBoxes.get(share.boxId);
  const all = await db.boxShares.where("boxId").equals(share.boxId).toArray();
  const before = await usersOf(box?.ownerId, all);
  const after = await usersOf(box?.ownerId, all.filter((s) => s.id !== share.id));
  return [...before].filter((id) => !after.has(id));
}

/**
 * ボックスを使えなくなった人が入れた画像を、それぞれのマイメディアに移す（ライブラリーからは外れる）。
 * 移した画像を代表にしていたライブラリーは、代表なしに戻す。移した枚数を返す。
 * 自動の名前の番号は、残ったボックスでは詰め、移した先では最後の番号にする
 */
async function moveOutImagesOf(boxId: string, userIds: string[]) {
  if (!userIds.length) return 0;
  const target = new Map<string, string>();
  for (const id of userIds) target.set(id, await ensureMyMedia(id));
  const moved = await db.transaction("rw", db.media, db.libraries, async () => {
    const ids = (await db.media.where("boxId").equals(boxId).toArray()).filter((m) => target.has(m.uploadedBy)).map((m) => m.id);
    await db.media
      .where("id")
      .anyOf(ids)
      .modify((m: Media) => {
        m.boxId = target.get(m.uploadedBy)!;
        m.libIds = [];
        if (m.title !== undefined) m.seq = APPEND + (m.seq ?? 0);
      });
    await db.libraries
      .where("boxId")
      .equals(boxId)
      .filter((l) => l.repMediaId !== null && ids.includes(l.repMediaId))
      .modify({ repMediaId: null });
    return ids.length;
  });
  if (moved) for (const id of [boxId, ...new Set(target.values())]) await renumber(id);
  return moved;
}

/** 共有をやめると、ほかの人のマイメディアに移る画像の枚数（やめる前の確認に使う） */
export async function countImagesMovedIfRemoved(shareId: string) {
  const share = await db.boxShares.get(shareId);
  if (!share) return 0;
  const losers = new Set(await losersIfRemoved(share));
  return db.media
    .where("boxId")
    .equals(share.boxId)
    .filter((m) => losers.has(m.uploadedBy))
    .count();
}

/** フレンドとボックスを共有する（もう共有していれば、権限だけ変える）。マイメディアは共有できない */
export async function shareBoxWithFriend(boxId: string, userId: string, canEdit: boolean) {
  const box = await db.mediaBoxes.get(boxId);
  if (!box || box.kind === "mine" || box.ownerId === userId) return;
  const found = await db.boxShares.where("boxId").equals(boxId).filter((s) => s.userId === userId).first();
  if (supa) {
    const { error } = found
      ? await sb().from("box_shares").update({ can_edit: canEdit }).eq("id", found.id)
      : await sb().from("box_shares").insert({ box_id: boxId, user_id: userId, can_edit: canEdit });
    if (error) throw new SaveError(`共有できませんでした（${error.message}）`);
    await pull();
    return;
  }
  if (found) await db.boxShares.update(found.id, { canEdit });
  else await db.boxShares.add({ id: newId(), boxId, userId, canEdit, createdAt: Date.now() });
}

/** ルームのメディア（紐づけるボックス・権限）を変えられるのは、ルームを作ったホストだけ */
export async function canChangeRoomMedia(roomId: string, userId: string) {
  return (await db.rooms.get(roomId))?.createdBy === userId;
}

/**
 * ボックスをルームに紐づける（メンバー全員で使える）。1つのルームに紐づけられるボックスは1つだけなので、
 * ほかのボックスが紐づいていれば紐づけずに "taken" を返す。マイメディアは紐づけられない。
 * 紐づけられるのは、ルームを作ったホスト（by）だけ
 */
export async function linkBoxToRoom(boxId: string, roomId: string, canEdit: boolean, by: string): Promise<"ok" | "taken" | "forbidden"> {
  if (!(await canChangeRoomMedia(roomId, by))) return "forbidden";
  const box = await db.mediaBoxes.get(boxId);
  if (!box || box.kind === "mine") return "taken";
  if (supa) {
    const found = await db.boxShares.where("roomId").equals(roomId).first();
    if (found && found.boxId !== boxId) return "taken";
    const { error } = found
      ? await sb().from("box_shares").update({ can_edit: canEdit }).eq("id", found.id)
      : await sb().from("box_shares").insert({ box_id: boxId, room_id: roomId, can_edit: canEdit });
    // 23505：ほかのボックスが、もう紐づいている（box_shares_room_idx）
    if (error) return error.code === "23505" ? "taken" : "forbidden";
    await pull();
    return "ok";
  }
  return db.transaction("rw", db.boxShares, async () => {
    const found = await db.boxShares.where("roomId").equals(roomId).first();
    if (found && found.boxId !== boxId) return "taken";
    if (found) await db.boxShares.update(found.id, { canEdit });
    else await db.boxShares.add({ id: newId(), boxId, roomId, canEdit, createdAt: Date.now() });
    return "ok";
  });
}

/** 共有の権限を変える（見るだけ／編集もできる）。見るだけにしても、入れてあった画像はそのまま */
export async function setShareCanEdit(shareId: string, canEdit: boolean) {
  if (supa) {
    const { error } = await sb().from("box_shares").update({ can_edit: canEdit }).eq("id", shareId);
    if (error) throw new SaveError(`権限を変えられませんでした（${error.message}）`);
  }
  await db.boxShares.update(shareId, { canEdit });
}

/** 共有をやめる（フレンドとの共有・ルームとの紐づけ）。使えなくなった人が入れた画像は、その人のマイメディアに移る。移した枚数を返す */
export async function removeShare(shareId: string) {
  // Supabase 版：使えなくなった人の画像を、その人のマイメディアに移すのは Supabase の関数で行う（ほかの人のマイメディアは見られないため：0014）
  if (supa) {
    const boxId = (await db.boxShares.get(shareId))?.boxId;
    const { data, error } = await sb().rpc("remove_box_share", { share: shareId });
    if (error) throw new SaveError(`共有をやめられませんでした（${error.message}）`);
    await pull();
    await pullRows();
    // 画像が抜けたボックスの、自動の名前の番号を詰める（移った先のボックスは見られないので、その人が次に触ったときに詰まる）
    const moved = typeof data === "number" ? data : 0;
    if (moved && boxId && (await db.mediaBoxes.get(boxId))) await renumber(boxId);
    return moved;
  }
  const share = await db.boxShares.get(shareId);
  if (!share) return 0;
  const losers = await losersIfRemoved(share);
  await db.boxShares.delete(shareId);
  return moveOutImagesOf(share.boxId, losers);
}

/** ルームとの紐づけを外す（ルームを消すときなど） */
export async function unlinkRoom(roomId: string) {
  for (const s of await db.boxShares.where("roomId").equals(roomId).toArray()) await removeShare(s.id);
}

/** フレンドを解除したとき：お互いのボックスの、相手への共有をやめる */
export async function removeSharesBetween(a: string, b: string) {
  for (const [owner, other] of [
    [a, b],
    [b, a],
  ]) {
    const boxIds = new Set((await db.mediaBoxes.where("ownerId").equals(owner).toArray()).map((x) => x.id));
    const shares = (await db.boxShares.where("userId").equals(other).toArray()).filter((s) => boxIds.has(s.boxId));
    for (const s of shares) await removeShare(s.id);
  }
}

/** その人のマイメディア（ID）。無ければ作る */
export async function ensureMyMedia(userId: string) {
  return db.transaction("rw", db.mediaBoxes, async () => {
    const found = await db.mediaBoxes.where("ownerId").equals(userId).filter((b) => b.kind === "mine").first();
    if (found) return found.id;
    // Supabase 版のマイメディアは、登録したときに Supabase で作られて写ってくる（ここでは作らない）
    if (supa) throw new SaveError("マイメディアを読み込んでいます。少し待ってから、もう一度試してください");
    const box = newMyMediaBox(userId);
    await db.mediaBoxes.add(box);
    return box.id;
  });
}

/**
 * ルームで画像を入れるときの行き先：ルームに紐づいたボックス（編集もできるとき。持ち主なら見るだけでも）。
 * 紐づいていない・見るだけ・DM（ルームの外）のときは、入れた人のマイメディア
 */
export async function uploadBoxForRoom(roomId: string, userId: string) {
  const share = roomId ? await db.boxShares.where("roomId").equals(roomId).first() : undefined;
  const box = share && (await db.mediaBoxes.get(share.boxId));
  if (share && (share.canEdit || box?.ownerId === userId)) return { boxId: share.boxId, mine: false };
  return { boxId: await ensureMyMedia(userId), mine: true };
}

export async function createBox(ownerId: string, name: string) {
  const box: MediaBox = { id: newId(), ownerId, name, kind: "box", createdAt: Date.now() };
  if (supa) {
    const { error } = await sb().from("media_boxes").insert({ id: box.id, owner_id: ownerId, name, kind: "box" });
    if (error) throw new SaveError(`ボックスを作れませんでした（${error.message}）`);
  }
  await db.mediaBoxes.add(box);
  return box;
}

/** 「名前を自動で付ける」を切り替える（ボックスごと。変えられるのは画像を入れられる人：0019） */
export async function setBoxAutoName(boxId: string, autoName: boolean) {
  if (supa) {
    const { error } = await sb().rpc("set_box_auto_name", { target: boxId, auto: autoName });
    if (error) throw new SaveError(`設定を変えられませんでした（${error.message}）`);
  }
  await db.mediaBoxes.update(boxId, { autoName });
}

export async function renameBox(boxId: string, name: string) {
  if (supa) {
    const { error } = await sb().from("media_boxes").update({ name }).eq("id", boxId);
    if (error) throw new SaveError(`名前を変えられませんでした（${error.message}）`);
  }
  await db.mediaBoxes.update(boxId, { name });
}

/**
 * ボックスを削除する（マイメディアは消せない）。中の画像は消さず、それぞれ入れた人のマイメディアに移す。
 * ライブラリーと共有先は消える。移した画像はライブラリーから外れるので、マイメディアの「未整理」に入る
 */
export async function deleteBox(boxId: string, opts: { localOnly?: boolean } = {}) {
  const box = await db.mediaBoxes.get(boxId);
  if (!box || box.kind === "mine") return;
  // Supabase 版：中の画像を入れた人のマイメディアに移すのは、Supabase の関数で行う（0014）。localOnly：もう Supabase で消えている
  if (supa && !opts.localOnly) {
    const { error } = await sb().rpc("delete_box", { target: boxId });
    if (error) throw new SaveError(`ボックスを削除できませんでした（${error.message}）`);
    // 読み直す前にブラウザの中から消す（残っていると「まだ Supabase に無いボックス」として送り直されてしまう）
    await deleteBox(boxId, { localOnly: true });
    await pull();
    await pullRows();
    return;
  }
  // Supabase で、もう消えている：ブラウザの中を片づけるだけ（画像の移し替えは Supabase が済ませている）
  if (supa) {
    deletedBoxes.add(boxId);
    await forgetBoxes([boxId]);
    await db.transaction("rw", db.mediaBoxes, db.boxShares, async () => {
      await db.boxShares.where("boxId").equals(boxId).delete();
      await db.mediaBoxes.delete(boxId);
    });
    return;
  }
  const uploaders = [...new Set((await db.media.where("boxId").equals(boxId).toArray()).map((m) => m.uploadedBy))];
  const known = new Set((await db.profiles.bulkGet(uploaders)).flatMap((p) => (p ? [p.id] : [])));
  // 入れた人がもういなければ、持ち主のマイメディアへ
  const target = new Map<string, string>();
  for (const id of [box.ownerId, ...uploaders.filter((u) => known.has(u))]) target.set(id, await ensureMyMedia(id));
  await db.transaction("rw", [db.mediaBoxes, db.boxShares, db.media, db.libraries], async () => {
    await db.media
      .where("boxId")
      .equals(boxId)
      .modify((m: Media) => {
        m.boxId = target.get(m.uploadedBy) ?? target.get(box.ownerId)!;
        m.libIds = [];
      });
    await db.libraries.where("boxId").equals(boxId).delete();
    await db.boxShares.where("boxId").equals(boxId).delete();
    await db.mediaBoxes.delete(boxId);
  });
}
