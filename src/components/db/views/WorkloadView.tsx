"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Popover, usePopover } from "@/components/ui/Popover";
import type { DbPage } from "@/lib/local/db";
import { isPageDone } from "@/lib/requests/due";
import { asValueProp } from "@/lib/requests/formula";
import { addDays, formatValue, isDate, today, valueOf } from "@/lib/requests/logic";
import { PageLink as PeekLink } from "../PageLink";
import { Empty, PageName, type ViewProps } from "./common";
import { timelineProps } from "./TimelineView";

/** 一度に出す期間の数 */
const SPAN = 12;
const dow = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const monthStart = (ymd: string) => `${ymd.slice(0, 7)}-01`;
const addMonths = (ymd: string, n: number) => {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
};

/**
 * 稼働：週（か月）ごとに、その期間に進行中のページ（開始の日付〜終わりの日付が重なるもの）が何件か・合計いくらかを棒で見せる。
 * 上限を決めると線を引き、超えた期間は赤くして「上限超え」と出す。棒を押すと、その期間のページが出る。
 * 終わったページは、はじめは数えない（ビューの設定で数えられる）
 */
export function WorkloadView({ database, view, pages, compact }: ViewProps) {
  const unit = view.options.workUnit ?? "week";
  const now = today();
  const thisStart = unit === "week" ? addDays(now, -dow(now)) : monthStart(now);
  // 出す範囲：はじめは今の期間が左から3つ目。‹ › で ずらす
  const [offset, setOffset] = useState(0);
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const pop = usePopover();
  const [openAt, setOpenAt] = useState<number | null>(null);

  const { start: startId, end: endId } = timelineProps(database, view);
  if (!startId && !endId) return <Empty>稼働には日付の項目が必要です。ビューの設定で、開始と終わりの日付を選んでください。</Empty>;
  const sumProp = database.props.find((p) => p.id === view.options.sum);
  const fmt = (n: number) => (sumProp ? formatValue(asValueProp(database, sumProp), n) : `${n}件`);
  const limit = view.options.limit && view.options.limit > 0 ? view.options.limit : null;

  // ページの期間（開始〜終わり。片方しか無ければその日だけ）
  const spans = pages
    .filter((p) => view.options.includeDone || !isPageDone(database, p))
    .map((p) => {
      const s = startId ? valueOf(p, startId) : undefined;
      const e = endId ? valueOf(p, endId) : undefined;
      const a = isDate(s) ? s : isDate(e) ? e : null;
      const b = isDate(e) ? e : a;
      return a && b ? { p, from: a <= b ? a : b, to: a <= b ? b : a } : null;
    })
    .filter((x) => x !== null);

  // 期間の並び
  const first = unit === "week" ? addDays(thisStart, (offset - 2) * 7) : addMonths(thisStart, offset - 2);
  const periods = Array.from({ length: SPAN }, (_, i) => {
    const from = unit === "week" ? addDays(first, i * 7) : addMonths(first, i);
    const to = unit === "week" ? addDays(from, 6) : addDays(addMonths(from, 1), -1);
    const active = spans.filter((x) => x.from <= to && x.to >= from).map((x) => x.p);
    const value = sumProp ? active.reduce((a, p) => a + (Number(valueOf(p, sumProp.id)) || 0), 0) : active.length;
    const label = unit === "week" ? `${Number(from.slice(5, 7))}/${Number(from.slice(8))}` : `${Number(from.slice(5, 7))}月`;
    return { from, to, active, value, label, current: from === thisStart, over: limit !== null && value > limit };
  });
  const max = Math.max(1, ...periods.map((x) => x.value), limit ?? 0);
  const anyOver = periods.some((x) => x.over);
  const range = (x: (typeof periods)[number]) => (unit === "week" ? `${x.from.replaceAll("-", "/")}〜${x.to.slice(5).replace("-", "/")}` : `${Number(x.from.slice(0, 4))}年${Number(x.from.slice(5, 7))}月`);
  const opened = openAt !== null ? periods[openAt] : null;

  return (
    <div className="space-y-2 rounded-[14px] border border-line bg-card p-3" data-name="稼働">
      <div className="flex flex-wrap items-center gap-1">
        <button className="btn-sub h-8 min-h-0 w-8 px-0" aria-label="前へ" onClick={() => setOffset(offset - 4)}>
          <Icon name="l" size={18} />
        </button>
        <button className="btn-sub h-8 min-h-0 px-3 text-sm" onClick={() => setOffset(0)}>
          {unit === "week" ? "今週" : "今月"}
        </button>
        <button className="btn-sub h-8 min-h-0 w-8 px-0" aria-label="次へ" onClick={() => setOffset(offset + 4)}>
          <Icon name="r" size={18} />
        </button>
        <span className="ml-2 text-xs text-muted">
          {unit === "week" ? "週ごと" : "月ごと"}の{sumProp ? `${sumProp.name}の合計` : "進行中の件数"}
          {limit !== null && `・上限 ${fmt(limit)}`}
        </span>
        <button className="ml-auto text-xs text-muted underline" onClick={() => setTable(!table)}>
          {table ? "グラフで見る" : "表で見る"}
        </button>
      </div>

      {table ? (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1 text-left font-normal">期間</th>
              <th className="py-1 text-right font-normal">{sumProp ? "合計" : "件数"}</th>
              {sumProp && <th className="py-1 text-right font-normal">件数</th>}
              {limit !== null && <th className="py-1 text-right font-normal">上限</th>}
            </tr>
          </thead>
          <tbody>
            {periods.map((x) => (
              <tr key={x.from} className={`border-t border-line/60 ${x.current ? "font-bold" : ""}`}>
                <td className="py-1">{range(x)}</td>
                <td className={`py-1 text-right ${x.over ? "text-warn" : ""}`}>{fmt(x.value)}</td>
                {sumProp && <td className="py-1 text-right text-muted">{x.active.length}件</td>}
                {limit !== null && <td className="py-1 text-right text-xs">{x.over ? <span className="font-bold text-warn">上限超え</span> : "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          {/* 棒：今の期間は濃く、上限を超えた期間は赤（上に「上限超え」）。押すとその期間のページ */}
          <div className={`relative flex items-end gap-1.5 border-b border-line ${compact ? "h-28" : "h-44"}`} role="img" aria-label="期間ごとの稼働">
            {limit !== null && (
              <div className="pointer-events-none absolute inset-x-0 z-[1] border-t-2 border-dashed border-muted/60" style={{ bottom: `${(limit / max) * 100}%` }}>
                <span className="absolute -top-4 right-0 bg-card px-1 text-[11px] text-muted">上限 {fmt(limit)}</span>
              </div>
            )}
            {periods.map((x, i) => (
              <button
                key={x.from}
                className="group relative flex h-full flex-1 flex-col items-center justify-end"
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onClick={(e) => {
                  setOpenAt(i);
                  pop.open(e);
                }}
                aria-label={`${range(x)}：${fmt(x.value)}${x.over ? "（上限超え）" : ""}`}
              >
                {x.over && <span className="mb-0.5 text-[10px] font-bold whitespace-nowrap text-warn">上限超え</span>}
                <span
                  className={`w-full max-w-10 rounded-t-[4px] ${x.over ? "bg-warn" : x.current ? "bg-accent" : "bg-accent/45"} ${hover === i ? "brightness-110" : ""}`}
                  style={{ height: `${(x.value / max) * 100}%`, minHeight: x.value ? 2 : 0 }}
                />
                {/* 押せる範囲は棒より広く（列全体）。カーソルを合わせると値 */}
                {hover === i && (
                  <span className="pointer-events-none absolute bottom-full z-[2] mb-1 rounded-[8px] border border-line bg-card px-2 py-1 text-xs whitespace-nowrap shadow-lg">
                    <b>{range(x)}</b>
                    <br />
                    {fmt(x.value)}
                    {sumProp && `（${x.active.length}件）`}
                    {x.over && <span className="ml-1 font-bold text-warn">上限超え</span>}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="mt-1 flex gap-1.5">
            {periods.map((x) => (
              <span key={x.from} className={`flex-1 text-center text-[11px] ${x.current ? "font-bold text-ink" : "text-muted"}`}>
                {x.label}
              </span>
            ))}
          </div>
          {anyOver && (
            <p className="mt-1 flex items-center gap-1 text-xs text-warn">
              <Icon name="flag" size={12} />
              上限を超えている期間があります
            </p>
          )}
        </div>
      )}

      {pop.anchor && opened && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={280} label={`${range(opened)}のページ`}>
          <p className="px-2 pt-1 pb-1.5 text-xs text-muted">
            {range(opened)}・{fmt(opened.value)}
          </p>
          {opened.active.map((p: DbPage) => (
            <PeekLink key={p.id} database={database} pageId={p.id} className="flex min-h-8 items-center rounded-[8px] px-2 hover:bg-tint" onClick={() => pop.close()}>
              <PageName database={database} page={p} className="text-sm" />
            </PeekLink>
          ))}
          {!opened.active.length && <p className="px-2 py-1 text-sm text-muted">進行中のページはありません</p>}
        </Popover>
      )}
    </div>
  );
}
