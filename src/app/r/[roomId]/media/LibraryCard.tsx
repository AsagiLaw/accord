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
}: {
  href?: string;
  name: string;
  covers: Media[];
  count?: number;
  onClick?: () => void;
  children?: React.ReactNode;
  active?: boolean;
}) {
  const body = (
    <>
      <div className="grid aspect-[3/2] grid-cols-[2fr_1fr] grid-rows-2 gap-0.5 overflow-hidden rounded-[10px] bg-line/40">
        {[0, 1, 2].map((i) => (
          <div key={i} className={i === 0 ? "row-span-2" : ""}>
            {covers[i] ? <ThumbImage id={covers[i].id} alt="" /> : <span className="block h-full w-full bg-line/30" />}
          </div>
        ))}
      </div>
      <span className="mt-1 block truncate text-sm">
        {name}
        {count !== undefined && <span className="ml-1.5 text-muted">{count}</span>}
      </span>
    </>
  );
  const cls = `relative block w-full rounded-[12px] p-1.5 text-left transition hover:bg-tint ${active ? "bg-tint ring-2 ring-accent" : ""}`;
  return (
    <div data-name={`カード「${name}」`} className="relative">
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
