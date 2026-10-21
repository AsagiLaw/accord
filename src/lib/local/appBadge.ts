"use client";

import Dexie, { liveQuery } from "dexie";
import { useEffect } from "react";
import { db } from "./db";

// ホーム画面のアイコン（インストールしたアプリ）の右上に、チャットの未読の数を出す（Badging API）。
// アプリを開いている間はここで数え直す。閉じている間は、プッシュ通知が届くたびにサービスワーカー（public/media-sw.js）が1つ足す。
// 今の数は、サービスワーカーからも読めるところ（Cache Storage）に覚えておく。
// 使えるのは iPhone（ホーム画面に追加したアプリで、通知を許可したとき）とパソコンの Chrome・Edge。Android は、通知の数が印になる

const CACHE = "accord-badge";
const KEY = "/accord-badge-count";

/** 見られるチャット（DM と、メンバーのルームのチャット。話せる人が決まっていればその中）の、自分以外の未読の発言の数 */
async function countUnread(userId: string) {
  const rooms = (await db.roomMembers.where("userId").equals(userId).toArray()).map((m) => m.roomId);
  const chats = [...(await db.chats.where("dm").equals(userId).toArray()), ...(rooms.length ? await db.chats.where("roomId").anyOf(rooms).toArray() : [])].filter(
    (c) => !c.allowed || c.allowed.includes(userId),
  );
  const reads = new Map((await db.chatReads.where("userId").equals(userId).toArray()).map((r) => [r.chatId, r.lastReadAt]));
  const counts = await Promise.all(
    chats.map((c) =>
      db.messages
        .where("[chatId+createdAt]")
        .between([c.id, reads.get(c.id) ?? 0], [c.id, Dexie.maxKey], false, true)
        .filter((m) => m.authorId !== userId)
        .count(),
    ),
  );
  return counts.reduce((a, b) => a + b, 0);
}

async function setBadge(n: number) {
  try {
    if (n > 0) await navigator.setAppBadge?.(n);
    else await navigator.clearAppBadge?.();
  } catch {
    // 使えない端末・許可が無いとき
  }
  try {
    await (await caches.open(CACHE)).put(KEY, new Response(String(n)));
  } catch {
    // 覚えられなくても、開いている間のバッジは出る
  }
}

/** アプリを開いている間、未読の数をアイコンのバッジにする（Housekeeping に置く）。ログアウトしたら消す */
export function useAppBadge(userId: string | undefined) {
  useEffect(() => {
    if (!userId) {
      void setBadge(0);
      return;
    }
    const sub = liveQuery(() => countUnread(userId)).subscribe({ next: (n) => void setBadge(n), error: () => {} });
    return () => sub.unsubscribe();
  }, [userId]);
}
