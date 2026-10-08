"use client";

import { createContext, useContext } from "react";
import { createPortal } from "react-dom";

/** メイン画面の上の細いバー（TopBar）の、右の操作を置く場所 */
export const TopBarSlot = createContext<HTMLElement | null>(null);

/** 画面ごとの操作（編集中の「完了」、チャットの参加者など）を、上のバーの右に出す */
export function TopBarActions({ children }: { children: React.ReactNode }) {
  const slot = useContext(TopBarSlot);
  return slot ? createPortal(children, slot) : null;
}
