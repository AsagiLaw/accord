"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { devSampleUsers } from "@/lib/auth/mode";
import { checkEmail, checkPassword, normalizeEmail, type AuthResult } from "@/lib/auth/validate";
import { checkUsername, normalizeUsername } from "@/lib/username";
import { deleteBox } from "./boxes";
import { db } from "./db";
import { removeFriendship } from "./friends";
import { createLocalProfile, usernameTaken } from "./profiles";
import { signInLocalSession, signOutLocalSession } from "./session";

// ローカル版のアカウント：メールとパスワードでのログインを、ブラウザの中だけで試すためのもの。
// Supabase につなぐと、ここは使わず Supabase Auth になる（src/lib/auth/supabase.ts）

const enc = new TextEncoder();
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** パスワードをそのまま保存しないよう、PBKDF2 でハッシュにする */
async function hashPassword(password: string, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 210_000 }, key, 256);
  return toB64(new Uint8Array(bits));
}

async function newCredentials(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { passwordHash: await hashPassword(password, salt), salt: toB64(salt) };
}

async function passwordMatches(userId: string, password: string) {
  const acc = await db.accounts.get(userId);
  return !!acc && (await hashPassword(password, fromB64(acc.salt))) === acc.passwordHash;
}

const WRONG = "メールアドレスかパスワードが違います";

export async function localSignUp(displayName: string, username: string, email: string, password: string): Promise<AuthResult> {
  const id = normalizeUsername(username);
  const bad = (!displayName.trim() && "表示名を入れてください") || checkUsername(id) || checkEmail(email) || checkPassword(password);
  if (bad) return { ok: false, error: bad };
  if (await usernameTaken(id)) return { ok: false, error: "この ID は、もうほかの人が使っています" };
  const mail = normalizeEmail(email);
  if (await db.accounts.where("email").equals(mail).first()) return { ok: false, error: "このメールアドレスは、もう登録されています" };
  const profile = await createLocalProfile(displayName.trim(), { username: id });
  await db.accounts.add({ userId: profile.id, email: mail, ...(await newCredentials(password)), createdAt: Date.now() });
  signInLocalSession(profile.id);
  return { ok: true };
}

export async function localSignIn(email: string, password: string): Promise<AuthResult> {
  const acc = await db.accounts.where("email").equals(normalizeEmail(email)).first();
  if (!acc || !(await passwordMatches(acc.userId, password))) return { ok: false, error: WRONG };
  if (!(await db.profiles.get(acc.userId))) return { ok: false, error: WRONG };
  signInLocalSession(acc.userId);
  return { ok: true };
}

/** 試し用の利用者（メールとパスワードを設定していない人）として入る。開発中のローカル版だけ */
export async function localSignInSample(userId: string): Promise<AuthResult> {
  if (!devSampleUsers) return { ok: false, error: "試し用の利用者は、開発中だけ使えます" };
  if (await db.accounts.get(userId)) return { ok: false, error: "この人はメールとパスワードでログインしてください" };
  if (!(await db.profiles.get(userId))) return { ok: false, error: "この利用者は見つかりません" };
  signInLocalSession(userId);
  return { ok: true };
}

/** 試し用の利用者（アカウントの無いプロフィール） */
export function useSampleProfiles() {
  return useLiveQuery(async () => {
    const withAccount = new Set(await db.accounts.toCollection().primaryKeys());
    return (await db.profiles.orderBy("createdAt").toArray()).filter((p) => !withAccount.has(p.id));
  }, []);
}

/** その人のアカウント（メールアドレス）。試し用の利用者なら null */
export function useLocalAccount(userId: string | undefined) {
  return useLiveQuery(async () => (userId ? ((await db.accounts.get(userId)) ?? null) : null), [userId]);
}

/**
 * パスワードの再設定：メールを送る代わりに、再設定のリンクを返す（1時間だけ使える）。
 * 登録の無いメールアドレスでも同じ答えにする（登録があるかを知られないように）。リンクは登録があるときだけ
 */
export async function localRequestReset(email: string): Promise<{ ok: true; link?: string } | { ok: false; error: string }> {
  const bad = checkEmail(email);
  if (bad) return { ok: false, error: bad };
  const acc = await db.accounts.where("email").equals(normalizeEmail(email)).first();
  if (!acc) return { ok: true };
  const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
  await db.authTokens.where("userId").equals(acc.userId).delete();
  await db.authTokens.add({ token, userId: acc.userId, kind: "reset", expiresAt: Date.now() + 60 * 60_000 });
  return { ok: true, link: `/reset-password?token=${token}` };
}

/** 再設定のリンクがまだ使えるか */
export async function localResetTokenValid(token: string) {
  const t = await db.authTokens.get(token);
  return !!t && t.expiresAt > Date.now();
}

export async function localResetPassword(token: string, password: string): Promise<AuthResult> {
  const bad = checkPassword(password);
  if (bad) return { ok: false, error: bad };
  const t = await db.authTokens.get(token);
  if (!t || t.expiresAt <= Date.now()) return { ok: false, error: "このリンクは使えません。もう一度、再設定のリンクを出してください" };
  await db.accounts.update(t.userId, await newCredentials(password));
  await db.authTokens.delete(token);
  signInLocalSession(t.userId);
  return { ok: true };
}

