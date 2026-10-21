"use client";

import { liveQuery } from "dexie";
import { useEffect, useSyncExternalStore } from "react";
import { askNotifyPermission, notifyPermission, showAppNotice, type AppNotice } from "@/lib/notify";
import { subscribePush, unsubscribePush } from "@/lib/push";
import { db, type Chat, type Message } from "./db";

// チャットのブラウザの通知。アプリを開いている間、ほかの人の発言が届いたら知らせる（閉じているときは、プッシュ通知：src/lib/push.ts）。
// 出すかどうかは、人と端末（ブラウザ）ごとに覚える（ブラウザの許可も端末ごとのため）。チャットごとに切れる（chatReads.muted。どの端末でも同じ）。
// 取り込み中の間と、もう読んだ発言（そのチャットを開いている画面では、すぐ既読になる）は知らせない

const KEY = (userId: string) => `irai-note:chat-notify:${userId}`;
const EVENT = "irai-note:chat-notify";
const read = (userId: string) => {
  try {
    return localStorage.getItem(KEY(userId)) === "1";
  } catch {
    return false;
  }
};

/** この端末で、チャットの通知を出す設定か */
export function useChatNotify(userId: string | undefined) {
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

/** 通知を出すかを決める。オンにするときは、ブラウザに許可を求める（断られたら false。ボタンを押した流れのまま呼ぶこと） */
export async function setChatNotify(userId: string, on: boolean): Promise<boolean> {
  if (on && !(await askNotifyPermission())) return false;
  try {
    if (on) localStorage.setItem(KEY(userId), "1");
    else localStorage.removeItem(KEY(userId));
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(EVENT));
  // アプリを閉じているときも、この端末に届くようにする（外すときは届かないようにする）
  void (on ? subscribePush() : unsubscribePush());
  return true;
}

/** そのチャットを開く画面と、通知の見出しに出す場所の名前（ルームのチャット・依頼ページ・ノート・ウィンドウ・DM） */
async function placeOf(chat: Chat): Promise<{ href: string; name: string }> {
  if (chat.dm) return { href: `/dm/${chat.id}`, name: "" };
  const room = `/r/${chat.roomId}`;
  const owner = chat.pageId ?? "";
  const [kind, id] = owner.includes(":") ? owner.split(":") : [owner ? "page" : "", owner];
  if (kind === "note") {
    const note = await db.notes.get(id);
    // ページの項目などの中のノートは、そのページで開く
    if (note?.pageId) return pageLink(note.pageId, chat.name);
    return { href: `${room}/note/${id}`, name: `${note?.title || "ノート"}・${chat.name}` };
  }
  if (kind === "window") {
    const win = await db.windows.get(id);
    return { href: `${room}/window/${id}`, name: `${win?.name || "ウィンドウ"}・${chat.name}` };
  }
  if (kind === "page") return pageLink(id, chat.name);
  if (!kind) return { href: `${room}/chat/${chat.id}`, name: `#${chat.name}` };
  return { href: room, name: chat.name };
}

async function pageLink(pageId: string, chatName: string) {
  const page = await db.dbPages.get(pageId);
  if (!page) return { href: "/", name: chatName };
  const title = page.title || "無題";
  return { href: `/r/${page.roomId}/db/${page.dbId}/p/${page.id}`, name: `${title}・${chatName}` };
}

/** その人がそのチャットを見られるか（DM の2人・ルームのメンバーで、話せる人が決まっていればその中） */
async function canSee(chat: Chat, userId: string) {
  if (chat.dm) return chat.dm.includes(userId);
  if (chat.allowed && !chat.allowed.includes(userId)) return false;
  return !!(await db.roomMembers.get([chat.roomId, userId]));
}

/** 発言の通知の見出しと本文（読む人によらない。アプリを閉じている人へのプッシュ通知も、書いた人のアプリでこれを作る） */
export async function noticeOf(m: Message): Promise<AppNotice | null> {
  const chat = await db.chats.get(m.chatId);
  if (!chat) return null;
  const author = await db.profiles.get(m.authorId);
  // 再現・イメージチャットは、話者（イメージユーザー）の名前で
  const imageUser = m.speaker ? await db.imageUsers.get(m.speaker) : undefined;
  const who = imageUser?.name ?? m.speaker ?? author?.displayName ?? "だれか";
  // ルームへの招待のカードは、招待したルームの名前で
  const invited = m.inviteId ? await db.roomInvites.get(m.inviteId) : undefined;
  const invitedRoom = invited ? (await db.rooms.get(invited.roomId))?.name : undefined;
  const text = m.text.trim() || (m.inviteId ? `ルーム「${invitedRoom ?? "（削除されたルーム）"}」に招待しました` : m.mediaIds.length ? `画像を${m.mediaIds.length}枚送りました` : "");
  const place = await placeOf(chat);
  const roomName = chat.roomId ? (await db.rooms.get(chat.roomId))?.name : undefined;
  // DM は LINE と同じく、見出しに送った人・本文に発言。ルームのチャットは、見出しに場所・本文に「送った人：発言」
  return chat.dm
    ? { title: who, body: text, tag: `chat:${m.id}`, href: place.href, icon: author?.avatar }
    : { title: roomName ? `${place.name}（${roomName}）` : place.name, body: `${who}：${text}`, tag: `chat:${m.id}`, href: place.href, icon: author?.avatar };
}

/** 届いた発言のうち、知らせるものを通知にする。多いときは1つにまとめる */
async function notify(userId: string, messages: Message[]) {
  if (!read(userId) || notifyPermission() !== "granted") return;
  const me = await db.profiles.get(userId);
  // 取り込み中の間は、通知を控える（未読の数は数えたまま）
  if (me?.presence === "dnd") return;
  const notices: AppNotice[] = [];
  for (const m of messages) {
    const chat = await db.chats.get(m.chatId);
    if (!chat || !(await canSee(chat, userId))) continue;
    const state = await db.chatReads.get([chat.id, userId]);
    // 通知を切ったチャットと、もう読んだ発言（開いている画面で読んだ）は知らせない
    if (state?.muted || (state?.lastReadAt ?? 0) >= m.createdAt) continue;
    const notice = await noticeOf(m);
    if (notice) notices.push(notice);
  }
  const list =
    notices.length > 3
      ? [{ title: `新しい発言が${notices.length}件あります`, body: notices.map((n) => n.body).join("\n"), tag: `chat:${messages.at(-1)!.id}`, href: notices.at(-1)!.href }]
      : notices;
  for (const n of list) await showAppNotice(n);
}

/** そのチャットを開いている画面が既読にするのを待ってから、まだ読んでいない発言だけを知らせる */
const SETTLE = 1500;

/** アプリを開いている間、届いた発言を見て通知する（Housekeeping に置く） */
export function useChatNotifications(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    // 通知をオンにした端末は、開くたびに届け先を覚え直す（別の人がログインし直したときも、その人の届け先になる）
    if (read(userId)) void subscribePush();
    // 開いた時刻より後の発言だけ（前から届いていたものは、未読の数で分かる）
    const since = Date.now();
    const seen = new Set<string>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const sub = liveQuery(() => db.messages.where("createdAt").above(since).toArray()).subscribe({
      next: (list) => {
        // 自分の発言と、もう見た発言（直した発言も、もう一度は知らせない）は除く
        const fresh = list.filter((m) => m.authorId !== userId && !seen.has(m.id));
        if (!fresh.length) return;
        for (const m of fresh) seen.add(m.id);
        const t = setTimeout(() => {
          timers.delete(t);
          void notify(userId, fresh);
        }, SETTLE);
        timers.add(t);
      },
      error: () => {},
    });
    return () => {
      sub.unsubscribe();
      for (const t of timers) clearTimeout(t);
    };
  }, [userId]);
}
