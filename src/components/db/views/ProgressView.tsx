"use client";

import { percentOf } from "@/lib/requests/stages";
import { stageOf } from "@/lib/requests/stages";
import { CircleGauge, Empty, Gauge, PageName, type ViewProps } from "./common";
import { PageLink as PeekLink } from "../PageLink";

/** 割合ビュー：ページごとの進み具合（工程の％や数値）をゲージで並べる。上に平均と完了の数 */
export function ProgressView({ database, view, pages, compact }: ViewProps) {
  const prop = database.props.find((p) => p.id === view.options.gauge) ?? database.props.find((p) => p.type === "stage") ?? database.props.find((p) => p.format === "percent");
  if (!prop) return <Empty>割合ビューには、「工程」か「数値（％）」の項目が必要です。ビューの設定で選んでください。</Empty>;
  const circle = view.options.gaugeStyle === "circle";
  const values = pages.map((p) => percentOf(database, p, prop.id) ?? 0);
  // 1件も無いときも、0% と 0 / 0 を出す
  const avg = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
  const done = values.filter((v) => v >= 100).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-[14px] border border-line bg-card p-4">
        <CircleGauge value={avg} size={compact ? 64 : 84} label="平均" />
        <div>
          <div className="text-xs text-muted">平均の進み具合（{prop.name}）</div>
          <div className="text-[28px] font-bold">{avg}%</div>
        </div>
        <div>
          <div className="text-xs text-muted">完了</div>
          <div className="text-[28px] font-bold">
            {done}
            <span className="text-base text-muted"> / {pages.length}</span>
          </div>
        </div>
      </div>
      {pages.length > 0 && (
        <div className={circle ? "grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2" : "grid gap-1.5"}>
          {pages.map((p, i) => {
            const v = values[i];
            const stage = prop.type === "stage" ? stageOf(prop, p).current?.name : undefined;
            return circle ? (
              <PeekLink key={p.id} database={database} pageId={p.id} className="grid justify-items-center gap-1.5 rounded-[12px] border border-line bg-card p-3 text-center hover:bg-tint">
                <CircleGauge value={v} size={compact ? 64 : 80} />
                <PageName database={database} page={p} className="max-w-full text-sm font-bold" />
                {stage && <span className="text-xs text-muted">{stage}</span>}
              </PeekLink>
            ) : (
              <PeekLink key={p.id} database={database} pageId={p.id} className="flex items-center gap-3 rounded-[10px] border border-line bg-card px-3 py-2 hover:bg-tint">
                <PageName database={database} page={p} className="w-40 shrink-0 text-sm font-bold" />
                <Gauge value={v} />
                <span className="w-24 shrink-0 text-right text-xs text-muted">
                  {stage ? `${stage}・` : ""}
                  {v}%
                </span>
              </PeekLink>
            );
          })}
        </div>
      )}
    </div>
  );
}
