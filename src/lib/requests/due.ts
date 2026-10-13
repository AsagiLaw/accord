import type { Database, DbPage, Property } from "@/lib/local/db";
import { daysBetween, isDate, today } from "./logic";
import { stageOf } from "./stages";
import { isDateLike } from "./formula";
import { statusGroupOf } from "./props";

// 納期のお知らせ：データベースごとに「どの日付を納期にするか」と「何日前から近いとするか」を決め、
// 終わっていないページの名前の横に印を出す（ブラウザの通知も同じ決まりで出す）

/** 名前から納期の項目を選ぶときの言葉 */
const DUE_NAME = /納期|締切|締め切り|〆切|期限/;

/** 納期のお知らせに使える項目（日付と、日付を出す数式） */
export const canBeDue = (database: Pick<Database, "props">, p: Property) => isDateLike(database, p);

/** 納期の項目。決めていなければ、名前（納期・締切・期限）から自動で選ぶ。「お知らせしない」にしていれば無し */
export function dueProp(database: Pick<Database, "props" | "dueProp">): Property | undefined {
  if (database.dueProp === null) return undefined;
  if (database.dueProp) return database.props.find((p) => p.id === database.dueProp && canBeDue(database, p));
  return database.props.find((p) => p.type === "date" && DUE_NAME.test(p.name));
}

/** 何日前から「近い」とするか */
export const dueDaysOf = (database: Pick<Database, "dueDays">) => database.dueDays ?? 3;

/** 終わったページか：ステータスが「完了」のグループ、または工程が最後（100%）まで進んだ */
export function isPageDone(database: Pick<Database, "props">, page: Pick<DbPage, "values">) {
  return database.props.some((p) => {
    const v = page.values[p.id];
    if (p.type === "status") return typeof v === "string" && !!v && statusGroupOf(p, v) === "done";
    if (p.type === "stage") {
      const st = stageOf(p, page);
      return !!st.current && st.pct >= 100;
    }
    return false;
  });
}

export type DueState = { date: string; days: number; tone: "late" | "today" | "soon" };

/** ページの納期の様子。納期が近い・今日・過ぎたときだけ返す（終わったページ・納期が遠い・空のときは null） */
export function dueStatus(database: Pick<Database, "props" | "dueProp" | "dueDays">, page: Pick<DbPage, "values">): DueState | null {
  const prop = dueProp(database);
  const v = prop ? page.values[prop.id] : undefined;
  if (typeof v !== "string" || !isDate(v.slice(0, 10)) || isPageDone(database, page)) return null;
  const date = v.slice(0, 10);
  const days = daysBetween(today(), date);
  if (days < 0) return { date, days, tone: "late" };
  if (days === 0) return { date, days, tone: "today" };
  return days <= dueDaysOf(database) ? { date, days, tone: "soon" } : null;
}

/** 印の文字（3日超過・今日まで・あと2日） */
export const dueText = (s: DueState) => (s.tone === "late" ? `${-s.days}日超過` : s.tone === "today" ? "今日まで" : `あと${s.days}日`);
