"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Popover, usePopover } from "@/components/ui/Popover";
import { pickerBox, type PickerSize } from "@/components/ui/Select";
import { addDays, isDate, today } from "@/lib/requests/logic";

// 日付・時刻を選ぶ（ブラウザの date・time の入力欄の代わり）。ボタンはドロップダウンと同じ形で、押すとカレンダーや時刻の一覧が出る

const WEEK = "日月火水木金土";
const dayOfWeek = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const pad = (n: number) => String(n).padStart(2, "0");

/** 「2026/10/19（月）」の形 */
export const dateLabel = (ymd: string) => `${ymd.replaceAll("-", "/")}（${WEEK[dayOfWeek(ymd)]}）`;

/**
 * 日付を選ぶカレンダー（カレンダーのブロックと同じ色分け：日曜は赤、土曜は青、選んだ日は色の付いた丸）。
 * ポップオーバーの中や、表のセルの編集にそのまま置ける。onClear を渡すと「クリア」を出す
 */
export function DatePicker({ value, onPick, min, onClear }: { value: string; onPick: (ymd: string) => void; min?: string; onClear?: () => void }) {
  const now = today();
  // 出している月（YYYY-MM）。はじめは選んでいる日の月、無ければ今月
  const [month, setMonth] = useState((isDate(value) ? value : now).slice(0, 7));
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  // いつも6週分を並べる（月を変えても高さが変わらないように）
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i - dayOfWeek(first)));
  const move = (n: number) => setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  const navClass = "grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-tint hover:text-ink";
  return (
    <div data-name="日付を選ぶカレンダー" className="select-none">
      <div className="mb-1 flex items-center gap-0.5 pl-1.5">
        <b className="flex-1 text-sm">
          {y}年{m}月
        </b>
        <button type="button" aria-label="前の月" title="前の月" onClick={() => move(-1)} className={navClass}>
          <Icon name="l" size={18} />
        </button>
        <button type="button" aria-label="次の月" title="次の月" onClick={() => move(1)} className={navClass}>
          <Icon name="r" size={18} />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px]">
        {[...WEEK].map((w, i) => (
          <span key={w} className={`py-0.5 ${i === 0 ? "text-warn/80" : i === 6 ? "text-accent/80" : "text-muted"}`}>
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((d) => {
          const on = d === value;
          const dw = dayOfWeek(d);
          const tone = d === now ? "font-bold text-accent ring-1 ring-accent ring-inset" : d.slice(0, 7) !== month ? "text-muted/50" : dw === 0 ? "text-warn" : dw === 6 ? "text-accent" : "";
          return (
            <button
              key={d}
              type="button"
              disabled={!!min && d < min}
              aria-pressed={on}
              aria-label={dateLabel(d)}
              onClick={() => onPick(d)}
              className={`mx-auto grid h-8 w-8 place-items-center rounded-full text-sm tabular-nums disabled:opacity-30 ${on ? "bg-accent font-bold text-accent-ink" : `enabled:hover:bg-tint ${tone}`}`}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex items-center border-t border-line pt-1">
        <button type="button" disabled={!!min && now < min} onClick={() => onPick(now)} className="rounded-[6px] px-1.5 py-0.5 text-xs text-accent hover:bg-tint disabled:opacity-40">
          今日
        </button>
        {onClear && isDate(value) && (
          <button type="button" onClick={onClear} className="ml-auto rounded-[6px] px-1.5 py-0.5 text-xs text-muted hover:bg-tint hover:text-ink">
            クリア
          </button>
        )}
      </div>
    </div>
  );
}

/** 日付の入力欄。押すとカレンダーが出る。clearable なら空にもできる */
export function DateInput({
  value,
  onChange,
  label,
  min,
  clearable,
  placeholder = "日付を選ぶ",
  id,
  size = "md",
  className = "w-full",
}: {
  value: string;
  onChange: (ymd: string) => void;
  label: string;
  /** これより前の日は選べない */
  min?: string;
  clearable?: boolean;
  placeholder?: string;
  id?: string;
  size?: PickerSize;
  className?: string;
}) {
  const pop = usePopover();
  const set = isDate(value);
  return (
    <>
      <button
        id={id}
        type="button"
        aria-label={`${label}：${set ? dateLabel(value) : "未入力"}`}
        aria-haspopup="dialog"
        aria-expanded={!!pop.anchor}
        onClick={pop.toggle}
        className={`${pickerBox(size)} ${className}`}
      >
        <span className={`truncate tabular-nums ${set ? "" : "text-muted"}`}>{set ? dateLabel(value) : placeholder}</span>
        <Icon name="calendar" size={16} className="shrink-0 text-muted" />
      </button>
      <Popover anchor={pop.anchor} onClose={pop.close} width={276} label={label} nested>
        <DatePicker
          value={value}
          min={min}
          onPick={(d) => {
            pop.close();
            onChange(d);
          }}
          onClear={
            clearable
              ? () => {
                  pop.close();
                  onChange("");
                }
              : undefined
          }
        />
      </Popover>
    </>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
const MINUTES = Array.from({ length: 12 }, (_, i) => pad(i * 5));

/** 時刻の入力欄（「10:30」の形）。押すと、時と分（5分ごと）の一覧が出る。時を選んでも閉じず、分を選ぶと閉じる */
export function TimeInput({ value, onChange, label, size = "md", className = "w-full" }: { value: string; onChange: (hm: string) => void; label: string; size?: PickerSize; className?: string }) {
  const pop = usePopover();
  const [h, mm] = /^\d{2}:\d{2}$/.test(value) ? value.split(":") : ["", ""];
  return (
    <>
      <button
        type="button"
        aria-label={`${label}：${value || "未入力"}`}
        aria-haspopup="dialog"
        aria-expanded={!!pop.anchor}
        onClick={pop.toggle}
        className={`${pickerBox(size)} ${className}`}
      >
        <span className={`truncate tabular-nums ${value ? "" : "text-muted"}`}>{value || "時刻を選ぶ"}</span>
        <Icon name="clock" size={16} className="shrink-0 text-muted" />
      </button>
      <Popover anchor={pop.anchor} onClose={pop.close} width={168} label={label} nested>
        <div className="grid grid-cols-2 gap-1">
          <TimeColumn name="時" items={HOURS} value={h} onPick={(x) => onChange(`${x}:${mm || "00"}`)} />
          <TimeColumn
            name="分"
            items={MINUTES}
            value={mm}
            onPick={(x) => {
              onChange(`${h || "00"}:${x}`);
              pop.close();
            }}
          />
        </div>
      </Popover>
    </>
  );
}

/** 時刻の一覧の1列（時か分）。開いたときは、選んでいるものが真ん中に見えるようにする */
function TimeColumn({ name, items, value, onPick }: { name: string; items: string[]; value: string; onPick: (v: string) => void }) {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = list.current;
    const on = el?.querySelector<HTMLElement>("[aria-pressed='true']");
    if (el && on) el.scrollTop = on.offsetTop - el.clientHeight / 2 + on.offsetHeight / 2;
    // 開いたときだけ合わせる（選び直すたびに動かさない）
  }, []);
  return (
    <div>
      <p className="pb-1 text-center text-xs text-muted">{name}</p>
      <div ref={list} role="group" aria-label={name} className="relative h-52 overflow-y-auto">
        {items.map((x) => (
          <button
            key={x}
            type="button"
            aria-pressed={x === value}
            onClick={() => onPick(x)}
            className={`flex h-8 w-full items-center justify-center rounded-[8px] text-sm tabular-nums ${x === value ? "bg-accent font-bold text-accent-ink" : "hover:bg-tint"}`}
          >
            {x}
          </button>
        ))}
      </div>
    </div>
  );
}
