// ログインまわりの入力の決まり（ローカル版と Supabase 版で同じ）

export const PASSWORD_MIN = 8;

export type AuthResult = { ok: true; message?: string } | { ok: false; error: string };

export const normalizeEmail = (v: string) => v.trim().toLowerCase();

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** 入力を確かめる。問題があれば、その言葉を返す */
export function checkEmail(v: string) {
  return isEmail(v) ? null : "メールアドレスの形を確かめてください";
}
export function checkPassword(v: string) {
  return v.length >= PASSWORD_MIN ? null : `パスワードは${PASSWORD_MIN}文字以上にしてください`;
}

/** ログインのあとに戻る先。ほかのサイトへは飛ばさない（/ で始まり、// で始まらないものだけ） */
export function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
