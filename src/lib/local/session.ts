"use client";

import type { User } from "@supabase/supabase-js";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useSyncExternalStore } from "react";
import { authMode } from "@/lib/auth/mode";
import { createClient } from "@/lib/supabase/client";
import { db } from "./db";
import { ensureLocalProfile } from "./profiles";

// 今ログインしている人。
// ローカル版：このブラウザでログインしたアカウントの一覧（signed-in）と、タブごとに今どれで操作しているか（current-user）を覚える。
//   タブごとの値（sessionStorage）を優先するので、2つのタブで別々の人としてチャットを試せる。
// Supabase 版：Supabase のログインの状態をそのまま使う（データはまだブラウザの中なので、同じ ID のプロフィールを用意する）
const KEY = "irai-note:current-user";
const SIGNED_IN = "irai-note:signed-in";
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

function readSignedIn(): string {
  try {
    return localStorage.getItem(SIGNED_IN) ?? "[]";
  } catch {
    return "[]";
  }
}
const parseIds = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};
function writeSignedIn(ids: string[]) {
  try {
    localStorage.setItem(SIGNED_IN, JSON.stringify([...new Set(ids)]));
  } catch {
    // 保存できなくても、このページの間は効く
  }
}

/** このタブの今の人（ローカル版）。ログインしていなければ null */
function readLocal(): string | null {
  const list = parseIds(readSignedIn());
  try {
    const tab = sessionStorage.getItem(KEY);
    // このタブで使っていた人がログアウトしていたら、ほかの人に替えず、ログインの画面へ
    if (tab) return list.includes(tab) ? tab : null;
    const last = localStorage.getItem(KEY);
    if (last && list.includes(last)) return last;
  } catch {
    // 読めないときは、ログインしているアカウントの最初の人
  }
  return list[0] ?? null;
}

/** このタブで操作する人を替える（ローカル版。ログインしている人だけ） */
export function setCurrentUser(id: string) {
  try {
    sessionStorage.setItem(KEY, id);
    localStorage.setItem(KEY, id);
  } catch {
    // 保存できない環境では、このタブの間だけ有効
  }
  notify();
}

/** ローカル版：ログインした（このブラウザのログインの一覧に入れて、このタブで使う） */
export function signInLocalSession(userId: string) {
  writeSignedIn([userId, ...parseIds(readSignedIn())]);
  setCurrentUser(userId);
}

/** ローカル版：今の人をログアウトする（ほかにログインしているアカウントはそのまま） */
export function signOutLocalSession(userId: string) {
  writeSignedIn(parseIds(readSignedIn()).filter((id) => id !== userId));
  try {
    if (sessionStorage.getItem(KEY) === userId) sessionStorage.removeItem(KEY);
    if (localStorage.getItem(KEY) === userId) localStorage.removeItem(KEY);
  } catch {
    // 消せなくても、一覧から外れたのでログアウトになる
  }
  notify();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

/** このブラウザでログインしているアカウント（ローカル版の切り替え用） */
export function useSignedInIds() {
  const raw = useSyncExternalStore(subscribe, readSignedIn, () => "[]");
  return useMemo(() => parseIds(raw), [raw]);
}

// --- Supabase 版 ---------------------------------------------------------------

/** Supabase のログインしている人。確かめるまでは undefined */
let supaUser: User | null | undefined;
let supaStarted = false;

async function setSupaUser(user: User | null) {
  if (user) await ensureLocalProfile(user);
  supaUser = user;
  notify();
}

function startSupabase() {
  // ローカル版では Supabase につながない
  if (supaStarted || typeof window === "undefined" || authMode !== "supabase") return;
  supaStarted = true;
  const sb = createClient();
  void sb.auth.getSession().then(({ data }) => setSupaUser(data.session?.user ?? null));
  sb.auth.onAuthStateChange((_event, session) => void setSupaUser(session?.user ?? null));
}

/** Supabase のログインしている人（メールアドレスやログインの方法を出すとき） */
export function useSupabaseUser() {
  return useSyncExternalStore(
    (fn) => {
      startSupabase();
      return subscribe(fn);
    },
    () => supaUser,
    () => undefined,
  );
}

// -------------------------------------------------------------------------------

/** 今ログインしている人の ID。確かめている間は undefined、ログインしていなければ null */
export function useCurrentUserId(): string | null | undefined {
  const local = useSyncExternalStore(subscribe, readLocal, () => undefined);
  const supa = useSupabaseUser();
  return authMode === "supabase" ? (supa === undefined ? undefined : (supa?.id ?? null)) : local;
}

/** 今ログインしている人のプロフィール。読み込み中は undefined、ログインしていなければ null */
export function useCurrentUser() {
  const id = useCurrentUserId();
  const found = useLiveQuery(async () => (id ? ((await db.profiles.get(id)) ?? null) : null), [id]);
  if (id === undefined) return undefined;
  if (id === null) return null;
  // 前の人の結果が残っている間は、読み込み中として扱う
  return found && found.id !== id ? undefined : found;
}
