// アカウントの ID（Discord のユーザー名と同じ決まり）。ほかの人と重ならず、フレンドの申請はこの ID で送る。
// ローカル版と Supabase 版で同じ決まりを使う（Supabase 版の確かめは supabase/migrations/0009）

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 32;

/** ID の決まりの説明（入力欄の下に出す） */
export const USERNAME_RULE = `半角の英小文字・数字・「_」「.」で${USERNAME_MIN}〜${USERNAME_MAX}文字`;

/** 入れた文字を ID の形にそろえる：全角は半角に、大文字は小文字に。前後の空白と、頭の「@」は外す */
export const normalizeUsername = (v: string) =>
  v
    .normalize("NFKC")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

/** ID の形を確かめる（normalizeUsername のあとの文字で）。問題があれば、その言葉を返す */
export function checkUsername(v: string): string | null {
  if (!v) return "ID を入れてください";
  if (!/^[a-z0-9_.]+$/.test(v)) return "ID に使えるのは、半角の英小文字・数字・「_」「.」だけです";
  if (v.length < USERNAME_MIN || v.length > USERNAME_MAX) return `ID は${USERNAME_MIN}〜${USERNAME_MAX}文字にしてください`;
  if (v.includes("..")) return "ID に「.」を2つ続けることはできません";
  return null;
}

/** 名前やメールアドレスから、ID の元にする文字を取り出す（使えない文字は外す）。使えるものが残らなければ空 */
export function usernameBase(text: string) {
  return normalizeUsername(text)
    .replace(/[^a-z0-9_.]+/g, "")
    .replace(/\.{2,}/g, ".")
    .slice(0, USERNAME_MAX - 5);
}

/**
 * 重ならない ID を作る（自分で決めていない人の、仮の ID）。元にする文字が使えればそれを、
 * 使えなければ後ろに数字を付け、元にする文字が無ければ「user」と数字にする
 */
export async function makeUsername(base: string, taken: (name: string) => Promise<boolean> | boolean) {
  const head = usernameBase(base);
  if (head && !checkUsername(head) && !(await taken(head))) return head;
  const stem = head.length >= USERNAME_MIN ? head : "user";
  for (let digits = 4; ; digits++) {
    for (let i = 0; i < 20; i++) {
      const name = `${stem}${Math.floor(Math.random() * 10 ** digits)
        .toString()
        .padStart(digits, "0")}`;
      if (!(await taken(name))) return name;
    }
  }
}
