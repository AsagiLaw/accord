"use client";

import { useEffect } from "react";
import { Icon } from "@/components/Icon";

/**
 * 画面の真ん中に重ねるポップアップの枠（別ページ・ノート・ウィンドウのポップアップで使う。ページのポップアップの上にも重なる）。
 * 上のバーに head（名前と、編集・拡大などのボタン）と「閉じる」。まわりを押すか Esc で閉じる
 */
export function PeekFrame({ name, label, head, onClose, children }: { name: string; label: string; head: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  // Esc で閉じる。下にページのポップアップがあっても、こちらだけ閉じる（先に受けて、処理済みにする）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.isContentEditable || t?.closest("input,textarea,select,[role=menu],[role=dialog][data-overlay]")) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[47] flex animate-[fade_.15s] items-center justify-center bg-black/40 p-[clamp(8px,4vw,48px)]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-name={name}
    >
      <div role="dialog" aria-modal="true" aria-label={label} className="flex h-full max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-[14px] border border-line bg-bg shadow-2xl">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">{head}</div>
          <button className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-tint" aria-label="閉じる" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
