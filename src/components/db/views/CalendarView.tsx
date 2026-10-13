"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { choose, confirmAction, promptText } from "@/components/ui/overlay";
import { addEvent, createPage, deleteEvent, nameSuffixOf, newPageDefaults } from "@/lib/local/requests";
import { P } from "@/lib/requests/defaults";
import { addDays, isDate, stagesOf, today, valueOf } from "@/lib/requests/logic";
import { stageDates, stageOf } from "@/lib/requests/stages";
import { PopupDialog } from "@/components/ui/Dialog";
import type { ViewProps } from "./common";
import { colorHueOf, tintOf } from "./groups";
import { PageLink as PeekLink, usePeek } from "../PageLink";

const WEEK = "日月火水木金土";

type Item = { key: string; text: string; pageId?: string; eventId?: string; tone: "auto" | "manual" | "done" };

/** サイズ（小・中・大）ごとの、1日のマスに出す件数 */
const PER_DAY = { s: 1, m: 2, l: 4 } as const;
/** サイズごとのマスの高さ（月・週、px）。出す件数と「▼ +N件」が入る高さ */
const CELL_PX = {
  month: { s: 64, m: 88, l: 136 },
  week: { s: 96, m: 160, l: 240 },
} as const;
/** マスの中の大きさ（px）：上下の余白と日付の行、予定1件（間を含む）、「▼ +N件」 */
const CELL_HEAD = 28;
const ITEM_H = 18;
const MORE_H = 16;

/** 期間（日・週・月・年）と、切り替えボタンの文字 */
type Range = "day" | "week" | "month" | "year";
const RANGES: { id: Range; label: string }[] = [
  { id: "day", label: "日" },
  { id: "week", label: "週" },
  { id: "month", label: "月" },
  { id: "year", label: "年" },
];
/** 年のカレンダー：月と月のあいだ（px）と、月の名前の行の高さ（px） */
const YEAR_GAP = 12;
const YEAR_TITLE = 18;
/** 1日のカレンダー（px）：予定1件（間を含む）、下の「この日に追加」、「▼ +N件」、上下の余白 */
const DAY_ROW = 24;
const DAY_FOOT = 48;
const DAY_MORE = 20;
const DAY_PAD = 18;

const pad = (n: number) => String(n).padStart(2, "0");

