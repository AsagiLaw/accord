"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";

/** 切り抜く枠の大きさ（画面の上の px） */
const STAGE = 280;
/** できあがりのアイコンの大きさ */
const OUT = 256;
const MAX_ZOOM = 4;

type View = { zoom: number; x: number; y: number };

/**
 * アイコンの切り抜き（Discord のアイコンの編集と同じ）。丸い枠の中に入る部分がアイコンになる。
 * 画像をドラッグで動かし、下のつまみかホイールで拡大する。矢印キーでも少しずつ動かせる
 */
export function AvatarCropper({ source, onCancel, onDone }: { source: Blob; onCancel: () => void; onDone: (dataUrl: string) => void }) {
  // 画像の URL は、渡された画像ごとに1つだけ作り、閉じたら片付ける
  const [url] = useState(() => URL.createObjectURL(source));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // 短い辺が枠にぴったり入る大きさを 1 倍とする
  const scaleOf = (zoom: number) => (size ? (STAGE / Math.min(size.w, size.h)) * zoom : 1);
  /** 画像が枠からはみ出さない（枠の中に余白ができない）ように位置をおさえる */
  const clamp = (v: View): View => {
    if (!size) return v;
    const s = scaleOf(v.zoom);
    const w = size.w * s;
    const h = size.h * s;
    return { zoom: v.zoom, x: Math.min(0, Math.max(STAGE - w, v.x)), y: Math.min(0, Math.max(STAGE - h, v.y)) };
  };
  /** 枠の真ん中を動かさずに拡大・縮小する */
  const zoomTo = (zoom: number) =>
    setView((v) => {
      const z = Math.min(MAX_ZOOM, Math.max(1, zoom));
      const k = scaleOf(z) / scaleOf(v.zoom);
      const c = STAGE / 2;
      return clamp({ zoom: z, x: c - (c - v.x) * k, y: c - (c - v.y) * k });
    });

  const s = scaleOf(view.zoom);

  const done = async () => {
    if (!size) return;
    setSaving(true);
    const bitmap = await createImageBitmap(source);
    const side = STAGE / s;
    const out = Math.round(Math.min(OUT, side));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = out;
    canvas.getContext("2d")!.drawImage(bitmap, -view.x / s, -view.y / s, side, side, 0, 0, out, out);
    bitmap.close();
    onDone(canvas.toDataURL("image/webp", 0.9));
  };

  return (
    <div
      data-overlay=""
      className="fixed inset-0 z-[57] flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div role="dialog" aria-modal="true" aria-label="アイコンの切り抜き" data-name="アイコンの切り抜き" className="w-full max-w-sm rounded-t-[20px] border border-line bg-card sm:rounded-[14px]">
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h3 className="font-bold">アイコンの切り抜き</h3>
          <button className="grid h-8 w-8 place-items-center rounded-full hover:bg-tint" aria-label="閉じる" onClick={onCancel}>
            <Icon name="x" />
          </button>
        </div>

        <div className="grid place-items-center px-5 pt-5">
          <div
            tabIndex={0}
            aria-label="切り抜く場所（ドラッグか矢印キーで動かす）"
            className="relative cursor-grab touch-none overflow-hidden rounded-[12px] bg-black outline-none select-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
            style={{ width: STAGE, height: STAGE }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d) setView((v) => clamp({ ...v, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onWheel={(e) => zoomTo(view.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 40 : 10;
              const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
              if (!d) return;
              e.preventDefault();
              setView((v) => clamp({ ...v, x: v.x + d[0], y: v.y + d[1] }));
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const w = e.currentTarget.naturalWidth;
                const h = e.currentTarget.naturalHeight;
                setSize({ w, h });
                // はじめは真ん中
                const k = STAGE / Math.min(w, h);
                setView({ zoom: 1, x: (STAGE - w * k) / 2, y: (STAGE - h * k) / 2 });
              }}
              className="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left"
              style={size ? { width: size.w * s, height: size.h * s, transform: `translate(${view.x}px, ${view.y}px)` } : { opacity: 0 }}
            />
            {/* 丸の外を暗くする（丸の中がアイコンになる） */}
            <div aria-hidden className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.55)]" />
          </div>
        </div>

        <div className="flex items-center gap-3 px-5 pt-4">
          <Icon name="img" size={16} className="shrink-0 text-muted" />
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={view.zoom}
            onChange={(e) => zoomTo(Number(e.target.value))}
            aria-label="拡大"
            className="min-w-0 flex-1 accent-[var(--accent)]"
          />
          <Icon name="img" size={24} className="shrink-0 text-muted" />
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4">
          <button type="button" className="btn-sub" onClick={() => size && setView(clamp({ zoom: 1, x: (STAGE - size.w * scaleOf(1)) / 2, y: (STAGE - size.h * scaleOf(1)) / 2 }))}>
            リセット
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-sub" onClick={onCancel}>
              キャンセル
            </button>
            <button type="button" className="btn" disabled={!size || saving} onClick={done}>
              決定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
