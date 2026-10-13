import type { Database, DbPage, PropType, Property } from "@/lib/local/db";
import { addDays, daysBetween, isDate, today } from "./logic";
import { stageOf } from "./stages";

/*
 * 数式の項目の計算。式は Notion に近い書き方：
 *   {依頼料} * 0.78            項目は {名前} で使う
 *   {納期} - 今日()            日付どうしの引き算は日数、日付＋数は日付
 *   もし({枚数} > 1, "複数", "1枚")
 *   "合計 " + {枚数} + "枚"     文字があれば、つないだ文字になる
 * 関数は日本語の名前と英語の名前のどちらでも使える（FUNCTIONS）。値は保存せず、読むたびに計算する
 */

/** 日付の値（ただの文字と区別するため） */
class FDate {
  constructor(public ymd: string) {}
}
type Val = number | string | boolean | FDate | null;

type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "ref"; name: string }
  | { k: "call"; name: string; args: Node[] }
  | { k: "un"; op: "-" | "!"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node };

class FormulaError extends Error {}

/** 関数の分け方（数式の設定の画面で、分けて並べる） */
export type FnGroup = "条件" | "数" | "文字" | "日付";

/** 関数：日本語の名前・英語の名前・中身の説明・分け方・出す値の種類 */
export const FUNCTIONS: { ja: string; en: string; args: string; note: string; group: FnGroup; kind: FormulaKind }[] = [
  { ja: "もし", en: "if", args: "条件, 合うとき, 合わないとき", note: "条件で値を変える", group: "条件", kind: "unknown" },
  { ja: "空", en: "empty", args: "値", note: "空かどうか", group: "条件", kind: "bool" },
  { ja: "四捨五入", en: "round", args: "数, 桁", note: "四捨五入（桁は小数の桁。省くと整数）", group: "数", kind: "number" },
  { ja: "切り捨て", en: "floor", args: "数, 桁", note: "切り捨て", group: "数", kind: "number" },
  { ja: "切り上げ", en: "ceil", args: "数, 桁", note: "切り上げ", group: "数", kind: "number" },
  { ja: "最大", en: "max", args: "数, 数, …", note: "いちばん大きい数", group: "数", kind: "number" },
  { ja: "最小", en: "min", args: "数, 数, …", note: "いちばん小さい数", group: "数", kind: "number" },
  { ja: "合計", en: "sum", args: "数, 数, …", note: "足した数", group: "数", kind: "number" },
  { ja: "数", en: "value", args: "{選択の項目}", note: "選んだ選択肢に付けた数（いくつも選べる項目は合計）", group: "数", kind: "number" },
  { ja: "進み具合", en: "progress", args: "{工程}", note: "工程の項目の進み具合（0〜100）", group: "数", kind: "number" },
  { ja: "数にする", en: "toNumber", args: "文字", note: "文字を数にする（「¥1,200」→ 1200）", group: "数", kind: "number" },
  { ja: "文字数", en: "length", args: "文字", note: "文字の数", group: "文字", kind: "number" },
  { ja: "含む", en: "contains", args: "文字, 探す文字", note: "探す文字が入っているか", group: "文字", kind: "bool" },
  { ja: "置き換え", en: "replace", args: "文字, 前, 後", note: "前の文字を後の文字にする（全部）", group: "文字", kind: "text" },
  { ja: "切り出し", en: "slice", args: "文字, 何文字目から, 何文字", note: "文字の一部（何文字を省くと最後まで）", group: "文字", kind: "text" },
  { ja: "文字にする", en: "toText", args: "値, 単位", note: "数や日付を文字にする（単位が「円」なら ¥1,200、「%」「枚」などは後ろに付く）", group: "文字", kind: "text" },
  { ja: "つなぐ", en: "join", args: "区切り, 値, 値, …", note: "空でない値を区切りでつなぐ", group: "文字", kind: "text" },
  { ja: "今日", en: "today", args: "", note: "今日の日付", group: "日付", kind: "date" },
  { ja: "日付を足す", en: "addDays", args: "日付, 数, 単位", note: "日付に足した日（単位は 日・週・月・年。省くと日）", group: "日付", kind: "date" },
  { ja: "日数", en: "days", args: "開始, 終わり", note: "開始から終わりまでの日数", group: "日付", kind: "number" },
  { ja: "期間", en: "dateBetween", args: "開始, 終わり, 単位", note: "開始から終わりまで（単位は 日・週・月・年。満で数える）", group: "日付", kind: "number" },
  { ja: "年", en: "year", args: "日付", note: "年（2026）", group: "日付", kind: "number" },
  { ja: "月", en: "month", args: "日付", note: "月（1〜12）", group: "日付", kind: "number" },
  { ja: "日", en: "day", args: "日付", note: "日（1〜31）", group: "日付", kind: "number" },
  { ja: "曜日", en: "weekday", args: "日付", note: "曜日（月・火…）", group: "日付", kind: "text" },
  { ja: "日付の形", en: "formatDate", args: "日付, 形", note: "日付を決めた形の文字にする（YYYY は年・M は月・D は日・曜 は曜日。例：\"M月D日（曜）\"）", group: "日付", kind: "text" },
  { ja: "月初め", en: "monthStart", args: "日付", note: "その月の1日", group: "日付", kind: "date" },
  { ja: "月末", en: "monthEnd", args: "日付", note: "その月の最後の日", group: "日付", kind: "date" },
  { ja: "日付にする", en: "parseDate", args: "文字", note: "「2026/10/13」などの文字を日付にする", group: "日付", kind: "date" },
];
const FN_NAME = new Map(FUNCTIONS.flatMap((f) => [[f.ja, f.en] as const, [f.en.toLowerCase(), f.en] as const]));

