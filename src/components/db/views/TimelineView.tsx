"use client";

import Link from "next/link";
import { P } from "@/lib/requests/defaults";
import { addDays, daysBetween, isDate, stagesOf, today } from "@/lib/requests/logic";
import { stageDates, stageOf } from "@/lib/requests/stages";
import { Empty, PageName, pageHref, type ViewProps } from "./common";

/** 日付の項目を選ぶ。設定が無ければ、依頼は開始日〜納期、それ以外は1つ目〜2つ目の日付 */
export function timelineProps(database: ViewProps["database"], view: ViewProps["view"]) {
  const dates = database.props.filter((p) => p.type === "date");
  const req = database.kind === "request";
  const start = view.options.start ?? (req ? P.start : dates[0]?.id);
  const end = view.options.end ?? (req ? P.due : (dates[1]?.id ?? dates[0]?.id));
  return { start, end };
}

/**
 * ページごとに、開始から終わりまでの帯を並べる（Notion のタイムラインと同じく、細い行に、名前の入った帯）。
 * 依頼は今の工程と％を帯に出し、工程の期限は帯の下の端に小さなひし形で出す。片方しか無ければ短い帯で出す
 */
export function TimelineView({ database, pages, view, compact, fit }: ViewProps) {
  const { start: startId, end: endId } = timelineProps(database, view);
  const rows = pages
    .map((p) => {
      const s = startId ? p.values[startId] : undefined;
      const e = endId ? p.values[endId] : undefined;
      const start = isDate(s) ? s : isDate(e) ? e : null;
      const due = isDate(e) ? e : start;
      if (!start || !due) return null;
      const s0 = start <= due ? start : due;
      const e0 = start <= due ? due : start;
      const stageProp = database.props.find((x) => x.id === view.options.stage && x.type === "stage");
      const stages = stageProp
        ? stageDates(stageProp, p, s0, e0)
        : view.options.stages && database.kind === "request"
          ? stagesOf(database, p)
              .filter((x) => x.kind === "stage")
              .map((x) => ({ name: x.name, date: x.date, pct: 0, done: false }))
          : [];
      // 今の工程と％（帯に出す）
      const cur = stageProp ? stageOf(stageProp, p) : null;
      return { p, start: s0, due: e0, stages, pct: cur ? cur.pct : null, stageName: cur?.current?.name };
    })
    .filter((r) => r !== null);

  if (!startId && !endId) return <Empty>タイムラインには日付の項目が必要です。列の「＋」から日付の項目を足してください。</Empty>;
  if (!rows.length) return <Empty>日付が入っているページがありません</Empty>;

  const now = today();
  const from = addDays([now, ...rows.map((r) => r.start)].sort()[0], -2);
  const to = addDays([now, ...rows.map((r) => r.due)].sort().at(-1)!, 2);
  const span = Math.max(1, daysBetween(from, to));
  const x = (d: string) => `${(daysBetween(from, d) / span) * 100}%`;
  // 目盛りは期間に合わせて、1日・1週・2週・1か月おき
  const step = span <= 14 ? 1 : span <= 70 ? 7 : span <= 140 ? 14 : 30;
  const ticks: string[] = [];
  for (let d = from; d <= to; d = addDays(d, step)) ticks.push(d);

  return (
    // fit（オールビューで高さを決めたとき）は、件数が少なくても枠をその高さまで伸ばす。目盛りと今日の線も下まで
    <div className={`overflow-x-auto rounded-[14px] border border-line bg-card px-3 py-2 ${fit ? "flex grow flex-col" : ""}`}>
      <div className={`${compact ? "min-w-[520px]" : "min-w-[680px]"} ${fit ? "flex grow flex-col" : ""}`}>
        {/* 目盛り（日付）：細い1行 */}
        <div className="relative h-5 border-b border-line/70 text-[10px] text-muted">
          {ticks.map((t, i) => (
            // 両端の日付は、枠からはみ出さないように内側へ寄せる
            <span key={t} className={`absolute top-0.5 whitespace-nowrap ${i === 0 ? "" : daysBetween(t, to) < step / 2 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: x(t) }}>
              {Number(t.slice(5, 7))}/{Number(t.slice(8))}
            </span>
          ))}
        </div>
        <div className={`relative py-1 ${fit ? "grow" : ""}`}>
          {/* 目盛りの線（帯の後ろ）と、今日の線（帯の前） */}
          <div className="pointer-events-none absolute inset-0">
            {ticks.map((t) => (
              <span key={t} className="absolute inset-y-0 w-px bg-line/50" style={{ left: x(t) }} />
            ))}
          </div>
          {rows.map(({ p, start, due, stages, pct, stageName }) => (
            <div key={p.id} className="relative h-8">
              {/* 帯：名前（と今の工程・％）が入る。押すとページを開く。帯が短いときは、名前は帯の外まで続く */}
              <Link
                href={pageHref(database, p.id)}
                className="absolute top-1 bottom-1 flex items-center rounded-[6px] border border-line bg-card shadow-sm hover:border-accent"
                style={{ left: x(start), width: `max(8px, calc(${x(due)} - ${x(start)}))` }}
                title={`${start.replaceAll("-", "/")} 〜 ${due.replaceAll("-", "/")}${pct !== null ? `（${stageName ? `${stageName}・` : ""}${pct}%）` : ""}`}
              >
                {/* 今の工程までを薄く塗る */}
                {pct !== null && <span className="absolute inset-y-0 left-0 rounded-l-[5px] bg-accent/15" style={{ width: `${pct}%` }} />}
                <span className="relative flex items-center gap-1.5 px-2 text-xs whitespace-nowrap">
                  <PageName database={database} page={p} className="font-bold" />
                  {pct !== null && (
                    <span className="text-muted">
                      {stageName ? `${stageName} ` : ""}
                      {pct}%
                    </span>
                  )}
                </span>
              </Link>
              {/* 工程の期限：帯の下の端に小さなひし形（名前はカーソルを合わせると出る） */}
              {stages.map((st) => (
                <span
                  key={st.name + st.date}
                  className={`absolute bottom-0.5 h-2 w-2 -translate-x-1/2 rotate-45 border border-card ${st.done ? "bg-accent" : st.date < now ? "bg-warn" : "bg-muted"}`}
                  style={{ left: x(st.date) }}
                  title={`${st.name}${st.pct ? `（${st.pct}%）` : ""}：${st.date.replaceAll("-", "/")}`}
                />
              ))}
            </div>
          ))}
          <span className="pointer-events-none absolute inset-y-0 z-[2] w-px bg-warn" style={{ left: x(now) }} title="今日" />
        </div>
      </div>
    </div>
  );
}
