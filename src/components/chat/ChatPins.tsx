"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { PopupDialog } from "@/components/ui/Dialog";
import { setPinned, usePinnedMessages } from "@/lib/local/chat";
import { useAllProfiles } from "@/lib/local/rooms";
import { plainText } from "./RichText";
import { jumpToMessage } from "./useMessageWindow";

/**
 * チャットの上のバー（とチャットのブロックの右上）に置くピンのボタン（Discord と同じ）。ピン留めした発言があるときだけ出す。
 * 押すとピン留めした発言の一覧。押すとその発言まで動いて光らせる
 */
export function ChatPinsButton({ chatId, compact }: { chatId: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const pinned = usePinnedMessages(chatId);
  if (!pinned?.length) return null;
  return (
    <>
      <button
        type="button"
        data-name="ピン留めした発言"
        aria-label={`ピン留めした発言（${pinned.length}件）`}
        title={`ピン留めした発言（${pinned.length}件）`}
        onClick={() => setOpen(true)}
        className={`relative grid shrink-0 place-items-center text-muted hover:bg-tint hover:text-ink ${compact ? "h-6 w-6 rounded-full" : "h-7 w-7 rounded-[8px]"}`}
      >
        <Icon name="pin" size={compact ? 15 : 18} />
      </button>
      {open && <ChatPinsDialog chatId={chatId} onClose={() => setOpen(false)} />}
    </>
  );
}

function ChatPinsDialog({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const pinned = usePinnedMessages(chatId);
  const profiles = useAllProfiles();
  const profileOf = (id: string) => profiles?.find((p) => p.id === id);
  return (
    <PopupDialog title="ピン留めした発言" onClose={onClose} width="max-w-lg">
      {!pinned?.length ? (
        <p className="py-8 text-center text-sm text-muted">ピン留めした発言はありません</p>
      ) : (
        <ul className="grid max-h-[60vh] gap-1.5 overflow-y-auto">
          {pinned.map((m) => {
            const p = profileOf(m.authorId);
            const name = m.speaker ?? p?.displayName ?? "退出した人";
            return (
              <li key={m.id} className="group relative">
                <button
                  type="button"
                  onClick={() => {
                    jumpToMessage(chatId, m);
                    onClose();
                  }}
                  className="flex w-full gap-2.5 rounded-[12px] border border-line bg-card p-2.5 pr-10 text-left hover:border-accent"
                >
                  <Avatar name={name} src={m.speaker ? undefined : p?.avatar} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2 text-xs text-muted">
                      <b className="text-sm text-ink">{name}</b>
                      {new Date(m.createdAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="mt-0.5 line-clamp-3 text-sm break-words whitespace-pre-wrap">
                      {m.inviteId ? "（ルームへの招待）" : plainText(m.text) || `（画像 ${m.mediaIds.length}枚）`}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="ピン留めを外す"
                  title="ピン留めを外す"
                  onClick={() => void setPinned(chatId, m.id, false)}
                  className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-tint hover:text-warn"
                >
                  <Icon name="x" size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </PopupDialog>
  );
}