// ---- 読み取り（文字 → 木） ----

type Tok = { t: "num" | "str" | "ref" | "id" | "op"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+|^[0-9]+/.exec(src.slice(i))!;
      out.push({ t: "num", v: m[0] });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "「") {
      const close = c === '"' ? '"' : "」";
      const j = src.indexOf(close, i + 1);
      if (j < 0) throw new FormulaError(`文字の終わり（${close}）がありません`);
      out.push({ t: "str", v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (c === "{" || c === "｛") {
      const j = src.slice(i + 1).search(/[}｝]/);
      if (j < 0) throw new FormulaError("項目の終わり（}）がありません");
      out.push({ t: "ref", v: src.slice(i + 1, i + 1 + j).trim() });
      i += j + 2;
      continue;
    }
    const two = src.slice(i, i + 2);
    if ([">=", "<=", "==", "!=", "&&", "||"].includes(two)) {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    // 全角の記号も、半角と同じに読む
    const wide: Record<string, string> = { "＋": "+", "－": "-", "−": "-", "×": "*", "＊": "*", "÷": "/", "／": "/", "（": "(", "）": ")", "，": ",", "、": ",", "＞": ">", "＜": "<", "＝": "=" };
    const op = wide[c] ?? c;
    if ("+-*/%()<>,=!".includes(op)) {
      out.push({ t: "op", v: op === "=" ? "==" : op });
      i++;
      continue;
    }
    // 関数の名前（日本語の名前も）
    const m = /^[A-Za-z_぀-ヿ㐀-鿿ー]+/.exec(src.slice(i));
    if (m) {
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    throw new FormulaError(`「${c}」は使えません`);
  }
  return out;
}

function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === "op" && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`「${v}」がありません`);
    p++;
  };
  const PREC: Record<string, number> = { "||": 1, "&&": 2, "==": 3, "!=": 3, ">": 4, "<": 4, ">=": 4, "<=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

  const primary = (): Node => {
    const t = peek();
    if (!t) throw new FormulaError("式が途中で終わっています");
    p++;
    if (t.t === "num") return { k: "num", v: Number(t.v) };
    if (t.t === "str") return { k: "str", v: t.v };
    if (t.t === "ref") return { k: "ref", name: t.v };
    if (t.t === "id") {
      const lower = t.v.toLowerCase();
      if (lower === "true" || t.v === "はい") return { k: "num", v: 1 };
      if (lower === "false" || t.v === "いいえ") return { k: "num", v: 0 };
      const name = FN_NAME.get(t.v) ?? FN_NAME.get(lower);
      if (!name) throw new FormulaError(`「${t.v}」という関数はありません`);
      expect("(");
      const args: Node[] = [];
      if (!isOp(")")) {
        args.push(expr(0));
        while (isOp(",")) {
          p++;
          args.push(expr(0));
        }
      }
      expect(")");
      return { k: "call", name, args };
    }
    if (t.v === "(") {
      const n = expr(0);
      expect(")");
      return n;
    }
    if (t.v === "-" || t.v === "!") return { k: "un", op: t.v, a: unary() };
    throw new FormulaError(`「${t.v}」の位置がおかしいです`);
  };
  const unary = (): Node => primary();
  const expr = (min: number): Node => {
    let a = unary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== "op" || !(t.v in PREC) || PREC[t.v] < min) break;
      p++;
      const b = expr(PREC[t.v] + 1);
      a = { k: "bin", op: t.v, a, b };
    }
    return a;
  };
  const n = expr(0);
  if (p < toks.length) throw new FormulaError(`「${toks[p].v}」の位置がおかしいです`);
  return n;
}

