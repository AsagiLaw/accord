"use client";

import { Icon } from "@/components/Icon";
import type { Media } from "@/lib/local/db";
import { ThumbImage } from "@/components/ThumbImage";

export { ThumbImage };

export function Thumb({
  m,
  selected,
  order,
  onClick,
  onDoubleClick,
  onFav,
  extra,
}: {
  m: Media;
  selected: boolean;
  /** 複数選択時の何番目か */
  order?: number;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onFav?: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={m.name}
      data-media={m.id}
      data-name="画像"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDoubleClick?.();
        if (e.key === " ") {
          e.preventDefault();
          onClick(e as unknown as React.MouseEvent);
        }
      }}
      className={`group relative aspect-square cursor-pointer overflow-hidden rounded-[12px] border border-line bg-card transition duration-300 select-none hover:-translate-y-[3px] active:scale-95 ${
        selected ? "outline-[3px] -outline-offset-1 outline-accent" : ""
      }`}
    >
      <ThumbImage id={m.id} alt={m.name} />
      <span className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-16px)] truncate rounded-[10px] bg-black/25 px-2.5 py-px text-xs font-bold text-white backdrop-blur-md [text-shadow:0_1px_3px_#000,0_0_8px_#000a]">
        {m.name}
      </span>
      {/* 複数選んでいるときだけ、選んだ順の番号を出す（1枚だけのときは枠の色だけ） */}
      {selected && order !== undefined && (
        <span className="absolute top-1.5 left-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-accent px-1 text-xs font-bold text-accent-ink">
          {order}
        </span>
      )}
      {onFav && (
        <button
          aria-label={m.fav ? "お気に入りから外す" : "お気に入りに追加"}
          aria-pressed={m.fav}
          onClick={(e) => {
            e.stopPropagation();
            onFav();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className={`absolute top-1 right-1 grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white transition ${
            m.fav ? "text-yellow-300 opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
          }`}
        >
          <Icon name="star" size={16} />
        </button>
      )}
      {extra}
    </div>
  );
}
