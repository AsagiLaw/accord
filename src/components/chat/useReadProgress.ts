"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { markRead } from "@/lib/local/chat";
import type { Message } from "@/lib/local/db";

/**
 * 既読は、実際に画面に出た発言の分だけ付ける（Discord と同じ）。発言一覧の下の端より上に出た、最後の発言までを読んだことにする。
 * タブの裏や、スマホでタブにした列の隠れた方にあるとき・ブラウザのタブが裏にあるときは既読にしない（既読を正しく出すため）。
 * 発言一覧の中の発言には data-at（発言の時刻）を付けておく。messages は発言一覧を描いてから渡す。
 * newBelow：まだ画面に出ていない、下にあるほかの人の発言の数（「新しい発言 ○件」のボタンに使う）
 */
export function useReadProgress(chatId: string, meId: string, list: RefObject<HTMLElement | null>, messages: Message[] | undefined) {
  // 画面に出た最後の発言の時刻（画面の表示用）
  const [seen, setSeen] = useState<{ chatId: string; at: number }>();
  const seenAt = useRef({ chatId, at: 0 });
  // 既読にした時刻（同じ時刻で何度も書き込まないように）
  const committed = useRef({ chatId, at: 0 });
  const onScreen = useRef(false);
  const frame = useRef(0);

  /** 測り直す（スクロールしたとき・発言が増えたときなど）。描き終わってから測る */
  const measure = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = list.current;
      if (!el) return;
      if (seenAt.current.chatId !== chatId) seenAt.current = { chatId, at: 0 };
      // 隠れているとき（display: none）は、どれも高さが 0 なので、何も読んだことにならない
      const bottom = el.getBoundingClientRect().bottom - 16;
      const items = el.querySelectorAll<HTMLElement>("[data-at]");
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].getBoundingClientRect().top >= bottom) continue;
        const at = Number(items[i].dataset.at);
        if (at > seenAt.current.at) {
          seenAt.current = { chatId, at };
          setSeen({ chatId, at });
        }
        break;
      }
      const at = seenAt.current.at;
      const done = committed.current.chatId === chatId ? committed.current.at : 0;
      if (at > done && onScreen.current && document.visibilityState === "visible") {
        committed.current = { chatId, at };
        void markRead(chatId, meId, at);
      }
    });
  };

  const ready = !!messages;
  useEffect(() => {
    const el = list.current;
    if (!ready || !el) return;
    // 発言一覧が画面に出ているか（タブの裏・隠れた列では出ていない）。大きさが変わったとき（タブを切り替えたときなど）も測り直す
    const io = new IntersectionObserver(([e]) => {
      onScreen.current = e.isIntersecting;
      measure();
    });
    const ro = new ResizeObserver(() => measure());
    io.observe(el);
    ro.observe(el);
    document.addEventListener("visibilitychange", measure);
    return () => {
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", measure);
      cancelAnimationFrame(frame.current);
    };
    // measure は chatId・meId・list から作る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, chatId, meId, list]);

  // 発言が増えた・減ったときも測り直す
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => measure(), [messages]);

  const at = seen?.chatId === chatId ? seen.at : null;
  const newBelow = at === null || !messages ? 0 : messages.filter((m) => m.authorId !== meId && m.createdAt > at).length;
  return { newBelow, measure };
}
