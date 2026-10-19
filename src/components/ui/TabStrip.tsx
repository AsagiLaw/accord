"use client";

import { Fragment, type ReactNode, type Ref } from "react";
import { Icon } from "@/components/Icon";
import { Popover, usePopover } from "@/components/ui/Popover";

/** タブ1つ分。content はアイコンと名前（一覧にも同じものを出す） */
export type TabStripItem = { id: string; content: ReactNode; title?: string };

/**
 * Chrome のようなタブの並び（タブのブロックと、データベースのビューで共通）。
 * - タブは同じ幅で上の角が丸い。増えると全部が収まるまで同じだけ縮む。選んでいるタブは白く、下の中身とつながる
 * - 選んでいないタブどうしのあいだには、かすかな仕切り
 * - 一番左の角丸の正方形ボタンで、タブを縦1列の一覧で出して選べる（タブが多くても探せる）
 */
export function TabStrip({
  items,
  active,
  onSelect,
  label,
  stripRef,
  className = "",
  title,
  draggable,
  onDragStartTab,
  onContextMenuTab,
  activeAccessory,
  after,
  unit = "タブ",
}: {
  items: TabStripItem[];
  active: string;
  onSelect: (id: string) => void;
  label: string;
  stripRef?: Ref<HTMLDivElement>;
  /** 並びの外側の見た目（枠や背景）。呼ぶ側で決める */
  className?: string;
  title?: string;
  draggable?: boolean;
  onDragStartTab?: (e: React.DragEvent, id: string) => void;
  onContextMenuTab?: (e: React.MouseEvent, id: string) => void;
  /** 選んでいるタブの右に出すもの（「…」のメニューなど） */
  activeAccessory?: (id: string) => ReactNode;
  /** タブの後ろに出すもの（「＋」など） */
  after?: ReactNode;
  /** 一覧の見出しに使う呼び名（タブ・ビュー） */
  unit?: string;
}) {
  const overview = usePopover();
  return (
    <div ref={stripRef} role="tablist" aria-label={label} title={title} className={`flex min-w-0 items-end gap-0.5 overflow-hidden ${className}`}>
      {/* 一覧を出すボタン：白い角丸の四角に、下向きの山形（∨）。開いているあいだは色が付く */}
      <button
        onClick={overview.toggle}
        aria-label={`${unit}を一覧で出す`}
        aria-expanded={!!overview.anchor}
        title={`${unit}を一覧で出す（${items.length}つ）`}
        // 上はタブと同じ高さから始め、上下左右の空きがだいたい同じ（4px）になるように置く。影は付けない
        className={`mr-0.5 grid h-7 w-7 shrink-0 place-items-center self-start rounded-[7px] transition ${overview.anchor ? "bg-tint text-accent" : "bg-card text-muted hover:text-ink"}`}
      >
        <Icon name="expand" size={18} />
      </button>
      {items.map((t, i) => {
        const on = t.id === active;
        // 選んでいないタブどうしのあいだに、かすかな仕切りを出す（一番左の外側と、選んでいるタブの左右には出さない）
        const sep = i > 0 && !on && items[i - 1].id !== active;
        return (
          <Fragment key={t.id}>
            {/* 一番左のタブの前には何も置かない（一覧ボタンの左右の空きをそろえるため） */}
            {i > 0 && <span aria-hidden className={`mb-2 h-4 w-px shrink-0 self-end ${sep ? "bg-line" : "bg-transparent"}`} />}
            <button
              role="tab"
              aria-selected={on}
              title={t.title}
              draggable={draggable}
              onDragStart={draggable && onDragStartTab ? (e) => onDragStartTab(e, t.id) : undefined}
              onClick={() => onSelect(t.id)}
              onContextMenu={onContextMenuTab ? (e) => onContextMenuTab(e, t.id) : undefined}
              // 幅は選んでいるタブも含めて全部同じ（144px）で、タブが増えると全部が収まるまで同じだけ縮む（アイコンが見える幅まで）。
              // 押しても幅は変わらない。切れた名前は、カーソルを乗せるか、左の一覧ボタンで見られる
              className={`relative -mb-px flex h-8 w-36 min-w-9 shrink items-center gap-1.5 rounded-t-[8px] px-2.5 text-xs ${on ? "tab-active z-[1] bg-card font-bold" : "text-muted hover:bg-tint"}`}
            >
              {/* 選んでいるタブは、下の両側を内側へ丸くして（tab-active）、下の中身とつなげる */}
              <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">{t.content}</span>
              {on && activeAccessory?.(t.id)}
            </button>
          </Fragment>
        );
      })}
      {/* 一番右のタブが選ばれていないときは、右の端にも仕切り */}
      {items.length > 0 && <span aria-hidden className={`mb-2 h-4 w-px shrink-0 self-end ${items.at(-1)!.id !== active ? "bg-line" : "bg-transparent"}`} />}
      {after}

      {overview.anchor && (
        // タブを縦1列に並べる（1行ずつ、アイコンと名前を横書き）
        <Popover anchor={overview.anchor} onClose={overview.close} width={260} label={`${unit}の一覧`}>
          <p className="px-2 pt-1 pb-1.5 text-xs text-muted">
            {unit} {items.length}つ
          </p>
          <div className="grid gap-0.5">
            {items.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  overview.close();
                  onSelect(t.id);
                }}
                className={`flex h-8 min-w-0 items-center gap-2 rounded-[8px] px-2 text-left text-sm ${t.id === active ? "bg-tint font-bold" : "hover:bg-tint"}`}
              >
                {t.content}
                {t.id === active && <Icon name="ok" size={14} className="shrink-0 text-accent" />}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}
