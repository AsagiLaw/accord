"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { MenuItem, Popover, usePopover } from "@/components/ui/Popover";
import type { DbView } from "@/lib/local/db";
import { P } from "@/lib/requests/defaults";
import { addDays, daysBetween, isDate, stagesOf, today, valueOf } from "@/lib/requests/logic";
import { stageDates, stageOf, withPct } from "@/lib/requests/stages";
import { Empty, PageName, type ViewProps } from "./common";
import { PageLink as PeekLink } from "../PageLink";
import { visibleProps } from "../editors";
import { PropValue } from "../values";
import { GroupHead, colorHueOf, groupPages, groupPropOf, groupSumText, tintOf, useCollapsed, type PageGroup } from "./groups";

/** 日付の項目を選ぶ。設定が無ければ、依頼は開始日〜納期、それ以外は1つ目〜2つ目の日付 */
export function timelineProps(database: ViewProps["database"], view: ViewProps["view"]) {
  const dates = database.props.filter((p) => p.type === "date");
  const req = database.kind === "request";
  const start = view.options.start ?? (req ? P.start : dates[0]?.id);
  const end = view.options.end ?? (req ? P.due : (dates[1]?.id ?? dates[0]?.id));
  return { start, end };
}

type Scale = NonNullable<DbView["options"]["timelineScale"]>;
/** 幅ごとの1日の横幅（px）。Notion と同じく、名前は画面の横幅にだいたい入る期間 */
export const TIMELINE_SCALES: { id: Scale; label: string; px: number }[] = [
  { id: "week", label: "週", px: 96 },
  { id: "biweek", label: "2週", px: 48 },
  { id: "month", label: "月", px: 24 },
  { id: "quarter", label: "四半期", px: 8 },
  { id: "year", label: "年", px: 2.5 },
];
const WEEK = "日月火水木金土";
const dow = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const firstOfMonth = (ymd: string) => `${ymd.slice(0, 7)}-01`;
const nextMonth = (ymd: string) => {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};
const nextYear = (ymd: string) => `${Number(ymd.slice(0, 4)) + 1}-01-01`;

/**
 * ページごとに、開始から終わりまでの帯を並べる（Notion のタイムラインと同じく、細い行に、名前の入った帯）。
 * 名前と今の工程・％は帯の左に付け、横にずらして見えなくなったら左の端で帯の上にかぶさって付いてくる。工程の期限は帯の下の端に小さなひし形で出す。片方しか無ければ短い帯で出す。
 * 「工程の期間を表示する」で工程の項目を選ぶと、工程の設定の開始日〜終了日の帯を、工程の割合で分けて出す（工程の設定の下の帯と同じ）。
 * 幅（週・2週・月・四半期・年）は右上のドロップダウンで切り替える。日付は横にスクロール・ドラッグ・「‹ ›」でずらす（端に近づくと、先の日付が足される）
 */
