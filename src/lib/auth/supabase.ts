"use client";

import type { AuthError } from "@supabase/supabase-js";
import { unsubscribePush } from "@/lib/push";
import { createClient } from "@/lib/supabase/client";
import { checkUsername, normalizeUsername } from "@/lib/username";
import { checkEmail, checkPassword, type AuthResult } from "./validate";

// Supabase Auth でのログインまわり（.env.local に Supabase のキーがあるとき）。画面からは src/lib/auth/index.ts を通して使う

let client: ReturnType<typeof createClient> | null = null;
const sb = () => (client ??= createClient());

/** Supabase のエラーを、画面に出す言葉にする */
function message(e: AuthError): string {
  switch (e.code) {
    case "invalid_credentials":
      return "メールアドレスかパスワードが違います";
    case "email_not_confirmed":
      return "メールアドレスの確認がまだです。届いたメールのリンクを開いてください";
    case "user_already_exists":
    case "email_exists":
      return "このメールアドレスは、もう登録されています";
    case "weak_password":
      return "パスワードが弱すぎます。もっと長く、推測されにくいものにしてください";
    case "same_password":
      return "今と同じパスワードです";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "しばらく時間をおいてから、もう一度試してください";
    case "email_address_invalid":
      return "メールアドレスの形を確かめてください";
    case "captcha_failed":
      return "「ロボットではありません」の確認がうまくいきませんでした。もう一度試してください";
    case "reauthentication_needed":
      return "安全のため、一度ログアウトしてログインし直してから変えてください";
    default:
      return `うまくいきませんでした（${e.message}）`;
  }
}

/** メールのリンクや Google から戻ってくる先（ここでログインを仕上げてから next へ） */
const callback = (next: string) => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

/**
 * その ID がまだ使われていないか（Supabase の profiles で確かめる：0009 の username_available）。
 * 確かめられないとき（0009 をまだ実行していないなど）は null
 */
export async function supaUsernameAvailable(username: string): Promise<boolean | null> {
  const { data, error } = await sb().rpc("username_available", { name: username });
  return error || typeof data !== "boolean" ? null : data;
}

export async function supaSignUp(displayName: string, username: string, email: string, password: string, next: string, captchaToken?: string): Promise<AuthResult> {
  const id = normalizeUsername(username);
  const bad = (!displayName.trim() && "表示名を入れてください") || checkUsername(id) || checkEmail(email) || checkPassword(password);
  if (bad) return { ok: false, error: bad };
  if ((await supaUsernameAvailable(id)) === false) return { ok: false, error: "この ID は、もうほかの人が使っています" };
  const { data, error } = await sb().auth.signUp({
    email: email.trim(),
    password,
    // ID は登録したときのプロフィールに入る（0009 の handle_new_user）
    options: { data: { display_name: displayName.trim(), username: id }, emailRedirectTo: callback(next), captchaToken },
  });
  if (error) return { ok: false, error: message(error) };
  // メールの確認が要る設定のときは、まだログインしていない
  if (!data.session) return { ok: true, message: "確認のメールを送りました。メールのリンクを開くと、登録が終わります" };
  return { ok: true };
}

export async function supaSignIn(email: string, password: string, captchaToken?: string): Promise<AuthResult> {
  const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password, options: { captchaToken } });
  return error ? { ok: false, error: message(error) } : { ok: true };
}

export async function supaSignInWithGoogle(next: string): Promise<AuthResult> {
  const { error } = await sb().auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback(next) } });
  return error ? { ok: false, error: message(error) } : { ok: true };
}

export async function supaRequestReset(email: string, captchaToken?: string): Promise<AuthResult> {
  const bad = checkEmail(email);
  if (bad) return { ok: false, error: bad };
  const { error } = await sb().auth.resetPasswordForEmail(email.trim(), { redirectTo: callback("/reset-password"), captchaToken });
  return error ? { ok: false, error: message(error) } : { ok: true };
}

/** 新しいパスワードにする（再設定のリンクから来たとき・設定から変えるとき） */
export async function supaUpdatePassword(password: string): Promise<AuthResult> {
  const bad = checkPassword(password);
  if (bad) return { ok: false, error: bad };
  const { error } = await sb().auth.updateUser({ password });
  return error ? { ok: false, error: message(error) } : { ok: true, message: "パスワードを変えました" };
}

/** 今のパスワードが合っているか（メールアドレスの変更やアカウントの削除の前に）。ロボットよけをオンにしていると token が要る */
export async function supaVerifyPassword(email: string, password: string, captchaToken?: string) {
  const { error } = await sb().auth.signInWithPassword({ email, password, options: { captchaToken } });
  return !error;
}

export async function supaChangeEmail(email: string): Promise<AuthResult> {
  const bad = checkEmail(email);
  if (bad) return { ok: false, error: bad };
  const { error } = await sb().auth.updateUser({ email: email.trim() }, { emailRedirectTo: callback("/") });
  return error
    ? { ok: false, error: message(error) }
    : { ok: true, message: "確認のメールを送りました。新しいメールアドレスに届いたリンクを開くと、変更が終わります" };
}

export async function supaSignOut() {
  // この端末に、ログアウトした人の通知が届かないようにする（ログインしている間に外す）
  await unsubscribePush();
  await sb().auth.signOut();
}

/** アカウントを削除する（supabase/migrations/0008 の delete_my_account を呼ぶ） */
export async function supaDeleteAccount(): Promise<AuthResult> {
  const { error } = await sb().rpc("delete_my_account");
  if (error) return { ok: false, error: `削除できませんでした（${error.message}）` };
  await sb().auth.signOut();
  return { ok: true };
}
