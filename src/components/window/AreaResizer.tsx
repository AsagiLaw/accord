"use client";

import { useEffect, useRef, useState } from "react";

/** 高さを分け合うブロック（区画）：チャット・オールビュー・画像・タブなどと、それを含む列（globals.css で --grow を使うところと同じ） */
const AREA = ".bn-block-column-list:has([data-fill],[data-tabs]), .bn-block-outer:has(> .bn-block > .react-renderer :is([data-fill],[data-tabs]))";
/** 区画の一番小さい高さ（globals.css と同じ） */
const MIN = 160;

type Handle = { a: string; b: string; top: number; left: number; width: number };

/** 上下に並んだ区画のあいだ（ウィンドウの一番上の並びと、列の中）に置く線の場所を測る */
function measure(wrap: HTMLElement): Handle[] {
  const box = wrap.getBoundingClientRect();
  const out: Handle[] = [];
  wrap.querySelectorAll<HTMLElement>(".ProseMirror > .bn-block-group, .bn-block-column").forEach((c) => {
    const areas = [...c.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !!el.dataset.id && el.offsetParent !== null && el.matches(AREA));
    for (let i = 1; i < areas.length; i++) {
      const ra = areas[i - 1].getBoundingClientRect();
      const rb = areas[i].getBoundingClientRect();
      const left = Math.min(ra.left, rb.left);
      out.push({
        a: areas[i - 1].dataset.id!,
        b: areas[i].dataset.id!,
        top: Math.round((ra.bottom + rb.top) / 2 - box.top),
        left: Math.round(left - box.left),
        width: Math.round(Math.max(ra.right, rb.right) - left),
      });
    }
  });
  return out;
}

/**
 * ウィンドウの編集中に、上下に並んだ区画のあいだに線を出す。つかんで上下に動かすと、2つの区画の高さの割合が変わる
 * （割合はブロックごとに grows に入れる。1 が標準）。エディタのすぐ後ろに置く
 */
export function AreaResizer({ grows, onChange, onDone }: { grows: Record<string, number>; onChange: (g: Record<string, number>) => void; onDone: (g: Record<string, number>) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [handles, setHandles] = useState<Handle[]>([]);
  const drag = useRef<{ h: Handle; y0: number; ha: number; hb: number; sum: number; next: Record<string, number> } | null>(null);

  // 区画の大きさ・並びが変わるたび、スクロールするたびに、線の場所を測り直す
  useEffect(() => {
    const layer = ref.current;
    const wrap = layer?.parentElement;
    const editor = layer?.previousElementSibling;
    if (!wrap || !editor) return;
    let last = "";
    const update = () => {
      const next = measure(wrap);
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setHandles(next);
      }
    };
    const ro = new ResizeObserver(update);
    const observe = () => {
      ro.disconnect();
      ro.observe(wrap);
      editor.querySelectorAll(AREA).forEach((el) => ro.observe(el));
    };
    observe();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mo = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        observe();
        update();
      }, 60);
    });
    mo.observe(editor, { childList: true, subtree: true });
    editor.addEventListener("scroll", update, { capture: true, passive: true });
    return () => {
      clearTimeout(timer);
      ro.disconnect();
      mo.disconnect();
      editor.removeEventListener("scroll", update, { capture: true });
    };
  }, []);

  const down = (e: React.PointerEvent, h: Handle) => {
    const wrap = ref.current?.parentElement;
    const a = wrap?.querySelector<HTMLElement>(`[data-id="${h.a}"]`);
    const b = wrap?.querySelector<HTMLElement>(`[data-id="${h.b}"]`);
    if (!a || !b) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { h, y0: e.clientY, ha: a.getBoundingClientRect().height, hb: b.getBoundingClientRect().height, sum: (grows[h.a] ?? 1) + (grows[h.b] ?? 1), next: grows };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // 2つの区画の高さの合計は変えずに、境目だけ動かす（どちらも一番小さい高さより低くはしない）
    const total = d.ha + d.hb;
    const min = Math.min(MIN, total / 2);
    const na = Math.min(total - min, Math.max(min, d.ha + e.clientY - d.y0));
    const ga = Math.round(((d.sum * na) / total) * 1000) / 1000;
    d.next = { ...grows, [d.h.a]: ga, [d.h.b]: Math.round((d.sum - ga) * 1000) / 1000 };
    onChange(d.next);
  };
  const up = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    onDone(d.next);
  };

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" data-name="区画の高さを変える線">
      {handles.map((h) => (
        <div
          key={`${h.a}-${h.b}`}
          role="separator"
          aria-orientation="horizontal"
          aria-label="上下の区画の高さの割合を変える"
          title="つかんで上下に動かすと、上下の高さの割合を変えられます"
          className="group pointer-events-auto absolute flex h-3 -translate-y-1/2 cursor-row-resize touch-none items-center justify-center"
          style={{ top: h.top, left: h.left, width: h.width }}
          onPointerDown={(e) => down(e, h)}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <span className="h-0.5 w-full rounded-full bg-accent opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100" />
          <span className="absolute h-1.5 w-10 rounded-full border border-line bg-card shadow-sm group-hover:border-accent group-hover:bg-accent" />
        </div>
      ))}
    </div>
  );
}