export function TimelineView({ database, pages, view, members, compact, fit }: ViewProps) {
  const { start: startId, end: endId } = timelineProps(database, view);
  const stageProp = database.props.find((x) => x.id === view.options.stage && x.type === "stage");
  const rows = pages
    .map((p) => {
      // 工程の期間を出すときは、工程の設定の開始日〜終了日を帯にして、工程の割合で分ける
      if (stageProp) {
        const dated = stageDates(stageProp, p);
        const ps = stageProp.start ? p.values[stageProp.start] : undefined;
        const pe = stageProp.end ? p.values[stageProp.end] : undefined;
        if (dated.length && isDate(ps) && isDate(pe)) {
          const s0 = ps <= pe ? ps : pe;
          const e0 = ps <= pe ? pe : ps;
          const cur = stageOf(stageProp, p);
          const shares = withPct(cur.list);
          const segs = dated.map((st, i) => ({ ...st, from: i ? dated[i - 1].date : s0, share: shares[i]?.share ?? 0, current: i === cur.index }));
          // ビューの開始・終わりの日付が工程の期間より広ければ、その分は白い帯で後ろにはみ出させる
          const vs = startId ? p.values[startId] : undefined;
          const ve = endId ? p.values[endId] : undefined;
          const outer = [s0, e0, ...[vs, ve].filter(isDate)].sort();
          const out = { start: outer[0], due: outer.at(-1)! };
          return { p, start: s0, due: e0, stages: [], segs, out, pct: cur.pct, stageName: cur.current?.name };
        }
      }
      const s = startId ? p.values[startId] : undefined;
      const e = endId ? p.values[endId] : undefined;
      const start = isDate(s) ? s : isDate(e) ? e : null;
      const due = isDate(e) ? e : start;
      if (!start || !due) return null;
      const s0 = start <= due ? start : due;
      const e0 = start <= due ? due : start;
      const stages =
        !stageProp && view.options.stages && database.kind === "request"
          ? stagesOf(database, p)
              .filter((x) => x.kind === "stage")
              .map((x) => ({ name: x.name, date: x.date, pct: 0, done: false }))
          : [];
      // 今の工程と％（帯に出す）
      const cur = stageProp ? stageOf(stageProp, p) : null;
      return { p, start: s0, due: e0, stages, segs: null, out: null, pct: cur ? cur.pct : null, stageName: cur?.current?.name };
    })
    .filter((r) => r !== null);

  // グループ分け：グループの見出しの行（たためる）と、その中の行
  const groupProp = groupPropOf(database, view);
  const collapsed = useCollapsed();
  type Row = (typeof rows)[number];
  type Entry = { kind: "head"; group: PageGroup } | { kind: "row"; row: Row; key: string };
  const entries: Entry[] = groupProp
    ? groupPages(groupProp, rows.map((r) => r.p), view, members).flatMap((g): Entry[] => [
        { kind: "head", group: g },
        ...(collapsed.isClosed(g.key) ? [] : g.pages.map((pg): Entry => ({ kind: "row", row: rows.find((r) => r.p.id === pg.id)!, key: `${g.key}:${pg.id}` }))),
      ])
    : rows.map((r): Entry => ({ kind: "row", row: r, key: r.p.id }));
  // 帯の左の表（名前と、出す項目の列）
  const tableCols = view.options.timelineTable ? visibleProps(database, view) : null;

  const now = today();
  // 幅：設定で決めたもの。右上のドロップダウンで選んだら、その場だけそれにする（設定を変えたら、設定のほうに戻る）
  const setting: Scale = view.options.timelineScale ?? "month";
  const [picked, setPicked] = useState<{ base: Scale; scale: Scale } | null>(null);
  const scale: Scale = picked?.base === setting ? picked.scale : setting;
  const px = TIMELINE_SCALES.find((s) => s.id === scale)!.px;

  // 出す期間：ページの日付と今日を入れ、両側に画面2枚分ほどの余白。スクロールで端に近づいたら、その分を足す（ext）
  const [ext, setExt] = useState({ scale, before: 0, after: 0 });
  const more = ext.scale === scale ? ext : { scale, before: 0, after: 0 };
  const pad = Math.ceil(1600 / px);
  const lo = [now, ...rows.map((r) => r.out?.start ?? r.start)].sort()[0];
  const hi = [now, ...rows.map((r) => r.out?.due ?? r.due)].sort().at(-1)!;
  const from = addDays(lo, -(pad + more.before));
  const to = addDays(hi, pad + more.after);
  const width = (daysBetween(from, to) + 1) * px;
  const left = (d: string) => daysBetween(from, d) * px;
  const x = (d: string) => `${left(d)}px`;
  /** その日の終わり（帯は終わりの日の終わりまで） */
  const right = (d: string) => left(addDays(d, 1));

  // スクロールの位置：はじめは今日を左から1/3に。幅を変えたら真ん中の日付を保つ。前に日付を足したら、その分ずらして見た目を保つ
  const box = useRef<HTMLDivElement>(null);
  const pending = useRef<{ date: string; at: number } | { shift: number } | null>({ date: now, at: 1 / 3 });
  useLayoutEffect(() => {
    const el = box.current;
    const p = pending.current;
    if (!el || !p) return;
    pending.current = null;
    if ("shift" in p) el.scrollLeft += p.shift;
    else el.scrollLeft = left(p.date) + px / 2 - el.clientWidth * p.at;
  });
  const pickScale = (s: Scale) => {
    const el = box.current;
    if (s === scale) return;
    pending.current = { date: el ? addDays(from, Math.floor((el.scrollLeft + el.clientWidth / 2) / px)) : now, at: 1 / 2 };
    setPicked({ base: setting, scale: s });
  };
  const onScroll = () => {
    const el = box.current;
    if (!el || pending.current) return;
    if (el.scrollLeft < 200) {
      pending.current = { shift: pad * px };
      setExt({ ...more, before: more.before + pad });
    } else if (el.scrollLeft + el.clientWidth > el.scrollWidth - 200) setExt({ ...more, after: more.after + pad });
  };
  const scaleMenu = usePopover();
  const goToday = () => {
    const el = box.current;
    // 今日をビューの真ん中に
    if (el) el.scrollTo({ left: left(now) + px / 2 - el.clientWidth / 2, behavior: "smooth" });
  };
  const turn = (n: number) => box.current?.scrollBy({ left: n * box.current.clientWidth * 0.8, behavior: "smooth" });

  // 何も無いところをマウスでドラッグすると、横にずらせる
  const pan = useRef<{ x: number; left: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || (e.target as HTMLElement).closest("a,button")) return;
    pan.current = { x: e.clientX, left: box.current?.scrollLeft ?? 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (pan.current && box.current) box.current.scrollLeft = pan.current.left - (e.clientX - pan.current.x);
  };
  const endPan = () => void (pan.current = null);

  // 目盛り：上の段は月（年の幅では年）、下の段は日（四半期は週の初め、年は月）
  const daily = scale === "week" || scale === "biweek" || scale === "month";
  const groups: { start: string; end: string; label: string }[] = [];
  const ticks: { date: string; label: string }[] = [];
  if (scale === "year") {
    for (let d = `${from.slice(0, 4)}-01-01`; d <= to; d = nextYear(d)) groups.push({ start: d, end: nextYear(d), label: `${Number(d.slice(0, 4))}年` });
    for (let d = firstOfMonth(from); d <= to; d = nextMonth(d)) ticks.push({ date: d, label: `${Number(d.slice(5, 7))}月` });
  } else {
    for (let d = firstOfMonth(from); d <= to; d = nextMonth(d)) groups.push({ start: d, end: nextMonth(d), label: `${Number(d.slice(0, 4))}年${Number(d.slice(5, 7))}月` });
    if (daily) for (let d = from; d <= to; d = addDays(d, 1)) ticks.push({ date: d, label: scale === "month" ? String(Number(d.slice(8))) : `${Number(d.slice(8))} ${WEEK[dow(d)]}` });
    else for (let d = addDays(from, (7 - dow(from)) % 7); d <= to; d = addDays(d, 7)) ticks.push({ date: d, label: `${Number(d.slice(5, 7))}/${Number(d.slice(8))}` });
  }
  const weekend = (d: string) => dow(d) === 0 || dow(d) === 6;
  // 縦の線：週・2週は毎日、月は週の初め、四半期は週、年は月
  const lines = scale === "month" ? ticks.filter((t) => dow(t.date) === 0) : ticks;

  if (!startId && !endId) return <Empty>タイムラインには日付の項目が必要です。列の「＋」から日付の項目を足してください。</Empty>;
  if (!rows.length) return <Empty>日付が入っているページがありません</Empty>;

  return (
    // fit（オールビューで高さを決めたとき）は、件数が少なくても枠をその高さまで伸ばす。目盛りと今日の線も下まで
    <div className={`rounded-[14px] border border-line bg-card py-2 ${fit ? "flex min-h-0 grow flex-col" : ""}`}>
      {/* ‹ 今日 › と、幅の切り替え */}
      <div className="mb-1 flex shrink-0 flex-wrap items-center gap-1 px-3">
        <button className="btn-sub h-8 min-h-0 w-8 px-0" aria-label="前へ" onClick={() => turn(-1)}>
          <Icon name="l" size={18} />
        </button>
        <button className="btn-sub h-8 min-h-0 px-3 text-sm" onClick={goToday}>
          今日
        </button>
        <button className="btn-sub h-8 min-h-0 w-8 px-0" aria-label="次へ" onClick={() => turn(1)}>
          <Icon name="r" size={18} />
        </button>
        {/* 幅のドロップダウン（Notion と同じ） */}
        <button className="btn-sub ml-auto h-8 min-h-0 gap-1 px-3 text-sm" aria-haspopup="menu" aria-expanded={!!scaleMenu.anchor} aria-label="タイムラインの幅" onClick={scaleMenu.toggle}>
          {TIMELINE_SCALES.find((s) => s.id === scale)!.label}
          <Icon name="dn" size={14} />
        </button>
        <Popover anchor={scaleMenu.anchor} onClose={scaleMenu.close} width={160} align="end" label="タイムラインの幅">
          {TIMELINE_SCALES.map((s) => (
            <MenuItem
              key={s.id}
              active={scale === s.id}
              right={scale === s.id ? <Icon name="ok" size={14} /> : undefined}
              onClick={() => {
                scaleMenu.close();
                pickScale(s.id);
              }}
            >
              {s.label}
            </MenuItem>
          ))}
        </Popover>
      </div>
      <div className={`flex ${fit ? "min-h-0 grow" : ""}`}>
      {/* 帯の左の表：見出しの高さと行の高さを、右の目盛り・帯とそろえる */}
      {tableCols && (
        // 狭い画面では、表は横幅の45%までにして、表だけ横にスクロールする
        <div className="max-w-[45%] shrink-0 overflow-x-auto border-r border-line text-sm" data-name="タイムラインの表">
          <div style={{ width: 180 + tableCols.length * 120 }}>
          <div className="flex h-12 items-end border-b border-line/70 text-xs text-muted">
            <span className="w-[180px] shrink-0 truncate px-2 pb-1">名前</span>
            {tableCols.map((c) => (
              <span key={c.id} className="w-[120px] shrink-0 truncate px-2 pb-1">
                {c.name}
              </span>
            ))}
          </div>
          <div className="py-1">
            {entries.map((en) =>
              en.kind === "head" ? (
                <div key={`h:${en.group.key}`} className="flex h-9 items-center bg-bg/40 px-1">
                  <GroupHead group={en.group} sum={groupSumText(database, view, en.group.pages)} collapsed={collapsed.isClosed(en.group.key)} onToggle={() => collapsed.toggle(en.group.key)} />
                </div>
              ) : (
                <div key={en.key} className="flex h-11 items-center border-b border-line/40">
                  <PeekLink database={database} pageId={en.row.p.id} className="w-[180px] shrink-0 truncate px-2 hover:underline">
                    <PageName database={database} page={en.row.p} className="font-bold" />
                  </PeekLink>
                  {tableCols.map((c) => (
                    <span key={c.id} className="flex w-[120px] shrink-0 items-center overflow-hidden px-2 whitespace-nowrap">
                      <PropValue prop={c} value={valueOf(en.row.p, c.id)} members={members} page={en.row.p} />
                    </span>
                  ))}
                </div>
              ),
            )}
          </div>
          </div>
        </div>
      )}
      <div
        ref={box}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        className={`min-w-0 flex-1 overflow-x-auto overscroll-x-contain select-none ${fit ? "flex min-h-0 flex-col" : ""}`}
        data-name="タイムライン（横にスクロール）"
      >
        <div className={`relative ${fit ? "flex grow flex-col" : ""}`} style={{ width }}>
          {/* 目盛りの上の段（月・年）。名前は左の端に残る */}
          <div className="relative h-6 text-xs font-bold">
            {groups.map((g) => {
              const l = Math.max(0, left(g.start));
              return (
                <span key={g.start} className="absolute inset-y-0 border-l border-line/70" style={{ left: l, width: Math.min(width, left(g.end)) - l }}>
                  <span className="sticky left-0 inline-block px-1.5 py-0.5 whitespace-nowrap">{g.label}</span>
                </span>
              );
            })}
          </div>
          {/* 目盛りの下の段（日・週・月） */}
          <div className="relative h-6 border-b border-line/70 text-xs text-muted">
            {ticks.map((t) => (
              <span
                key={t.date}
                className={`absolute top-1 whitespace-nowrap ${daily ? "overflow-hidden text-center" : "pl-0.5"} ${t.date === now ? "font-bold text-accent" : daily && weekend(t.date) ? "text-warn/80" : ""}`}
                style={daily ? { left: x(t.date), width: px } : { left: x(t.date) }}
              >
                {t.label}
              </span>
            ))}
          </div>
          <div className={`relative py-1 ${fit ? "grow" : ""}`} style={{ minHeight: compact ? 80 : 120 }}>
            {/* 土日と目盛りの線（帯の後ろ） */}
            <div className="pointer-events-none absolute inset-0">
              {daily && ticks.filter((t) => weekend(t.date)).map((t) => <span key={`we${t.date}`} className="absolute inset-y-0 bg-tint/60" style={{ left: x(t.date), width: px }} />)}
              {lines.map((t) => (
                <span key={t.date} className="absolute inset-y-0 w-px bg-line/50" style={{ left: x(t.date) }} />
              ))}
            </div>
          {entries.map((en) => {
            // グループの見出しの行（左に表を出していれば、見出しは表のほう。ここは同じ高さの帯）
            if (en.kind === "head")
              return tableCols ? (
                <div key={`h:${en.group.key}`} className="h-9 bg-bg/40" />
              ) : (
                <div key={`h:${en.group.key}`} className="relative h-9 bg-bg/40">
                  <div className="sticky left-0 flex h-9 w-72 items-center px-1">
                    <GroupHead group={en.group} sum={groupSumText(database, view, en.group.pages)} collapsed={collapsed.isClosed(en.group.key)} onToggle={() => collapsed.toggle(en.group.key)} />
                  </div>
                </div>
              );
            const { p, start, due, stages, segs, out, pct, stageName } = en.row;
            // 色分けの色（帯をうすく塗り、縁をその色に）
            const hue = colorHueOf(database, view, p);
            // 帯の端（白い帯があれば、それも入れた端）
            const barStart = left(out?.start ?? start);
            const barEnd = right(out?.due ?? due);
            const tip = `${start.replaceAll("-", "/")} 〜 ${due.replaceAll("-", "/")}${pct !== null ? `（${stageName ? `${stageName}・` : ""}${pct}%）` : ""}`;
            return (
              <div key={en.key} className="relative h-11">
                {segs ? (
                  <>
                    {/* ビューの開始〜終わりの白い帯（工程の期間からはみ出た分だけ見える） */}
                    {out && (out.start < start || out.due > due) && (
                      <PeekLink
                        database={database}
                        pageId={p.id}
                        aria-hidden
                        tabIndex={-1}
                        className="absolute top-2 bottom-2 rounded-[6px] border border-line bg-card shadow-sm hover:border-accent"
                        style={{ left: x(out.start), width: right(out.due) - left(out.start) }}
                        title={`${out.start.replaceAll("-", "/")} 〜 ${out.due.replaceAll("-", "/")}`}
                      />
                    )}
                    {/* 工程の期間：工程ごとに分けた帯（終わった工程は濃く、今の工程は枠で囲む） */}
                    <PeekLink
                      database={database}
                        pageId={p.id}
                      className="absolute top-2 bottom-2 flex overflow-hidden rounded-[6px] border border-line bg-card text-xs shadow-sm hover:border-accent"
                      style={{ left: x(start), width: right(due) - left(start) }}
                      title={tip}
                    >
                      {segs.map((st, i) => {
                        // 工程の帯：前の工程の期限から、この工程の期限まで（最後の工程は終わりの日の終わりまで）
                        const w = (i === segs.length - 1 ? right(due) : left(st.date)) - left(st.from);
                        if (w <= 0) return null;
                        return (
                          <span
                            key={i}
                            className={`flex shrink-0 items-center justify-center truncate px-1 ${hue ? "" : st.done ? (i % 2 ? "bg-accent/35" : "bg-accent/50") : i % 2 ? "bg-accent/10" : "bg-accent/20"} ${st.current ? "font-bold ring-1 ring-accent ring-inset" : ""}`}
                            // 色分けしていれば、工程の帯もその色で（終わった工程は濃く）
                            style={{ width: w, ...(hue ? { background: tintOf(hue, st.done ? (i % 2 ? 38 : 52) : i % 2 ? 12 : 22) } : {}) }}
                            title={`${st.name}（${st.share}%）：${st.from.replaceAll("-", "/")} 〜 ${st.date.replaceAll("-", "/")}`}
                          >
                            {st.name}
                          </span>
                        );
                      })}
                    </PeekLink>
                  </>
                ) : (
                  <>
                    {/* 帯。押すとページを開く。今の工程までを薄く塗る */}
                    <PeekLink
                      database={database}
                        pageId={p.id}
                      className="absolute top-2 bottom-2 overflow-hidden rounded-[6px] border border-line bg-card shadow-sm hover:border-accent"
                      style={{ left: x(start), width: right(due) - left(start), ...(hue ? { background: tintOf(hue, 28), borderColor: hue } : {}) }}
                      title={tip}
                    >
                      {pct !== null && <span className="absolute inset-y-0 left-0 bg-accent/15" style={{ width: `${pct}%` }} />}
                    </PeekLink>
                    {/* 工程の期限：帯の下の端に小さなひし形（名前はカーソルを合わせると出る） */}
                    {stages.map((st) => (
                      <span
                        key={st.name + st.date}
                        className={`absolute bottom-1 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border border-card ${st.done ? "bg-accent" : st.date < now ? "bg-warn" : "bg-muted"}`}
                        style={{ left: left(st.date) + px / 2 }}
                        title={`${st.name}${st.pct ? `（${st.pct}%）` : ""}：${st.date.replaceAll("-", "/")}`}
                      />
                    ))}
                  </>
                )}
                {/* 名前と今の工程・％：帯の左に付く。横にずらして帯の左が見えなくなったら、画面の左の端で帯の上にかぶさって付いてくる（帯の終わりまで）。
                    左の端から帯の終わりまでの入れ物の中で、帯の分の空きの左に置き、sticky で左の端に留める */}
                <div className="pointer-events-none absolute inset-y-0 left-0 z-[1] flex justify-end" style={{ width: barEnd }}>
                  <PeekLink
                    database={database}
                        pageId={p.id}
                    className="pointer-events-auto sticky left-0 my-auto ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] border border-line bg-card/85 px-2 text-sm whitespace-nowrap hover:underline"
                    title={tip}
                  >
                    <PageName database={database} page={p} className="font-bold" />
                    {pct !== null && (
                      <span className="text-muted">
                        {stageName ? `${stageName} ` : ""}
                        {pct}%
                      </span>
                    )}
                  </PeekLink>
                  <span className="shrink-0" style={{ width: barEnd - barStart }} />
                </div>
              </div>
            );
          })}
            {/* 今日の線（帯の前） */}
            <span className="pointer-events-none absolute inset-y-0 z-[2] w-px bg-warn" style={{ left: left(now) + px / 2 }} title="今日" />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
