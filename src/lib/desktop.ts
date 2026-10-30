"use client";

import { useSyncExternalStore } from "react";

// デスクトップ版（desktop/ の Tauri）の中で開いているときだけ、window.accordDesktop がある（desktop/src-tauri/src/main.rs）

type AccordDesktop = {
  platform: string;
  /** 隠れている窓を前に出す */
  show: () => void;
};

declare global {
  interface Window {
    accordDesktop?: AccordDesktop;
  }
}

export const desktopApp = () => (typeof window === "undefined" ? undefined : window.accordDesktop);

const subscribe = () => () => {};

/** デスクトップ版の中で開いているか */
export function useIsDesktopApp() {
  return useSyncExternalStore(subscribe, () => !!window.accordDesktop, () => false);
}
