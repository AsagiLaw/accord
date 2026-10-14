"use client";

import { useEffect, useRef, useState } from "react";
import { usePeek } from "@/components/db/PageLink";
import { TAG_COLORS } from "@/components/db/meta";
import { tintOf } from "@/components/db/views/groups";
import { SettingsButton, useNoteContext } from "@/components/embeds";
import { Icon } from "@/components/Icon";
import { PopupDialog } from "@/components/ui/Dialog";
import { confirmAction } from "@/components/ui/overlay";
import { MenuDivider } from "@/components/ui/Popover";
import { BackHead, EmptyNote, MenuTitle, NavRow, OptionRow, SectionHead, ToggleRow } from "@/components/ui/SettingsMenu";
import { newId, type CalEvent, type Database, type DbPage, type TagColor } from "@/lib/local/db";
import { deleteEvent, nameSuffixOf, saveCalEvent, useCalendarEvents, useDatabases, usePagesOf } from "@/lib/local/requests";
import { addDays, daysBetween, isDate, today, valueOf } from "@/lib/requests/logic";
import { stageDates, stageOf } from "@/lib/requests/stages";

// カレンダーのブロック：ふつうのカレンダーアプリのように予定を組める。データベースの日付（いくつでも）とルームの予定も一緒に出せる

/**
 * カレンダーブロックの props（ブロックの props と同じ）。calendarId：このカレンダーの予定の持ち主（はじめて出したときに作る）。
 * own："1" でこのカレンダーの予定を出す／room："1" でルームの予定を出す／dbs：出すデータベースの項目（{dbId, propId} の並びの JSON）。
 * range：はじめに出す期間（month・week・list）／weekStart："1" で月曜はじまり／wrap："1" で予定の名前を右端で折り返す
 */
export type CalendarProps = { calendarId: string; own: string; room: string; dbs: string; range: string; weekStart: string; wrap: string };

export type DbSource = { dbId: string; propId: string };
type Range = "month" | "week" | "list";
const RANGE_LABEL: Record<Range, string> = { month: "月", week: "週", list: "リスト" };

/** 1日のマスに出す1件。event はこのカレンダー・ルームの予定、page はデータベースのページ。first はその予定の始まりの日（か、出している期間・週の最初の日） */
export type CalItem = { key: string; text: string; time?: string; hue: string; first: boolean; done?: boolean; event?: CalEvent; page?: { database: Database; pageId: string } };
type Item = CalItem;

/** ドラッグ中の予定：move は日を動かす、start・end は始まり・終わりの日を変える。from はつかんだ日、to はマウスの下の日 */
type Drag = { id: string; mode: "move" | "start" | "end"; from: string; to: string };

/** ドラッグした先の予定（何日かにわたる予定の終わりの日は、始まりの日より前にならない） */
const dragged = (e: CalEvent, d: Drag): CalEvent => {
  const end = e.end && e.end > e.date ? e.end : e.date;
  if (d.mode === "move") {
    const n = daysBetween(d.from, d.to);
    return { ...e, date: addDays(e.date, n), end: end > e.date ? addDays(end, n) : undefined };
  }
  if (d.mode === "start") {
    const start = d.to < end ? d.to : end;
    return { ...e, date: start, end: end > start ? end : undefined };
  }
  const last = d.to > e.date ? d.to : e.date;
  return { ...e, end: last > e.date ? last : undefined };
};

