"use client";

import { createPortal } from "react-dom";
import { Icon } from "@/components/Icon";

/**
 * 見るためのポップアップ（オールビューの「すべて見る」、カレンダーのその日の予定など）。
 * 画面の真ん中（スマホでは下から）に出し、右上の「×」か、まわりの暗いところを押すと閉じる
 */
/** note：見出しの説明。いつもは出さず、見出しにカーソルを乗せてしばらくすると出す */
export function PopupDialog({ title, onClose, children, width = "max-w-5xl", note }: { title: string; onClose: () => void; children: React.ReactNode; width?: string; note?: string }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="sheet-backdrop fixed inset-0 z-[56] flex items-end justify-center bg-black/50 sm:items-center" onClick={(e) => e.target === e.currentTarget && onClose()} data-overlay="">
      <div role="dialog" aria-modal="true" aria-label={title} className={`flex max-h-[92dvh] w-full ${width} flex-col rounded-t-[20px] border border-line bg-card sm:rounded-[14px]`}>
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h3 className="font-bold" title={note}>
            {title}
          </h3>
          <button className="grid h-8 w-8 place-items-center rounded-full hover:bg-tint" aria-label="閉じる" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
