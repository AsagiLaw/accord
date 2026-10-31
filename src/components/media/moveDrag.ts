"use client";

import { toast } from "@/components/ui/overlay";
import type { Library } from "@/lib/local/db";
import { MEDIA_DRAG_TYPE } from "@/lib/media/export";
import { moveMediaFlow } from "./flows";

// 一覧の画像をドラッグして、ライブラリーへ移す。落とす先（サイドバーのライブラリー・一覧のフォルダ）は別々の場所にあるので、ここで持つ

type MoveDrag = {
  boxId: string;
  ids: string[];
  /** 今開いているライブラリー。無ければ（すべて・検索の結果など）移さず入れるだけ */
  from: string | null;
};

let current: MoveDrag | null = null;
let listening = false;
let warnedMulti = false;

/** ドラッグを始めた。ライブラリーに落とさずに終わったとき、他のアプリに渡せるのは1枚だけなので、最初の1回だけ知らせる */
export function beginMoveDrag(drag: MoveDrag) {
  current = drag;
  if (listening) return;
  listening = true;
  window.addEventListener(
    "dragend",
    (e) => {
      const multi = !!current && current.ids.length > 1;
      current = null;
      if (multi && e.dataTransfer?.dropEffect !== "none" && !warnedMulti) {
        warnedMulti = true;
        toast("他のアプリにドラッグで渡せるのは1枚だけです。複数枚は右クリックの「ダウンロード」を使ってください");
      }
    },
    true,
  );
}

/** このライブラリーに落とせるドラッグか（今開いているライブラリーには落とせない） */
export function acceptsMoveDrag(e: React.DragEvent, boxId: string, libId: string) {
  return !!current && current.boxId === boxId && current.from !== libId && e.dataTransfer.types.includes(MEDIA_DRAG_TYPE);
}

/** ライブラリーに落とした */
export function dropMoveDrag(lib: Library) {
  const drag = current;
  current = null;
  if (drag) void moveMediaFlow(drag.boxId, drag.ids, drag.from, lib);
}
