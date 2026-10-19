"use client";

import { Icon } from "@/components/Icon";

/**
 * チェックボックス（表の「チェックボックス」の項目と同じ見た目）。ブラウザのチェックボックスの代わりに、どこでもこれを使う。
 * label の中に置けば、横の文字を押しても切り替わる。danger は、取り消せない操作の確認に使う赤
 */
export function Checkbox({
  checked,
  onChange,
  label,
  id,
  size = "md",
  danger,
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 横に文字が無いときの読み上げ */
  label?: string;
  id?: string;
  size?: "sm" | "md";
  danger?: boolean;
  className?: string;
}) {
  const on = danger ? "border-warn bg-warn text-white" : "border-accent bg-accent text-accent-ink";
  return (
    <button
      id={id}
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`grid shrink-0 place-items-center rounded-[5px] border transition-colors ${size === "sm" ? "h-4 w-4" : "h-[18px] w-[18px]"} ${checked ? on : "border-muted hover:border-ink"} ${className}`}
    >
      {checked && <Icon name="ok" size={size === "sm" ? 12 : 14} />}
    </button>
  );
}
