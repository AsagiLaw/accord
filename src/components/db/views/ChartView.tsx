"use client";

import { useState } from "react";
import type { DbPage } from "@/lib/local/db";
import { asValueProp } from "@/lib/requests/formula";
import { formatValue, isDate, today, valueOf } from "@/lib/requests/logic";
import { Empty, type ViewProps } from "./common";
import { groupPages, groupableProps } from "./groups";

/** 区別しやすさを確かめた8色（globals.css の --series-1〜8）。この順で使い、9つ目からは「その他」にまとめる */
const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);
const OTHER = "var(--series-other)";

const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

type Bar = { key: string; label: string; value: number; count: number };

/**
 * グラフ：項目（依頼窓口など）ごとの件数・合計を、棒（1色。名前で見分ける）かドーナツ（8色と凡例・名前）で。
 * 折れ線は、日付の項目で月ごと（直近12か月）の推移。どれも、カーソルを合わせると値、「表で見る」で同じ数を表で
 */
export function ChartView({ database, view, pages, members, compact }: ViewProps) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const type = view.options.chartType ?? "bar";
  const sumProp = database.props.find((p) => p.id === view.options.sum);
  const measure = (list: DbPage[]) => (sumProp ? list.reduce((a, p) => a + (Number(valueOf(p, sumProp.id)) || 0), 0) : list.length);
  const fmt = (n: number) => (sumProp ? formatValue(asValueProp(database, sumProp), n) : `${n}件`);
  const what = sumProp ? `${sumProp.name}の合計` : "件数";

  // ---- 折れ線：月ごとの推移 ----
  if (type === "line") {
    const dateProp = database.props.find((p) => p.id === view.options.date);
    if (!dateProp) return <Empty>折れ線には、ビューの設定で「月ごとに分ける日付」を選んでください</Empty>;
    const thisMonth = today().slice(0, 7);
    const months = Array.from({ length: 12 }, (_, i) => shiftMonth(thisMonth, i - 11));
    const points: Bar[] = months.map((m) => {
      const list = pages.filter((p) => {
        const d = valueOf(p, dateProp.id);
        return isDate(d) && d.slice(0, 7) === m;
      });
      return { key: m, label: `${Number(m.slice(5))}月`, value: measure(list), count: list.length };
    });
    const max = Math.max(1, ...points.map((p) => p.value));
    const W = 600;
    const H = compact ? 140 : 200;
    const padX = 16;
    const padTop = 16;
    const xAt = (i: number) => padX + (i * (W - padX * 2)) / (points.length - 1);
    const yAt = (v: number) => padTop + (1 - v / max) * (H - padTop - 4);
    return (
      <Frame title={`${dateProp.name}の月ごとの${what}`} table={table} setTable={setTable}>
        {table ? (
          <DataTable rows={points} fmt={fmt} head="月" sum={!!sumProp} />
        ) : (
          <div className="relative" onPointerLeave={() => setHover(null)}>
            <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label={`月ごとの${what}`}>
              {/* 目盛りの線（うすく） */}
              {[0, 0.5, 1].map((t) => (
                <line key={t} x1={0} x2={W} y1={yAt(max * t)} y2={yAt(max * t)} stroke="var(--line)" strokeWidth={1} />
              ))}
              <polyline points={points.map((p, i) => `${xAt(i)},${yAt(p.value)}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {hover !== null && (
                <>
                  <line x1={xAt(hover)} x2={xAt(hover)} y1={padTop / 2} y2={H} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />
                  <circle cx={xAt(hover)} cy={yAt(points[hover].value)} r={5} fill="var(--accent)" stroke="var(--card)" strokeWidth={2} />
                </>
              )}
              {/* 最後の点だけ値を書く（全部には書かない） */}
              <text x={xAt(points.length - 1)} y={yAt(points.at(-1)!.value) - 8} textAnchor="end" fontSize={12} fill="var(--ink)">
                {fmt(points.at(-1)!.value)}
              </text>
              {/* カーソルを合わせる範囲：月ごとの縦の帯 */}
              {points.map((p, i) => (
                <rect key={p.key} x={xAt(i) - (W - padX * 2) / (points.length - 1) / 2} y={0} width={(W - padX * 2) / (points.length - 1)} height={H} fill="transparent" onPointerEnter={() => setHover(i)} />
              ))}
            </svg>
            <div className="mt-1 flex justify-between px-1 text-[11px] text-muted">
              {points.map((p) => (
                <span key={p.key}>{p.label}</span>
              ))}
            </div>
            {hover !== null && <Tip at="top-0 left-0">{`${points[hover].label}：${fmt(points[hover].value)}${sumProp ? `（${points[hover].count}件）` : ""}`}</Tip>}
          </div>
        )}
      </Frame>
    );
  }

  // ---- 棒・ドーナツ：項目ごと ----
  const group = database.props.find((p) => p.id === view.options.group) ?? groupableProps(database).find((p) => p.type === "status" || p.type === "select");
  if (!group) return <Empty>グラフには、分ける項目（選択・ステータスなど）が必要です。ビューの設定で選んでください。</Empty>;
  const bars: Bar[] = groupPages(group, pages, { options: { groupOrder: view.options.groupOrder } }, members)
    .filter((g) => g.pages.length)
    .map((g) => ({ key: g.key, label: g.label, value: measure(g.pages), count: g.pages.length }));
  if (!bars.length) return <Empty>該当するものはありません</Empty>;
  const total = bars.reduce((a, b) => a + b.value, 0);

  if (type === "donut") {
    // 9つ目からは「その他」にまとめる（色を作り足さない）
    const slices = bars.length > 8 ? [...bars.slice(0, 7), { key: "__other", label: "その他", value: bars.slice(7).reduce((a, b) => a + b.value, 0), count: bars.slice(7).reduce((a, b) => a + b.count, 0) }] : bars;
    const color = (i: number) => (slices[i].key === "__other" ? OTHER : SERIES[i]);
    const R = 70;
    const r = 44;
    // 各切れの始まりと終わりの角度（前の切れまでの合計から）
    const arcs = slices.map((s, i) => {
      const before = slices.slice(0, i).reduce((a, x) => a + x.value, 0);
      const a0 = (before / (total || 1)) * Math.PI * 2;
      const a1 = ((before + s.value) / (total || 1)) * Math.PI * 2;
      return { s, i, a0, a1 };
    });
    const pt = (a: number, rad: number) => [80 + rad * Math.sin(a), 80 - rad * Math.cos(a)];
    const path = (a0: number, a1: number) => {
      const big = a1 - a0 > Math.PI ? 1 : 0;
      const [x0, y0] = pt(a0, R);
      const [x1, y1] = pt(a1, R);
      const [x2, y2] = pt(a1, r);
      const [x3, y3] = pt(a0, r);
      return `M${x0},${y0} A${R},${R} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${big} 0 ${x3},${y3} Z`;
    };
    return (
      <Frame title={`${group.name}ごとの${what}`} table={table} setTable={setTable}>
        {table ? (
          <DataTable rows={slices} fmt={fmt} head={group.name} sum={!!sumProp} total={total} />
        ) : (
          <div className="flex flex-wrap items-center gap-6" onPointerLeave={() => setHover(null)}>
            <div className="relative">
              <svg viewBox="0 0 160 160" className={compact ? "h-32 w-32" : "h-44 w-44"} role="img" aria-label={`${group.name}ごとの${what}`}>
                {arcs.map(({ s, i, a0, a1 }) =>
                  // 1つだけのときは輪っか全体
                  a1 - a0 >= Math.PI * 2 - 1e-6 ? (
                    <circle key={s.key} cx={80} cy={80} r={(R + r) / 2} fill="none" stroke={color(i)} strokeWidth={R - r} onPointerEnter={() => setHover(i)} />
                  ) : (
                    <path key={s.key} d={path(a0, a1)} fill={color(i)} stroke="var(--card)" strokeWidth={2} opacity={hover === null || hover === i ? 1 : 0.55} onPointerEnter={() => setHover(i)} />
                  ),
                )}
                <text x={80} y={76} textAnchor="middle" fontSize={11} fill="var(--muted)">
                  合計
                </text>
                <text x={80} y={94} textAnchor="middle" fontSize={15} fontWeight={700} fill="var(--ink)">
                  {fmt(total)}
                </text>
              </svg>
              {hover !== null && <Tip at="top-full left-0 mt-1">{`${slices[hover].label}：${fmt(slices[hover].value)}（${Math.round((slices[hover].value / (total || 1)) * 100)}%）`}</Tip>}
            </div>
            {/* 凡例：色・名前・値・割合（色だけで見分けなくてよいように、名前をいつも出す） */}
            <ul className="min-w-0 flex-1 space-y-1 text-sm">
              {slices.map((s, i) => (
                <li key={s.key} className="flex items-center gap-2" onPointerEnter={() => setHover(i)}>
                  <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: color(i) }} />
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  <span className="shrink-0">{fmt(s.value)}</span>
                  <span className="w-10 shrink-0 text-right text-xs text-muted">{Math.round((s.value / (total || 1)) * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Frame>
    );
  }

  // 棒：横の棒を1色で。名前は左、値は右（色で見分けなくてよい）
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <Frame title={`${group.name}ごとの${what}`} table={table} setTable={setTable}>
      {table ? (
        <DataTable rows={bars} fmt={fmt} head={group.name} sum={!!sumProp} total={total} />
      ) : (
        <div className="space-y-1.5" role="img" aria-label={`${group.name}ごとの${what}`} onPointerLeave={() => setHover(null)}>
          {bars.map((b, i) => (
            <div key={b.key} className="relative flex items-center gap-2 text-sm" onPointerEnter={() => setHover(i)}>
              <span className="w-28 shrink-0 truncate">{b.label}</span>
              <span className="h-4 min-w-0 flex-1">
                <span className={`block h-full rounded-r-[4px] ${hover === i ? "bg-accent" : "bg-accent/70"}`} style={{ width: `${(b.value / max) * 100}%`, minWidth: b.value ? 2 : 0 }} />
              </span>
              <span className="w-28 shrink-0 text-right">{fmt(b.value)}</span>
              {hover === i && <Tip at="bottom-full left-28 mb-1">{`${b.label}：${fmt(b.value)}${sumProp ? `（${b.count}件）` : ""}・全体の${Math.round((b.value / (total || 1)) * 100)}%`}</Tip>}
            </div>
          ))}
        </div>
      )}
    </Frame>
  );
}

/** グラフの枠：題と「表で見る」 */
function Frame({ title, table, setTable, children }: { title: string; table: boolean; setTable: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-[14px] border border-line bg-card p-4" data-name="グラフ">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold">{title}</span>
        <button className="ml-auto text-xs text-muted underline" onClick={() => setTable(!table)}>
          {table ? "グラフで見る" : "表で見る"}
        </button>
      </div>
      {children}
    </div>
  );
}

/** カーソルを合わせたときの値。値や名前に重ならない場所（at）に出す */
function Tip({ children, at }: { children: React.ReactNode; at: string }) {
  return <span className={`pointer-events-none absolute z-[2] rounded-[8px] border border-line bg-card px-2 py-1 text-xs whitespace-nowrap shadow-lg ${at}`}>{children}</span>;
}

/** 同じ数を表で */
function DataTable({ rows, fmt, head, sum, total }: { rows: Bar[]; fmt: (n: number) => string; head: string; sum: boolean; total?: number }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-muted">
        <tr>
          <th className="py-1 text-left font-normal">{head}</th>
          <th className="py-1 text-right font-normal">{sum ? "合計" : "件数"}</th>
          {sum && <th className="py-1 text-right font-normal">件数</th>}
          {total !== undefined && <th className="py-1 text-right font-normal">割合</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-line/60">
            <td className="py-1">{r.label}</td>
            <td className="py-1 text-right">{fmt(r.value)}</td>
            {sum && <td className="py-1 text-right text-muted">{r.count}件</td>}
            {total !== undefined && <td className="py-1 text-right text-muted">{Math.round((r.value / (total || 1)) * 100)}%</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
