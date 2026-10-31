"use client";

import { useEffect, useRef, useState } from "react";
import { ThumbImage } from "@/components/ThumbImage";
import { Spinner } from "@/components/ui/Spinner";

/** 拡大の上限（画面に収めた大きさの何倍まで） */
const MAX_ZOOM = 8;
/** ダブルタップで拡大する倍率 */
const TAP_ZOOM = 2.5;
const FIT = { zoom: 1, x: 0, y: 0 };
/** 隣の画像との間（px） */
const GAP = 16;
const SLIDE_MS = 220;
/** 2回目のタップを待つ時間 */
const DOUBLE_TAP_MS = 280;
/** これより動いたらタップではなく、なぞった扱い（px） */
const MOVE_PX = 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Point = { x: number; y: number };
type Gesture =
  | { type: "idle"; start: Point }
  | { type: "ignored" }
  | { type: "swipe"; start: Point; dx: number; lastX: number; lastT: number; speed: number }
  | { type: "pan"; start: Point; ox: number; oy: number; moved: boolean }
  | { type: "pinch"; dist: number; center: Point; zoom: number; ox: number; oy: number };

/**
 * 指で触る端末の、画像を全面に出す部分。親いっぱいに広がる（親に relative を付けておくこと）。
 * 左右になぞると指についてきて前後の画像へ移り、ピンチとダブルタップで拡大し、拡大中はなぞって動かす。
 * 隣の画像は、通信を増やさないよう小さい画像で見せ、移ってから元の画像を取ってくる
 */
