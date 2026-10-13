"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { ImageViewer } from "@/components/ImageViewer";
import { ThumbImage } from "@/components/ThumbImage";
import { PopupDialog } from "@/components/ui/Dialog";
import type { Media } from "@/lib/local/db";
import { useChatSentMedia } from "@/lib/local/media";

/** チャットの上のバーに置くフォルダのボタン。押すと、そのチャットで送られた画像の一覧を出す */
export function ChatImagesButton({ chatId, roomId }: { chatId: string; roomId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-name="チャットの画像"
        aria-label="このチャットで送られた画像"
        title="このチャットで送られた画像"
        onClick={() => setOpen(true)}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-muted hover:bg-tint hover:text-ink"
      >
        <Icon name="folder" size={18} />
      </button>
      {open && <ChatImagesDialog chatId={chatId} roomId={roomId} onClose={() => setOpen(false)} />}
    </>
  );
}

/** そのチャットで送られた画像（新しい順）。押すと大きく見られる */
function ChatImagesDialog({ chatId, roomId, onClose }: { chatId: string; roomId: string; onClose: () => void }) {
  const sent = useChatSentMedia(chatId);
  const [viewer, setViewer] = useState<{ items: Media[]; start: number } | null>(null);
  const items = sent?.map((s) => s.media) ?? [];
  return (
    <PopupDialog title={`このチャットで送られた画像${sent ? `（${sent.length}）` : ""}`} onClose={onClose} width="max-w-3xl">
      {!sent ? (
        <p className="text-muted">読み込み中…</p>
      ) : sent.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
          {sent.map((s, i) => (
            <figure key={s.media.id} className="min-w-0">
              <button
                onClick={() => setViewer({ items, start: i })}
                aria-label={`画像を開く：${s.media.name}`}
                className="block aspect-square w-full overflow-hidden rounded-[10px] border border-line"
              >
                <ThumbImage id={s.media.id} alt={s.media.name} />
              </button>
              <figcaption className="mt-1 truncate px-0.5 text-xs text-muted" title={new Date(s.at).toLocaleString("ja-JP")}>
                {s.by}・{new Date(s.at).toLocaleDateString("ja-JP")}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted">このチャットで送られた画像はまだありません。</p>
      )}
      {viewer && <ImageViewer items={viewer.items} start={viewer.start} roomId={roomId} onClose={() => setViewer(null)} />}
    </PopupDialog>
  );
}