const WEEK = "日月火水木金土";
const dayOfWeek = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
/** 「10/7」の形 */
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8))}`;
const monthOf = (ymd: string) => ymd.slice(0, 7);
const addMonths = (ymd: string, n: number) => {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
};

export const parseDbs = (s: string): DbSource[] => {
  try {
    const v: unknown = JSON.parse(s || "[]");
    return Array.isArray(v) ? v.filter((x): x is DbSource => !!x && typeof x.dbId === "string" && typeof x.propId === "string") : [];
  } catch {
    return [];
  }
};

/** 出せる項目：日付の項目と、工程の項目（工程ごとの期限） */
const datePropsOf = (d: Database) => d.props.filter((p) => p.type === "date" || p.type === "stage");

/** 予定の色（決めていなければ、このカレンダーの予定は青、ルームの予定は灰色） */
const hueOf = (e: CalEvent) => TAG_COLORS[e.color ?? (e.calendarId ? "blue" : "gray")].hue;
/** データベースの日付の色（決まった1色） */
const DB_HUE = "var(--accent)";

/**
 * from〜to の日付ごとの予定（このカレンダー・ルームの予定と、データベースの日付）。1日の中は、終日の予定・時刻の早い順。
 * 何日かにわたる予定は、その日すべてに入れる（first は始まりの日か、出している期間の最初の日、weekHead が true の日）
 */
export function collectItems({
  events,
  sources,
  databases,
  pages,
  from,
  to,
  weekHead,
}: {
  events: CalEvent[];
  sources: DbSource[];
  databases: Database[];
  pages: DbPage[];
  from: string;
  to: string;
  weekHead?: (ymd: string) => boolean;
}) {
  const items = new Map<string, Item[]>();
  const push = (date: string, item: Item) => {
    if (date >= from && date <= to) items.set(date, [...(items.get(date) ?? []), item]);
  };
  for (const e of events) {
    const end = e.end && e.end > e.date ? e.end : e.date;
    for (let d = e.date < from ? from : e.date; d <= end && d <= to; d = addDays(d, 1))
      push(d, { key: `${e.id}:${d}`, text: e.text, time: d === e.date ? e.time : undefined, hue: hueOf(e), first: d === e.date || d === from || !!weekHead?.(d), done: !!e.done, event: e });
  }
  for (const s of sources) {
    const database = databases.find((d) => d.id === s.dbId);
    const prop = database?.props.find((p) => p.id === s.propId);
    if (!database || !prop) continue;
    const suffix = nameSuffixOf(database);
    for (const p of pages.filter((x) => x.dbId === database.id)) {
      const name = `${p.title || "無題"}${suffix}`;
      if (prop.type === "stage") {
        // 工程の期限：工程ごとに出す（終わった工程は線で消す）
        const current = stageOf(prop, p).index;
        stageDates(prop, p).forEach((st, i) =>
          push(st.date, { key: `${p.id}:${prop.id}:${st.name}`, text: `${st.name}：${name}`, hue: DB_HUE, first: true, done: i < current, page: { database, pageId: p.id } }),
        );
        continue;
      }
      const v = valueOf(p, prop.id);
      if (isDate(v)) push(v, { key: `${p.id}:${prop.id}`, text: `${prop.name}：${name}`, hue: DB_HUE, first: true, page: { database, pageId: p.id } });
    }
  }
  for (const list of items.values()) list.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  return items;
}

export function CalendarBlockView({ props, onChange, fill }: { props: CalendarProps; onChange: (patch: Partial<CalendarProps>) => void; fill?: boolean }) {
  const ctx = useNoteContext();
  const peek = usePeek();
  const now = today();

  // このカレンダーの予定の持ち主を用意する（テンプレートの中では作らない。テンプレートで作ったページ・チャンネルごとにできる）
  const creating = useRef(false);
  useEffect(() => {
    if (props.calendarId || creating.current || ctx.template) return;
    creating.current = true;
    onChange({ calendarId: newId() });
  }, [props.calendarId, ctx.template, onChange]);

  const own = props.own !== "";
  const room = props.room === "1";
  const sources = parseDbs(props.dbs);
  const events = useCalendarEvents(ctx.roomId, own ? props.calendarId : "", room) ?? [];
  const databases = useDatabases(ctx.roomId) ?? [];
  const pages = usePagesOf(sources.map((s) => s.dbId)) ?? [];

  // 期間：設定で決めたもの。上の「月・週」で選んだら、その場だけそれにする（設定を変えたら、設定のほうに戻る）
  const setting: Range = props.range === "week" || props.range === "list" ? props.range : "month";
  const wrap = props.wrap === "1";
  const [picked, setPicked] = useState<{ base: Range; range: Range } | null>(null);
  const range: Range = picked?.base === setting ? picked.range : setting;
  const ws = props.weekStart === "1" ? 1 : 0;
  /** 週の中の位置（週の始まりが 0） */
  const posInWeek = (ymd: string) => (dayOfWeek(ymd) - ws + 7) % 7;
  // 出している期間の中の1日（月なら1日、週ならその週の始まり）
  const [cursor, setCursor] = useState(now);
  const weekStart = addDays(cursor, -posInWeek(cursor));
  const monthStart = `${monthOf(cursor)}-01`;
  const monthEnd = addDays(addMonths(monthStart, 1), -1);
  const gridStart = range === "week" ? weekStart : addDays(monthStart, -posInWeek(monthStart));
  const weeks = range === "week" ? 1 : Math.ceil((posInWeek(monthStart) + Number(monthEnd.slice(8))) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
  const move = (n: number) => setCursor(range === "week" ? addDays(weekStart, n * 7) : addMonths(monthStart, n));
  const title = range === "week" ? `${md(days[0])} 〜 ${md(days[6])}` : `${cursor.slice(0, 4)}年${Number(cursor.slice(5, 7))}月`;

  // 日付ごとの予定（リストはその月の1日〜末日。月・週は並べたマスの最初〜最後）
  const from = range === "list" ? monthStart : days[0];
  const to = range === "list" ? monthEnd : days[days.length - 1];
  // ドラッグ中の予定は、動かした先で出す（離したら保存する）
  const [drag, setDrag] = useState<Drag | null>(null);
  const shown = drag ? events.map((e) => (e.id === drag.id ? dragged(e, drag) : e)) : events;
  const items = collectItems({ events: shown, sources, databases, pages: pages as DbPage[], from, to, weekHead: (d) => posInWeek(d) === 0 });

  // 予定の画面（足す・直す）
  const canAdd = !ctx.template && ((own && !!props.calendarId) || room);
  const [editing, setEditing] = useState<{ event?: CalEvent; date: string } | null>(null);
  const openNew = (date: string) => canAdd && setEditing({ date });
  const openItem = (it: Item) => {
    if (it.page) return peek(it.page.database, it.page.pageId);
    if (it.event) setEditing({ event: it.event, date: it.event.date });
  };

  /** マウスの下の日（帯が上に重なっていても、その下の日のマス） */
  const dayAt = (x: number, y: number) => document.elementsFromPoint(x, y).find((el) => el instanceof HTMLElement && el.dataset.day)?.getAttribute("data-day") ?? null;

  /**
   * 予定のドラッグ：真ん中をつかむと日を動かす（日数はそのまま）、左右の端をつかむと始まり・終わりの日を変える。
   * 4px 動いたらドラッグ。動かさずに離したら、ふつうに押したことにする（直す画面を開く）。マウスの下の日のマスで日付を決める
   */
  const startDrag = (e: React.PointerEvent, ev: CalEvent, mode: Drag["mode"]) => {
    if (ctx.template || e.button !== 0) return;
    const day = dayAt(e.clientX, e.clientY);
    if (!day) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    let cur: Drag | null = null;
    const onMove = (pe: PointerEvent) => {
      if (!cur && Math.hypot(pe.clientX - sx, pe.clientY - sy) < 4) return;
      const to = dayAt(pe.clientX, pe.clientY);
      if (!to) return;
      cur = { id: ev.id, mode, from: day, to };
      setDrag(cur);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDrag(null);
      if (!cur) return;
      // ドラッグしたあとは、続けて出る click（直す画面を開く・その日に足す）を出さない
      const swallow = (ce: MouseEvent) => (ce.stopPropagation(), ce.preventDefault());
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      const next = dragged(ev, cur);
      if (next.date === ev.date && (next.end ?? "") === (ev.end ?? "")) return;
      const { date, end, text, time, endTime, color, memo, calendarId, done } = next;
      void saveCalEvent(ctx.roomId, ev.id, { date, end, text, time, endTime, color, memo, calendarId, done });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  /**
   * 1日のマスの中の並び：日をまたぐ予定を上に（始まりの早い順・長い順。となりの日と同じ高さに並びやすい）、そのあと時刻の早い順
   */
  const dayList = (d: string) =>
    [...(items.get(d) ?? [])].sort((a, b) => {
      const sa = a.event && a.event.end && a.event.end > a.event.date ? a.event : null;
      const sb = b.event && b.event.end && b.event.end > b.event.date ? b.event : null;
      if (sa && sb) return sa.date.localeCompare(sb.date) || (sb.end ?? "").localeCompare(sa.end ?? "");
      if (sa || sb) return sa ? -1 : 1;
      return (a.time ?? "").localeCompare(b.time ?? "");
    });

  /**
   * 1日のマスの中の予定1件。日をまたぐ予定は、続く側の角を丸めず、マスの端まで伸ばして、となりの日とつながって見せる
   * （名前は始まりの日と週の始まりだけ）。左右の端（予定の始まり・終わりの日）をつかむと、日を変えられる
   */
  const chip = (it: Item, d: string) => {
    const ev = it.event;
    const movable = !!ev && !ctx.template;
    const end = ev ? (ev.end && ev.end > ev.date ? ev.end : ev.date) : d;
    const fromLeft = !!ev && d > ev.date;
    const toRight = !!ev && d < end;
    return (
      <button
        key={it.key}
        type="button"
        onPointerDown={movable ? (e) => startDrag(e, ev, "move") : undefined}
        onClick={(e) => {
          e.stopPropagation();
          openItem(it);
        }}
        title={`${it.time ? `${it.time} ` : ""}${it.text}${ev && end > ev.date ? `（${md(ev.date)}〜${md(end)}）` : ""}${ev?.memo ? `\n${ev.memo}` : ""}`}
        className={`group/chip relative flex min-w-0 shrink-0 gap-1 px-1 py-px text-left text-[11px] leading-4 ${fromLeft ? "ml-0 rounded-l-none" : "ml-1 rounded-l-[5px]"} ${toRight ? "mr-0 rounded-r-none" : "mr-1 rounded-r-[5px]"} ${wrap ? "items-start" : "items-center"} ${it.done ? "text-muted line-through" : ""} ${movable ? "cursor-grab touch-none" : ""} ${drag?.id === ev?.id ? "ring-1 ring-accent" : ""}`}
        style={{ background: tintOf(it.hue, it.page ? 14 : 24), boxShadow: fromLeft ? undefined : `inset 2px 0 0 ${it.hue}` }}
        data-name="カレンダーの予定"
      >
        {it.time && <span className="shrink-0 text-muted">{it.time}</span>}
        {/* 続きの日は名前を隠す（週の始まりだけ「…」付きで出す）。折り返すときは、右端で次の行へ */}
        <span className={`${wrap ? "min-w-0 break-words whitespace-normal" : "truncate"} ${fromLeft && !it.first ? "invisible" : ""} ${fromLeft ? "opacity-70" : ""}`}>
          {fromLeft ? `… ${it.text}` : it.text}
        </span>
        {movable && d === ev.date && (
          <span
            aria-hidden
            onPointerDown={(e) => startDrag(e, ev, "start")}
            title="ドラッグで始まりの日を変える"
            className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l-[5px] group-hover/chip:bg-black/15"
          />
        )}
        {movable && d === end && (
          <span
            aria-hidden
            onPointerDown={(e) => startDrag(e, ev, "end")}
            title="ドラッグで終わりの日を変える"
            className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r-[5px] group-hover/chip:bg-black/15"
          />
        )}
      </button>
    );
  };

  // リスト：その月の予定を日付ごとに。何日かにわたる予定は、始まりの日（月の前から続くものは1日）に1件で出す
  const listDays = [...items.keys()]
    .sort()
    .map((d) => ({ date: d, list: (items.get(d) ?? []).filter((it) => !it.event || d === it.event.date || d === from) }))
    .filter((x) => x.list.length);
  /** 何日かにわたる予定の「10/20〜10/22」 */
  const span = (it: Item) => {
    const e = it.event;
    return e?.end && e.end > e.date ? `${md(e.date)}〜${md(e.end)}` : "";
  };
  /** リストの左に出す時刻（終日・何日か・データベースの名前） */
  const when = (it: Item) => {
    if (!it.event) return it.page?.database.name ?? "";
    if (span(it)) return span(it);
    return it.time ? `${it.time}${it.event.endTime ? `〜${it.event.endTime}` : ""}` : "終日";
  };

  /** その日の予定（ポップアップの一覧）。出している期間の外の日でも、その日の分を集める */
  const dayItems = (d: string) => (items.has(d) ? items.get(d) : collectItems({ events: shown, sources, databases, pages: pages as DbPage[], from: d, to: d }).get(d));

  const weekdayOrder = Array.from({ length: 7 }, (_, i) => (ws + i) % 7);
  // マスの高さ（ふつう）：週の表示は高く、月の表示は低め。予定が多ければ伸びる。ウィンドウ（fit）では区画の高さを分け、マスごとにスクロール
  const cellMin = range === "week" ? "min-h-56" : "min-h-24";
  // その日の予定のポップアップ（日付を押したとき）
  const [dayOpen, setDayOpen] = useState<string | null>(null);

  return (
    <div
      className={`w-full overflow-hidden rounded-[14px] border border-line bg-card ${fill ? "flex h-full flex-col" : ""}`}
      data-fill={fill ? "" : undefined}
      contentEditable={false}
      data-name="カレンダーブロック"
    >
      {/* 上の段：‹ 今日 ›・期間・月/週・予定を追加・設定 */}
      {/* タブの中でも隠さない（data-block-head を付けない）。アイコンだけは、タブの中では出さない（data-block-title） */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1.5 text-sm">
        <span className="mr-1 flex items-center gap-1.5" data-block-title="">
          <Icon name="calendar" size={16} className="text-muted" />
        </span>
        <button className="btn-sub h-7 min-h-0 w-7 px-0" aria-label="前へ" onClick={() => move(-1)}>
          <Icon name="l" size={16} />
        </button>
        <button className="btn-sub h-7 min-h-0 px-2.5 text-xs" onClick={() => setCursor(now)}>
          今日
        </button>
        <button className="btn-sub h-7 min-h-0 w-7 px-0" aria-label="次へ" onClick={() => move(1)}>
          <Icon name="r" size={16} />
        </button>
        <b className="ml-1 whitespace-nowrap">{title}</b>
        <span className="ml-auto flex items-center gap-1">
          <span className="flex overflow-hidden rounded-full border border-line text-xs" role="group" aria-label="期間">
            {(["month", "week", "list"] as const).map((r) => (
              <button key={r} aria-pressed={range === r} onClick={() => setPicked({ base: setting, range: r })} className={`px-2.5 py-1 ${range === r ? "bg-accent text-accent-ink" : "hover:bg-tint"}`}>
                {RANGE_LABEL[r]}
              </button>
            ))}
          </span>
          <button className="btn h-7 min-h-0 gap-1 px-2.5 text-xs" disabled={!canAdd} title={canAdd ? "予定を追加" : "歯車で「このカレンダーの予定」か「ルームの予定」を出すと、予定を足せます"} onClick={() => openNew(now)}>
            <Icon name="add" size={14} />
            予定
          </button>
          {!ctx.locked && (
            <SettingsButton label="カレンダーの設定">
              <CalendarMenu props={props} sources={sources} databases={databases} onChange={onChange} />
            </SettingsButton>
          )}
        </span>
      </div>
      {range === "list" ? (
        // リスト：日付の見出しと、その日の予定（押すと直す・ページを開く。日付を押すと、その日に予定を足す）
        <div className={`divide-y divide-line ${fill ? "min-h-0 flex-1 overflow-y-auto" : ""}`} data-name="カレンダーのリスト">
          {listDays.map(({ date: d, list }) => (
            <div key={d} className="flex gap-3 px-3 py-2">
              <button
                type="button"
                onClick={() => openNew(d)}
                disabled={!canAdd}
                title={canAdd ? "この日に予定を追加" : undefined}
                className={`w-16 shrink-0 self-start rounded-[6px] px-1 text-left text-sm enabled:hover:bg-tint ${d === now ? "font-bold text-accent" : dayOfWeek(d) === 0 ? "text-warn" : dayOfWeek(d) === 6 ? "text-accent" : ""}`}
              >
                {md(d)}
                <span className="ml-0.5 text-xs text-muted">（{WEEK[dayOfWeek(d)]}）</span>
                {d === now && <span className="block text-[11px] font-normal">今日</span>}
              </button>
              <div className="min-w-0 flex-1 space-y-1">
                {list.map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => openItem(it)}
                    className={`flex w-full min-w-0 items-start gap-2 rounded-[8px] py-1 pr-2 pl-3 text-left text-sm hover:bg-tint ${it.done ? "text-muted line-through" : ""}`}
                    style={{ boxShadow: `inset 3px 0 0 ${it.hue}` }}
                    data-name="カレンダーの予定（リスト）"
                  >
                    <span className="w-24 shrink-0 truncate text-xs leading-5 text-muted">{when(it)}</span>
                    <span className="min-w-0 flex-1 break-words">{it.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!listDays.length && <p className="px-3 py-6 text-center text-sm text-muted">この月の予定はありません</p>}
        </div>
      ) : (
        <>
      {/* 曜日 */}
      <div className="grid shrink-0 grid-cols-7 border-b border-line text-center text-xs text-muted">
        {weekdayOrder.map((d) => (
          <span key={d} className={`py-1 ${d === 0 ? "text-warn/80" : d === 6 ? "text-accent/80" : ""}`}>
            {WEEK[d]}
          </span>
        ))}
      </div>
      {/* 日付のマス：何も無いところを押すとその日に予定を足す。日付を押すと、その日の予定をポップアップで一覧にする */}
      <div
        className={`grid grid-cols-7 gap-px bg-line ${fill ? "min-h-0 flex-1" : ""}`}
        style={fill ? { gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` } : undefined}
      >
        {days.map((d) => {
          const outside = range === "month" && monthOf(d) !== monthOf(cursor);
          const dw = dayOfWeek(d);
          return (
            <div
              key={d}
              onClick={() => openNew(d)}
              className={`group flex min-w-0 flex-col gap-0.5 py-1 ${fill ? "min-h-0 overflow-x-hidden overflow-y-auto" : cellMin} ${outside ? "bg-bg/60" : "bg-card"} ${canAdd ? "cursor-pointer" : ""}`}
              data-name={`${md(d)}のマス`}
              data-day={d}
            >
              <span className="flex shrink-0 items-center justify-between px-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDayOpen(d);
                  }}
                  title="この日の予定を見る"
                  className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-xs ${d === now ? "bg-accent font-bold text-accent-ink" : `hover:bg-tint ${outside ? "text-muted/60" : dw === 0 ? "text-warn" : dw === 6 ? "text-accent" : "text-muted"}`}`}
                >
                  {range === "week" || Number(d.slice(8)) === 1 ? md(d) : Number(d.slice(8))}
                </button>
                {canAdd && <Icon name="add" size={12} className="text-muted opacity-0 group-hover:opacity-100" />}
              </span>
              {dayList(d).map((it) => chip(it, d))}
            </div>
          );
        })}
      </div>
        </>
      )}
      {!own && !room && !sources.length && <p className="px-3 py-2 text-xs text-muted">{ctx.locked ? "編集モードで、歯車から出すものを選んでください" : "歯車から出すもの（予定・データベースの日付）を選んでください"}</p>}
      {dayOpen && (
        <PopupDialog title={`${Number(dayOpen.slice(5, 7))}月${Number(dayOpen.slice(8))}日（${WEEK[dayOfWeek(dayOpen)]}）の予定`} onClose={() => setDayOpen(null)} width="max-w-md">
          <div className="space-y-1">
            {(dayItems(dayOpen) ?? []).map((it) => (
              <button
                key={it.key}
                type="button"
                onClick={() => {
                  setDayOpen(null);
                  openItem(it);
                }}
                className={`flex w-full min-w-0 items-start gap-2 rounded-[8px] py-1.5 pr-2 pl-3 text-left text-sm hover:bg-tint ${it.done ? "text-muted line-through" : ""}`}
                style={{ boxShadow: `inset 3px 0 0 ${it.hue}` }}
              >
                <span className="w-24 shrink-0 truncate text-xs leading-5 text-muted">{when(it)}</span>
                <span className="min-w-0 flex-1 break-words">{it.text}</span>
              </button>
            ))}
            {!dayItems(dayOpen)?.length && <p className="py-4 text-center text-sm text-muted">この日の予定はありません</p>}
          </div>
          {canAdd && (
            <button
              type="button"
              className="btn-sub mt-3 w-full"
              onClick={() => {
                const d = dayOpen;
                setDayOpen(null);
                openNew(d);
              }}
            >
              <Icon name="add" size={16} />
              この日に予定を追加
            </button>
          )}
        </PopupDialog>
      )}
      {editing && (
        <EventDialog
          roomId={ctx.roomId}
          event={editing.event}
          date={editing.date}
          targets={{ own: own && props.calendarId ? props.calendarId : "", room }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ---- 予定の画面：名前・日付（何日かにわたってもよい）・時刻（終日でもよい）・色・メモ ----

const COLOR_IDS = Object.keys(TAG_COLORS) as TagColor[];

function EventDialog({ roomId, event, date, targets, onClose }: { roomId: string; event?: CalEvent; date: string; targets: { own: string; room: boolean }; onClose: () => void }) {
  const [text, setText] = useState(event?.text ?? "");
  const [start, setStart] = useState(event?.date ?? date);
  const [end, setEnd] = useState(event?.end ?? event?.date ?? date);
  const [allDay, setAllDay] = useState(!event?.time);
  const [time, setTime] = useState(event?.time ?? "10:00");
  const [endTime, setEndTime] = useState(event?.endTime ?? "11:00");
  const [color, setColor] = useState<TagColor | undefined>(event?.color);
  const [memo, setMemo] = useState(event?.memo ?? "");
  const [done, setDone] = useState(!!event?.done);
  // 足す先：このカレンダー（出していれば）かルームの予定。直すときは、今の先のまま
  const [target, setTarget] = useState<"own" | "room">(event ? (event.calendarId ? "own" : "room") : targets.own ? "own" : "room");
  const [busy, setBusy] = useState(false);
  const ok = !!text.trim() && isDate(start) && isDate(end) && end >= start && (allDay || !time || !endTime || end > start || endTime >= time);

  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    await saveCalEvent(roomId, event?.id ?? null, {
      text: text.trim(),
      date: start,
      end,
      time: allDay ? undefined : time || undefined,
      endTime: allDay ? undefined : endTime || undefined,
      color,
      memo: memo.trim() || undefined,
      done: done || undefined,
      calendarId: target === "own" ? event?.calendarId || targets.own : undefined,
    });
    onClose();
  };

  return (
    <PopupDialog title={event ? "予定を直す" : "予定を追加"} onClose={onClose} width="max-w-md">
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="block">
          <span className="text-xs text-muted">名前（必須）</span>
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} className="field" placeholder="例：打ち合わせ" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-muted">始まりの日</span>
            <input
              type="date"
              value={start}
              onChange={(e) => {
                const v = e.target.value;
                // 終わりの日は、始まりの日より前にならないようにそろえる
                setStart(v);
                if (isDate(v) && end < v) setEnd(v);
              }}
              className="field"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted">終わりの日</span>
            <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="field" />
          </label>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            終日
          </label>
          {/* 済み：ToDo のブロックでチェックしたものと同じ。カレンダーでは線で消して出す */}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            済み
          </label>
        </div>
        {!allDay && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs text-muted">始まりの時刻</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="field" />
            </label>
            <label className="block">
              <span className="text-xs text-muted">終わりの時刻</span>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="field" />
            </label>
          </div>
        )}
        <div>
          <span className="text-xs text-muted">色</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {COLOR_IDS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={TAG_COLORS[c].label}
                aria-pressed={(color ?? (target === "own" ? "blue" : "gray")) === c}
                title={TAG_COLORS[c].label}
                onClick={() => setColor(c)}
                className={`h-6 w-6 rounded-full border-2 ${(color ?? (target === "own" ? "blue" : "gray")) === c ? "border-ink" : "border-transparent"}`}
                style={{ background: TAG_COLORS[c].hue }}
              />
            ))}
          </div>
        </div>
        <label className="block">
          <span className="text-xs text-muted">メモ</span>
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} className="field resize-y" />
        </label>
        {/* 足す先は、両方出しているときだけ選ぶ */}
        {!event && targets.own && targets.room && (
          <div>
            <span className="text-xs text-muted">入れる先</span>
            <div className="mt-1 flex gap-1">
              {(["own", "room"] as const).map((t) => (
                <button key={t} type="button" aria-pressed={target === t} onClick={() => setTarget(t)} className={`rounded-full border px-3 py-1 text-xs ${target === t ? "border-accent bg-tint font-bold" : "border-line hover:bg-tint"}`}>
                  {t === "own" ? "このカレンダー" : "ルームの予定"}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          {event && (
            <button
              type="button"
              className="btn-sub text-warn"
              onClick={async () => {
                if (!(await confirmAction(`「${event.text}」を削除します`, "削除"))) return;
                await deleteEvent(event.id);
                onClose();
              }}
            >
              <Icon name="del" size={16} />
              削除
            </button>
          )}
          <span className="ml-auto" />
          <button type="button" className="btn-sub" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn" disabled={!ok || busy}>
            {event ? "保存" : "追加"}
          </button>
        </div>
      </form>
    </PopupDialog>
  );
}

// ---- 設定：出すもの（このカレンダーの予定・ルームの予定・データベースの日付）と、はじめの期間・週の始まり ----

function CalendarMenu({ props, sources, databases, onChange }: { props: CalendarProps; sources: DbSource[]; databases: Database[]; onChange: (patch: Partial<CalendarProps>) => void }) {
  const [openDb, setOpenDb] = useState<string | null>(null);
  const setSources = (next: DbSource[]) => onChange({ dbs: JSON.stringify(next) });
  const db = openDb ? databases.find((d) => d.id === openDb) : undefined;

  // データベースを押したあと：出す日付の項目を選ぶ（いくつでも）
  if (db) {
    const list = datePropsOf(db);
    return (
      <div>
        <BackHead title={db.name} onBack={() => setOpenDb(null)} />
        <SectionHead label="カレンダーに出す項目" />
        {list.map((p) => {
          const on = sources.some((s) => s.dbId === db.id && s.propId === p.id);
          return (
            <ToggleRow
              key={p.id}
              icon={p.type === "stage" ? "timeline" : "calendar"}
              label={p.type === "stage" ? `${p.name}（工程の期限）` : p.name}
              on={on}
              onChange={(v) => setSources(v ? [...sources, { dbId: db.id, propId: p.id }] : sources.filter((s) => !(s.dbId === db.id && s.propId === p.id)))}
            />
          );
        })}
        {!list.length && <EmptyNote>日付の項目がありません</EmptyNote>}
      </div>
    );
  }
  const countOf = (d: Database) => sources.filter((s) => s.dbId === d.id && d.props.some((p) => p.id === s.propId)).length;
  return (
    <div>
      <MenuTitle>カレンダーの設定</MenuTitle>
      <SectionHead label="出すもの" />
      <ToggleRow icon="calendar" label="このカレンダーの予定" note="このブロックだけの予定" on={props.own !== ""} onChange={(on) => onChange({ own: on ? "1" : "" })} />
      <ToggleRow icon="calendar" label="ルームの予定" note="データベースのカレンダーの「予定を追加」で入れた予定" on={props.room === "1"} onChange={(on) => onChange({ room: on ? "1" : "" })} />
      {databases.map((d) => (
        <NavRow key={d.id} icon="db" emoji={d.icon} label={d.name} value={countOf(d) ? `${countOf(d)}個の項目` : "出さない"} onClick={() => setOpenDb(d.id)} />
      ))}
      <MenuDivider />
      <SectionHead label="表示" />
      {(["month", "week", "list"] as const).map((r) => (
        <OptionRow key={r} icon={r === "list" ? "list" : "calendar"} selected={(props.range === "week" || props.range === "list" ? props.range : "month") === r} onClick={() => onChange({ range: r })}>
          はじめは{RANGE_LABEL[r]}で出す
        </OptionRow>
      ))}
      <ToggleRow icon="calendar" label="月曜はじまり" on={props.weekStart === "1"} onChange={(on) => onChange({ weekStart: on ? "1" : "" })} />
      <ToggleRow icon="text" label="文章を右端で折り返す" note="マスの中の予定の名前を、省略せずに折り返す" on={props.wrap === "1"} onChange={(on) => onChange({ wrap: on ? "1" : "" })} />
    </div>
  );
}
