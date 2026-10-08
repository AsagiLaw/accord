"use client";

import { useRef } from "react";
import { Icon } from "@/components/Icon";
import type { Library, Media } from "@/lib/local/db";
import { setFav } from "@/lib/local/media";
import { THUMB_SIZES, repOf } from "@/lib/media/logic";
import { useMediaPrefs } from "@/lib/media/prefs";
import { setRepresentative } from "@/lib/local/media";
import { useMediaState } from "./MediaContext";
import { rememberOpenedFrom } from "./Lightbox";
import { Thumb } from "./Thumb";

/** マウス操作の端末か（タッチ端末では、タップで開き「選択」モードで選ぶ） */
export const isPointerFine = () =>
  typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

export function MediaGrid({
  list,
  selectMode,
  /** ライブラリーを開いているとき：そのライブラリー（印の付け替えに使う） */
  lib,
  empty = "画像がありません",
}: {
  list: Media[];
  selectMode: boolean;
  lib?: Library;
  empty?: string;
}) {
  const { selected, setSelected, setViewing, libs, media } = useMediaState();
  const prefs = useMediaPrefs();
  const anchor = useRef<string | null>(null);
  const ids = list.map((m) => m.id);
  const childReps = lib
    ? libs.filter((l) => l.parentId === lib.id).map((k) => ({ lib: k, rep: repOf(media, k) }))
    : [];
  const parentRep = lib?.parentId ? repOf(media, lib) : undefined;

  // サムネイルの位置を覚えてから開く（そこから拡大して出てくる）
  const open = (id: string) => {
    rememberOpenedFrom(document.querySelector(`[data-media="${id}"] img`));
    setViewing(id, ids);
  };

  const click = (e: React.MouseEvent, id: string) => {
    if (!isPointerFine()) {
      if (selectMode) setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
      else open(id);
      return;
    }
    const multi = e.ctrlKey || e.metaKey;
    if (e.shiftKey && anchor.current && ids.includes(anchor.current)) {
      const a = ids.indexOf(anchor.current);
      const b = ids.indexOf(id);
      const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
      if (a > b) range.reverse();
      setSelected(multi ? [...selected, ...range.filter((x) => !selected.includes(x))] : range);
      return;
    }
    anchor.current = id;
    if (multi) setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else setSelected([id]);
  };

  if (!list.length) return <p className="py-6 text-sm text-muted">{empty}</p>;

  return (
    <div
      data-name="画像一覧"
      className="grid gap-2.5"
      // 画像は選んだ大きさちょうどで並べる（ライブラリーのカードの左の四角と同じ大きさにするため、広げない）
      style={{ gridTemplateColumns: `repeat(auto-fill, ${THUMB_SIZES[prefs.level - 1]}px)` }}
      onClick={(e) => {
        // 何もないところをクリックしたら選択を外す（マウス操作のとき）
        if (e.target === e.currentTarget && isPointerFine()) setSelected([]);
      }}
    >
      {list.map((m) => {
        const usedBy = childReps.filter((c) => c.rep === m.id).map((c) => c.lib.name);
        return (
          <Thumb
            key={m.id}
            m={m}
            selected={selected.includes(m.id)}
            order={selected.length > 1 && selected.includes(m.id) ? selected.indexOf(m.id) + 1 : undefined}
            onClick={(e) => click(e, m.id)}
            onDoubleClick={() => open(m.id)}
            onFav={() => setFav([m.id], !m.fav)}
            extra={
              <>
                {lib?.parentId && (
                  <button
                    title="親ライブラリーで、この小ライブラリーの代表として表示する画像にする"
                    aria-label="代表の画像にする"
                    aria-pressed={parentRep === m.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRepresentative(lib.id, m.id);
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    className={`absolute top-1 right-10 grid h-8 w-8 place-items-center rounded-full bg-black/40 transition ${
                      parentRep === m.id ? "text-accent opacity-100" : "text-white opacity-0 group-hover:opacity-100 focus:opacity-100"
                    }`}
                  >
                    <Icon name="mark" size={16} />
                  </button>
                )}
                {usedBy.length > 0 && (
                  <span
                    title={`小ライブラリー「${usedBy.join("」「")}」の代表`}
                    className="absolute bottom-6 left-1.5 flex items-center gap-0.5 rounded-full bg-accent px-1.5 text-[11px] text-accent-ink"
                  >
                    <Icon name="folder" size={12} />
                    {usedBy.join("、")}
                  </span>
                )}
              </>
            }
          />
        );
      })}
    </div>
  );
}
