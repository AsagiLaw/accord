"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { firstUnread, olderFrom, useMessagesSince } from "@/lib/local/chat";
import type { Message } from "@/lib/local/db";

/** 一度に読み込む発言の数 */
const PAGE = 50;
export const JUMP_EVENT = "irai-note:chat-jump";
type JumpDetail = { chatId: string; id: string; createdAt: number };

/**
 * チャットの発言を全部は読まず、新しい方から少しずつ読み込む（Discord と同じ）。
 * 最初は最新の 50 件。上の端まで戻ると、その前の 50 件を足す。一番下に戻ると、また最新の 50 件に減らす。
 * 新しい発言は、読み込んでいる範囲の後ろに足されるので、古い発言を読んでいる間に来ても位置はずれない。
 * 読んでいない発言が溜まっているときは、最初の未読の少し前から読み込む（unreadId：最初の未読。「ここから未読」の線を引く）
 */
export function useMessageWindow(chatId: string, meId: string) {
  // 発言一覧（スクロールする箱）。スクロールしたときに覚える
  const list = useRef<HTMLElement | null>(null);
  // この時刻から後の発言を読み込む（チャットが変わったら、決まるまで読まない）
  const [range, setRange] = useState<{ chatId: string; from: number }>();
  const data = useMessagesSince(chatId, range?.chatId === chatId ? range.from : undefined);
  const loading = useRef(false);
  // 古い発言を足したとき、見ていた位置がずれないように、下からの距離を覚えておく
  const keep = useRef<number | null>(null);
  // 検索から飛んできた、まだ読み込んでいない発言
  const pending = useRef<string | null>(null);

  const readFrom = async (before: number | null, count: number) => {
    const from = await olderFrom(chatId, before, count);
    setRange({ chatId, from });
  };

  // 開いたときの最初の未読（開いている間は、読んでも線を残す。自分が発言したら消す）
  const [unread, setUnread] = useState<{ chatId: string; id: string }>();
  // 未読を調べ直し終えた回数
  const [located, setLocated] = useState(0);

  useEffect(() => {
    void (async () => {
      const first = await firstUnread(chatId, meId);
      const latest = await olderFrom(chatId, null, PAGE);
      // 未読が多くて最新の 50 件に入らないときは、最初の未読の少し前から読む
      const from = first ? Math.min(latest, await olderFrom(chatId, first.createdAt, 10)) : latest;
      setUnread(first ? { chatId, id: first.id } : undefined);
      setRange({ chatId, from });
    })();
  }, [chatId, meId]);

  const messages = data?.messages;
  const hasOlder = !!data?.hasOlder;
  const firstId = messages?.[0]?.id;

  /** 古い発言を足す。box は発言一覧（スクロールする箱） */
  const loadOlder = async (box?: HTMLElement | null) => {
    if (box) list.current = box;
    const el = list.current;
    const first = messages?.[0];
    if (!hasOlder || !first || loading.current) return;
    loading.current = true;
    if (el) keep.current = el.scrollHeight - el.scrollTop;
    // 同じ時刻の発言を取りこぼさないよう、いちばん古い発言も含めて数える
    await readFrom(first.createdAt, PAGE + 1);
  };

  useLayoutEffect(() => {
    const el = list.current;
    if (el && keep.current !== null) el.scrollTop = el.scrollHeight - keep.current;
    keep.current = null;
    loading.current = false;
  }, [firstId]);

  /** 発言一覧の onScroll に付ける */
  const onScroll = (el: HTMLElement) => {
    list.current = el;
    if (!messages) return;
    if (el.scrollTop < 200) void loadOlder();
    // 一番下まで戻ったら、たくさん読み込んだ古い発言を手放す
    else if (el.scrollHeight - el.scrollTop - el.clientHeight < 20 && messages.length > PAGE * 2 && !pending.current) void readFrom(null, PAGE);
  };

  // 検索から飛んできたとき：読み込んでいなければ、その発言の少し前から読み込み直してから動く
  useEffect(() => {
    const onJump = (e: Event) => {
      const d = (e as CustomEvent<JumpDetail>).detail;
      if (d.chatId !== chatId) return;
      if (messages?.some((m) => m.id === d.id)) return flash(d.id);
      pending.current = d.id;
      void olderFrom(chatId, d.createdAt, 10).then((from) => setRange({ chatId, from }));
    };
    window.addEventListener(JUMP_EVENT, onJump);
    return () => window.removeEventListener(JUMP_EVENT, onJump);
  }, [chatId, messages]);

  useLayoutEffect(() => {
    const id = pending.current;
    if (id && messages?.some((m) => m.id === id)) {
      pending.current = null;
      flash(id);
    }
  }, [messages]);

  const unreadId = unread?.chatId === chatId ? unread.id : null;
  /** 「ここから未読」の線を消す（自分が発言したとき） */
  const dismissUnread = () => setUnread(undefined);
  /** 未読を調べ直す（隠れていたチャットが見えるようになったとき） */
  const relocate = () => {
    void firstUnread(chatId, meId).then((first) => {
      setUnread(first ? { chatId, id: first.id } : undefined);
      setLocated((n) => n + 1);
    });
  };

  return { messages, hasOlder, loadOlder, onScroll, unreadId, dismissUnread, located, relocate };
}

/** 開いているチャットの、その発言まで動いて、少しのあいだ光らせる（読み込んでいなければ読み込む） */
export function jumpToMessage(chatId: string, m: Pick<Message, "id" | "createdAt">) {
  window.dispatchEvent(new CustomEvent<JumpDetail>(JUMP_EVENT, { detail: { chatId, id: m.id, createdAt: m.createdAt } }));
}

/** 同じチャットを2か所で開いていることもあるので、見えている方を動かす */
function flash(id: string) {
  const el = [...document.querySelectorAll<HTMLElement>(`[data-msg="${CSS.escape(id)}"]`)].find((x) => x.offsetParent !== null);
  if (!el) return;
  // 遠いときは、なめらかに動くと時間がかかるので、すぐに動く
  el.scrollIntoView({ block: "center", behavior: Math.abs(el.getBoundingClientRect().top) > window.innerHeight * 2 ? "instant" : "smooth" });
  el.classList.remove("msg-flash");
  void el.offsetWidth;
  el.classList.add("msg-flash");
  setTimeout(() => el.classList.remove("msg-flash"), 1800);
}
