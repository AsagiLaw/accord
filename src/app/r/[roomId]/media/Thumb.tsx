"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Media } from "@/lib/local/db";
import { ThumbImage } from "@/components/ThumbImage";

export { ThumbImage };

/**
 * 名前をその場で書き換える入力欄（画像の名前の所に出す）。Enter か外を押すと決まり、Esc でやめる。
 * 画像のクリック・ダブルクリック・キー操作には伝えない
 */
export function NameField({
  name,
  onDone,
  className = "",
}: {
  name: string;
  onDone: (name: string | null) => void;
  className?: string;
}) {
  const [value, setValue] = useState(name);
  const finished = useRef(false);
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const v = value.trim();
    onDone(save && v && v !== name ? v : null);
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <input
      autoFocus
      value={value}
      aria-label="画像の名前"
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        // 日本語の変換を決めるための Enter では決めない
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={stop}
      onContextMenu={stop}
      className={`min-w-0 rounded-[6px] border border-accent bg-card px-1.5 text-ink outline-none ${className}`}
    />
  );
}

export function Thumb({
  m,
  selected,
  order,
  onClick,
  onDoubleClick,
  onFav,
  extra,
  renaming,
  onRenamed,
}: {
  m: Media;
  selected: boolean;
  /** 複数選択時の何番目か */
  order?: number;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onFav?: () => void;
  extra?: React.ReactNode;
  /** 名前をその場で書き換えているとき */
  renaming?: boolean;
  onRenamed?: (name: string | null) => void;
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
      {renaming ? (
        <NameField
          name={m.name}
          onDone={(n) => onRenamed?.(n)}
          className="absolute right-2 bottom-2 left-2 h-6 text-xs font-bold"
        />
      ) : (
        <span className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-16px)] truncate rounded-[10px] bg-black/25 px-2.5 py-px text-xs font-bold text-white backdrop-blur-md [text-shadow:0_1px_3px_#000,0_0_8px_#000a]">
          {m.name}
        </span>
      )}
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
            m.fav
              ? "text-yellow-300 opacity-100"
              : "opacity-0 group-hover:opacity-100 focus:opacity-100"
          }`}
        >
          <Icon name="star" size={16} />
        </button>
      )}
      {extra}
    </div>
  );
}
