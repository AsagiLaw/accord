"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { LibMode, SortKey } from "@/lib/media/logic";
import { updatePrefs, useMediaPrefs } from "@/lib/media/prefs";

const DIR_LABEL: Record<SortKey, { desc: string; asc: string }> = {
  new: { desc: "新しい順", asc: "古い順" },
  name: { desc: "ん→あ順", asc: "あ→ん順" },
  size: { desc: "大きい順", asc: "小さい順" },
};

const LIB_MODES: { v: LibMode; label: string; note: string }[] = [
  { v: "rep", label: "基本", note: "小ライブラリーは代表の画像だけを出します" },
  { v: "all", label: "全て表示", note: "小ライブラリーの画像もすべて出します" },
  { v: "single", label: "シングル", note: "小ライブラリーに入っていない画像だけを出します" },
];

function Seg<T extends string>({ items, value, onChange }: { items: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="grid grid-flow-col gap-1 rounded-full bg-bg p-1" role="group">
      {items.map(([v, label]) => (
        <button
          key={v}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`min-h-[30px] rounded-full px-3 text-sm ${value === v ? "bg-accent font-bold text-accent-ink" : "text-muted"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function SortMenu({ showLibMode }: { showLibMode: boolean }) {
  const prefs = useMediaPrefs();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        className="btn-sub w-10 px-0"
        aria-label="並べ替えと表示"
        aria-expanded={open}
        title="並べ替えと表示"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="sort" />
      </button>
      {open && (
        <div role="dialog" data-name="並べ替えと表示のメニュー" aria-label="並べ替えと表示" className="absolute top-12 right-0 z-30 w-72 space-y-3 rounded-[14px] border border-line bg-card p-4 shadow-xl">
          <section className="space-y-2">
            <h4 className="text-sm font-bold">並べる基準</h4>
            <Seg
              items={[
                ["new", "日時"],
                ["name", "名前"],
                ["size", "容量"],
              ]}
              value={prefs.sort}
              onChange={(sort) => updatePrefs({ sort })}
            />
            <Seg
              items={[
                ["desc", DIR_LABEL[prefs.sort].desc],
                ["asc", DIR_LABEL[prefs.sort].asc],
              ]}
              value={prefs.dirs[prefs.sort]}
              onChange={(d) => updatePrefs({ dirs: { ...prefs.dirs, [prefs.sort]: d } })}
            />
          </section>
          <section className="space-y-1">
            <h4 className="text-sm font-bold">画像のサイズ</h4>
            <input
              type="range"
              min={1}
              max={4}
              step={1}
              value={prefs.level}
              onChange={(e) => updatePrefs({ level: Number(e.target.value) })}
              aria-label="画像のサイズ"
              className="w-full accent-[var(--accent)]"
            />
            <div className="flex justify-between text-xs text-muted">
              {["極小", "小", "中", "大"].map((l, i) => (
                <span key={l} className={prefs.level === i + 1 ? "font-bold text-ink" : ""}>
                  {l}
                </span>
              ))}
            </div>
          </section>
          {showLibMode && (
            <section className="space-y-1">
              <h4 className="text-sm font-bold">ライブラリーの表示</h4>
              {LIB_MODES.map((o) => (
                <button
                  key={o.v}
                  aria-pressed={prefs.libMode === o.v}
                  onClick={() => updatePrefs({ libMode: o.v })}
                  className={`grid w-full justify-items-start rounded-[10px] px-3 py-1.5 text-left ${
                    prefs.libMode === o.v ? "bg-tint" : "hover:bg-tint"
                  }`}
                >
                  <span className="flex items-center gap-1 text-sm font-bold">
                    {prefs.libMode === o.v && <Icon name="ok" size={14} />}
                    {o.label}
                  </span>
                  <span className="text-xs text-muted">{o.note}</span>
                </button>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
