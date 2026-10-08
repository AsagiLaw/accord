"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { choose, toast } from "@/components/ui/overlay";
import type { Library } from "@/lib/local/db";
import { organize } from "@/lib/local/media";
import { chain, childrenOf, coverOf, descendants } from "@/lib/media/logic";
import { newLibraryFlow } from "./flows";
import { CoverCard } from "./LibraryCard";
import { useMediaState } from "./MediaContext";
import { ThumbImage } from "./Thumb";

/**
 * 「整理」：選んだ画像を入れるライブラリーを選ぶ（複数可）。
 * すでに全部の画像が入っているライブラリーは選択済みで始まり、外すとそこから出る。
 * ▽で小ライブラリーの段を開いていける。
 */
export function OrganizeDialog({ ids }: { ids: string[] }) {
  const { libs, media, byId, roomId, setOrganizing, setSelected } = useMediaState();
  const items = ids.map((id) => byId.get(id)).filter((m) => m !== undefined);
  const [before] = useState(() => libs.map((l) => l.id).filter((id) => items.length > 0 && items.every((m) => m.libIds.includes(id))));
  const [chosen, setChosen] = useState<string[]>(before);
  // 開いている段：最初は、選択済みの一番深い小ライブラリーが見えるところまで
  const [open, setOpen] = useState<string[]>(() => {
    const deepest = libs.filter((l) => before.includes(l.id) && l.parentId).sort((a, b) => chain(libs, b.id).length - chain(libs, a.id).length)[0];
    return deepest ? chain(libs, deepest.id).slice(0, -1).map((l) => l.id) : [];
  });
  const changed = chosen.length !== before.length || chosen.some((x) => !before.includes(x));

  const close = () => setOrganizing(null);

  const toggle = async (lib: Library) => {
    if (!chosen.includes(lib.id)) {
      setChosen([...chosen, lib.id]);
      return;
    }
    // もともと入っていたライブラリーを外すと、その小ライブラリーからも外れる
    const affected = descendants(libs, lib.id)
      .filter((x) => x !== lib.id && items.some((m) => m.libIds.includes(x)))
      .map((x) => libs.find((l) => l.id === x)!)
      .filter(Boolean);
    if (before.includes(lib.id) && affected.length) {
      const i = await choose(`「${lib.name}」から外します`, [{ label: "外す", detail: `「${lib.name}」と、その小ライブラリーから画像を外します`, danger: true }], `「${affected.map((l) => l.name).join("」「")}」からも外れますが、よろしいですか？`);
      if (i !== 0) return;
      const drop = [lib.id, ...affected.map((l) => l.id)];
      setChosen(chosen.filter((x) => !drop.includes(x)));
      return;
    }
    setChosen(chosen.filter((x) => x !== lib.id));
  };

  const addLib = async (parent: Library | null) => {
    const lib = await newLibraryFlow(roomId, parent?.id ?? null, parent?.name);
    if (lib) setChosen((c) => [...c, lib.id]);
  };

  const card = (lib: Library, depth: number) => {
    const on = chosen.includes(lib.id);
    const expanded = open[depth] === lib.id;
    return (
      <div key={lib.id} className="w-36 shrink-0">
        <CoverCard name={lib.name} covers={coverOf(media, lib)} active={on} onClick={() => toggle(lib)}>
          <span
            aria-hidden
            className={`pointer-events-none absolute top-3 right-3 grid h-6 w-6 place-items-center rounded-full border-2 ${on ? "border-accent bg-accent text-accent-ink" : "border-white bg-black/30"}`}
          >
            {on && <Icon name="ok" size={14} />}
          </span>
          <button
            aria-label={`「${lib.name}」の小ライブラリーを${expanded ? "閉じる" : "開く"}`}
            aria-expanded={expanded}
            onClick={() => setOpen(expanded ? open.slice(0, depth) : [...open.slice(0, depth), lib.id])}
            className="absolute right-2 bottom-1 grid h-8 w-8 place-items-center rounded-full hover:bg-tint"
          >
            <Icon name="dn" className={`transition ${expanded ? "rotate-180" : ""}`} />
          </button>
        </CoverCard>
      </div>
    );
  };

  const newCard = (parent: Library | null) => (
    <button
      onClick={() => addLib(parent)}
      className="grid aspect-[3/2] w-36 shrink-0 place-items-center self-start rounded-[12px] border border-dashed border-line text-sm text-muted hover:bg-tint"
    >
      <span className="grid place-items-center">
        <Icon name="add" size={22} />
        {parent ? "小ライブラリーを作る" : "ライブラリーを作る"}
      </span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/50 sm:items-center" onClick={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="画像を整理" className="flex max-h-[92dvh] w-full max-w-3xl flex-col rounded-t-[20px] border border-line bg-card sm:rounded-[14px]">
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h3 className="font-bold">画像を整理（{items.length}枚）</h3>
          <div className="flex gap-2">
            <button className="btn-sub" onClick={close}>
              キャンセル
            </button>
            <button
              className="btn"
              disabled={!changed}
              onClick={async () => {
                const undo = await organize(roomId, ids, chosen, before);
                close();
                setSelected([]);
                toast(`${items.length}枚を整理しました`, { label: "元に戻す", run: () => void undo() });
              }}
            >
              完了
            </button>
          </div>
        </div>
        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {items.map((m) => (
              <div key={m.id} className="h-16 w-16 shrink-0 overflow-hidden rounded-md">
                <ThumbImage id={m.id} alt={m.name} />
              </div>
            ))}
          </div>
          <p className="text-sm text-muted">入れるライブラリーを選んでください（いくつでも）。▽で小ライブラリーを開けます。</p>
          <Row>
            {childrenOf(libs, null).map((l) => card(l, 0))}
            {newCard(null)}
          </Row>
          {open.map((id, depth) => {
            const lib = libs.find((l) => l.id === id);
            if (!lib) return null;
            return (
              <div key={id}>
                <p className="mb-1 text-sm text-muted">「{lib.name}」の小ライブラリー</p>
                <Row>
                  {childrenOf(libs, id).map((l) => card(l, depth + 1))}
                  {newCard(lib)}
                </Row>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex gap-2 overflow-x-auto pb-1"
      onWheel={(e) => {
        // マウスのホイールでも横に送れるようにする
        const el = e.currentTarget;
        if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
      }}
    >
      {children}
    </div>
  );
}
