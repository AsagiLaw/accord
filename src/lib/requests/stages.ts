import type { Database, DbPage, Property, StageStep } from "@/lib/local/db";
import { addDays, daysBetween, isDate } from "./logic";

// 「工程」の項目の計算。プラン（basedOn の選択肢）ごとに工程の並びが変わる

/** そのページで選べる工程の並び */
export function stagesFor(prop: Property, page: Pick<DbPage, "values">): StageStep[] {
  const key = prop.basedOn ? String(page.values[prop.basedOn] ?? "") : "";
  return prop.stages?.[key] ?? [];
}

/** 今の工程と、その％（工程が未選択なら 0） */
export function stageOf(prop: Property, page: Pick<DbPage, "values">) {
  const list = stagesFor(prop, page);
  const name = page.values[prop.id];
  const index = list.findIndex((s) => s.name === name);
  return { list, index, current: index >= 0 ? list[index] : undefined, pct: index >= 0 ? list[index].pct : 0 };
}

/** 進み具合（0〜100）。工程の項目ならその工程の％、数値ならその値 */
export function percentOf(database: Database, page: DbPage, propId: string | undefined): number | null {
  const prop = database.props.find((p) => p.id === propId);
  if (!prop) return null;
  if (prop.type === "stage") return stageOf(prop, page).pct;
  const n = Number(page.values[prop.id]);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

/** 開始日〜終了日に、各工程の期限を％の位置で割り振る */
export function stageDates(prop: Property, page: DbPage, start: unknown, end: unknown) {
  if (!isDate(start) || !isDate(end)) return [];
  const span = daysBetween(start, end);
  const { list, index } = stageOf(prop, page);
  return list.map((s, i) => ({ name: s.name, pct: s.pct, date: addDays(start, Math.round((span * s.pct) / 100)), done: i <= index }));
}
