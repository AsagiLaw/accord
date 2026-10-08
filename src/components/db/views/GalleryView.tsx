"use client";

import Link from "next/link";
import { IconMark } from "@/components/IconMark";
import { ThumbImage } from "@/components/ThumbImage";
import { valueOf } from "@/lib/requests/logic";
import { visibleProps } from "../editors";
import { PropValue } from "../values";
import { Empty, PageName, pageHref, type ViewProps } from "./common";

/** 画像をカードで並べる。表紙はメディアの項目の1枚目 */
export function GalleryView({ database, view, pages, members, compact }: ViewProps) {
  const cover = database.props.find((p) => p.id === view.options.cover) ?? database.props.find((p) => p.type === "media");
  const shown = visibleProps(database, view);
  if (!pages.length) return <Empty>該当するものはありません</Empty>;

  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-[repeat(auto-fill,minmax(160px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(220px,1fr))]"}`}>
      {pages.map((p) => {
        const images = cover ? valueOf(p, cover.id) : undefined;
        const first = Array.isArray(images) ? (images[0] as string | undefined) : undefined;
        return (
          <Link key={p.id} href={pageHref(database, p.id)} className="overflow-hidden rounded-[12px] border border-line bg-card hover:bg-tint">
            <div className="grid aspect-[4/3] place-items-center bg-line/30 text-4xl">{first ? <ThumbImage id={first} alt="" /> : (p.icon ? <IconMark icon={p.icon} /> : <span className="text-sm text-muted">画像なし</span>)}</div>
            <div className="space-y-1 p-2.5">
              <PageName database={database} page={p} className="font-bold" />
              {shown
                .filter((sp) => sp.id !== cover?.id)
                .map((sp) => {
                  const v = valueOf(p, sp.id);
                  return v === undefined || v === "" || v === null ? null : (
                    <div key={sp.id} className="text-sm">
                      <PropValue prop={sp} value={v} members={members} page={p} />
                    </div>
                  );
                })}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
