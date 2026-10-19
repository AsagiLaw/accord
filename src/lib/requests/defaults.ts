import { newId } from "@/lib/id";
import type { Database, DbView, Stage, StageStep } from "@/lib/local/db";
import { standardRequestTemplate } from "@/lib/local/windowLayout";

// 依頼データベースの最初の形。項目は試作「依頼ノート」と同じ

/** 依頼の項目の ID。工程の計算・収入の集計・取り込みで使う */
export const P = {
  title: "title",
  count: "p_n",
  use: "p_use",
  received: "p_recv",
  start: "p_start",
  due: "p_due",
  fee: "p_fee",
  channel: "p_win",
  plan: "p_plan",
  progress: "p_prog",
  stage: "p_stage",
  status: "p_status",
  /** 依頼進行チャット（チャットの項目）・やり取り再現（イメージチャットの項目） */
  chat: "p_chat",
  reenact: "p_reenact",
} as const;

export const DONE = "完了";

/** プランに工程の設定が無いときの工程 */
export const DEFAULT_STAGES: Stage[] = [
  { name: "下書き", ratio: 0.3 },
  { name: "線画", ratio: 0.6 },
  { name: "着色", ratio: 0.85 },
  { name: "納品", ratio: 1 },
];

const ROUGH_STAGES: Stage[] = [
  { name: "ラフ", ratio: 0.2 },
  { name: "下書き", ratio: 0.4 },
  { name: "線画", ratio: 0.65 },
  { name: "着色", ratio: 0.85 },
  { name: "納品", ratio: 1 },
];

export function requestDatabase(roomId: string): { database: Database; views: DbView[] } {
  const id = newId();
  const template = standardRequestTemplate();
  const database: Database = {
    id,
    roomId,
    name: "依頼",
    templates: [template],
    defaultTemplateId: template.id,
    kind: "request",
    props: [
      { id: P.title, name: "依頼者名", type: "title" },
      { id: P.count, name: "依頼枚数", type: "number" },
      { id: P.use, name: "使用用途", type: "text" },
      { id: P.received, name: "依頼受付日", type: "date" },
      { id: P.start, name: "依頼開始日", type: "date" },
      { id: P.due, name: "納期", type: "date" },
      { id: P.fee, name: "依頼料", type: "number", format: "yen" },
      { id: P.channel, name: "依頼窓口", type: "select", options: ["Skeb", "X(DM)"] },
      { id: P.plan, name: "依頼プラン", type: "select", options: ["通常", "ラフ付き"] },
      {
        id: P.stage,
        name: "工程",
        type: "stage",
        basedOn: P.plan,
        start: P.start,
        end: P.due,
        stages: {
          通常: stepsFromRatios(DEFAULT_STAGES),
          ラフ付き: stepsFromRatios(ROUGH_STAGES),
        },
      },
      { id: P.progress, name: "進行", type: "number", format: "percent" },
      { id: P.status, name: "ステータス", type: "status", options: ["進行中", DONE] },
      { id: P.chat, name: "依頼進行チャット", type: "chat" },
      { id: P.reenact, name: "やり取り再現", type: "imageChat", seed: "page" },
    ],
    plans: {
      通常: DEFAULT_STAGES,
      ラフ付き: ROUGH_STAGES,
    },
    order: 1,
    createdAt: Date.now(),
  };
  const notDone = [{ prop: P.status, op: "isNot" as const, value: DONE }];
  const view = (order: number, v: Omit<DbView, "id" | "dbId" | "order">): DbView => ({ id: newId(), dbId: id, order, ...v });
  const views: DbView[] = [
    view(1, { name: "現在の依頼", type: "list", filters: notDone, sort: { prop: P.due, dir: "asc" }, options: { gauge: P.stage, date: P.due } }),
    view(2, { name: "テーブル", type: "table", filters: [], sort: { prop: P.received, dir: "desc" }, options: {} }),
    view(3, { name: "依頼タイムライン", type: "timeline", filters: notDone, sort: { prop: P.due, dir: "asc" }, options: { date: P.stage } }),
    view(4, { name: "カレンダー", type: "calendar", filters: notDone, sort: null, options: { stages: true, stage: P.stage } }),
    view(5, { name: "これまでの収入", type: "summary", filters: [{ prop: P.status, op: "is", value: DONE }], sort: null, options: { sum: P.fee, date: P.due } }),
    view(6, { name: "終了した依頼", type: "table", filters: [{ prop: P.status, op: "is", value: DONE }], sort: { prop: P.due, dir: "desc" }, options: {} }),
  ];
  return { database, views };
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** 「その工程まで終わったら何％か」の並びを、工程ごとの割合にする（差を取り、できるだけ小さな整数にする。例：30・60・85・100 → 6・6・5・3） */
export function stepsFromPcts(list: { name: string; pct: number }[]): StageStep[] {
  const sorted = [...list].sort((a, b) => a.pct - b.pct);
  const diffs = sorted.map((x, i) => Math.max(0, Math.round(x.pct) - (i ? Math.round(sorted[i - 1].pct) : 0)));
  const g = diffs.reduce((a, b) => gcd(a, b), 0) || 1;
  return sorted.map((x, i) => ({ name: x.name, weight: diffs[i] / g }));
}

/** 依頼プランの工程（納期までのどのあたりか）から、工程の項目の割合を作る */
export const stepsFromRatios = (list: Stage[]) => stepsFromPcts(list.map((x) => ({ name: x.name, pct: x.ratio * 100 })));
