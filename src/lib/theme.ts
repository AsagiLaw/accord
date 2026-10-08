"use client";

import { useSyncExternalStore } from "react";
import { THEME_KEY } from "./theme-boot";

// 表示モード（端末に合わせる／ホワイト／ダーク）。人ごと・端末ごとの設定なのでブラウザに保存する
export type ThemeMode = "system" | "light" | "dark";

const listeners = new Set<() => void>();

function read(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function setTheme(mode: ThemeMode) {
  try {
    if (mode === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch {
    // 保存できなくても、このページの間は切り替わる
  }
  if (mode === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", mode);
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", fn);
  return () => {
    listeners.delete(fn);
    mq.removeEventListener("change", fn);
  };
}

export function useTheme(): ThemeMode {
  return useSyncExternalStore(subscribe, read, () => "system");
}

/** 今、実際にダークで表示されているか */
export function useIsDark(): boolean {
  const mode = useTheme();
  return useSyncExternalStore(
    subscribe,
    () => (mode === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : mode === "dark"),
    () => false,
  );
}