const parsed = new Map<string, Node | FormulaError>();
function parseCached(src: string): Node {
  let n = parsed.get(src);
  if (!n) {
    try {
      n = parse(src);
    } catch (e) {
      n = e instanceof FormulaError ? e : new FormulaError("式が読めません");
    }
    parsed.set(src, n);
  }
  if (n instanceof FormulaError) throw n;
  return n;
}

// ---- 計算 ----

type Ctx = { database: Database; page: Pick<DbPage, "title" | "values">; seen: Set<string> };

const isEmptyVal = (v: Val) => v === null || v === "";
const num = (v: Val): number => {
  if (v === null || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof FDate) throw new FormulaError("日付は数として使えません");
  const n = Number(v);
  if (!Number.isFinite(n)) throw new FormulaError(`「${v}」は数ではありません`);
  return n;
};
const str = (v: Val): string => (v === null ? "" : v instanceof FDate ? v.ymd.replaceAll("-", "/") : typeof v === "boolean" ? (v ? "はい" : "いいえ") : String(v));
const truthy = (v: Val) => !(v === null || v === "" || v === 0 || v === false);
const date = (v: Val): FDate | null => {
  if (v instanceof FDate) return v;
  if (typeof v === "string" && isDate(v.slice(0, 10))) return new FDate(v.slice(0, 10));
  if (isEmptyVal(v)) return null;
  throw new FormulaError("日付が要ります");
};
const roundTo = (x: number, digits: number, fn: (n: number) => number) => {
  const k = 10 ** Math.max(0, Math.min(10, Math.trunc(digits)));
  return fn(x * k) / k;
};

const WEEK = "日月火水木金土";
const ymdOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const dayOfWeek = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

/** 月を足す（その月に無い日は、その月の最後の日にする：1/31 の1か月後は 2/28） */
function addMonths(ymd: string, n: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + n, 0)).getUTCDate();
  return ymdOf(Date.UTC(y, m - 1 + n, Math.min(d, last)));
}

/** 日付を単位（日・週・月・年）でずらす */
function shiftDate(ymd: string, n: number, unit: string) {
  if (unit === "日") return addDays(ymd, n);
  if (unit === "週") return addDays(ymd, n * 7);
  if (unit === "月") return addMonths(ymd, n);
  if (unit === "年") return addMonths(ymd, n * 12);
  throw new FormulaError(`単位は「日・週・月・年」のどれかです（「${unit}」は使えません）`);
}

/** 満で数えた月の数（10/15 から 11/14 は 0、11/15 で 1） */
function monthsBetween(a: string, b: string): number {
  if (b < a) return -monthsBetween(b, a);
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) - (bd < ad ? 1 : 0);
}

/** 項目の値を、計算に使う形にする */
function refValue(ctx: Ctx, name: string): Val {
  const prop = ctx.database.props.find((p) => p.name === name);
  if (!prop) throw new FormulaError(`「${name}」という項目はありません`);
  if (prop.type === "title") return ctx.page.title || null;
  const v = ctx.page.values[prop.id];
  switch (prop.type) {
    case "formula": {
      if (ctx.seen.has(prop.id)) throw new FormulaError(`「${name}」が自分を使っています`);
      return run(prop, { ...ctx, seen: new Set([...ctx.seen, prop.id]) });
    }
    case "number":
    case "serial":
      return v === undefined || v === null || v === "" ? null : Number(v);
    case "date":
    case "created":
    case "edited":
      return typeof v === "string" && isDate(v.slice(0, 10)) ? new FDate(v.slice(0, 10)) : null;
    case "checkbox":
      return !!v;
    case "multiselect":
      return Array.isArray(v) ? v.join("、") : null;
    case "media":
      return Array.isArray(v) ? v.length : 0;
    case "chat":
    case "imageChat":
      return null;
    default:
      return v === undefined || v === null ? null : String(v);
  }
}

