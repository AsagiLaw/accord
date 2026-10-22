"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/Icon";

type Box = { top: number; left: number; width: number; height: number };

/**
 * チャットのブロックを、メイン画面の中身（上のバーの下・メンバー一覧の左）いっぱいに大きく出す。
 * ブロックはその場に置いたまま、位置だけ画面に固定して重ねる（作り直さないので、読んでいる所や書きかけの文はそのまま）。
 * ref をブロックの外側の要素に付け、expanded のあいだは style を当てる
 */
export function useChatExpand() {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [box, setBox] = useState<Box | null>(null);

  // 大きくしているあいだは、メイン画面の中身の位置と大きさに合わせ続ける（画面の幅やメンバー一覧の開け閉めで変わる）
  useLayoutEffect(() => {
    if (!expanded) return;
    const area = ref.current?.closest<HTMLElement>('[data-name="メイン画面の中身"]') ?? document.querySelector<HTMLElement>('[data-name="メイン画面の中身"]');
    const place = () => {
      // メイン画面の外（ページのポップアップなど）では、画面いっぱい
      const r = area?.getBoundingClientRect() ?? { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    place();
    const ro = area ? new ResizeObserver(place) : null;
    if (area) ro?.observe(area);
    window.addEventListener("resize", place);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [expanded]);

  const style: CSSProperties | undefined = expanded && box ? { position: "fixed", ...box, zIndex: 40 } : undefined;
  return { ref, expanded, style, toggle: () => setExpanded((v) => !v) };
}

/** チャットのブロックの右上の、大きく表示する・元の大きさに戻すボタン */
export function ChatExpandButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  const label = expanded ? "元の大きさに戻す" : "大きく表示";
  return (
    <button
      type="button"
      data-name="チャットを大きく表示"
      aria-label={label}
      aria-pressed={expanded}
      title={label}
      onClick={onClick}
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-tint hover:text-ink ${expanded ? "text-accent" : "text-muted"}`}
    >
      <Icon name={expanded ? "fullscreenExit" : "fullscreen"} size={16} />
    </button>
  );
}
