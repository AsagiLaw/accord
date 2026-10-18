"use client";

import {
  deleteLocalUserData,
  localChangeEmail,
  localChangePassword,
  localRequestReset,
  localResetPassword,
  localSetCredentials,
  localSignIn,
  localSignOut,
  localSignUp,
  localVerifyPassword,
  useLocalAccount,
  whyCannotDelete,
} from "@/lib/local/accounts";
import { usernameTaken } from "@/lib/local/profiles";
import { useSupabaseUser } from "@/lib/local/session";
import { checkUsername, normalizeUsername } from "@/lib/username";
import { authMode } from "./mode";
import {
  supaChangeEmail,
  supaDeleteAccount,
  supaRequestReset,
  supaSignIn,
  supaSignInWithGoogle,
  supaSignOut,
  supaSignUp,
  supaUpdatePassword,
  supaUsernameAvailable,
  supaVerifyPassword,
} from "./supabase";
import { turnstileEnabled } from "@/lib/turnstile";
import type { AuthResult } from "./validate";

// ログインまわりの入口。画面はここだけを使い、ローカル版か Supabase 版かは気にしない
export { authMode };

const supa = authMode === "supabase";

const CAPTCHA_NEEDED = "「ロボットではありません」の確認が終わってから、もう一度押してください";
const CAPTCHA_FAILED = "「ロボットではありません」の確認がうまくいきませんでした。もう一度試してください";

/**
 * ロボットよけ（Turnstile）の確かめ。ローカル版はこのアプリのサーバー（/api/turnstile）で Cloudflare に問い合わせる。
 * Supabase 版は token を Supabase に渡すと Supabase が確かめるので、ここでは token があるかだけ見る（token は1回しか使えない）
 */
