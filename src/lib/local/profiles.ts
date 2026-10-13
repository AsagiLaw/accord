import { db, newId, newMyMediaBox, type Profile } from "./db";

/** 新しい人を作る（マイメディアも一緒に用意する）。id を渡すとその ID で作る（Supabase のアカウントと揃えるとき） */
export async function createLocalProfile(displayName: string, opts: { id?: string; avatar?: string } = {}) {
  const profile: Profile = { id: opts.id ?? newId(), displayName, createdAt: Date.now(), ...(opts.avatar ? { avatar: opts.avatar } : {}) };
  await db.transaction("rw", db.profiles, db.mediaBoxes, async () => {
    await db.profiles.add(profile);
    await db.mediaBoxes.add(newMyMediaBox(profile.id));
  });
  return profile;
}

/**
 * Supabase でログインした人の、ブラウザの中のプロフィール。無ければ作る。
 * データはまだブラウザの中にあるので、Supabase のアカウントと同じ ID のプロフィールを用意して、今までの画面をそのまま使う
 */
export async function ensureLocalProfile(user: { id: string; email?: string; user_metadata?: Record<string, unknown> }) {
  if (await db.profiles.get(user.id)) return;
  const meta = user.user_metadata ?? {};
  const name = [meta.display_name, meta.full_name, meta.name].find((v): v is string => typeof v === "string" && !!v.trim());
  await createLocalProfile(name?.trim() ?? user.email?.split("@")[0] ?? "名前なし", { id: user.id });
}
