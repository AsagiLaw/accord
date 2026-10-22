import { useLayoutEffect, type RefObject } from "react";

// 入力欄を、書いた分だけ広げる（Discord と同じ）。画面の半分まで広がったら、そこから先は欄の中で動かす
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      const border = el.offsetHeight - el.clientHeight;
      const max = window.innerHeight / 2;
      const want = el.scrollHeight + border;
      el.style.height = `${Math.min(want, max)}px`;
      el.style.overflowY = want > max ? "auto" : "hidden";
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [ref, value]);
}
