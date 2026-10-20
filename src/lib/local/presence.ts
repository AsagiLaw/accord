"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState, useSyncExternalStore } from "react";
import { db, newId, type Presence, type PresenceTab } from "./db";
import { sb, supa } from "./sync";

// オンラインかどうか：サイトを開いている間だけオンラインにする。
// タブごとに「開いている」としばらくおきに知らせ、知らせが途切れた人はオフライン。
// サイトを開いていても、しばらく操作が無ければ退席中（自分で「オンライン」を選んでいるときだけ）。
// ローカル版はブラウザの中（presenceTabs）に、Supabase 版は Supabase（presence_beats：0015）に知らせる。
// Supabase 版では、見せてよい人（フレンド・同じルームの人）の知らせだけを、しばらくおきに読む

/** 開いていると知らせる間隔（Supabase 版は、通信を減らすため長め） */
const BEAT = supa ? 30_000 : 15_000;
/** 知らせがこれだけ途切れたら、タブは閉じたものとみなす（Supabase 版は、読む間隔のぶん長め） */
const GONE = supa ? 80_000 : BEAT * 3;
/** 操作がこれだけ無ければ退席中（Discord と同じ10分） */
export const IDLE_AFTER = 10 * 60_000;
/** 操作を知らせ直す間隔（操作のたびに書き込まないよう、これより短い間はまとめる） */
const ACTIVE_WRITE = 30_000;

/** 画面に出す状態：自分で選んだ4つに、オフライン（サイトを開いていない）を足したもの */
export type ShownPresence = Presence | "offline";

/** このタブの印（ページを読み込むたびに新しくする。タブを複製しても別のタブになるように） */
const TAB_ID = typeof window === "undefined" ? "" : newId();

/**
 * このタブで操作している人として「開いている」と知らせ続ける。利用者を切り替えたら、その人として知らせ直す。
 * タブを閉じたら行を消す（消せなくても、知らせが途切れればオフラインになる）
 */
export function usePresenceBeacon(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    let activeAt = Date.now();
    let writtenActiveAt = activeAt;
    const write = () => {
      writtenActiveAt = activeAt;
      // 自分の画面には、自分の状態をすぐ出す（ブラウザの中にも書く）
      void db.presenceTabs.put({ tabId: TAB_ID, userId, beatAt: Date.now(), activeAt });
      // rpc は then を呼ぶまで送られないので、結果を受け取る形にする
      if (supa) void sb().rpc("presence_beat", { idle_seconds: Math.round((Date.now() - activeAt) / 1000) }).then(() => undefined);
    };
    write();
    const timer = window.setInterval(() => {
      write();
      // 閉じたまま残った古いタブの行を片付ける
      void db.presenceTabs.filter((t) => t.beatAt < Date.now() - GONE * 4).delete();
    }, BEAT);

    const onActive = () => {
      activeAt = Date.now();
      // 退席中から戻ったときなどは、次の知らせを待たずにすぐ書く
      if (activeAt - writtenActiveAt > ACTIVE_WRITE) write();
    };
    const onVisible = () => document.visibilityState === "visible" && onActive();
    const remove = () => void db.presenceTabs.delete(TAB_ID);
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, onActive, { passive: true }));
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", remove);
    return () => {
      window.clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, onActive));
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", remove);
      remove();
    };
  }, [userId]);
}

/** 今の時刻（数秒おきに進める）。知らせが途切れた人や、操作が無くなった人、ひとことの期限を見直すため */
export function useNow(every = BEAT / 3) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(t);
  }, [every]);
  return now;
}

/**
 * 人の状態を決める関数を返す。viewerId は見ている人（自分のオフライン表示は、自分には「オフライン表示」と見せる）。
 * 読み込み中は、選んだ状態をそのまま返す
 */
export function useShownPresence(viewerId: string | undefined) {
  const local = useLiveQuery(() => db.presenceTabs.toArray(), []);
  const remote = useRemoteTabs();
  const now = useNow();
  // Supabase 版：ほかの人は Supabase から読んだ知らせ、自分はこのブラウザの知らせも使う
  const tabs = supa ? (local && remote ? [...remote, ...local.filter((t) => t.userId === viewerId)] : undefined) : local;
  // ほかの人が選んだ状態も、プロフィールより新しいものが届いていればそちらを使う（自分は自分のプロフィール）
  return (person: { id: string; presence?: Presence }): ShownPresence => {
    const chosen = person.id === viewerId ? undefined : remote?.find((t) => t.userId === person.id)?.presence;
    return shownPresence(chosen ? { ...person, presence: chosen } : person, tabs, now, viewerId);
  };
}

// ---- Supabase 版：ほかの人の知らせを読む ----

/** ほかの人の知らせ。presence はその人が選んだ状態（0016） */
type RemoteTab = PresenceTab & { presence?: Presence };

let remoteTabs: RemoteTab[] | undefined;
const remoteListeners = new Set<() => void>();
let remoteTimer: ReturnType<typeof setInterval> | null = null;

async function readRemote() {
  const { data, error } = await sb().rpc("presence_list");
  if (error) return;
  const now = Date.now();
  // 何秒前かで届くので、このパソコンの時計に直す
  remoteTabs = ((data ?? []) as { user_id: string; beat_ago: number; active_ago: number; presence?: string }[]).map((r) => ({
    tabId: `remote:${r.user_id}`,
    userId: r.user_id,
    beatAt: now - r.beat_ago * 1000,
    activeAt: now - r.active_ago * 1000,
    ...(r.presence === "online" || r.presence === "idle" || r.presence === "dnd" || r.presence === "invisible" ? { presence: r.presence as Presence } : {}),
  }));
  remoteListeners.forEach((f) => f());
}

const onRemoteVisible = () => {
  if (document.visibilityState === "visible") void readRemote();
};

function subscribeRemote(f: () => void) {
  remoteListeners.add(f);
  if (supa && !remoteTimer) {
    void readRemote();
    // 画面が見えている間だけ読む（見えていないタブで通信しない）
    remoteTimer = setInterval(() => {
      if (document.visibilityState === "visible") void readRemote();
    }, BEAT);
    document.addEventListener("visibilitychange", onRemoteVisible);
  }
  return () => {
    remoteListeners.delete(f);
    if (!remoteListeners.size && remoteTimer) {
      clearInterval(remoteTimer);
      remoteTimer = null;
      document.removeEventListener("visibilitychange", onRemoteVisible);
    }
  };
}

/** ほかの人の知らせ（Supabase 版）。読み込み中は undefined。ローカル版では使わない */
function useRemoteTabs() {
  return useSyncExternalStore(subscribeRemote, () => remoteTabs, () => undefined);
}

export function shownPresence(person: { id: string; presence?: Presence }, tabs: PresenceTab[] | undefined, now: number, viewerId?: string): ShownPresence {
  const chosen = person.presence ?? "online";
  const self = person.id === viewerId;
  if (chosen === "invisible") return self ? "invisible" : "offline";
  if (!tabs) return chosen;
  const open = tabs.filter((t) => t.userId === person.id && t.beatAt > now - GONE);
  if (!open.length) return "offline";
  // どれかのタブで最近操作していればオンライン。自分で退席中・取り込み中を選んでいれば、そのまま
  const lastActive = Math.max(...open.map((t) => t.activeAt));
  if (chosen === "online" && lastActive < now - IDLE_AFTER) return "idle";
  return chosen;
}
