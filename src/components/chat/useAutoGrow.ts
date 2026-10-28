import { useLayoutEffect, type RefObject } from "react";

// 入力欄を、書いた分だけ広げる（Discord と同じ）。画面の半分まで広がったら、そこから先は欄の中で動かす
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      // 何も書いていないときは、薄い案内の文（placeholder）の長さでは広げない（狭いブロックで案内が2行になっても、欄は1行のまま）
      const hint = el.placeholder;
      if (!el.value) el.placeholder = "";
      el.style.height = "auto";
      const border = el.offsetHeight - el.clientHeight;
      const max = window.innerHeight / 2;
      const want = el.scrollHeight + border;
      el.style.height = `${Math.min(want, max)}px`;
      el.style.overflowY = want > max ? "auto" : "hidden";
      el.placeholder = hint;
    };
    fit();
    // 欄の幅が変わったとき（チャットのブロックを大きくした・列の幅を変えたなど）も、折り返しが変わるので測り直す
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    ro.observe(el);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [ref, value]);
}
