"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db, newId, type Presence, type PresenceTab } from "./db";

// オンラインかどうか（ローカル版）：サイトを開いている間だけオンラインにする。
// タブごとに「開いている」と数秒おきに知らせ、知らせが途切れた人はオフライン。
// サイトを開いていても、しばらく操作が無ければ退席中（自分で「オンライン」を選んでいるときだけ）。
// サーバー版では、知らせる先を Supabase の Realtime Presence に置き換える

/** 開いていると知らせる間隔 */
const BEAT = 15_000;
/** 知らせがこれだけ途切れたら、タブは閉じたものとみなす */
const GONE = BEAT * 3;
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
      void db.presenceTabs.put({ tabId: TAB_ID, userId, beatAt: Date.now(), activeAt });
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
  const tabs = useLiveQuery(() => db.presenceTabs.toArray(), []);
  const now = useNow();
  return (person: { id: string; presence?: Presence }): ShownPresence => shownPresence(person, tabs, now, viewerId);
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
