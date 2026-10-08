"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * ボタンのそばに出る小さな画面（メニュー・入力など）。
 * 表の中のようにはみ出しが隠れる場所でも切れないよう、body の直下に固定位置で出す。
 */
/** ボタンのそば、または右クリックした位置 */
export type Anchor = HTMLElement | { x: number; y: number };

const rectOf = (a: Anchor) => (a instanceof HTMLElement ? a.getBoundingClientRect() : { left: a.x, right: a.x, top: a.y, bottom: a.y });

export function Popover({
  anchor,
  onClose,
  children,
  width = 280,
  align = "start",
  label,
  nested,
}: {
  anchor: Anchor | null;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  align?: "start" | "end";
  label?: string;
  /** ほかのポップオーバーの中から開くもの（右クリックのメニューなど）。押しても、元のポップオーバーは閉じない */
  nested?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = rectOf(anchor);
      const w = Math.min(width, window.innerWidth - 16);
      let left = align === "end" ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      // 下に入りきらず、上の方が広ければ上に出す
      if (below < 240 && above > below) setPos({ left, top: Math.max(8, r.top - Math.min(above, 480) - 4), maxH: Math.min(above, 480) });
      else setPos({ left, top: r.bottom + 4, maxH: Math.min(below, 520) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, width, align]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // 中のダイアログ（確認・名前入力）や、元のボタン、中から開いたポップオーバーを押したときは閉じない
      if (panel.current?.contains(t) || (anchor instanceof HTMLElement && anchor.contains(t)) || (t as Element).closest?.("[data-overlay], [data-nested-popover]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[data-overlay]")) onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  if (!anchor || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panel}
      role="menu"
      aria-label={label}
      data-nested-popover={nested ? "" : undefined}
      data-name={label ? `${label}（メニュー）` : undefined}
      className="fixed z-[58] overflow-y-auto rounded-[12px] border border-line bg-card p-1.5 text-sm shadow-xl"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: Math.min(width, typeof window !== "undefined" ? window.innerWidth - 16 : width), maxHeight: pos?.maxH }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** ポップオーバーの中の1行のボタン */
export function MenuItem({
  icon,
  children,
  onClick,
  danger,
  active,
  right,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  active?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex min-h-[34px] w-full items-center gap-2 rounded-[8px] px-2 text-left hover:bg-tint ${danger ? "text-warn" : ""} ${active ? "bg-tint font-bold" : ""}`}
    >
      {icon && <span className="grid w-5 shrink-0 place-items-center text-muted">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right}
    </button>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pt-2 pb-1 text-xs text-muted">{children}</div>;
}

export function MenuDivider() {
  return <div className="my-1 h-px bg-line" />;
}

/** ポップオーバーを開くボタンの状態をまとめて持つ */
export function usePopover() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  return {
    anchor,
    open: (e: { currentTarget: HTMLElement }) => setAnchor(e.currentTarget),
    /** 右クリックした位置に出す */
    openAt: (e: { clientX: number; clientY: number; preventDefault: () => void }) => {
      e.preventDefault();
      setAnchor({ x: e.clientX, y: e.clientY });
    },
    toggle: (e: { currentTarget: HTMLElement }) => {
      // 後で読むとイベントの currentTarget は消えているので、先に取っておく
      const el = e.currentTarget;
      setAnchor((a) => (a ? null : el));
    },
    close: () => setAnchor(null),
  };
}
