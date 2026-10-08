import type { Database, DbPage, DbView, Filter, Property } from "@/lib/local/db";
import { DEFAULT_STAGES, P } from "./defaults";

// 日付は「YYYY-MM-DD」の文字列で持つ（時差でずれないよう、計算は UTC の正午で行う）

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const toTime = (ymd: string) => Date.parse(`${ymd}T12:00:00Z`);
const fromTime = (t: number) => new Date(t).toISOString().slice(0, 10);

export const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 作成日時・更新日時に入れる「YYYY-MM-DD HH:mm」 */
export function stamp(t: number = Date.now()): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const daysBetween = (a: string, b: string) => Math.round((toTime(b) - toTime(a)) / 864e5);
export const addDays = (ymd: string, n: number) => fromTime(toTime(ymd) + n * 864e5);

export function valueOf(page: DbPage, propId: string): unknown {
  return propId === P.title ? page.title : page.values[propId];
}

export type StageDate = { name: string; date: string; kind: "received" | "start" | "stage" };

/** 依頼の工程の期限。受付日・開始日と、プランの工程を開始日〜納期に割り振った日付 */
export function stagesOf(db: Database, page: DbPage): StageDate[] {
  const recv = page.values[P.received];
  const start = page.values[P.start];
  const due = page.values[P.due];
  const out: StageDate[] = [];
  if (isDate(recv)) out.push({ name: "受付", date: recv, kind: "received" });
  if (isDate(start)) out.push({ name: "開始", date: start, kind: "start" });
  if (isDate(start) && isDate(due)) {
    const plan = page.values[P.plan];
    const stages = (typeof plan === "string" && db.plans[plan]) || DEFAULT_STAGES;
    const span = toTime(due) - toTime(start);
    for (const s of stages) out.push({ name: s.name, date: fromTime(toTime(start) + Math.round((span * s.ratio) / 864e5) * 864e5), kind: "stage" });
  }
  return out;
}

/** 今日の時点で、次に来る工程（すべて過ぎていれば最後） */
export function nextStage(db: Database, page: DbPage): StageDate | undefined {
  const st = stagesOf(db, page).filter((s) => s.kind === "stage");
  return st.find((s) => s.date >= today()) ?? st.at(-1);
}

function isEmpty(v: unknown) {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/** フィルターの値の「自分」「今日」を、実際の値にする */
function resolve(value: string | undefined, me: string | undefined) {
  if (value === "@me") return me ?? "";
  if (value === "@today") return today();
  return value;
}

function matches(page: DbPage, raw: Filter, prop: Property | undefined, me?: string): boolean {
  const f = { ...raw, value: resolve(raw.value, me) };
  const v = valueOf(page, f.prop);
  // チェックボックスは、チェックが無いことを「空」とする
  const empty = prop?.type === "checkbox" ? !v : isEmpty(v);
  if (prop?.type === "checkbox" && (f.op === "is" || f.op === "isNot")) return (String(!!v) === f.value) === (f.op === "is");
  switch (f.op) {
    case "empty":
      return empty;
    case "notEmpty":
      return !empty;
    case "is":
      return Array.isArray(v) ? v.includes(f.value) : String(v ?? "") === (f.value ?? "");
    case "isNot":
      return Array.isArray(v) ? !v.includes(f.value) : String(v ?? "") !== (f.value ?? "");
    case "contains":
      return String(Array.isArray(v) ? v.join(" ") : (v ?? "")).toLowerCase().includes((f.value ?? "").toLowerCase());
    case "gt":
    case "lt": {
      if (isEmpty(v) || !f.value) return false;
      if (prop?.type === "number") return f.op === "gt" ? Number(v) > Number(f.value) : Number(v) < Number(f.value);
      // 日付・日時は日付の部分で比べる（「今日より後」に今日の日時を含めない）
      const a = String(v).slice(0, 10);
      return f.op === "gt" ? a > f.value : a < f.value;
    }
  }
}

export function applyView(db: Database, pages: DbPage[], view: DbView, me?: string): DbPage[] {
  const filtered = pages.filter((p) => view.filters.every((f) => matches(p, f, db.props.find((x) => x.id === f.prop), me)));
  if (!view.sort) return filtered;
  const { prop, dir } = view.sort;
  const type = db.props.find((x) => x.id === prop)?.type;
  const k = dir === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => {
    const va = valueOf(a, prop);
    const vb = valueOf(b, prop);
    // 空のものは常に後ろ
    if (isEmpty(va) && isEmpty(vb)) return 0;
    if (isEmpty(va)) return 1;
    if (isEmpty(vb)) return -1;
    if (type === "number") return (Number(va) - Number(vb)) * k;
    return String(va).localeCompare(String(vb), "ja", { numeric: true }) * k;
  });
}

export function formatValue(prop: Property, v: unknown, userName?: (id: string) => string): string {
  if (prop.type === "checkbox") return v ? "✓" : "";
  if (isEmpty(v)) return "";
  switch (prop.type) {
    case "created":
    case "edited":
      return String(v).replaceAll("-", "/");
    case "number": {
      const n = Number(v);
      if (prop.format === "yen") return `¥${n.toLocaleString("ja-JP")}`;
      if (prop.format === "percent") return `${n}%`;
      return n.toLocaleString("ja-JP");
    }
    case "date":
      return isDate(v) ? v.replaceAll("-", "/") : String(v);
    case "multiselect":
      return Array.isArray(v) ? v.join("、") : String(v);
    case "user":
      return userName ? userName(String(v)) : String(v);
    case "media":
      return Array.isArray(v) ? `画像${v.length}枚` : "";
    default:
      return String(v);
  }
}

/** 納期までの残り日数の表示 */
export function dueLabel(due: unknown): { text: string; tone: "late" | "soon" | "normal" } | null {
  if (!isDate(due)) return null;
  const n = daysBetween(today(), due);
  if (n < 0) return { text: `${-n}日超過`, tone: "late" };
  if (n === 0) return { text: "今日が納期", tone: "late" };
  if (n <= 3) return { text: `あと${n}日`, tone: "soon" };
  return { text: `あと${n}日`, tone: "normal" };
}

export const FILTER_OPS: Record<Filter["op"], string> = {
  is: "である",
  isNot: "でない",
  contains: "を含む",
  gt: "より後・大きい",
  lt: "より前・小さい",
  empty: "が空",
  notEmpty: "が空でない",
};
