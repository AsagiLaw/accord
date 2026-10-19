"use client";

import { useEffect, useSyncExternalStore } from "react";
import { withFormulas } from "@/lib/requests/formula";
import { dueProp, dueStatus, dueText } from "@/lib/requests/due";
import { today } from "@/lib/requests/logic";
import { askNotifyPermission, showAppNotice } from "@/lib/notify";
import { db, type Profile } from "./db";

// 納期のブラウザの通知。出すかどうかは、人と端末（ブラウザ）ごとに覚える（ブラウザの許可も端末ごとのため）。
// サイトを開いている間、30分ごとに見て、納期が近い・今日・過ぎたページを、1ページにつき1日1回だけ知らせる

const KEY = (userId: string) => `irai-note:due-notify:${userId}`;
const EVENT = "irai-note:due-notify";
const read = (userId: string) => {
  try {
    return localStorage.getItem(KEY(userId)) === "1";
  } catch {
    return false;
  }
};

/** この端末で、納期の通知を出す設定か */
export function useDueNotify(userId: string | undefined) {
  return useSyncExternalStore(
    (fn) => {
      window.addEventListener(EVENT, fn);
      window.addEventListener("storage", fn);
      return () => {
        window.removeEventListener(EVENT, fn);
        window.removeEventListener("storage", fn);
      };
    },
    () => (userId ? read(userId) : false),
    () => false,
  );
}

/** 通知を出すかを決める。オンにするときは、ブラウザに許可を求める（断られたら false） */
export async function setDueNotify(userId: string, on: boolean): Promise<boolean> {
  if (on && !(await askNotifyPermission())) return false;
  try {
    if (on) localStorage.setItem(KEY(userId), "1");
    else localStorage.removeItem(KEY(userId));
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(EVENT));
  if (on) void checkDue(userId, true);
  return true;
}

/** 通知の許可の様子（ブラウザが通知を使えない・止めている） */
export { notifyPermission } from "@/lib/notify";

let running = false;

/** 納期が近いページを見て、まだ今日知らせていないものを通知する */
async function checkDue(userId: string, force = false) {
  if (running || typeof Notification === "undefined" || Notification.permission !== "granted" || (!force && !read(userId))) return;
  running = true;
  try {
    const me = await db.profiles.get(userId);
    // 取り込み中の間は、通知を控える
    if (me?.presence === "dnd") return;
    const rooms = (await db.roomMembers.where("userId").equals(userId).toArray()).map((m) => m.roomId);
    const databases = rooms.length ? await db.databases.where("roomId").anyOf(rooms).toArray() : [];
    const day = today();
    const fresh: { title: string; body: string; href: string; tag: string }[] = [];
    for (const d of databases) {
      if (!dueProp(d)) continue;
      const pages = withFormulas(d, (await db.dbPages.where("dbId").equals(d.id).toArray()).filter((p) => !p.deletedAt));
      for (const p of pages) {
        const st = dueStatus(d, p);
        if (!st) continue;
        const key = `irai-note:due-notified:${userId}:${p.id}`;
        try {
          if (localStorage.getItem(key) === day) continue;
          localStorage.setItem(key, day);
        } catch {
          continue;
        }
        fresh.push({
          title: `${p.title || "無題"}：${dueText(st)}`,
          body: `${d.name}・納期 ${st.date.replaceAll("-", "/")}`,
          href: `/r/${d.roomId}/db/${d.id}/p/${p.id}`,
          tag: `due:${p.id}:${day}`,
        });
      }
    }
    // 多いときは1つにまとめる
    const list = fresh.length > 3 ? [{ title: `納期が近いページが${fresh.length}件あります`, body: fresh.map((f) => f.title).join("\n"), href: fresh[0].href.replace(/\/p\/[^/]+$/, ""), tag: `due:all:${day}` }] : fresh;
    // Android の Chrome などでも出るよう、サービスワーカーから出す（押すとそのページへ）
    for (const f of list) await showAppNotice(f);
  } finally {
    running = false;
  }
}

/** アプリを開いている間、納期の通知を見る（すぐに1回、そのあと30分ごと） */
export function useDueNotifications(me: Pick<Profile, "id"> | null | undefined) {
  const id = me?.id;
  useEffect(() => {
    if (!id) return;
    const first = setTimeout(() => void checkDue(id), 3000);
    const timer = setInterval(() => void checkDue(id), 30 * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [id]);
}