function call(ctx: Ctx, name: string, args: Node[]): Val {
  const v = (i: number) => (args[i] ? ev(ctx, args[i]) : null);
  const need = (n: number) => {
    if (args.length < n) throw new FormulaError(`${FUNCTIONS.find((f) => f.en === name)?.ja ?? name}() の中身が足りません`);
  };
  switch (name) {
    case "today":
      return new FDate(today());
    case "days": {
      need(2);
      const a = date(v(0));
      const b = date(v(1));
      return a && b ? daysBetween(a.ymd, b.ymd) : null;
    }
    case "addDays": {
      need(2);
      const d = date(v(0));
      const n = v(1);
      if (!d || isEmptyVal(n)) return d;
      return new FDate(shiftDate(d.ymd, Math.trunc(num(n)), args[2] ? str(v(2)) : "日"));
    }
    case "dateBetween": {
      need(2);
      const a = date(v(0));
      const b = date(v(1));
      if (!a || !b) return null;
      const unit = args[2] ? str(v(2)) : "日";
      const d = daysBetween(a.ymd, b.ymd);
      if (unit === "日") return d;
      if (unit === "週") return Math.trunc(d / 7);
      if (unit === "月") return monthsBetween(a.ymd, b.ymd);
      if (unit === "年") return Math.trunc(monthsBetween(a.ymd, b.ymd) / 12);
      throw new FormulaError(`単位は「日・週・月・年」のどれかです（「${unit}」は使えません）`);
    }
    case "year":
    case "month":
    case "day": {
      need(1);
      const d = date(v(0));
      return d ? Number(name === "year" ? d.ymd.slice(0, 4) : name === "month" ? d.ymd.slice(5, 7) : d.ymd.slice(8, 10)) : null;
    }
    case "weekday": {
      need(1);
      const d = date(v(0));
      return d ? WEEK[dayOfWeek(d.ymd)] : null;
    }
    case "formatDate": {
      need(2);
      const d = date(v(0));
      if (!d) return null;
      const [y, m, day] = d.ymd.split("-");
      const parts: Record<string, string> = { YYYY: y, YY: y.slice(2), MM: m, M: String(Number(m)), DD: day, D: String(Number(day)), 曜: WEEK[dayOfWeek(d.ymd)] };
      return str(v(1)).replace(/YYYY|YY|MM|M|DD|D|曜/g, (t) => parts[t]);
    }
    case "monthStart":
    case "monthEnd": {
      need(1);
      const d = date(v(0));
      if (!d) return null;
      const [y, m] = d.ymd.split("-").map(Number);
      return new FDate(name === "monthStart" ? `${d.ymd.slice(0, 8)}01` : ymdOf(Date.UTC(y, m, 0)));
    }
    case "parseDate": {
      need(1);
      const t = str(v(0)).trim();
      if (!t) return null;
      const m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(t);
      const ymd = m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
      // 2/30 のような無い日は、日付にしない
      if (!m || ymdOf(Date.parse(`${ymd}T00:00:00Z`) || 0) !== ymd) throw new FormulaError(`「${t}」は日付として読めません`);
      return new FDate(ymd);
    }
    case "length":
      need(1);
      return [...str(v(0))].length;
    case "contains":
      need(2);
      return str(v(0)).includes(str(v(1)));
    case "replace": {
      need(3);
      const find = str(v(1));
      return find ? str(v(0)).split(find).join(str(v(2))) : str(v(0));
    }
    case "slice": {
      need(2);
      const chars = [...str(v(0))];
      const start = Math.max(1, Math.trunc(num(v(1))));
      const count = args[2] ? Math.max(0, Math.trunc(num(v(2)))) : chars.length;
      return chars.slice(start - 1, start - 1 + count).join("");
    }
    case "toText": {
      need(1);
      const x = v(0);
      if (typeof x !== "number") return str(x);
      const unit = args[1] ? str(v(1)) : "";
      const n = x.toLocaleString("ja-JP", { maximumFractionDigits: 10 });
      return unit === "円" ? `¥${n}` : `${n}${unit === "％" ? "%" : unit}`;
    }
    case "toNumber": {
      need(1);
      const x = v(0);
      if (typeof x === "number") return x;
      if (isEmptyVal(x)) return null;
      const n = Number(str(x).replace(/[,，¥￥%％円\s]/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    case "join": {
      need(1);
      const sep = str(v(0));
      return args
        .slice(1)
        .map((_, i) => v(i + 1))
        .filter((x) => !isEmptyVal(x))
        .map(str)
        .join(sep);
    }
    case "if":
      need(2);
      return truthy(v(0)) ? v(1) : v(2);
    case "round":
    case "floor":
    case "ceil": {
      need(1);
      const x = v(0);
      if (isEmptyVal(x)) return null;
      return roundTo(num(x), args[1] ? num(v(1)) : 0, name === "round" ? Math.round : name === "floor" ? Math.floor : Math.ceil);
    }
    case "max":
    case "min":
    case "sum": {
      const ns = args.map((_, i) => v(i)).filter((x) => !isEmptyVal(x)).map(num);
      if (!ns.length) return null;
      return name === "sum" ? ns.reduce((a, b) => a + b, 0) : name === "max" ? Math.max(...ns) : Math.min(...ns);
    }
    case "empty":
      need(1);
      return isEmptyVal(v(0));
    case "progress": {
      need(1);
      const a = args[0];
      const prop = a.k === "ref" ? ctx.database.props.find((p) => p.name === a.name) : undefined;
      if (prop?.type !== "stage") throw new FormulaError("進み具合() には {工程の項目} を入れてください");
      return stageOf(prop, ctx.page).pct;
    }
    case "value": {
      // 選択肢に付けた数（選択肢の「⋯」で決める）。付けていない選択肢・空なら空
      need(1);
      const a = args[0];
      const prop = a.k === "ref" ? ctx.database.props.find((p) => p.name === a.name) : undefined;
      if (prop?.type !== "select" && prop?.type !== "status" && prop?.type !== "multiselect") throw new FormulaError("数() には {選択の項目} を入れてください");
      const v = ctx.page.values[prop.id];
      const of = (o: unknown) => (typeof o === "string" ? prop.optionValues?.[o] : undefined);
      if (Array.isArray(v)) {
        const ns = v.map(of).filter((x): x is number => typeof x === "number");
        return ns.length ? ns.reduce((x, y) => x + y, 0) : null;
      }
      return of(v) ?? null;
    }
  }
  throw new FormulaError(`「${name}」という関数はありません`);
}

function ev(ctx: Ctx, n: Node): Val {
  switch (n.k) {
    case "num":
      return n.v;
    case "str":
      return n.v;
    case "ref":
      return refValue(ctx, n.name);
    case "call":
      return call(ctx, n.name, n.args);
    case "un": {
      const a = ev(ctx, n.a);
      return n.op === "!" ? !truthy(a) : isEmptyVal(a) ? null : -num(a);
    }
    case "bin": {
      if (n.op === "&&") return truthy(ev(ctx, n.a)) && truthy(ev(ctx, n.b));
      if (n.op === "||") return truthy(ev(ctx, n.a)) || truthy(ev(ctx, n.b));
      const a = ev(ctx, n.a);
      const b = ev(ctx, n.b);
      switch (n.op) {
        case "+":
          if (a instanceof FDate || b instanceof FDate) {
            const d = a instanceof FDate ? a : (b as FDate);
            const other = a instanceof FDate ? b : a;
            if (other instanceof FDate) throw new FormulaError("日付どうしは足せません");
            return isEmptyVal(other) ? d : new FDate(addDays(d.ymd, Math.trunc(num(other))));
          }
          if (typeof a === "string" || typeof b === "string") return str(a) + str(b);
          if (a === null && b === null) return null;
          return num(a) + num(b);
        case "-":
          if (a instanceof FDate && b instanceof FDate) return daysBetween(b.ymd, a.ymd);
          if (a instanceof FDate) return isEmptyVal(b) ? a : new FDate(addDays(a.ymd, -Math.trunc(num(b))));
          // 日付が空なら、日付の計算は空にする（{納期} - 今日() で納期が空のとき）
          if (b instanceof FDate || (a === null && b === null)) return null;
          return num(a) - num(b);
        // かけ算・割り算は、どちらかが空なら空（依頼料が空のページの手取りは空）。足し算・引き算は、片方が空なら 0 とみなす
        case "*":
          return isEmptyVal(a) || isEmptyVal(b) ? null : num(a) * num(b);
        case "/": {
          if (isEmptyVal(a) || isEmptyVal(b)) return null;
          const d = num(b);
          if (d === 0) throw new FormulaError("0 で割れません");
          return num(a) / d;
        }
        case "%": {
          const d = num(b);
          if (d === 0) throw new FormulaError("0 で割れません");
          return num(a) % d;
        }
        case "==":
        case "!=": {
          const same = a instanceof FDate || b instanceof FDate ? str(a) === str(b) : typeof a === "number" || typeof b === "number" ? !isEmptyVal(a) && !isEmptyVal(b) && num(a) === num(b) : str(a) === str(b);
          return n.op === "==" ? same : !same;
        }
        default: {
          // 大きい・小さい：数どうしは数で、日付は日付で、ほかは文字で比べる
          if (isEmptyVal(a) || isEmptyVal(b)) return false;
          const [x, y] = a instanceof FDate || b instanceof FDate ? [date(a)!.ymd, date(b)!.ymd] : typeof a === "number" || typeof b === "number" ? [num(a), num(b)] : [str(a), str(b)];
          return n.op === ">" ? x > y : n.op === "<" ? x < y : n.op === ">=" ? x >= y : x <= y;
        }
      }
    }
  }
}

function run(prop: Property, ctx: Ctx): Val {
  const src = prop.formula?.trim();
  if (!src) return null;
  return ev(ctx, parseCached(src));
}

/** 計算した値（数・文字・真偽・日付は "YYYY-MM-DD"）。式が空・計算できないときは null と、その理由 */
export function evalFormula(database: Database, page: Pick<DbPage, "title" | "values">, prop: Property): { value: number | string | boolean | null; error?: string } {
  try {
    const v = run(prop, { database, page, seen: new Set([prop.id]) });
    if (v instanceof FDate) return { value: v.ymd };
    if (typeof v === "number") return Number.isFinite(v) ? { value: Math.round(v * 1e10) / 1e10 } : { value: null, error: "計算できない数になりました" };
    return { value: v };
  } catch (e) {
    return { value: null, error: e instanceof FormulaError ? e.message : "計算できません" };
  }
}

/** ページの値に、数式の項目の計算した値を入れたもの（保存はしない）。ビューの絞り込み・並び替え・表示はこれを使う */
export function withFormulas<T extends Pick<DbPage, "title" | "values">>(database: Database | null | undefined, pages: T[]): T[] {
  const formulas = database?.props.filter((p) => p.type === "formula" && p.formula?.trim()) ?? [];
  if (!database || !formulas.length) return pages;
  return pages.map((pg) => {
    const values = { ...pg.values };
    for (const f of formulas) values[f.id] = evalFormula(database, pg, f).value;
    return { ...pg, values };
  });
}

// ---- 出す値の種類 ----

/** 数式が出す値の種類（式から読み取る。分からなければ unknown） */
export type FormulaKind = "number" | "text" | "date" | "bool" | "unknown";

function kindOf(props: Property[], n: Node, seen: Set<string>): FormulaKind {
  switch (n.k) {
    case "num":
      return "number";
    case "str":
      return "text";
    case "ref": {
      const p = props.find((x) => x.name === n.name);
      if (!p) return "unknown";
      if (p.type === "formula") return seen.has(p.id) ? "unknown" : kindOfProp(props, p, new Set([...seen, p.id]));
      if (p.type === "number" || p.type === "media" || p.type === "serial") return "number";
      if (p.type === "date" || p.type === "created" || p.type === "edited") return "date";
      if (p.type === "checkbox") return "bool";
      if (p.type === "chat" || p.type === "imageChat") return "unknown";
      return "text";
    }
    case "call": {
      // もし() は合うときの値（分からなければ合わないときの値）、ほかは関数の表の種類
      if (n.name === "if") {
        const a = n.args[1] ? kindOf(props, n.args[1], seen) : "unknown";
        return a !== "unknown" ? a : n.args[2] ? kindOf(props, n.args[2], seen) : "unknown";
      }
      return FUNCTIONS.find((f) => f.en === n.name)?.kind ?? "unknown";
    }
    case "un":
      return n.op === "!" ? "bool" : "number";
    case "bin": {
      if (!["+", "-", "*", "/", "%"].includes(n.op)) return "bool";
      const a = kindOf(props, n.a, seen);
      const b = kindOf(props, n.b, seen);
      if (n.op === "+") return a === "date" || b === "date" ? "date" : a === "text" || b === "text" ? "text" : "number";
      if (n.op === "-") return a === "date" && b !== "date" ? "date" : "number";
      return "number";
    }
  }
}

function kindOfProp(props: Property[], prop: Property, seen: Set<string>): FormulaKind {
  const src = prop.formula?.trim();
  if (!src) return "unknown";
  try {
    return kindOf(props, parseCached(src), seen);
  } catch {
    return "unknown";
  }
}

/** 数式の項目が出す値の種類 */
export const formulaKind = (database: Pick<Database, "props">, prop: Property): FormulaKind => kindOfProp(database.props, prop, new Set([prop.id]));

/**
 * 値の種類で見た項目の種類。数式は、出す値で日付・数値・チェックボックス・テキストのどれかにする（ほかの項目はそのまま）。
 * フィルターの条件・表の計算・日付や数を選ぶ場所で、数式を日付や数の項目と同じに扱うのに使う
 */
export function valueTypeOf(database: Pick<Database, "props">, prop: Property): PropType {
  if (prop.type !== "formula") return prop.type;
  const k = formulaKind(database, prop);
  return k === "date" ? "date" : k === "number" ? "number" : k === "bool" ? "checkbox" : "text";
}

/** 値の種類で見た項目（数式なら、種類を出す値のものにした写し。表示の決まり format はそのまま） */
export const asValueProp = (database: Pick<Database, "props">, prop: Property): Property => (prop.type === "formula" ? { ...prop, type: valueTypeOf(database, prop) } : prop);

/** 日付として使える項目（日付の項目と、日付を出す数式） */
export const isDateLike = (database: Pick<Database, "props">, prop: Property) => valueTypeOf(database, prop) === "date";

/** 数として使える項目（数値の項目と、数を出す数式） */
export const isNumberLike = (database: Pick<Database, "props">, prop: Property) => valueTypeOf(database, prop) === "number";

/** 項目の名前を変えたとき、ほかの数式の中の {前の名前} を {新しい名前} にする */
export function renameInFormula(formula: string, from: string, to: string) {
  return formula.replace(/[{｛]\s*([^}｝]*?)\s*[}｝]/g, (m, name: string) => (name === from ? `{${to}}` : m));
}

// ---- かんたん（選んで作る）----

export type SimpleOp = "+" | "-" | "*" | "/" | "days";
export type SimpleFormula = { a: string; op: SimpleOp; b: { kind: "prop"; name: string } | { kind: "num"; value: string } | { kind: "today" } };

/** かんたんで選んだものから、式を作る */
export function simpleToFormula(s: SimpleFormula): string {
  const b = s.b.kind === "prop" ? `{${s.b.name}}` : s.b.kind === "today" ? "今日()" : s.b.value || "0";
  if (s.op === "days") return `日数({${s.a}}, ${b})`;
  return `{${s.a}} ${s.op} ${b}`;
}

/** 式が、かんたんで作れる形なら、その中身（違えば null） */
export function formulaToSimple(formula: string): SimpleFormula | null {
  const f = formula.trim();
  const operand = (x: string): SimpleFormula["b"] | null => {
    let m = /^\{([^}]+)\}$/.exec(x);
    if (m) return { kind: "prop", name: m[1].trim() };
    if (/^(今日|today)\(\)$/i.test(x)) return { kind: "today" };
    m = /^-?\d+(\.\d+)?$/.exec(x);
    return m ? { kind: "num", value: x } : null;
  };
  let m = /^(?:日数|days)\(\s*\{([^}]+)\}\s*,\s*(.+?)\s*\)$/i.exec(f);
  if (m) {
    const b = operand(m[2]);
    return b ? { a: m[1].trim(), op: "days", b } : null;
  }
  m = /^\{([^}]+)\}\s*([+\-*/])\s*(.+)$/.exec(f);
  if (m) {
    const b = operand(m[3].trim());
    return b ? { a: m[1].trim(), op: m[2] as SimpleOp, b } : null;
  }
  return null;
}
