"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { sb, supa } from "./sync";

// 「○○が入力中…」（Discord と同じ）。打っている間は数秒おきに知らせ、送ったら（欄を空にしたら）やめたと知らせる。
// 知らせは残さない。Supabase 版は Realtime の broadcast（チャンネル「typing:チャットの ID」。見られる人だけ：0023）、
// ローカル版は同じブラウザのタブの間（BroadcastChannel）で届ける

/** 打っている間、この間隔で知らせる */
const EVERY = 3000;
/** 知らせが途切れてから、この時間で「入力中」を消す */
const TTL = 6000;

type Ping = { chatId: string; userId: string; stop?: boolean };
type Listener = (p: Ping) => void;

/** 同じチャットを2か所で開いていても、つながりは1つにする */
const hubs = new Map<string, { send: (p: Ping) => void; listeners: Set<Listener>; close: () => void }>();

function join(chatId: string, listener: Listener) {
  let hub = hubs.get(chatId);
  if (!hub) {
    const listeners = new Set<Listener>();
    const deliver = (p: Ping) => {
      if (p?.chatId === chatId) for (const l of listeners) l(p);
    };
    if (supa) {
      const ch: RealtimeChannel = sb()
        .channel(`typing:${chatId}`, { config: { private: true } })
        .on("broadcast", { event: "typing" }, ({ payload }) => deliver(payload as Ping))
        .subscribe();
      hub = { listeners, send: (p) => void ch.send({ type: "broadcast", event: "typing", payload: p }), close: () => void sb().removeChannel(ch) };
    } else {
      const bc = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("accord:typing");
      if (bc) bc.onmessage = (e) => deliver(e.data as Ping);
      hub = { listeners, send: (p) => bc?.postMessage(p), close: () => bc?.close() };
    }
    hubs.set(chatId, hub);
  }
  hub.listeners.add(listener);
  const h = hub;
  return {
    send: (p: Ping) => h.send(p),
    leave: () => {
      h.listeners.delete(listener);
      if (h.listeners.size) return;
      h.close();
      hubs.delete(chatId);
    },
  };
}

/** そのチャットで入力中のほかの人（ID）と、自分が打っていることを知らせる ping・やめたと知らせる stop */
export function useTyping(chatId: string, meId: string) {
  const [typers, setTypers] = useState<string[]>([]);
  const send = useRef<(p: Ping) => void>(() => {});
  const lastSent = useRef(0);

  useEffect(() => {
    const until = new Map<string, number>();
    const update = () => setTypers([...until.keys()]);
    const conn = join(chatId, (p) => {
      if (p.userId === meId) return;
      if (p.stop) until.delete(p.userId);
      else until.set(p.userId, Date.now() + TTL);
      update();
    });
    send.current = conn.send;
    const tick = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, t] of until)
        if (t < now) {
          until.delete(id);
          changed = true;
        }
      if (changed) update();
    }, 1000);
    return () => {
      clearInterval(tick);
      // 閉じるときに打っていたら、やめたと知らせる
      if (lastSent.current) conn.send({ chatId, userId: meId, stop: true });
      lastSent.current = 0;
      send.current = () => {};
      conn.leave();
    };
  }, [chatId, meId]);

  const ping = useCallback(() => {
    const now = Date.now();
    if (now - lastSent.current < EVERY) return;
    lastSent.current = now;
    send.current({ chatId, userId: meId });
  }, [chatId, meId]);

  const stop = useCallback(() => {
    if (!lastSent.current) return;
    lastSent.current = 0;
    send.current({ chatId, userId: meId, stop: true });
  }, [chatId, meId]);

  return { typers, ping, stop };
}
