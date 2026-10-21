"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatSize } from "@/lib/media/image";
import { useUploadSummary } from "@/lib/media/remote";

/** カーソルを乗せてから詳しい内容を出すまで */
const SHOW_AFTER = 400;

/** 残りの時間（秒）を「あと約3分」の形にする */
function remainingText(sec: number | null) {
  if (sec === null || !Number.isFinite(sec)) return "計算中";
  if (sec < 60) return `あと約${Math.max(1, Math.ceil(sec))}秒`;
  if (sec < 3600) return `あと約${Math.ceil(sec / 60)}分`;
  const h = Math.floor(sec / 3600);
  const m = Math.ceil((sec % 3600) / 60);
  return m ? `あと約${h}時間${m}分` : `あと約${h}時間`;
}

/**
 * 上部バーの、R2 に画像を置いている途中のサークルゲージ（置いている画像が無ければ何も出さない）。
 * カーソルを乗せてしばらくすると、枚数・残りの時間・速さを出す
 */
export function UploadIndicator() {
  const s = useUploadSummary();
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<DOMRect | null>(null);
  const wait = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!s) return null;

  const show = () => {
    if (wait.current) clearTimeout(wait.current);
    wait.current = setTimeout(() => setShown(ref.current?.getBoundingClientRect() ?? null), SHOW_AFTER);
  };
  const hide = () => {
    if (wait.current) clearTimeout(wait.current);
    wait.current = null;
    setShown(null);
  };

  const pct = Math.round(s.ratio * 100);
  const R = 7;
  const C = 2 * Math.PI * R;
  const rows: [string, string][] = [
    ["アップロード中", `${s.count}枚`],
    ["残り", remainingText(s.remaining)],
    ["速度", s.speed === null ? "計算中" : `${formatSize(Math.round(s.speed))}/秒`],
  ];

  return (
    <span
      ref={ref}
      role="progressbar"
      tabIndex={0}
      aria-label={`画像をアップロード中（${s.count}枚・${pct}%）`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      data-name="アップロードのサークルゲージ"
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] outline-none hover:bg-tint focus-visible:bg-tint md:h-7 md:w-7"
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden className="-rotate-90">
        <circle cx="9" cy="9" r={R} fill="none" strokeWidth="2.5" className="stroke-line" />
        <circle
          cx="9"
          cy="9"
          r={R}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - s.ratio)}
          className="stroke-accent transition-[stroke-dashoffset] duration-300"
        />
      </svg>
      {shown &&
        createPortal(
          <div
            role="tooltip"
            data-name="アップロードの詳しい内容"
            className="anim-pop pointer-events-none fixed z-[58] rounded-[10px] border border-line bg-card px-3 py-2 text-xs shadow-xl"
            style={{ top: shown.bottom + 6, right: Math.max(8, window.innerWidth - shown.right) }}
          >
            <div className="mb-1.5 h-1 w-full overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-right font-bold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </div>,
          document.body,
        )}
    </span>
  );
}
