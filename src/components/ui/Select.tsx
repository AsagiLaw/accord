"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { MenuItem, Popover, usePopover } from "@/components/ui/Popover";

/** ドロップダウンの1つ分。note は説明（いつもは出さず、カーソルを乗せてしばらくすると出す） */
export type SelectOption<T extends string = string> = { value: T; label: string; note?: string };

/**
 * ドロップダウンのボタンの見た目（日付・時刻の入力欄や、選択肢を選ぶ欄も同じ形にする）。
 * 高さは置く場所に合わせる：sm はツールバー（h-7 のボタンと並ぶ）、md はメニューや設定の行、lg は文字の入力欄（.field）と同じ高さ（タグが何行かになると伸びる）
 */
export type PickerSize = "sm" | "md" | "lg";
export const pickerBox = (size: PickerSize = "md") =>
  `flex min-w-0 items-center justify-between gap-2 rounded-[10px] border border-line bg-bg text-left enabled:hover:bg-tint disabled:opacity-50 ${size === "sm" ? "h-7 px-2.5 text-xs" : size === "md" ? "h-9 px-3 text-sm" : "min-h-[calc(1.7em+1rem+2px)] px-3 py-1"}`;

/**
 * ドロップダウン（メディアの「並べる基準」と同じ見た目）。ブラウザの select の代わりに、どこでもこれを使う。
 * 押すとボタンの下に一覧を出し、選んでいるものは左にチェックを付ける
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  placeholder = "選ぶ",
  disabled,
  id,
  size = "md",
  className = "w-full",
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** 何を選ぶか（読み上げと、一覧の名前に使う） */
  label: string;
  /** 一覧に無い値のときに出す文字 */
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  size?: PickerSize;
  /** 幅など（はじめは横いっぱい） */
  className?: string;
}) {
  const pop = usePopover();
  // 一覧の幅は、ボタンの幅にそろえる
  const [width, setWidth] = useState(0);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <button
        id={id}
        type="button"
        aria-label={`${label}：${current?.label ?? placeholder}`}
        aria-haspopup="menu"
        aria-expanded={!!pop.anchor}
        disabled={disabled}
        onClick={(e) => {
          setWidth(e.currentTarget.offsetWidth);
          pop.toggle(e);
        }}
        className={`${pickerBox(size)} ${className}`}
      >
        <span className={`truncate ${current ? "" : "text-muted"}`}>{current?.label ?? placeholder}</span>
        <Icon name="dn" size={16} className={`shrink-0 text-muted transition-transform ${pop.anchor ? "rotate-180" : ""}`} />
      </button>
      <Popover anchor={pop.anchor} onClose={pop.close} width={Math.max(width, 180)} label={label} nested>
        {options.map((o) => (
          <MenuItem
            key={o.value}
            active={o.value === value}
            title={o.note}
            icon={o.value === value ? <Icon name="ok" size={14} /> : <span />}
            onClick={() => {
              pop.close();
              if (o.value !== value) onChange(o.value);
            }}
          >
            {o.label}
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}
