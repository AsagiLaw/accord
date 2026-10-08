"use client";

import { DONE, P } from "@/lib/requests/defaults";
import { isDate, today, valueOf } from "@/lib/requests/logic";
import { Empty, type ViewProps } from "./common";

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

/** 合計の集計（依頼なら「これまでの収入」）。月ごとの棒も出す */
export function SummaryView({ database, view, pages, allPages, compact }: ViewProps) {
  const sumProp = database.props.find((p) => p.id === view.options.sum);
  if (!sumProp) return <Empty>ビューの設定で、合計する数値の項目を選んでください</Empty>;
  const fmt = (n: number) => (sumProp.format === "yen" ? yen(n) : n.toLocaleString("ja-JP"));
  const num = (p: (typeof pages)[number]) => Number(valueOf(p, sumProp.id)) || 0;
  const total = pages.reduce((a, p) => a + num(p), 0);

  // 月ごと（日付の項目で振り分け）。直近6か月
  const dateId = view.options.date;
  const thisMonth = today().slice(0, 7);
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const byMonth = new Map<string, number>();
  if (dateId) {
    for (const p of pages) {
      const d = valueOf(p, dateId);
      if (isDate(d)) byMonth.set(d.slice(0, 7), (byMonth.get(d.slice(0, 7)) ?? 0) + num(p));
    }
  }
  const max = Math.max(1, ...months.map((m) => byMonth.get(m) ?? 0));
  // 依頼なら、まだ完了していない依頼の依頼料（これから入る見込み）も出す
  const expected = database.kind === "request" ? allPages.filter((p) => p.values[P.status] !== DONE).reduce((a, p) => a + num(p), 0) : null;

  return (
    <div className="rounded-[14px] border border-line bg-card p-4">
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <div className="text-xs text-muted">合計（{pages.length}件）</div>
          <div className="text-[28px] font-bold">{fmt(total)}</div>
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
      </div>
      {dateId && (
        <div className={`mt-4 flex items-end gap-2 ${compact ? "h-20" : "h-32"}`} role="img" aria-label="月ごとの合計">
          {months.map((mo) => {
            const v = byMonth.get(mo) ?? 0;
            return (
              <div key={mo} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${Number(mo.slice(5))}月：${fmt(v)}`}>
                <div className={`w-full max-w-10 rounded-t-md ${mo === thisMonth ? "bg-accent" : "bg-accent/40"}`} style={{ height: `${(v / max) * 100}%`, minHeight: v ? 3 : 0 }} />
                <span className="text-[11px] text-muted">{Number(mo.slice(5))}月</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
