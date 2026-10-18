import { checkUsername, makeUsername, normalizeUsername } from "@/lib/username";
import { db, newId, newMyMediaBox, type Profile } from "./db";

/** その ID を、もうほかの人が使っているか（except は自分） */
export async function usernameTaken(username: string, except?: string) {
  const found = await db.profiles.where("username").equals(username).first();
  return !!found && found.id !== except;
}

/** ID がちょうど同じ人（ID は重ならないので、いても1人）。入れた文字は ID の形にそろえてから探す */
export async function findProfileByUsername(text: string) {
  const username = normalizeUsername(text);
  return username ? db.profiles.where("username").equals(username).first() : undefined;
}

/**
 * 新しい人を作る（マイメディアも一緒に用意する）。id を渡すとその ID で作る（Supabase のアカウントと揃えるとき）。
 * username（アカウントの ID）を渡さないか、もう使われていれば、名前から仮の ID を作る
 */
export async function createLocalProfile(displayName: string, opts: { id?: string; avatar?: string; username?: string } = {}) {
  return db.transaction("rw", db.profiles, db.mediaBoxes, async () => {
    const wanted = normalizeUsername(opts.username ?? "");
    const username = wanted && !checkUsername(wanted) && !(await usernameTaken(wanted)) ? wanted : await makeUsername(displayName, (n) => usernameTaken(n));
    const profile: Profile = { id: opts.id ?? newId(), displayName, username, createdAt: Date.now(), ...(opts.avatar ? { avatar: opts.avatar } : {}) };
    await db.profiles.add(profile);
    await db.mediaBoxes.add(newMyMediaBox(profile.id));
    return profile;
  });
}

/** 自分の ID を変える。形が違う・ほかの人が使っているときは、その言葉を返す */
export async function changeUsername(userId: string, text: string): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  const username = normalizeUsername(text);
  const bad = checkUsername(username);
  if (bad) return { ok: false, error: bad };
  return db.transaction("rw", db.profiles, async () => {
    if (await usernameTaken(username, userId)) return { ok: false as const, error: "この ID は、もうほかの人が使っています" };
    await db.profiles.update(userId, { username });
    return { ok: true as const, username };
  });
}

/**
 * Supabase でログインした人の、ブラウザの中のプロフィール。無ければ作る。
 * データはまだブラウザの中にあるので、Supabase のアカウントと同じ ID のプロフィールを用意して、今までの画面をそのまま使う。
 * アカウントの ID は、登録のときに決めたもの（Google で登録した人は、名前から仮の ID）
 */
export async function ensureLocalProfile(user: { id: string; email?: string; user_metadata?: Record<string, unknown> }) {
  if (await db.profiles.get(user.id)) return;
  const meta = user.user_metadata ?? {};
  const name = [meta.display_name, meta.full_name, meta.name].find((v): v is string => typeof v === "string" && !!v.trim());
  const username = typeof meta.username === "string" ? meta.username : undefined;
  await createLocalProfile(name?.trim() ?? user.email?.split("@")[0] ?? "名前なし", { id: user.id, username });
}
