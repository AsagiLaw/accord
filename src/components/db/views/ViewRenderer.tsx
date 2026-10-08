"use client";

import { applyView, valueOf } from "@/lib/requests/logic";
import { VIEW_TYPES } from "../meta";
import { BoardView } from "./BoardView";
import { CalendarView } from "./CalendarView";
import type { ViewProps } from "./common";
import { GalleryView } from "./GalleryView";
import { ListView } from "./ListView";
import { ProgressView } from "./ProgressView";
import { SummaryView } from "./SummaryView";
import { TableView } from "./TableView";
import { TimelineView } from "./TimelineView";

/** ビューの種類に合わせて表示する。絞り込み・並び替え・検索はここでかける */
export function ViewRenderer(props: Omit<ViewProps, "pages"> & { search?: string }) {
  const q = props.search?.trim().toLowerCase();
  let pages = applyView(props.database, props.allPages, props.view, props.userId);
  // 検索：名前と、文字・選択肢の項目から探す
  if (q) {
    pages = pages.filter((p) =>
      props.database.props.some((prop) => {
        const v = valueOf(p, prop.id);
        return (Array.isArray(v) ? v.join(" ") : String(v ?? "")).toLowerCase().includes(q);
      }),
    );
  }
  const p = { ...props, pages };
  return (
    <div data-name={`ビュー「${props.view.name}」（${VIEW_TYPES[props.view.type].label}）`} className={props.fit ? "flex min-h-0 grow flex-col" : undefined}>
      {body(p)}
    </div>
  );
}

function body(p: ViewProps) {
  switch (p.view.type) {
    case "table":
      return <TableView {...p} />;
    case "board":
      return <BoardView {...p} />;
    case "list":
      return <ListView {...p} />;
    case "gallery":
      return <GalleryView {...p} />;
    case "progress":
      return <ProgressView {...p} />;
    case "timeline":
      return <TimelineView {...p} />;
    case "calendar":
      return <CalendarView {...p} />;
    case "summary":
      return <SummaryView {...p} />;
  }
}
