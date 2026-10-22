"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { toast } from "@/components/ui/overlay";
import { ensureMyMedia, useBoxAccess, useRoomBox } from "@/lib/local/boxes";
import type { Media } from "@/lib/local/db";
import { ensureInBox } from "@/lib/local/media";
import { useCurrentUser } from "@/lib/local/session";
import { useBlobUrl } from "@/lib/media/blob-url";
import { downloadOriginals } from "@/lib/media/export";

/** 拡大の上限（画面に合わせた大きさの何倍まで） */
const MAX_ZOOM = 8;
/** 画面に合わせた大きさ（拡大していない） */
const FIT = { zoom: 1, x: 0, y: 0 };

/**
 * チャットなどで添付画像を大きく見る、シンプルな表示画面。
 * ホイール・ダブルクリック・＋／−で拡大し、拡大中はドラッグで動かす。
 * 完全に削除して小さい画像だけ残した画像（gone）も、それを広げて見せる（保存やメディアで見るは出さない）
 */
export function ImageViewer({ items, start, roomId, onClose }: { items: Media[]; start: number; roomId: string; onClose: () => void }) {
  const [i, setI] = useState(start);
  const m = items[i];
  const url = useBlobUrl(m?.id, "original");
  // 「メディアで見る」：ルームのボックスの画像ならルームのメディア、ほかのボックス（マイメディアなど）なら DM のボックスの画面
  const roomBox = useRoomBox(roomId);
  const mediaHref = m && roomBox?.box.id === m.boxId ? `/r/${roomId}/media/all` : `/dm/media/${m?.boxId}/all`;
  // 見られないボックスの画像（DM で受け取った画像など）は「メディアで見る」の代わりに、自分のマイメディアに保存できる
  const me = useCurrentUser();
  const access = useBoxAccess(m?.boxId ?? "", me?.id);
  const [saved, setSaved] = useState<string[]>([]);
  // 拡大：zoom は画面に合わせた大きさの何倍か、at は中心からのずれ（px）
  const [view, setView] = useState(FIT);
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  /** 前後の画像へ。拡大は戻す */
  const go = (to: (x: number) => number) => {
    setI((x) => Math.min(items.length - 1, Math.max(0, to(x))));
    setView(FIT);
  };
  /** 拡大の倍率を変える。cx・cy（画面の位置）を中心に広げる。無ければ真ん中 */
  const zoomTo = (next: number, cx?: number, cy?: number) =>
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(1, next));
      if (zoom === 1) return FIT;
      const r = area.current?.getBoundingClientRect();
      const px = r && cx !== undefined ? cx - (r.left + r.width / 2) : 0;
      const py = r && cy !== undefined ? cy - (r.top + r.height / 2) : 0;
      const k = zoom / v.zoom;
      return { zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  const save = async () => {
    if (!me || !m) return;
    await ensureInBox([m.id], await ensureMyMedia(me.id), me.id);
    setSaved((s) => [...s, m.id]);
    toast("マイメディアに保存しました");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      const step = (d: number) => {
        setI((x) => Math.min(items.length - 1, Math.max(0, x + d)));
        setView(FIT);
      };
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
      if (e.key === "+" || e.key === ";") setView((v) => ({ ...v, zoom: Math.min(MAX_ZOOM, v.zoom * 1.25) }));
      if (e.key === "-") setView((v) => (v.zoom / 1.25 <= 1 ? FIT : { ...v, zoom: v.zoom / 1.25 }));
      if (e.key === "0") setView(FIT);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, onClose]);

  if (!m) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={m.name} className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white">
      <div className="flex items-center gap-2 px-3 py-2">
        {/* 自動で名前を付けた画像は、タイトルだけ */}
        <span className="min-w-0 truncate font-bold">{m.title || m.name}</span>
        {items.length > 1 && (
          <span className="shrink-0 text-sm text-white/60">
            {i + 1} / {items.length}
          </span>
        )}
        {m.gone && (
          <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-xs text-white/80" title="元の画像は削除されたため、小さい画像で表示しています">
            縮小版
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {view.zoom > 1 && (
            <button className="rounded-full px-3 py-1.5 text-sm tabular-nums hover:bg-white/15" title="画面に合わせる（0）" onClick={() => zoomTo(1)}>
              {Math.round(view.zoom * 100)}%
            </button>
          )}
          <button aria-label="縮小" title="縮小（−）" disabled={view.zoom <= 1} onClick={() => zoomTo(view.zoom / 1.25)} className="grid h-10 w-10 place-items-center rounded-full text-xl hover:bg-white/15 disabled:opacity-40">
            −
          </button>
          <button aria-label="拡大" title="拡大（＋・ホイール・ダブルクリック）" disabled={view.zoom >= MAX_ZOOM} onClick={() => zoomTo(view.zoom * 1.25)} className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/15 disabled:opacity-40">
            <Icon name="add" />
          </button>
          {m.gone ? null : access ? (
            <Link href={mediaHref} className="rounded-full px-3 py-1.5 text-sm hover:bg-white/15" onClick={onClose}>
              メディアで見る
            </Link>
          ) : access === null && me ? (
            <button className="rounded-full px-3 py-1.5 text-sm hover:bg-white/15 disabled:opacity-60" disabled={saved.includes(m.id)} onClick={save}>
              {saved.includes(m.id) ? "保存しました" : "マイメディアに保存"}
            </button>
          ) : null}
          {/* 表示している画像ではなく、元のファイルを保存する（PSD は表示用の PNG で見せているため） */}
          {!m.gone && (
            <button onClick={() => void downloadOriginals([m])} aria-label="元の画像を保存" title="元の画像を保存" className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/15">
              <Icon name="download" />
            </button>
          )}
          <button aria-label="閉じる" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/15">
            <Icon name="x" />
          </button>
        </div>
      </div>
      <div
        ref={area}
        className="relative min-h-0 flex-1 overflow-hidden"
        onClick={(e) => e.target === e.currentTarget && view.zoom === 1 && onClose()}
        onWheel={(e) => zoomTo(view.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY)}
      >
        {url && (
          // eslint-disable-next-line @next/next/no-img-element -- ブラウザ内の Blob なので next/image は使えない
          <img
            src={url}
            alt={m.name}
            draggable={false}
            // 小さい画像だけ残した画像は、画面いっぱいまで広げて見せる
            className={`absolute inset-0 m-auto select-none object-contain ${m.gone ? "h-full w-full" : "max-h-full max-w-full"} ${view.zoom > 1 ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"}`}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transition: dragging ? "none" : "transform 120ms ease-out" }}
            onDoubleClick={(e) => zoomTo(view.zoom > 1 ? 1 : 2.5, e.clientX, e.clientY)}
            onPointerDown={(e) => {
              if (view.zoom === 1) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
              setDragging(true);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              setView((v) => ({ ...v, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
            }}
            onPointerUp={() => {
              drag.current = null;
              setDragging(false);
            }}
          />
        )}
        {i > 0 && (
          <button aria-label="前の画像" onClick={() => go((x) => x - 1)} className="absolute top-1/2 left-2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-black/50 hover:bg-black/80">
            <Icon name="l" size={26} />
          </button>
        )}
        {i < items.length - 1 && (
          <button aria-label="次の画像" onClick={() => go((x) => x + 1)} className="absolute top-1/2 right-2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-black/50 hover:bg-black/80">
            <Icon name="r" size={26} />
          </button>
        )}
      </div>
    </div>
  );
}
