"use client";

import type { Media } from "@/lib/local/db";
import { ThumbImage } from "./Thumb";
import { MediaLink, useMediaRouter } from "./MediaLink";

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
  openOnDoubleClick,
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
  /** ダブルクリックで開く（ライブラリー）。1回のクリックでは選んだ印だけ付ける（Windows のフォルダと同じ） */
  openOnDoubleClick?: boolean;
}) {
  const router = useMediaRouter();
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
      <span className={`mt-1 block truncate text-sm ${children ? "pr-7" : ""}`}>
        {name}
        {count !== undefined && (
          <span className="ml-1.5 text-muted">{count}</span>
        )}
      </span>
    </>
  );
  // 大きさをそろえるときは画像一覧と同じ見せ方：内側の余白を付けず、カーソルで少し浮き、押すと縮む
  const cls = `relative block w-full rounded-[12px] text-left transition ${
    size
      ? "duration-300 select-none motion-safe:hover:-translate-y-[3px] active:scale-95"
      : "p-1.5 hover:bg-tint"
    // 選んでいる印の枠：余白のあるカードは内側に描く（横スクロールの並びの中でも枠が切れないように）
  } ${active ? (size ? "bg-tint ring-2 ring-accent" : "bg-tint ring-2 ring-accent ring-inset") : ""}`;
  return (
    <div
      data-name={`カード「${name}」`}
      className="relative"
      style={size ? { width: size * 1.5 + 2 } : undefined}
    >
      {href && openOnDoubleClick ? (
        <div
          role="link"
          tabIndex={0}
          aria-label={name}
          title="ダブルクリックで開く"
          onDoubleClick={() => router.push(href)}
          onKeyDown={(e) => e.key === "Enter" && router.push(href)}
          className={`${cls} cursor-default outline-none focus-visible:ring-2 focus-visible:ring-accent focus:bg-tint`}
        >
          {body}
        </div>
      ) : href ? (
        <MediaLink href={href} className={cls}>
          {body}
        </MediaLink>
      ) : (
        <button type="button" onClick={onClick} className={cls}>
          {body}
        </button>
      )}
      {children}
    </div>
  );
}
