import type { Database, DbPage, Property, StageStep } from "@/lib/local/db";
import { addDays, daysBetween, isDate } from "./logic";

// 「工程」の項目の計算。プラン（basedOn の選択肢）ごとに工程の並びが変わる

/** 割合から、工程ごとの％（share：その工程の分）と進み具合（pct：その工程まで終わったときの％）を出す。
 * 合計がいくつでもよい（下書き 1・清書 4 なら 20%・80%、進み具合は 20%・100%）。合計が 0 なら同じ割合とみなす */
export function withPct(list: StageStep[]): (StageStep & { share: number; pct: number })[] {
  const ws = list.map((s) => Math.max(0, Number(s.weight) || 0));
  const sum = ws.reduce((a, b) => a + b, 0);
  const total = sum > 0 ? sum : list.length;
  let done = 0;
  return list.map((s, i) => {
    const w = sum > 0 ? ws[i] : 1;
    done += w;
    return { ...s, share: Math.round((w / total) * 100), pct: Math.round((done / total) * 100) };
  });
}

/** そのページで選べる工程の並び（％つき） */
export function stagesFor(prop: Property, page: Pick<DbPage, "values">) {
  const key = prop.basedOn ? String(page.values[prop.basedOn] ?? "") : "";
  return withPct(prop.stages?.[key] ?? []);
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

/** 工程の設定の開始日〜終了日に、各工程の期限を％の位置で割り振る（どちらかが空なら無し） */
export function stageDates(prop: Property, page: DbPage) {
  const start = prop.start ? page.values[prop.start] : undefined;
  const end = prop.end ? page.values[prop.end] : undefined;
  if (!isDate(start) || !isDate(end)) return [];
  const span = daysBetween(start, end);
  const { list, index } = stageOf(prop, page);
  return list.map((s, i) => ({ name: s.name, pct: s.pct, date: addDays(start, Math.round((span * s.pct) / 100)), done: i <= index }));
}
