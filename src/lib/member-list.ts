"use client";

import { useSyncExternalStore } from "react";

// ルームのメンバー一覧（右の列）を開いているか。Discord と同じく、パソコンでは開け閉めを覚えておく。端末ごとの設定
const KEY = "irai-note:member-list";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setMemberListOpen(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // 保存できなくても、このページの間は切り替わる
  }
  listeners.forEach((fn) => fn());
}

export function useMemberListOpen(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      window.addEventListener("storage", fn);
      return () => {
        listeners.delete(fn);
        window.removeEventListener("storage", fn);
      };
    },
    read,
    () => false,
  );
}

const DESKTOP = "(min-width: 768px)";

/** パソコンの幅（md 以上）か。スマホでは、メンバー一覧を右から重ねて出す */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia(DESKTOP);
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    },
    () => window.matchMedia(DESKTOP).matches,
    () => true,
  );
}
