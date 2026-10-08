"use client";

import Link from "next/link";
import type { Media } from "@/lib/local/db";
import { ThumbImage } from "./Thumb";

/** 表紙に画像3枚を並べたカード（ライブラリー・すべて・お気に入りなど） */
export function CoverCard({
  href,
  name,
  covers,
  count,
  onClick,
  children,
  active,
  size,
}: {
  href?: string;
  name: string;
  covers: Media[];
  count?: number;
  onClick?: () => void;
  children?: React.ReactNode;
  active?: boolean;
  /** 左の大きい四角の一辺（px）。画像一覧の画像と同じ大きさにそろえるときに渡す。無ければ幅いっぱいに広がる */
  size?: number;
}) {
  const body = (
    <>
      <div
        className={`grid grid-rows-2 gap-0.5 overflow-hidden rounded-[10px] bg-line/40 ${size ? "" : "aspect-[3/2] grid-cols-[2fr_1fr]"}`}
        style={
          size
            ? { height: size, gridTemplateColumns: `${size}px ${size / 2}px` }
            : undefined
        }
      >
        {[0, 1, 2].map((i) => (
          <div key={i} className={i === 0 ? "row-span-2" : ""}>
            {covers[i] ? (
              <ThumbImage id={covers[i].id} alt="" />
            ) : (
              <span className="block h-full w-full bg-line/30" />
            )}
          </div>
        ))}
      </div>
      <span className="mt-1 block truncate text-sm">
        {name}
        {count !== undefined && (
          <span className="ml-1.5 text-muted">{count}</span>
        )}
      </span>
    </>
  );
  // 大きさをそろえるときは画像一覧と同じ見せ方：内側の余白を付けず、カーソルで少し浮き、押すと縮む
  const cls = `relative block w-full rounded-[12px] text-left transition ${
    size ? "duration-300 select-none hover:-translate-y-[3px] active:scale-95" : "p-1.5 hover:bg-tint"
  } ${active ? "bg-tint ring-2 ring-accent" : ""}`;
  return (
    <div
      data-name={`カード「${name}」`}
      className="relative"
      style={size ? { width: size * 1.5 + 2 } : undefined}
    >
      {href ? (
        <Link href={href} className={cls}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={cls}>
          {body}
        </button>
      )}
      {children}
    </div>
  );
}
