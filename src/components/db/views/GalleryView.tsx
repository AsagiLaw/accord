"use client";

import { IconMark } from "@/components/IconMark";
import { ThumbImage } from "@/components/ThumbImage";
import type { DbPage } from "@/lib/local/db";
import { valueOf } from "@/lib/requests/logic";
import { visibleProps } from "../editors";
import { PropValue } from "../values";
import { Empty, PageName, type ViewProps } from "./common";
import { PageLink as PeekLink } from "../PageLink";
import { GroupHead, colorHueOf, groupPages, groupPropOf, groupSumText, useCollapsed } from "./groups";

/** カードの大きさ（並べる幅の最小、px）。狭い場所（compact）では小さめ */
const CARD_W = { s: 150, m: 220, l: 320 } as const;

/**
 * 画像をカードで並べる。表紙はメディアの項目の1枚目。
 * カードの大きさ（小・中・大）と画像の収め方（切り抜く・全体を見せる）はビューの設定で。グループ分け・色分け（カードの上の線）もできる
 */
export function GalleryView({ database, view, pages, members, compact }: ViewProps) {
  const cover = database.props.find((p) => p.id === view.options.cover) ?? database.props.find((p) => p.type === "media");
  const shown = visibleProps(database, view);
  const group = groupPropOf(database, view);
  const collapsed = useCollapsed();
  if (!pages.length) return <Empty>該当するものはありません</Empty>;
  const min = Math.round(CARD_W[view.options.cardSize ?? "m"] * (compact ? 0.75 : 1));
  const contain = view.options.imageFit === "contain";

  const card = (p: DbPage) => {
    const images = cover ? valueOf(p, cover.id) : undefined;
    const first = Array.isArray(images) ? (images[0] as string | undefined) : undefined;
    const hue = colorHueOf(database, view, p);
    return (
      <PeekLink key={p.id} database={database} pageId={p.id} className="overflow-hidden rounded-[12px] border border-line bg-card hover:bg-tint" style={hue ? { borderTop: `4px solid ${hue}` } : undefined}>
        <div className="grid aspect-[4/3] place-items-center bg-line/30 text-4xl">
          {first ? <ThumbImage id={first} alt="" className={contain ? "object-contain" : undefined} /> : p.icon ? <IconMark icon={p.icon} /> : <span className="text-sm text-muted">画像なし</span>}
        </div>
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
      </PeekLink>
    );
  };
  const grid = (list: DbPage[]) => (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}>
      {list.map(card)}
    </div>
  );

  if (!group) return grid(pages);
  return (
    <div className="space-y-3">
      {groupPages(group, pages, view, members).map((g) => (
        <section key={g.key || "__none"} className="space-y-1.5">
          <GroupHead group={g} sum={groupSumText(database, view, g.pages)} collapsed={collapsed.isClosed(g.key)} onToggle={() => collapsed.toggle(g.key)} />
          {!collapsed.isClosed(g.key) && grid(g.pages)}
        </section>
      ))}
    </div>
  );
}