/** 試し用の利用者に、メールとパスワードを設定する（ふつうのアカウントになる） */
export async function localSetCredentials(userId: string, email: string, password: string): Promise<AuthResult> {
  const bad = checkEmail(email) || checkPassword(password);
  if (bad) return { ok: false, error: bad };
  const mail = normalizeEmail(email);
  if (await db.accounts.where("email").equals(mail).first()) return { ok: false, error: "このメールアドレスは、もう登録されています" };
  await db.accounts.add({ userId, email: mail, ...(await newCredentials(password)), createdAt: Date.now() });
  return { ok: true };
}

export async function localChangePassword(userId: string, current: string, next: string): Promise<AuthResult> {
  if (!(await passwordMatches(userId, current))) return { ok: false, error: "今のパスワードが違います" };
  const bad = checkPassword(next);
  if (bad) return { ok: false, error: bad };
  await db.accounts.update(userId, await newCredentials(next));
  return { ok: true, message: "パスワードを変えました" };
}

export async function localChangeEmail(userId: string, email: string, password: string): Promise<AuthResult> {
  if (!(await passwordMatches(userId, password))) return { ok: false, error: "パスワードが違います" };
  const bad = checkEmail(email);
  if (bad) return { ok: false, error: bad };
  const mail = normalizeEmail(email);
  const other = await db.accounts.where("email").equals(mail).first();
  if (other && other.userId !== userId) return { ok: false, error: "このメールアドレスは、もう登録されています" };
  await db.accounts.update(userId, { email: mail });
  return { ok: true, message: "メールアドレスを変えました（ローカル版なので、確認のメールは送りません）" };
}

export async function localVerifyPassword(userId: string, password: string) {
  return passwordMatches(userId, password);
}

export function localSignOut(userId: string) {
  signOutLocalSession(userId);
}

/** アカウントを削除できない理由（自分がホストのルームがある）。削除できるなら null */
export async function whyCannotDelete(userId: string) {
  const hosted = await db.rooms.filter((r) => r.createdBy === userId).toArray();
  if (!hosted.length) return null;
  return `ホストになっているルーム（${hosted.map((r) => `「${r.name}」`).join("")}）を、先に削除してください。ホストは引き継げないため、ルームがあるうちはアカウントを削除できません。`;
}

/**
 * アカウントを削除する（ブラウザの中のデータ）。Discord と同じく、自分がホストのルームがあるときは先に削除してもらう（ホストは引き継げない）。
 * 消すもの：プロフィール・アカウント・フレンド・ルームへの参加と招待・自分のボックス（ほかの人が入れた画像は、その人のマイメディアに移す）・マイメディアの画像。
 * 残すもの：送ったメッセージ（「削除された人」として残る）
 */
export async function deleteLocalUserData(userId: string): Promise<AuthResult> {
  const blocked = await whyCannotDelete(userId);
  if (blocked) return { ok: false, error: blocked };
  // Supabase 版では、アカウントを消したときに Supabase の間柄も消えている（0008）ので、ブラウザの中だけ片づける
  for (const f of await db.friendships.where("fromId").equals(userId).or("toId").equals(userId).toArray()) await removeFriendship(f.id, { localOnly: true });
  // ほかの人のボックスの、この人への共有（入れてあった画像は、ボックスにそのまま残す）
  await db.boxShares.where("userId").equals(userId).delete();
  const boxes = await db.mediaBoxes.where("ownerId").equals(userId).toArray();
  for (const b of boxes.filter((b) => b.kind !== "mine")) await deleteBox(b.id);
  // マイメディア（自分のボックスを消したときに移ってきた、自分の画像も入っている）
  await db.transaction("rw", [db.mediaBoxes, db.boxShares, db.media, db.mediaBlobs, db.libraries], async () => {
    for (const b of boxes.filter((b) => b.kind === "mine")) {
      const ids = (await db.media.where("boxId").equals(b.id).primaryKeys()) as string[];
      await db.mediaBlobs.bulkDelete(ids);
      await db.media.bulkDelete(ids);
      await db.libraries.where("boxId").equals(b.id).delete();
      await db.boxShares.where("boxId").equals(b.id).delete();
      await db.mediaBoxes.delete(b.id);
    }
  });
  await db.transaction("rw", [db.roomMembers, db.roomInvites, db.chatReads, db.presenceTabs, db.accounts, db.authTokens, db.profiles], async () => {
    await db.roomMembers.where("userId").equals(userId).delete();
    // 送った招待と、届いていた招待（DM の招待のカードは「使えない招待」になる）
    await db.roomInvites.where("fromId").equals(userId).or("toId").equals(userId).delete();
    await db.chatReads.where("userId").equals(userId).delete();
    await db.presenceTabs.where("userId").equals(userId).delete();
    await db.authTokens.where("userId").equals(userId).delete();
    await db.accounts.delete(userId);
    await db.profiles.delete(userId);
  });
  signOutLocalSession(userId);
  return { ok: true };
}