/** その日の曜日（0 が日曜） */
const dayOfWeek = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
/** 「10/7」の形 */
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8))}`;

/**
 * 工程の期限は自動で入る。日付にカーソルを合わせると＋が出て、
 * 「予定を追加」か「依頼工程を追加」を選べる。
 * 期間はデイリー（1日の予定を大きく並べる）、ウィークリー（1週間。日曜から土曜を大きく並べる）、マンスリー（1か月）、
 * イヤリー（12か月を小さく並べる）。ビューの設定で選ぶ。
 * 設定で「切り替えボタン」をオンにすると、右上の「日・週・月・年」で、その場で切り替えられる（編集モードでなくても）
 */
export function CalendarView({ database, pages, view, events, compact, fit, userId }: ViewProps) {
  const peek = usePeek();
  // 出す日付の項目。依頼以外で設定が無ければ、1つ目の日付の項目
  const dateId = view.options.date ?? (database.kind === "request" ? undefined : database.props.find((p) => p.type === "date")?.id);
  const now = today();
  const [month, setMonth] = useState(now.slice(0, 7));
  const [y, m] = month.split("-").map(Number);
  // 週の始まり（日曜・月曜）と、土日を隠すか。order は並べる曜日の順（0 が日曜）
  const ws = view.options.weekStart ?? 0;
  const hideWe = !!view.options.hideWeekends;
  const order = Array.from({ length: 7 }, (_, i) => (ws + i) % 7).filter((d) => !hideWe || (d !== 0 && d !== 6));
  const colsStyle = { gridTemplateColumns: `repeat(${order.length}, minmax(0, 1fr))` };
  /** 週の中の位置（週の始まりが 0） */
  const posInWeek = (d: number) => (d - ws + 7) % 7;
  /** 月の日付のマス：週ごとに、並べる曜日の順で。月の外のマスは null */
  const monthCells = (ym: string) => {
    const [yy, mo] = ym.split("-").map(Number);
    const lead = posInWeek(new Date(Date.UTC(yy, mo - 1, 1)).getUTCDay());
    const n = new Date(Date.UTC(yy, mo, 0)).getUTCDate();
    const weeks = Math.ceil((lead + n) / 7);
    const cells: (string | null)[] = [];
    for (let w = 0; w < weeks; w++)
      for (const d of order) {
        const i = w * 7 + posInWeek(d) - lead + 1;
        cells.push(i >= 1 && i <= n ? `${ym}-${pad(i)}` : null);
      }
    return { cells, weeks };
  };
  // 色分け：ページの予定は、選んだ項目の選択肢の色でうすく塗る
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const move = (n: number) => setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  // 期間：設定で決めたもの。切り替えボタンで選んだら、その場だけそれにする（設定の期間を変えたら、設定のほうに戻る）
  const setting: Range = view.options.calendarRange ?? "month";
  const switchable = !!view.options.calendarSwitch;
  const [picked, setPicked] = useState<{ base: Range; range: Range } | null>(null);
  const range: Range = switchable && picked?.base === setting ? picked.range : setting;
  const pick = (r: Range) => setPicked({ base: setting, range: r });
  const yearly = range === "year";
  // デイリー：今日から始める
  const daily = range === "day";
  const [day, setDay] = useState(now);
  // ウィークリー：今週の始まり（日曜か月曜）から始める。土日を隠すときは、平日だけ並べる
  const weekly = range === "week";
  const thisWeek = addDays(now, -posInWeek(dayOfWeek(now)));
  const [weekPicked, setWeekStart] = useState(thisWeek);
  // 週の始まりの設定を変えたときも、その週の始まりにそろえる
  const weekStart = addDays(weekPicked, -posInWeek(dayOfWeek(weekPicked)));
  const weekAll = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekDays = weekAll.filter((d) => order.includes(dayOfWeek(d)));
  // サイズを決めていれば、1日に出す件数をそこまでにする（日付のマスは減らさない）。入りきらない日は「▼」でその日をポップアップ。
  // ウィンドウ（fit）では、高さは区画で決まるので、サイズは使わない
  const size = fit ? undefined : view.options.size;
  const perDay = size ? PER_DAY[size] : undefined;
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  // マスの高さ：サイズで決まる。決めていなければ中身に合わせる（ウィンドウでは、測るまでの仮の高さ）
  const natural = size ? CELL_PX[weekly ? "week" : "month"][size] : weekly ? (compact ? 160 : 256) : compact ? 64 : 96;
  const rows = weekly ? 1 : monthCells(month).weeks;
  // ウィンドウ（fit）では、マスの高さは区画の高さで決まる。今のマスの高さを測って、入る件数を決める
  const grid = useRef<HTMLDivElement>(null);
  const [rowH, setRowH] = useState<number | null>(null);
  useEffect(() => {
    const el = grid.current;
    if (!fit || !el) return;
    const ro = new ResizeObserver(() => {
      const c = el.firstElementChild;
      if (c) setRowH(Math.round(c.getBoundingClientRect().height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, range]);
  // 1日のカレンダーは、ウィンドウ（fit）では、場所の高さを測って、入る件数を決める
  const dayBox = useRef<HTMLDivElement>(null);
  const [dayH, setDayH] = useState<number | null>(null);
  useEffect(() => {
    const el = dayBox.current;
    if (!fit || !daily || !el) return;
    const ro = new ResizeObserver(() => setDayH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, daily]);
  // 年のカレンダーは、ウィンドウ（fit）では、場所の大きさを測って、12か月がいちばん大きく入る並べ方（何列か）を選ぶ
  const yearBox = useRef<HTMLDivElement>(null);
  const [yearSize, setYearSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = yearBox.current;
    if (!fit || !yearly || !el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setYearSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, yearly]);
  let yearCols = 4;
  if (fit && yearSize) {
    let best = 0;
    for (const c of [1, 2, 3, 4, 6, 12]) {
      const r = 12 / c;
      // 1日のマスの大きさ：横は列の幅を7つに、縦は月の高さ（名前の行を除く）を7つ（曜日と6週）に分けた、小さいほう
      const cell = Math.min((yearSize.w - YEAR_GAP * (c - 1)) / c / 7, ((yearSize.h - YEAR_GAP * (r - 1)) / r - YEAR_TITLE) / 7);
      if (cell > best) {
        best = cell;
        yearCols = c;
      }
    }
  }

  const items = new Map<string, Item[]>();
  const push = (date: string, item: Item) => items.set(date, [...(items.get(date) ?? []), item]);
  for (const p of pages) {
    const suffix = nameSuffixOf(database);
    // 「出す日付」で工程の項目を選んだら、工程ごとの期限を出す
    const stageProp = database.props.find((x) => x.type === "stage" && x.id === dateId);
    // 終わった工程（今の工程より前）だけ斜線にする。今の工程は進めている途中なので、ふつうに出す
    if (stageProp) {
      const current = stageOf(stageProp, p).index;
      stageDates(stageProp, p).forEach((s, i) => {
        push(s.date, { key: `${p.id}:${s.name}`, text: `${s.name}：${p.title}${suffix}`, pageId: p.id, tone: i < current ? "done" : "auto" });
      });
    }
    const dp = database.props.find((x) => x.id === dateId && x.type !== "stage");
    const dv = dp ? valueOf(p, dp.id) : undefined;
    if (dp && isDate(dv)) push(dv, { key: `${p.id}:${dp.id}`, text: `${dp.name}：${p.title}${suffix}`, pageId: p.id, tone: "auto" });
  }
  for (const e of events) push(e.date, { key: e.id, text: e.text, eventId: e.id, tone: "manual" });

  const add = async (date: string) => {
    const label = `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
    // 「出す日付」が工程のときは、日付からページは作らない（予定だけ）
    const dp = database.props.find((x) => x.id === dateId && x.type === "date");
    if (database.kind !== "request") {
      const k = await choose(label, [
        ...(dp ? [{ label: "ページを追加", detail: `「${dp.name}」がこの日のページを作る` }] : []),
        { label: "予定を追加", detail: "カレンダーだけに書くメモ" },
      ]);
      if (k === null) return;
      if (dp && k === 0) {
        const title = await promptText(`${label}にページを追加`, "", "名前");
        if (!title) return;
        const page = await createPage(database, userId, title, { ...newPageDefaults(database, userId), [dp.id]: date });
        peek(database, page.id);
        return;
      }
      const text = await promptText(`${label}に予定を追加`, "", "内容");
      if (text) await addEvent(database.roomId, date, text);
      return;
    }
    const kind = pages.length ? await choose(label, [{ label: "予定を追加" }, { label: "依頼工程を追加" }]) : 0;
    if (kind === null) return;
    if (kind === 0) {
      const text = await promptText(`${label}に予定を追加`, "", "内容");
      if (text) await addEvent(database.roomId, date, text);
      return;
    }
    const pi = await choose(
      `${label}：どの依頼の工程ですか`,
      pages.map((p) => ({ label: `${p.title}${nameSuffixOf(database)}`, detail: isDate(p.values[P.due]) ? `納期 ${String(p.values[P.due]).replaceAll("-", "/")}` : undefined })),
    );
    if (pi === null) return;
    const page = pages[pi];
    const stageNames = [
      ...new Set(
        stagesOf(database, page)
          .filter((s) => s.kind === "stage")
          .map((s) => s.name),
      ),
    ];
    const names = stageNames.length ? stageNames : ["ラフ", "下書き", "線画", "着色", "納品"];
    const si = await choose(
      `${page.title}${nameSuffixOf(database)}：どの工程ですか`,
      names.map((n) => ({ label: n })),
    );
    if (si === null) return;
    await addEvent(database.roomId, date, `${names[si]}：${page.title}${nameSuffixOf(database)}`, page.id);
  };

  /** 1日のマス。label は左上に出す日付 */
  const cell = (d: string, label: string) => {
    const list = items.get(d) ?? [];
    // 出す件数：サイズの件数まで。ウィンドウでは、マスに入る件数まで（入りきらない分は「▼ +N件」）
    let shown = perDay !== undefined && list.length > perDay ? list.slice(0, perDay) : list;
    if (fit) {
      const room = rowH ?? natural;
      const cap = perDay ?? Infinity;
      const fitAll = Math.max(0, Math.floor((room - CELL_HEAD) / ITEM_H));
      const fitWithMore = Math.max(0, Math.floor((room - CELL_HEAD - MORE_H) / ITEM_H));
      shown = list.length > Math.min(cap, fitAll) ? list.slice(0, Math.min(cap, fitWithMore)) : list;
    }
    const height = fit ? "min-h-0 overflow-hidden" : size ? "" : weekly ? (compact ? "min-h-40" : "min-h-64") : compact ? "min-h-16" : "min-h-24";
    return (
      <div
        key={d}
        className={`group relative bg-card p-1 ${height} ${d === now ? "outline-2 -outline-offset-2 outline-accent" : ""}`}
        // サイズを決めたときは、そのサイズの高さ（ウィンドウでは、それを上限に縮む）
        style={size && !fit ? { height: natural } : undefined}
      >
        <div className="flex items-center justify-between">
          {/* 日付と、その日の件数（予定があるときだけ） */}
          <span className="flex min-w-0 items-center gap-1">
            {switchable ? (
              <button
                className={`rounded px-0.5 hover:bg-tint ${d === now ? "font-bold text-accent" : ""}`}
                title={`${Number(d.slice(5, 7))}月${Number(d.slice(8))}日を1日で開く`}
                onClick={() => {
                  setDay(d);
                  pick("day");
                }}
              >
                {label}
              </button>
            ) : (
              <span className={d === now ? "font-bold text-accent" : ""}>{label}</span>
            )}
            {list.length > 0 && (
              <span className="shrink-0 rounded-full bg-tint px-1.5 text-[10px] leading-4 text-muted" title={`${list.length}件の予定`}>
                {list.length}件
              </span>
            )}
          </span>
          <button
            aria-label={`${Number(d.slice(5, 7))}月${Number(d.slice(8))}日に追加`}
            onClick={() => add(d)}
            className="grid h-5 w-5 place-items-center rounded-full bg-accent text-accent-ink opacity-0 group-hover:opacity-100 focus:opacity-100 max-md:opacity-40"
          >
            <Icon name="add" size={14} />
          </button>
        </div>
        <div className="mt-0.5 space-y-0.5">
          {shown.map(item)}
          {list.length > shown.length && (
            <button
              onClick={() => setDayOpen(d)}
              className="mx-auto flex w-fit items-center gap-0.5 rounded px-1 text-[10px] text-muted hover:bg-tint hover:text-ink"
              title="この日の予定を全部見る"
            >
              <Icon name="rt" size={12} className="rotate-90" />+{list.length - shown.length}件
            </button>
          )}
        </div>
      </div>
    );
  };

  /** 年のカレンダーの1か月：小さな日付のマス。予定のある日は色を付けて、押すとその日の予定をポップアップで出す */
  const miniMonth = (mm: number) => {
    const key = `${y}-${pad(mm)}`;
    const n = new Date(Date.UTC(y, mm, 0)).getUTCDate();
    let total = 0;
    for (let i = 1; i <= n; i++) total += items.get(`${key}-${pad(i)}`)?.length ?? 0;
    const title = (
      <>
        {mm}月{total > 0 && <span className="rounded-full bg-tint px-1.5 text-[10px] leading-4 font-normal text-muted">{total}件</span>}
      </>
    );
    return (
      <div key={key} className={`flex min-w-0 flex-col ${fit ? "min-h-0 overflow-hidden" : ""}`}>
        {/* 月の名前。切り替えボタンがあるときは、押すとその月をマンスリーで開く */}
        {switchable ? (
          <button
            className="flex shrink-0 items-center gap-1 self-start rounded px-0.5 text-xs font-bold hover:bg-tint"
            style={{ height: YEAR_TITLE }}
            title={`${mm}月を開く`}
            onClick={() => {
              setMonth(key);
              pick("month");
            }}
          >
            {title}
          </button>
        ) : (
          <span className="flex shrink-0 items-center gap-1 px-0.5 text-xs font-bold" style={{ height: YEAR_TITLE }}>
            {title}
          </span>
        )}
        <div
          className={`grid gap-px text-center text-[10px] ${fit ? "min-h-0 grow" : "auto-rows-[22px]"}`}
          style={{ ...colsStyle, ...(fit ? { gridTemplateRows: "repeat(7, minmax(0, 1fr))" } : {}) }}
        >
          {order.map((d) => (
            <span key={d} className={`grid place-items-center ${d === 0 ? "text-warn" : "text-muted"}`}>
              {WEEK[d]}
            </span>
          ))}
          {monthCells(key).cells.map((day, i) => {
            if (!day) return <span key={`e${i}`} />;
            const c = items.get(day)?.length ?? 0;
            const tone = c >= 3 ? "bg-accent/45" : c === 2 ? "bg-accent/30" : c === 1 ? "bg-accent/15" : "";
            return (
              <button
                key={day}
                onClick={() => setDayOpen(day)}
                title={`${mm}月${Number(day.slice(8))}日${c ? `：${c}件の予定` : ""}`}
                className={`grid min-h-0 place-items-center overflow-hidden rounded-[4px] leading-none ${tone} ${c ? "font-bold text-ink" : "text-muted hover:bg-tint"} ${
                  day === now ? "outline-2 -outline-offset-2 outline-accent font-bold text-accent" : ""
                }`}
              >
                {Number(day.slice(8))}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  /** 予定1件（依頼の工程・日付はページへ、自分で入れた予定は押すと削除） */
  function item(it: Item) {
    // 折り返す設定なら、…で切らずにマスの右端で折り返す
    const fold = view.options.calendarWrap ? "break-words whitespace-normal" : "truncate";
    const page = it.pageId ? pageById.get(it.pageId) : undefined;
    const hue = page && it.tone !== "done" ? colorHueOf(database, view, page) : undefined;
    return it.pageId ? (
      <PeekLink
        key={it.key}
        database={database}
        pageId={it.pageId}
        title={it.text}
        className={`block rounded px-1 ${fold} ${it.tone === "done" ? "w-fit max-w-full text-muted line-through" : "bg-tint"}`}
        style={hue ? { background: tintOf(hue, 22), boxShadow: `inset 3px 0 0 ${hue}` } : undefined}
      >
        {it.text}
      </PeekLink>
    ) : (
      <button
        key={it.key}
        title={`${it.text}（クリックで削除）`}
        onClick={async () => it.eventId && (await confirmAction(`「${it.text}」を削除します`, "削除")) && deleteEvent(it.eventId)}
        className={`block w-full rounded border border-dashed border-accent px-1 text-left ${fold}`}
      >
        {it.text}
      </button>
    );
  }

  const weekEnd = weekAll[6];
  const unit = daily ? "日" : weekly ? "週" : yearly ? "年" : "月";
  const step = (n: number) => (daily ? setDay(addDays(day, n)) : weekly ? setWeekStart(addDays(weekStart, 7 * n)) : move(yearly ? 12 * n : n));
  // 今の日・週・月・年を出していないときは、そこへ戻るボタンを出す
  const away = daily ? day !== now : weekly ? weekStart !== thisWeek : yearly ? y !== Number(now.slice(0, 4)) : month !== now.slice(0, 7);
  // 1日のカレンダー：その日の予定。ウィンドウでは入る分だけ出して、残りは「▼ +N件」から
  const dayList = items.get(day) ?? [];
  let dayShown = dayList;
  if (fit && dayH !== null) {
    const fitAll = Math.max(0, Math.floor((dayH - DAY_PAD - DAY_FOOT) / DAY_ROW));
    const fitWithMore = Math.max(0, Math.floor((dayH - DAY_PAD - DAY_FOOT - DAY_MORE) / DAY_ROW));
    if (dayList.length > fitAll) dayShown = dayList.slice(0, fitWithMore);
  }
  const heading = daily
    ? `${Number(day.slice(0, 4))}年${Number(day.slice(5, 7))}月${Number(day.slice(8))}日（${WEEK[dayOfWeek(day)]}）`
    : weekly
      ? `${weekStart.slice(0, 4)}年${md(weekStart)}〜${md(weekEnd)}`
      : yearly
        ? `${y}年`
        : `${y}年${m}月`;
  return (
    <div className={`rounded-[14px] border border-line bg-card p-3 ${fit ? "flex min-h-0 grow flex-col" : ""}`}>
      <div className="mb-2 flex shrink-0 items-center gap-2" data-cal-head="">
        <button className="btn-sub h-8 min-h-0 w-8 px-0" aria-label={`前の${unit}`} onClick={() => step(-1)}>
          <Icon name="l" />
        </button>
        <b className={`min-w-24 text-center ${daily && day === now ? "text-accent" : ""}`}>{heading}</b>
        <button className="btn-sub h-8 min-h-0 w-8 px-0" aria-label={`次の${unit}`} onClick={() => step(1)}>
          <Icon name="r" />
        </button>
        {away && (
          <button className="ml-1 text-sm text-muted underline" onClick={() => (daily ? setDay(now) : weekly ? setWeekStart(thisWeek) : setMonth(now.slice(0, 7)))}>
            {daily ? "今日" : weekly ? "今週" : yearly ? "今年" : "今月"}
          </button>
        )}
        {/* 切り替えボタン（設定でオンにしたとき）：右上の「日・週・月・年」。その場だけ切り替わる */}
        {switchable && (
          <div className="ml-auto flex shrink-0 gap-0.5 rounded-[8px] border border-line p-0.5 text-xs" role="group" aria-label="期間の切り替え">
            {RANGES.map((r) => (
              <button
                key={r.id}
                aria-pressed={range === r.id}
                onClick={() => pick(r.id)}
                className={`rounded-[6px] px-2.5 py-0.5 ${range === r.id ? "bg-tint font-bold text-ink" : "text-muted hover:bg-tint/60 hover:text-ink"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {daily ? (
        // デイリー：1日の予定を大きく並べる。下から、この日に予定などを足せる
        <div ref={dayBox} className={`flex flex-col gap-1 rounded-[10px] border border-line p-2 text-sm ${fit ? "min-h-0 grow overflow-hidden" : "min-h-40"}`}>
          {dayList.length ? dayShown.map(item) : <p className="text-muted">予定はありません</p>}
          {dayList.length > dayShown.length && (
            <button
              onClick={() => setDayOpen(day)}
              className="flex w-fit items-center gap-0.5 rounded px-1 text-xs text-muted hover:bg-tint hover:text-ink"
              title="この日の予定を全部見る"
            >
              <Icon name="rt" size={12} className="rotate-90" />+{dayList.length - dayShown.length}件
            </button>
          )}
          <button className="btn-sub mt-auto shrink-0 self-start" onClick={() => add(day)}>
            <Icon name="add" size={16} />
            この日に追加
          </button>
        </div>
      ) : yearly ? (
        // イヤリー：12か月を小さく並べる。ウィンドウでは、場所にいちばん大きく入る列の数で、全部を収める
        <div
          ref={yearBox}
          className={`grid text-xs ${fit ? "min-h-0 grow" : "grid-cols-[repeat(auto-fill,minmax(168px,1fr))]"}`}
          style={
            fit ? { gap: YEAR_GAP, gridTemplateColumns: `repeat(${yearCols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${12 / yearCols}, minmax(0, 1fr))` } : { gap: YEAR_GAP }
          }
        >
          {Array.from({ length: 12 }, (_, i) => miniMonth(i + 1))}
        </div>
      ) : (
        <div className={`flex min-h-0 flex-col gap-px overflow-hidden rounded-[10px] border border-line bg-line text-xs ${fit ? "grow" : ""}`}>
          <div className="grid shrink-0 gap-px" style={colsStyle}>
            {order.map((d) => (
              <div key={d} className={`bg-card py-1 text-center ${d === 0 ? "text-warn" : "text-muted"}`}>
                {WEEK[d]}
              </div>
            ))}
          </div>
          {/* 日付のマスは、どの行も同じ高さ（auto-rows-fr：いちばん予定の多い行にそろう）。
            ウィンドウでは、区画の高さを全部の行で同じだけ分ける（日付は減らさない） */}
          <div
            ref={grid}
            className={`grid gap-px ${fit ? "min-h-0 grow" : "auto-rows-fr"}`}
            style={{ ...colsStyle, ...(fit ? { gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` } : {}) }}
          >
            {weekly ? (
              // ウィークリー：1週間を大きく（予定が多くても読めるように）
              weekDays.map((d) => cell(d, md(d)))
            ) : (
              // 月の外のマスも、ほかと同じ見た目の空きにする
              monthCells(month).cells.map((d, i) => (d ? cell(d, String(Number(d.slice(8)))) : <div key={`e${i}`} className="bg-card/60" />))
            )}
          </div>
        </div>
      )}
      {dayOpen && (
        <PopupDialog title={`${Number(dayOpen.slice(5, 7))}月${Number(dayOpen.slice(8))}日の予定`} onClose={() => setDayOpen(null)} width="max-w-md">
          <div className="space-y-1 text-sm">
            {(items.get(dayOpen) ?? []).map(item)}
            {!items.get(dayOpen)?.length && <p className="text-muted">予定はありません</p>}
          </div>
          {/* この日に予定などを足す（年のカレンダーには「＋」が無いので、ここから） */}
          <button
            className="btn-sub mt-3"
            onClick={() => {
              const day = dayOpen;
              setDayOpen(null);
              void add(day);
            }}
          >
            <Icon name="add" size={16} />
            この日に追加
          </button>
        </PopupDialog>
      )}
    </div>
  );
}
