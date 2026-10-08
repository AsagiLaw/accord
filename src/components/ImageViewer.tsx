"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Media } from "@/lib/local/db";
import { useBlobUrl } from "@/lib/media/blob-url";

/** チャットなどで添付画像を大きく見る、シンプルな表示画面 */
export function ImageViewer({ items, start, roomId, onClose }: { items: Media[]; start: number; roomId: string; onClose: () => void }) {
  const [i, setI] = useState(start);
  const m = items[i];
  const url = useBlobUrl(m?.id, "original");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
      if (e.key === "ArrowRight") setI((x) => Math.min(items.length - 1, x + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, onClose]);

  if (!m) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={m.name} className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="min-w-0 truncate font-bold">{m.name}</span>
        {items.length > 1 && (
          <span className="shrink-0 text-sm text-white/60">
            {i + 1} / {items.length}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Link href={`/r/${roomId}/media/all`} className="rounded-full px-3 py-1.5 text-sm hover:bg-white/15" onClick={onClose}>
            メディアで見る
          </Link>
          {url && (
            <a href={url} download={m.fileName} aria-label="元の画像を保存" title="元の画像を保存" className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/15">
              <Icon name="download" />
            </a>
          )}
          <button aria-label="閉じる" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/15">
            <Icon name="x" />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {url && (
          // eslint-disable-next-line @next/next/no-img-element -- ブラウザ内の Blob なので next/image は使えない
          <img src={url} alt={m.name} className="absolute inset-0 m-auto max-h-full max-w-full object-contain" />
        )}
        {i > 0 && (
          <button aria-label="前の画像" onClick={() => setI(i - 1)} className="absolute top-1/2 left-2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-black/50 hover:bg-black/80">
            <Icon name="l" size={26} />
          </button>
        )}
        {i < items.length - 1 && (
          <button aria-label="次の画像" onClick={() => setI(i + 1)} className="absolute top-1/2 right-2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-black/50 hover:bg-black/80">
            <Icon name="r" size={26} />
          </button>
        )}
      </div>
    </div>
  );
}