async function guard(token?: string): Promise<string | null> {
  if (!turnstileEnabled) return null;
  if (!token) return CAPTCHA_NEEDED;
  if (supa) return null;
  const r = await fetch("/api/turnstile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) })
    .then((x) => x.json() as Promise<{ ok?: boolean }>)
    .catch(() => ({ ok: false }));
  return r.ok ? null : CAPTCHA_FAILED;
}

/** Supabase 版で、設定の画面からパスワードを確かめるときの token の確かめ（ローカル版は要らない） */
const supaGuard = (token?: string) => (supa && turnstileEnabled && !token ? CAPTCHA_NEEDED : null);

export async function signUp(displayName: string, username: string, email: string, password: string, next: string, captcha?: string): Promise<AuthResult> {
  const bad = await guard(captcha);
  if (bad) return { ok: false, error: bad };
  return supa ? supaSignUp(displayName, username, email, password, next, captcha) : localSignUp(displayName, username, email, password);
}

/**
 * 登録の画面で、入れた ID が使えるか。形が違えばその言葉、使われていれば「もう使われています」、使えれば null。
 * Supabase 版で確かめられないとき（0009 をまだ実行していない）も null（登録のときに、もう一度確かめる）
 */
export async function checkUsernameFree(username: string): Promise<string | null> {
  const id = normalizeUsername(username);
  const bad = checkUsername(id);
  if (bad) return bad;
  const free = supa ? await supaUsernameAvailable(id) : !(await usernameTaken(id));
  return free === false ? "この ID は、もうほかの人が使っています" : null;
}

export async function signIn(email: string, password: string, captcha?: string): Promise<AuthResult> {
  const bad = await guard(captcha);
  if (bad) return { ok: false, error: bad };
  return supa ? supaSignIn(email, password, captcha) : localSignIn(email, password);
}

export async function signInWithGoogle(next: string): Promise<AuthResult> {
  if (!supa) return { ok: false, error: "Google でのログインは、Supabase につなぐと使えます" };
  return supaSignInWithGoogle(next);
}

/** パスワードの再設定のメールを送る。ローカル版はメールの代わりにリンクを返す */
export async function requestPasswordReset(email: string, captcha?: string): Promise<{ ok: true; link?: string } | { ok: false; error: string }> {
  const bad = await guard(captcha);
  if (bad) return { ok: false, error: bad };
  if (!supa) return localRequestReset(email);
  const r = await supaRequestReset(email, captcha);
  return r.ok ? { ok: true } : r;
}

/** 再設定のリンクから来て、新しいパスワードにする（ローカル版はリンクの token が要る） */
export const resetPassword = (password: string, token: string | null) =>
  supa ? supaUpdatePassword(password) : token ? localResetPassword(token, password) : Promise.resolve<AuthResult>({ ok: false, error: "このリンクは使えません" });

/** ログインの方法と、メールアドレス（アカウントの設定に出す） */
export type AccountInfo = {
  email: string | null;
  /** password：メールとパスワード、google：Google だけ、sample：試し用の利用者（ローカル版） */
  kind: "password" | "google" | "sample";
  /** パスワードを設定しているか（Google だけの人や試し用の利用者は、まだ無い） */
  hasPassword: boolean;
  /** 新しいメールアドレスの確認待ち（Supabase 版） */
  pendingEmail?: string;
};

export function useAccountInfo(userId: string): AccountInfo | undefined {
  const local = useLocalAccount(supa ? undefined : userId);
  const user = useSupabaseUser();
  if (!supa) return local === undefined ? undefined : local ? { email: local.email, kind: "password", hasPassword: true } : { email: null, kind: "sample", hasPassword: false };
  if (!user) return undefined;
  const providers = (user.app_metadata?.providers as string[] | undefined) ?? [user.app_metadata?.provider as string];
  const hasPassword = providers.includes("email");
  return { email: user.email ?? null, kind: hasPassword ? "password" : "google", hasPassword, pendingEmail: user.new_email ?? undefined };
}

/** パスワードを変える。まだ無い人（Google だけ・試し用の利用者）は current を空にして、新しく設定する */
export async function changePassword(userId: string, info: AccountInfo, current: string, next: string, email?: string, captcha?: string): Promise<AuthResult> {
  if (!supa) {
    if (info.kind === "sample") {
      const r = await localSetCredentials(userId, email ?? "", next);
      return r.ok ? { ok: true, message: "メールアドレスとパスワードを設定しました。次からはこれでログインできます" } : r;
    }
    return localChangePassword(userId, current, next);
  }
  const bad = info.hasPassword ? supaGuard(captcha) : null;
  if (bad) return { ok: false, error: bad };
  if (info.hasPassword && !(await supaVerifyPassword(info.email ?? "", current, captcha))) return { ok: false, error: "今のパスワードが違います" };
  return supaUpdatePassword(next);
}

export async function changeEmail(userId: string, info: AccountInfo, email: string, password: string, captcha?: string): Promise<AuthResult> {
  if (!supa) return localChangeEmail(userId, email, password);
  const bad = info.hasPassword ? supaGuard(captcha) : null;
  if (bad) return { ok: false, error: bad };
  if (info.hasPassword && !(await supaVerifyPassword(info.email ?? "", password, captcha))) return { ok: false, error: "パスワードが違います" };
  return supaChangeEmail(email);
}

export async function signOut(userId: string) {
  if (supa) await supaSignOut();
  else localSignOut(userId);
}

/** アカウントを削除する。パスワードがある人は、確かめてから */
export async function deleteAccount(userId: string, info: AccountInfo, password: string, captcha?: string): Promise<AuthResult> {
  const blocked = await whyCannotDelete(userId);
  if (blocked) return { ok: false, error: blocked };
  if (info.hasPassword) {
    const bad = supaGuard(captcha);
    if (bad) return { ok: false, error: bad };
    const ok = supa ? await supaVerifyPassword(info.email ?? "", password, captcha) : await localVerifyPassword(userId, password);
    if (!ok) return { ok: false, error: "パスワードが違います" };
  }
  if (supa) {
    const r = await supaDeleteAccount();
    if (!r.ok) return r;
  }
  // ブラウザの中のデータも消す（Supabase 版でも、データはまだブラウザの中にある）
  return deleteLocalUserData(userId);
}
