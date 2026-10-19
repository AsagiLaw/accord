"use client";

import { Icon, type IconName } from "@/components/Icon";

/** 切り替えの1つ分。icon があれば文字の代わりにアイコンを出す（文字は読み上げとツールチップに使う） */
export type SegmentedItem<T extends string> = { value: T; label: string; icon?: IconName; title?: string };

/**
 * 切り替えボタン（表示モード・アイコン表示とリスト表示・カレンダーの期間など）。
 * 灰色の丸い台の上に並べ、選んでいるものだけ色を付ける。横いっぱいにするときは className に w-full。
 * sm はツールバー用（全体の高さが h-7 のボタンと同じ）
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
  size = "md",
  className = "",
}: {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex shrink-0 gap-0.5 rounded-full bg-bg p-1 ${className}`}>
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={it.icon ? it.label : undefined}
            title={it.title ?? (it.icon ? it.label : undefined)}
            onClick={() => onChange(it.value)}
            className={`grid flex-1 place-items-center rounded-full whitespace-nowrap ${size === "sm" ? "h-5 min-w-8 px-2.5 text-xs" : "min-h-[30px] min-w-9 px-3 text-sm"} ${on ? "bg-accent font-bold text-accent-ink" : "text-muted hover:text-ink"}`}
          >
            {it.icon ? <Icon name={it.icon} size={size === "sm" ? 14 : 18} /> : it.label}
          </button>
        );
      })}
    </div>
  );
}
