"use client";

import { useSyncExternalStore } from "react";

// 指で触る端末か（スマホ・タブレット）。マウスのあるパソコンは、窓を狭くしても当てはまらない
const TOUCH = "(hover: none) and (pointer: coarse)";
// スマホ：指で触る端末で、短い辺が 600px 未満（横向きのスマホも含む。globals.css の .phone-hide と同じ）
const PHONE = `${TOUCH} and (max-width: 599.98px), ${TOUCH} and (max-height: 599.98px)`;

const matches = (query: string) => typeof window !== "undefined" && window.matchMedia(query).matches;

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const isTouchDevice = () => matches(TOUCH);
export const isTouchPhone = () => matches(PHONE);
export const useIsTouchDevice = () => useMedia(TOUCH);
export const useIsTouchPhone = () => useMedia(PHONE);
