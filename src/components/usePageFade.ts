"use client";

import { usePathname } from "next/navigation";
import { useEffect, type RefObject } from "react";

/**
 * 画面（URL）が切り替わったら、中身をふわっと出す（ぱっと入れ替わって、ちらついて見えないように）。
 * 中身は作り直さず、外側の要素の濃さだけを動かす（位置は動かさない。中の固定表示の位置がずれないように）
 */
export function usePageFade(ref: RefObject<HTMLElement | null>) {
  const pathname = usePathname();
  useEffect(() => {
    ref.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" });
  }, [pathname, ref]);
}
