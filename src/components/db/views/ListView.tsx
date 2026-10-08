"use client";

import Link from "next/link";
import { dueLabel, valueOf } from "@/lib/requests/logic";
import { percentOf, stageOf } from "@/lib/requests/stages";
import { visibleProps } from "../editors";
import { PropValue } from "../values";
import { Empty, Gauge, PageName, pageHref, type ViewProps } from "./common";

/**
 * リスト（Notion のリストと同じ）：1ページを1行にして、左に名前、右に出すプロパティを横に並べる。
 * 出すプロパティは「プロパティの表示/非表示」で選ぶ。ゲージ・期限（リストの設定）も行の右に小さく出す
 */
export function ListView({ database, view, pages, members }: ViewProps) {
  const shown = visibleProps(database, view);
  const gauge = view.options.gauge;
  const gp = database.props.find((x) => x.id === gauge);
  const dateProp = database.props.find((p) => p.id === view.options.date);
  if (!pages.length) return <Empty>該当するものはありません</Empty>;

  return (
    <div className="grid">
      {pages.map((p) => {
        const g = gauge ? percentOf(database, p, gauge) : null;
        const stageNow = gp?.type === "stage" ? stageOf(gp, p).current?.name : undefined;
        const due = dateProp ? dueLabel(valueOf(p, dateProp.id)) : null;
        return (
          <Link key={p.id} href={pageHref(database, p.id)} className="flex min-h-9 items-center gap-3 border-b border-line/70 px-2 py-1.5 last:border-b-0 hover:bg-tint">
            {/* 名前は左。長いときは途中で切る */}
            <PageName database={database} page={p} className="max-w-[55%] shrink-0 font-bold" />
            {/* 出すプロパティは右に横並び。入りきらない分は右から隠れる */}
            <span className="flex min-w-0 flex-1 items-center justify-end gap-3 overflow-hidden text-xs whitespace-nowrap text-muted">
              {shown.map((sp) => (
                <span key={sp.id} className="flex shrink-0 items-center" title={sp.name}>
                  <PropValue prop={sp} value={valueOf(p, sp.id)} members={members} page={p} />
                </span>
              ))}
              {g !== null && (
                <span className="flex shrink-0 items-center gap-1.5" title={gp?.name}>
                  <span className="w-20">
                    <Gauge value={g} />
                  </span>
                  {stageNow ? `${stageNow}・` : ""}
                  {g}%
                </span>
              )}
              {due && <span className={`shrink-0 ${due.tone === "late" ? "font-bold text-warn" : due.tone === "soon" ? "font-bold text-ink" : ""}`}>{due.text}</span>}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