export function TouchStage({
  id,
  alt,
  url,
  loading,
  prevId,
  nextId,
  onGo,
  onImageTap,
  onBackdropTap,
  onImageLoad,
}: {
  id: string;
  alt: string;
  /** 元の画像の URL。取ってくる間は無い（小さい画像を広げて出す） */
  url: string | undefined;
  loading: boolean;
  prevId?: string;
  nextId?: string;
  onGo: (step: -1 | 1) => void;
  onImageTap?: () => void;
  onBackdropTap?: () => void;
  onImageLoad?: (el: HTMLImageElement) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 別の画像に切り替えたら、全体の表示に戻す
  const [viewState, setViewState] = useState({ ...FIT, id: "" });
  const view = viewState.id === id ? viewState : { ...FIT, id };
  const zoomed = view.zoom > 1;
  /** 左右になぞっている量（px）と、指を離したあと動かしている間か */
  const [dx, setDx] = useState(0);
  const [sliding, setSliding] = useState(false);
  /** 指を置いている間（動きをなめらかにしない） */
  const [touching, setTouching] = useState(false);

  useEffect(
    () => () => {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      if (slideTimer.current) clearTimeout(slideTimer.current);
    },
    [],
  );

  /** 画面に収めたときの画像の大きさと、枠の大きさ */
  const measure = () => {
    const s = stage.current;
    const sw = s?.clientWidth ?? 1;
    const sh = s?.clientHeight ?? 1;
    const nw = img.current?.naturalWidth || sw;
    const nh = img.current?.naturalHeight || sh;
    const k = Math.min(sw / nw, sh / nh);
    return { w: nw * k, h: nh * k, sw, sh };
  };
  /** 画面からはみ出す分だけ動かせる */
  const placed = (zoom: number, x: number, y: number) => {
    if (zoom <= 1.01) return { ...FIT, id };
    const { w, h, sw, sh } = measure();
    const mx = Math.max(0, (w * zoom - sw) / 2);
    const my = Math.max(0, (h * zoom - sh) / 2);
    return { zoom, x: clamp(x, -mx, mx), y: clamp(y, -my, my), id };
  };
  /** 枠の真ん中からの位置 */
  const fromCenter = (p: Point) => {
    const r = stage.current?.getBoundingClientRect();
    return r ? { x: p.x - r.left - r.width / 2, y: p.y - r.top - r.height / 2 } : p;
  };

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    setDx(0);
    gesture.current = {
      type: "pinch",
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      center: fromCenter({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
      zoom: view.zoom,
      ox: view.x,
      oy: view.y,
    };
  };

  const startOne = (p: Point) => {
    gesture.current = zoomed ? { type: "pan", start: p, ox: view.x, oy: view.y, moved: false } : { type: "idle", start: p };
  };

  /** 指を離したとき：十分になぞっていれば隣の画像へ、足りなければ元の位置へ戻す */
  const endSwipe = (g: Extract<Gesture, { type: "swipe" }>) => {
    const w = stage.current?.clientWidth ?? 1;
    const step = g.dx < 0 ? 1 : -1;
    const target = step === 1 ? nextId : prevId;
    const far = Math.abs(g.dx) > w * 0.2 || (Math.abs(g.speed) > 0.35 && Math.abs(g.dx) > MOVE_PX * 2);
    const leave = far && !!target;
    const finish = () => {
      if (leave) onGo(step);
      setDx(0);
      setSliding(false);
    };
    // 「動きを減らす」設定では、動かさずに切り替える
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return finish();
    setSliding(true);
    setDx(leave ? -step * (w + GAP) : 0);
    slideTimer.current = setTimeout(finish, SLIDE_MS);
  };

  const tap = (p: Point) => {
    const last = lastTap.current;
    const now = performance.now();
    if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(p.x - last.x, p.y - last.y) < MOVE_PX * 3) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      lastTap.current = null;
      // 元の画像を取ってくる間（小さい画像を出している間）は拡大しない
      if (!img.current) return;
      if (zoomed) return setViewState({ ...FIT, id });
      const c = fromCenter(p);
      return setViewState(placed(TAP_ZOOM, c.x - c.x * TAP_ZOOM, c.y - c.y * TAP_ZOOM));
    }
    lastTap.current = { t: now, ...p };
    tapTimer.current = setTimeout(() => {
      lastTap.current = null;
      const { w, h } = measure();
      const c = fromCenter(p);
      if (zoomed || (Math.abs(c.x) <= w / 2 && Math.abs(c.y) <= h / 2)) onImageTap?.();
      else onBackdropTap?.();
    }, DOUBLE_TAP_MS);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (sliding) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, p);
    setTouching(true);
    if (pointers.current.size === 2) startPinch();
    else if (pointers.current.size === 1) startOne(p);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g || g.type === "ignored") return;
    if (g.type === "pinch") {
      if (pointers.current.size < 2 || !img.current) return;
      const [a, b] = [...pointers.current.values()];
      const zoom = clamp((g.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist, 1, MAX_ZOOM);
      const r = zoom / g.zoom;
      const c = fromCenter({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      setViewState(placed(zoom, c.x - (g.center.x - g.ox) * r, c.y - (g.center.y - g.oy) * r));
      return;
    }
    const mx = p.x - g.start.x;
    const my = p.y - g.start.y;
    if (g.type === "pan") {
      if (Math.hypot(mx, my) > MOVE_PX) g.moved = true;
      setViewState(placed(view.zoom, g.ox + mx, g.oy + my));
      return;
    }
    if (g.type === "idle") {
      if (Math.hypot(mx, my) < MOVE_PX) return;
      // 上下になぞったときは何もしない。左右のときだけ、隣の画像へ動かす
      gesture.current = Math.abs(mx) > Math.abs(my) ? { type: "swipe", start: g.start, dx: mx, lastX: p.x, lastT: e.timeStamp, speed: 0 } : { type: "ignored" };
      return;
    }
    if (e.timeStamp > g.lastT) g.speed = (p.x - g.lastX) / (e.timeStamp - g.lastT);
    g.lastX = p.x;
    g.lastT = e.timeStamp;
    g.dx = mx;
    // 前後に画像が無い方へは、重く動かす
    setDx(mx > 0 ? (prevId ? mx : mx / 3) : nextId ? mx : mx / 3);
  };

  const onPointerEnd = (e: React.PointerEvent, cancelled: boolean) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const left = pointers.current.size;
    const g = gesture.current;
    if (left === 0) setTouching(false);
    if (g?.type === "pinch") {
      // 指を1本だけ離したら、残りの指で動かす（収めた大きさに戻っていれば何もしない）
      if (left === 1) gesture.current = zoomed ? { type: "pan", start: [...pointers.current.values()][0], ox: view.x, oy: view.y, moved: true } : { type: "ignored" };
      else if (left === 0) gesture.current = null;
      return;
    }
    if (left > 0) return;
    gesture.current = null;
    if (g?.type === "swipe") return endSwipe(g);
    if (cancelled) return;
    if (g?.type === "idle" || (g?.type === "pan" && !g.moved)) tap({ x: e.clientX, y: e.clientY });
  };

  const side = (sideId: string | undefined, sign: -1 | 1) =>
    sideId && (
      <div className="absolute inset-0" style={{ transform: `translateX(calc(${sign * 100}% + ${sign * GAP}px))` }}>
        <ThumbImage id={sideId} alt="" className="object-contain" />
      </div>
    );

  return (
    <div
      ref={stage}
      data-name="画像の操作面"
      className="absolute inset-0 touch-none overflow-hidden select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => onPointerEnd(e, false)}
      onPointerCancel={(e) => onPointerEnd(e, true)}
    >
      <div className="absolute inset-0" style={{ transform: `translateX(${dx}px)`, transition: sliding ? `transform ${SLIDE_MS}ms cubic-bezier(.2,.8,.2,1)` : "none" }}>
        {side(prevId, -1)}
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- ブラウザ内の Blob なので next/image は使えない
          <img
            ref={img}
            key={id}
            src={url}
            alt={alt}
            draggable={false}
            onLoad={(e) => onImageLoad?.(e.currentTarget)}
            className="absolute inset-0 h-full w-full object-contain"
            style={{
              transform: zoomed ? `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` : undefined,
              transition: touching ? "none" : "transform 160ms ease-out",
            }}
          />
        ) : (
          // 小さい画像の側のくるくるは重ねない
          <div className="absolute inset-0 [&_[role=status]]:hidden">
            <ThumbImage id={id} alt={alt} className="object-contain" />
          </div>
        )}
        {!url && loading && <Spinner onImage />}
        {side(nextId, 1)}
      </div>
    </div>
  );
}
