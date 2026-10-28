"use client";

import { useMemo, useRef, useState } from "react";
import { Popover, type Anchor } from "@/components/ui/Popover";
import { EMOJI_GROUPS, EMOJI_LIST, recentEmoji, rememberEmoji } from "./emoji";

/**
 * 絵文字を選ぶ小さな画面（Discord と同じ）。言葉で探せて、最近使ったものを先頭に出す。
 * 選ぶと onPick。keepOpen なら閉じずに続けて選べる（入力欄に続けて入れるとき。Shift を押しながら選んでも続けて選べる）
 */
export function EmojiPicker({ anchor, onPick, onClose, keepOpen }: { anchor: Anchor | null; onPick: (emoji: string) => void; onClose: () => void; keepOpen?: boolean }) {
  const [q, setQ] = useState("");
  const [recent] = useState(recentEmoji);
  const body = useRef<HTMLDivElement>(null);
  const query = q.trim().toLowerCase();
  const hits = useMemo(() => (query ? EMOJI_LIST.filter((e) => e.words.includes(query) || e.emoji === query) : []), [query]);
  const groups = [{ label: "よく使う", icon: "🕘", items: recent }, ...EMOJI_GROUPS.map((g) => ({ ...g, items: g.items.map((x) => x.split(" ")[0]) }))];

  const pick = (emoji: string, shift: boolean) => {
    rememberEmoji(emoji);
    onPick(emoji);
    if (!keepOpen && !shift) onClose();
  };
  const cell = (emoji: string, key: string) => (
    <button
      key={key}
      type="button"
      onClick={(e) => pick(emoji, e.shiftKey)}
      className="grid h-9 w-9 place-items-center rounded-[8px] text-[22px] leading-none hover:bg-tint"
      aria-label={emoji}
    >
      {emoji}
    </button>
  );

  return (
    <Popover anchor={anchor} onClose={onClose} width={344} label="絵文字">
      <div data-name="絵文字の選択" className="flex flex-col gap-1.5">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits[0]) {
              e.preventDefault();
              pick(hits[0].emoji, e.shiftKey);
            }
          }}
          placeholder="絵文字を探す"
          aria-label="絵文字を探す"
          className="field h-8 py-1 text-sm"
        />
        {!query && (
          <div className="flex gap-0.5 border-b border-line pb-1">
            {groups.map((g, i) => (
              <button
                key={g.label}
                type="button"
                title={g.label}
                aria-label={g.label}
                onClick={() => body.current?.querySelector<HTMLElement>(`[data-group="${i}"]`)?.scrollIntoView({ block: "start" })}
                className="grid h-7 flex-1 place-items-center rounded-[6px] text-base hover:bg-tint"
              >
                {g.icon}
              </button>
            ))}
          </div>
        )}
        <div ref={body} className="h-[264px] overflow-y-auto pr-0.5">
          {query ? (
            hits.length ? (
              <div className="grid grid-cols-8">{hits.map((e, i) => cell(e.emoji, `${e.emoji}-${i}`))}</div>
            ) : (
              <p className="py-8 text-center text-sm text-muted">見つかりません</p>
            )
          ) : (
            groups.map((g, i) => (
              <section key={g.label} data-group={i}>
                <p className="sticky top-0 z-[1] bg-card px-1 pt-1 pb-0.5 text-xs font-bold text-muted">{g.label}</p>
                <div className="grid grid-cols-8">{g.items.map((e) => cell(e, `${g.label}-${e}`))}</div>
              </section>
            ))
          )}
        </div>
      </div>
    </Popover>
  );
}
