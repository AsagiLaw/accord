"use client";

import { useState } from "react";
import type { DbPage } from "@/lib/local/db";
import { asValueProp } from "@/lib/requests/formula";
import { formatValue, isDate, today, valueOf } from "@/lib/requests/logic";
import { isPageDone } from "@/lib/requests/due";
import { Empty, type ViewProps } from "./common";
import { groupPages } from "./groups";

/** その月から n か月ずらした「YYYY-MM」 */
const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/**
 * 合計の集計（依頼なら「これまでの収入」）。月ごとの棒も出す。
 * 期間（すべて・今年・直近12か月）で絞り、去年の同じ月と比べられる。項目（依頼窓口など）ごとの合計も出せる
 */
export function SummaryView({ database, view, pages, allPages, members, compact }: ViewProps) {
  const [table, setTable] = useState(false);
  const sumProp = database.props.find((p) => p.id === view.options.sum);
  if (!sumProp) return <Empty>ビューの設定で、合計する数値の項目を選んでください</Empty>;
  const fmt = (n: number) => formatValue(asValueProp(database, sumProp), n);
  const num = (p: DbPage) => Number(valueOf(p, sumProp.id)) || 0;
  const dateId = view.options.date;
  const dateOf = (p: DbPage) => {
    const d = dateId ? valueOf(p, dateId) : undefined;
    return isDate(d) ? d : null;
  };

  // 期間：今年（1〜12月）・直近12か月・すべて（月の棒は直近6か月）。日付の項目が無ければ、期間では絞らない
  const thisMonth = today().slice(0, 7);
  const period = dateId ? (view.options.period ?? "all") : "all";
  const year = thisMonth.slice(0, 4);
  const span = period === "last12" ? 12 : 6;
  const months: string[] =
    period === "year" ? Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`) : Array.from({ length: span }, (_, i) => shiftMonth(thisMonth, i - span + 1));
  const inPeriod = (p: DbPage) => {
    if (period === "all") return true;
    const d = dateOf(p);
    return !!d && d.slice(0, 7) >= months[0] && d.slice(0, 7) <= months.at(-1)!;
  };
  const list = pages.filter(inPeriod);
  const total = list.reduce((a, p) => a + num(p), 0);

  // 月ごと（日付の項目で振り分け）。去年と比べるときは、12か月前の同じ月も
  const byMonth = new Map<string, number>();
  for (const p of pages) {
    const d = dateOf(p);
    if (d) byMonth.set(d.slice(0, 7), (byMonth.get(d.slice(0, 7)) ?? 0) + num(p));
  }
  const compare = !!view.options.compare && !!dateId;
  const max = Math.max(1, ...months.map((m) => byMonth.get(m) ?? 0), ...(compare ? months.map((m) => byMonth.get(shiftMonth(m, -12)) ?? 0) : []));
  const lastYearTotal = compare ? months.reduce((a, m) => a + (byMonth.get(shiftMonth(m, -12)) ?? 0), 0) : 0;
  // 依頼なら、まだ完了していない依頼の依頼料（これから入る見込み）も出す
  const expected = database.kind === "request" ? allPages.filter((p) => !isPageDone(database, p)).reduce((a, p) => a + num(p), 0) : null;

  // 項目ごとの合計（大きい順）
  const split = database.props.find((p) => p.id === view.options.split);
  const parts = split
    ? groupPages(split, list, { options: {} }, members)
        .map((g) => ({ ...g, total: g.pages.reduce((a, p) => a + num(p), 0) }))
        // 1件も無いときは、選択肢を 0 のまま並べる
        .filter((g) => g.pages.length || (!list.length && g.key))
        .sort((a, b) => b.total - a.total)
    : [];
  const partMax = Math.max(1, ...parts.map((g) => g.total));
  const periodLabel = period === "year" ? `${year}年` : period === "last12" ? "直近12か月" : "すべて";

  return (
    <div className="space-y-3 rounded-[14px] border border-line bg-card p-4">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-2">
        <div>
          <div className="text-xs text-muted">
            合計（{periodLabel}・{list.length}件）
          </div>
          <div className="text-[28px] font-bold">{fmt(total)}</div>
          {compare && <div className="text-xs text-muted">去年の同じ期間：{fmt(lastYearTotal)}</div>}
        </div>
        {dateId && (
          <div>
            <div className="text-xs text-muted">今月</div>
            <div className="text-[28px] font-bold">{fmt(byMonth.get(thisMonth) ?? 0)}</div>
          </div>
        )}
        {expected !== null && (
          <div>
            <div className="text-xs text-muted">進行中の依頼（見込み）</div>
            <div className="text-[28px] font-bold text-muted">{fmt(expected)}</div>
          </div>
        )}
        <button className="ml-auto text-xs text-muted underline" onClick={() => setTable(!table)}>
          {table ? "グラフで見る" : "表で見る"}
        </button>
      </div>

      {/* 月ごとの棒（今月は濃く）。去年と比べるときは、左に去年の同じ月を灰色で */}
      {dateId &&
        (table ? (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 text-left font-normal">月</th>
                <th className="py-1 text-right font-normal">合計</th>
                {compare && <th className="py-1 text-right font-normal">去年</th>}
              </tr>
            </thead>
            <tbody>
              {months.map((mo) => (
                <tr key={mo} className="border-t border-line/60">
                  <td className="py-1">{`${Number(mo.slice(0, 4))}年${Number(mo.slice(5))}月`}</td>
                  <td className="py-1 text-right">{fmt(byMonth.get(mo) ?? 0)}</td>
                  {compare && <td className="py-1 text-right text-muted">{fmt(byMonth.get(shiftMonth(mo, -12)) ?? 0)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div>
            <div className={`flex items-end gap-1.5 border-b border-line ${compact ? "h-20" : "h-32"}`} role="img" aria-label="月ごとの合計">
              {months.map((mo) => {
                const v = byMonth.get(mo) ?? 0;
                const lv = byMonth.get(shiftMonth(mo, -12)) ?? 0;
                return (
                  <div key={mo} className="group relative flex h-full flex-1 items-end justify-center gap-0.5" title={`${Number(mo.slice(5))}月：${fmt(v)}${compare ? `（去年 ${fmt(lv)}）` : ""}`}>
                    {compare && (
                      <div
                        className="w-full max-w-4 rounded-t-[4px] bg-line"
                        style={{
                          height: `${(lv / max) * 100}%`,
                          minHeight: lv ? 2 : 0,
                        }}
                      />
                    )}
                    <div
                      className={`w-full rounded-t-[4px] ${compare ? "max-w-4" : "max-w-10"} ${mo === thisMonth ? "bg-accent" : "bg-accent/40"} group-hover:brightness-110`}
                      style={{
                        height: `${(v / max) * 100}%`,
                        minHeight: v ? 2 : 0,
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex gap-1.5">
              {months.map((mo) => (
                <span key={mo} className="flex-1 text-center text-[11px] text-muted">
                  {Number(mo.slice(5))}月
                </span>
              ))}
            </div>
            {compare && (
              <div className="mt-1 flex gap-3 text-[11px] text-muted">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-[2px] bg-accent" />
                  今年
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-[2px] bg-line" />
                  去年
                </span>
              </div>
            )}
          </div>
        ))}

      {/* 項目ごとの合計：名前・棒・金額（色は1色。名前で見分ける） */}
      {split && (
        <div className="space-y-1 border-t border-line pt-3">
          <div className="text-xs text-muted">{split.name}ごと</div>
          {parts.map((g) => (
            <div key={g.key || "__none"} className="flex items-center gap-2 text-sm" title={`${g.label}：${fmt(g.total)}（${g.pages.length}件）`}>
              <span className="w-28 shrink-0 truncate">{g.label}</span>
              <span className="h-3 min-w-0 flex-1">
                <span
                  className="block h-full rounded-r-[4px] bg-accent/70"
                  style={{
                    width: `${(g.total / partMax) * 100}%`,
                    minWidth: g.total ? 2 : 0,
                  }}
                />
              </span>
              <span className="w-28 shrink-0 text-right">{fmt(g.total)}</span>
              <span className="w-10 shrink-0 text-right text-xs text-muted">{g.pages.length}件</span>
            </div>
          ))}
          {!parts.length && (
            <div className="flex items-center gap-2 text-sm">
              <span className="w-28 shrink-0 truncate">{split.name}なし</span>
              <span className="h-3 min-w-0 flex-1" />
              <span className="w-28 shrink-0 text-right">{fmt(0)}</span>
              <span className="w-10 shrink-0 text-right text-xs text-muted">0件</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
