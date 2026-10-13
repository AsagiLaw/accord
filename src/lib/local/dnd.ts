"use client";

import { useCurrentUser } from "./session";

// 取り込み中（Discord の「取り込み中」と同じ）：通知を控えめにする。
// 未読の数は数えたままにして、赤い印を灰色にし、ブラウザのタブの題名にも数を出さない（取り込み中をやめると元に戻る）

/** 今の利用者が「取り込み中」を選んでいるか */
export function useDoNotDisturb() {
  return useCurrentUser()?.presence === "dnd";
}

/** 未読の数の印の色。取り込み中は灰色で目立たなくする */
export const badgeTone = (quiet: boolean) => (quiet ? "bg-muted text-card" : "bg-warn text-white");
