import type { Media } from "@/lib/local/db";

// 画像の名前を自動で付ける（「20250101_誕生日」「20250101_誕生日_01」の形）ための決まりを、画面から切り離した純粋な関数にしたもの。
// 番号は、同じボックス・同じ制作日・同じタイトルの画像が2枚以上あるときだけ、まとまりごとに 1 から振り、間が空いたら詰める

/** 加わった画像を、まとまりの最後に回すための番号の下駄。振り直すと 1 からの番号になる */
export const APPEND = 1_000_000;

type Ymd = { y: number; m: number; d: number };

/** 日付として読む形。上にあるものほど先に探す */
const PATTERNS: { re: RegExp; ymd: (g: string[]) => Ymd }[] = [
  // 2025年01月01日・2025年1月1日（「日」は無くてもよい。間に空白があってもよい）
  { re: /((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/, ymd: (g) => ({ y: +g[1], m: +g[2], d: +g[3] }) },
  // 令和7年1月1日・平成元年1月8日
  {
    re: /(令和|平成)\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/,
    ymd: (g) => ({ y: (g[1] === "令和" ? 2018 : 1988) + (g[2] === "元" ? 1 : +g[2]), m: +g[3], d: +g[4] }),
  },
  // 2025-01-01・2025_01_01・2025.1.1（区切りは前後で同じもの）
  { re: /(?<!\d)((?:19|20)\d{2})([-_./])(\d{1,2})\2(\d{1,2})(?!\d)/, ymd: (g) => ({ y: +g[1], m: +g[3], d: +g[4] }) },
  // 20250101（カメラの「IMG_20250101_123456」なども）
  { re: /(?<!\d)((?:19|20)\d{2})(\d{2})(\d{2})(?!\d)/, ymd: (g) => ({ y: +g[1], m: +g[2], d: +g[3] }) },
];

/** 区切りとして前後から取り除く文字 */
const SEP = "[-_.\\s　・－＿．–—]";

const isRealDate = ({ y, m, d }: Ymd) => {
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
};

/**
 * 名前の中の日付を探して取り除く。「2025年01月01日-誕生日」なら、日付は 2025/1/1、残りは「誕生日」。
 * 日付が無ければ date は null で、残りは前後の区切りを除いた名前
 */
export function splitDate(text: string): { date: Ymd | null; rest: string } {
  // 全角の数字も読む（文字数は変わらないので、見つけた場所はそのまま元の名前に使える）
  const half = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  for (const p of PATTERNS) {
    const g = p.re.exec(half);
    if (!g) continue;
    const date = p.ymd(g);
    if (!isRealDate(date)) continue;
    return { date, rest: joinAround(text, g.index, g.index + g[0].length) };
  }
  return { date: null, rest: trimSep(text) };
}

/** 日付を抜いた前後をつなぐ。間にあった区切りは1つだけ残す（「IMG_20250101_1234」→「IMG_1234」） */
function joinAround(text: string, start: number, end: number) {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const sepBefore = new RegExp(`${SEP}+$`).exec(before)?.[0] ?? "";
  const sepAfter = new RegExp(`^${SEP}+`).exec(after)?.[0] ?? "";
  const left = before.slice(0, before.length - sepBefore.length);
  const right = after.slice(sepAfter.length);
  const sep = left && right ? (sepBefore || sepAfter).slice(0, 1) : "";
  // 日付だけを囲んでいたかっこ（「誕生日（2025-01-01）」）も消す
  return trimSep((left + sep + right).replace(/[(（[【「]\s*[)）\]】」]/g, ""));
}

const trimSep = (s: string) => s.replace(new RegExp(`^${SEP}+|${SEP}+$`, "g"), "");

/** ファイル名から拡張子を除く（今の画像の名前の付け方と同じ） */
export const stripExt = (fileName: string) => fileName.replace(/\.\w+$/, "");

/** その日の 0 時（端末の時刻で） */
const startOfDay = ({ y, m, d }: Ymd) => new Date(y, m - 1, d).getTime();

const sameDay = (t: number, { y, m, d }: Ymd) => {
  const x = new Date(t);
  return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d;
};

/**
 * 入れる画像の制作日とタイトルを決める。
 * 制作日：フォルダ名の日付 → ファイル名の日付 → 画像の中の撮影日・作成日 → ファイルの更新日時 → 今。
 * 名前の日付には時刻が無いので、画像の記録が同じ日なら、その時刻まで使う（同じ日の中でも制作日の順に並ぶように）。
 * タイトル：フォルダから入れたらフォルダ名、そうでなければファイル名（どちらも日付を除く。フォルダ名が日付だけならファイル名）
 */
export function planImport(input: { fileName: string; folder?: string; embedded: number | null; modified: number | null }) {
  const fromFolder = input.folder ? splitDate(input.folder) : null;
  const fromFile = splitDate(stripExt(input.fileName));
  const named = fromFolder?.date ?? fromFile.date;
  const precise = input.embedded ?? input.modified;
  const madeAt = named ? (precise !== null && sameDay(precise, named) ? precise : startOfDay(named)) : (precise ?? Date.now());
  return { madeAt, title: fromFolder?.rest || fromFile.rest };
}

/** 今ある画像に自動の名前を付けるときの制作日とタイトル。今の名前 → 元のファイル名の順に日付を探す */
export function planExisting(m: Media, recorded: number | null) {
  const fromName = splitDate(m.name);
  const fromFile = splitDate(stripExt(m.fileName));
  const named = fromName.date ?? fromFile.date;
  const precise = m.madeAt ?? recorded;
  const madeAt = named ? (precise != null && sameDay(precise, named) ? precise : startOfDay(named)) : (precise ?? m.createdAt);
  return { madeAt, title: fromName.rest || fromFile.rest };
}

/** 制作日。記録の無い画像（この機能より前に入れたもの）は追加日時 */
export const madeOf = (m: Media) => m.madeAt ?? m.createdAt;

/** 名前に使う日付「20250101」（端末の時刻で） */
export function dayKey(t: number) {
  const x = new Date(t);
  return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, "0")}${String(x.getDate()).padStart(2, "0")}`;
}

/** 番号を振るまとまり（同じ制作日・同じタイトル）の印 */
export const groupKey = (t: number, title: string) => `${dayKey(t)}\n${title}`;

/** 「20250101_誕生日_01」。番号が無ければ「20250101_誕生日」、タイトルが空なら「20250101_01」 */
export function autoName(t: number, title: string, seq?: number) {
  return [dayKey(t), title, seq === undefined ? "" : String(seq).padStart(2, "0")].filter(Boolean).join("_");
}

/**
 * 自動の名前の番号を振り直す。同じ制作日・同じタイトルのまとまりごとに、今の番号の順で 1 から詰める
 * （番号の無いもの・下駄を履いたものは最後に回る）。1枚だけのまとまりは、名前に番号を付けない。
 * 変わる画像だけを返す。ゴミ箱の画像は数えない
 */
export function renumberPlan(rows: Media[]): { id: string; seq: number; name: string }[] {
  const groups = new Map<string, Media[]>();
  for (const m of rows) {
    if (m.title === undefined || m.trashed) continue;
    const key = groupKey(madeOf(m), m.title);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const out: { id: string; seq: number; name: string }[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => (a.seq ?? APPEND) - (b.seq ?? APPEND) || a.createdAt - b.createdAt);
    list.forEach((m, i) => {
      const name = autoName(madeOf(m), m.title!, list.length > 1 ? i + 1 : undefined);
      if (m.seq !== i + 1 || m.name !== name) out.push({ id: m.id, seq: i + 1, name });
    });
  }
  return out;
}
