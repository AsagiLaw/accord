"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { MenuItem, Popover, usePopover } from "@/components/ui/Popover";

export type Crumb = { key: string; label: string; href: string };

const SEP = 18; // 区切りの「›」と間隔の幅
const MORE = 30; // 「«」ボタンの幅

/**
 * Windows のフォルダのような場所の表示。幅が足りないときは、左（上の階層）から「«」の中にしまい、
 * 押すと、しまった場所を選べる。今開いているもの（current）は最後まで残す
 */
export function Breadcrumbs({
  items,
  current,
  currentLabel,
  onNavigate,
}: {
  /** 今開いているものより前の場所（上の階層から順に） */
  items: Crumb[];
  current: React.ReactNode;
  /** 幅を測るための、今開いているものの名前 */
  currentLabel: string;
  /** 場所を押したとき（画像の拡大を閉じるなど） */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const more = usePopover();
  const box = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(0);

  // 並べられる幅と、それぞれの名前の幅から、左からいくつしまうかを決める
  useEffect(() => {
    const el = box.current;
    const m = measure.current;
    if (!el || !m) return;
    const fit = () => {
      const widths = [...m.children].map((c) => (c as HTMLElement).offsetWidth);
      const cur = widths.pop() ?? 0;
      const room = el.clientWidth;
      let h = 0;
      const rest = (from: number) =>
        widths.slice(from).reduce((a, w) => a + w + SEP, 0);
      while (h < widths.length && rest(h) + cur + (h ? MORE : 0) > room) h++;
      setHidden(h);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    ro.observe(m);
    return () => ro.disconnect();
  }, []);

  const shown = items.slice(hidden);
  const sep = <Icon name="rt" size={14} className="shrink-0 text-muted" />;

  return (
    <div
      ref={box}
      className="relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
    >
      {/* 幅を測るための見えない写し */}
      <div
        ref={measure}
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 flex whitespace-nowrap"
      >
        {items.map((c) => (
          <span key={c.key}>{c.label}</span>
        ))}
        <b className="px-1">{currentLabel}</b>
      </div>

      {hidden > 0 && (
        <>
          <button
            type="button"
            aria-label="上の階層を選ぶ"
            title="上の階層を選ぶ"
            aria-expanded={!!more.anchor}
            onClick={more.toggle}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] text-muted hover:bg-tint hover:text-ink"
          >
            «
          </button>
          <Popover
            anchor={more.anchor}
            onClose={more.close}
            width={240}
            label="上の階層"
          >
            {items.slice(0, hidden).map((c, i) => (
              // 下の階層ほど右へずらして、階層が分かるようにする
              <MenuItem
                key={c.key}
                onClick={() => {
                  more.close();
                  onNavigate?.();
                  router.push(c.href);
                }}
              >
                <span
                  className="flex items-center gap-1.5"
                  style={{ paddingLeft: i * 12 }}
                >
                  <Icon
                    name={i ? "folder" : "img"}
                    size={14}
                    className="shrink-0 text-muted"
                  />
                  {c.label}
                </span>
              </MenuItem>
            ))}
          </Popover>
        </>
      )}
      {shown.map((c, i) => (
        <span key={c.key} className="flex shrink-0 items-center gap-1">
          {(i > 0 || hidden > 0) && sep}
          <Link
            href={c.href}
            onClick={onNavigate}
            className="whitespace-nowrap text-muted hover:text-ink"
          >
            {c.label}
          </Link>
        </span>
      ))}
      {/* 今開いているもの：すべてしまっても入りきらないときだけ省略する */}
      <span className="flex min-w-0 items-center gap-1">
        {(shown.length > 0 || hidden > 0) && sep}
        {current}
      </span>
    </div>
  );
}
