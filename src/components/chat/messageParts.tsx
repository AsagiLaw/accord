"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { MenuDivider, MenuItem, Popover, type Anchor } from "@/components/ui/Popover";
import { editMessage } from "@/lib/local/chat";
import type { Message } from "@/lib/local/db";
import { copyText } from "./LongText";
import { plainText } from "./RichText";
import { useAutoGrow } from "./useAutoGrow";

// チャットとイメージチャットで同じに使う、発言のまわりの部品（日付と時刻・操作のメニュー・その場で直す欄）

const WEEK = "日月火水木金土";
const dayLabel = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`;
};
export const timeLabel = (t: number) => new Date(t).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
/** 時刻に乗せたときに出す、日付つきの時刻 */
export const fullTime = (t: number) => new Date(t).toLocaleString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
export const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
/** 返信の引用などに出す、発言の短い中身 */
export const previewOf = (m: Message) => (m.inviteId ? "（ルームへの招待）" : plainText(m.text) || "（画像）");

/** 発言の操作のメニュー（右クリック・長押し・「…」）と、リアクションの絵文字の選択 */
export type MenuState = { m: Message; anchor: Anchor };

/** 日付が変わるところに引く線 */
export function DayDivider({ at }: { at: number }) {
  return (
    <div className="my-4 flex items-center gap-3 text-xs text-muted">
      <span className="h-px flex-1 bg-line" />
      {dayLabel(at)}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** 時刻。乗せると日付つきで出す */
export function MessageTime({ at, className }: { at: number; className?: string }) {
  return (
    <time dateTime={new Date(at).toISOString()} title={fullTime(at)} className={className}>
      {timeLabel(at)}
    </time>
  );
}

/** 文章の後ろに付ける「（編集済み）」。乗せると直した時刻 */
export function EditedMark({ at }: { at: number }) {
  return (
    <span title={`編集：${fullTime(at)}`} className="ml-1 inline-block text-[11px] whitespace-nowrap opacity-70">
      （編集済み）
    </span>
  );
}

/** 発言の操作のメニューを開く「…」（吹き出しの横。文字に重ならないよう、場所はいつも空けておき、乗せたときに出す。指で触る端末ではいつも薄く出す） */
export function MenuDots({ open, onOpen }: { open: boolean; onOpen: (el: HTMLElement) => void }) {
  return (
    <button
      type="button"
      aria-label="発言の操作"
      title="発言の操作"
      onClick={(e) => onOpen(e.currentTarget)}
      className={`grid h-6 w-6 shrink-0 self-end place-items-center rounded-full text-muted transition-opacity hover:bg-tint hover:text-ink focus-visible:opacity-100 ${
        open ? "bg-tint text-ink opacity-100" : "opacity-0 group-hover:opacity-100 pointer-coarse:opacity-60"
      }`}
    >
      <Icon name="dots" size={16} />
    </button>
  );
}

/** 発言の行の右クリックと、指で触る端末の長押しで、メニューを開く（Discord と同じ）。off の間（直している間）は何もしない。行に付ける */
export function useMessageGestures(onMenu: (anchor: Anchor) => void, off: boolean) {
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean } | null>(null);
  return {
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
      // 文字を選んでいるとき・リンクの上では、ブラウザのメニュー（コピー・リンクのコピー）を出す
      const sel = window.getSelection();
      if ((sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) || (e.target as Element).closest("a, textarea, input") || off) return;
      e.preventDefault();
      onMenu({ x: e.clientX, y: e.clientY });
    },
    onTouchStart: (e: React.TouchEvent) => {
      if (off || e.touches.length !== 1) return;
      const t = e.touches[0];
      const p = {
        x: t.clientX,
        y: t.clientY,
        fired: false,
        timer: setTimeout(() => {
          p.fired = true;
          navigator.vibrate?.(10);
          onMenu({ x: p.x, y: p.y });
        }, 450),
      };
      press.current = p;
    },
    onTouchMove: (e: React.TouchEvent) => {
      const p = press.current;
      const t = e.touches[0];
      if (p && !p.fired && Math.hypot(t.clientX - p.x, t.clientY - p.y) > 8) {
        clearTimeout(p.timer);
        press.current = null;
      }
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const p = press.current;
      press.current = null;
      if (!p) return;
      clearTimeout(p.timer);
      // 長押しでメニューを出したときは、指を離しても画像などを開かない
      if (p.fired) e.preventDefault();
    },
  };
}

/**
 * 発言の操作のメニュー（右クリック・長押し・「…」）。social ならいちばん上によく使う絵文字のリアクションと、ピン留め。
 * extra はチャットの種類ごとの項目（イメージチャットの「話している人を変える」など）。close で閉じる
 */
export function MessageMenu({
  state,
  social,
  canReply,
  canEdit,
  pinned,
  quick = [],
  extra,
  onClose,
  onReact,
  onMoreReactions,
  onReply,
  onEdit,
  onPin,
  onDelete,
}: {
  state: MenuState;
  social: boolean;
  canReply: boolean;
  canEdit: boolean;
  pinned?: boolean;
  quick?: string[];
  extra?: (close: () => void) => React.ReactNode;
  onClose: () => void;
  onReact?: (emoji: string) => void;
  onMoreReactions?: () => void;
  onReply?: () => void;
  onEdit: () => void;
  onPin?: () => void;
  onDelete: (skipConfirm: boolean) => void;
}) {
  const { m, anchor } = state;
  const run = (f?: () => void) => () => {
    onClose();
    f?.();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={236} label="発言の操作">
      {social && (
        <>
          <div className="flex items-center justify-between px-0.5 pb-1">
            {quick.slice(0, 5).map((e) => (
              <button key={e} type="button" aria-label={`${e} でリアクション`} onClick={run(() => onReact?.(e))} className="grid h-9 w-9 place-items-center rounded-full bg-ink/[0.05] text-lg hover:bg-tint">
                {e}
              </button>
            ))}
            <button type="button" aria-label="ほかの絵文字" title="ほかの絵文字" onClick={run(onMoreReactions)} className="grid h-9 w-9 place-items-center rounded-full bg-ink/[0.05] text-muted hover:bg-tint hover:text-ink">
              <Icon name="smile" size={18} />
            </button>
          </div>
          <MenuDivider />
        </>
      )}
      {canReply && (
        <MenuItem icon={<Icon name="reply" size={16} />} onClick={run(onReply)}>
          返信
        </MenuItem>
      )}
      {canEdit && !m.inviteId && (
        <MenuItem icon={<Icon name="edit" size={16} />} onClick={run(onEdit)}>
          編集
        </MenuItem>
      )}
      {social && (
        <MenuItem icon={<Icon name="pin" size={16} />} onClick={run(onPin)}>
          {pinned ? "ピン留めを外す" : "ピン留め"}
        </MenuItem>
      )}
      {m.text && (
        <MenuItem icon={<Icon name="copy" size={16} />} onClick={run(() => copyText(m.text))}>
          文章をコピー
        </MenuItem>
      )}
      {extra?.(onClose)}
      {canEdit && (
        <>
          <MenuDivider />
          <MenuItem
            danger
            icon={<Icon name="del" size={16} />}
            title="Shift を押しながら選ぶと、確かめずに削除します"
            onClick={(e?: React.MouseEvent) => {
              onClose();
              onDelete(!!e?.shiftKey);
            }}
          >
            {m.inviteId ? "招待を取り消す" : "削除"}
          </MenuItem>
        </>
      )}
    </Popover>
  );
}

/** 発言をその場で直す欄。Enter で保存・Esc でやめる。文章を全部消して保存すると、発言を消すか確かめる（Discord と同じ） */
export function EditBox({ m, onDone, onDelete }: { m: Message; onDone: () => void; onDelete: () => void }) {
  const [draft, setDraft] = useState(m.text);
  const input = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(input, draft);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const save = async () => {
    const text = draft.trim();
    if (text === m.text.trim()) return onDone();
    if (!text && !m.mediaIds.length) {
      onDone();
      onDelete();
      return;
    }
    await editMessage(m.id, text);
    onDone();
  };
  return (
    <div data-name="発言の編集" className="w-full">
      <textarea
        ref={input}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
        rows={1}
        aria-label="発言を直す"
        className="field w-full resize-none py-2 text-sm"
      />
      <div className="mt-1 flex justify-end gap-1 text-xs">
        <button type="button" title="Esc" className="rounded-full px-2.5 py-1 hover:bg-tint" onClick={onDone}>
          キャンセル
        </button>
        <button type="button" title="Enter" className="rounded-full bg-accent px-2.5 py-1 font-bold text-accent-ink hover:opacity-90" onClick={() => void save()}>
          保存
        </button>
      </div>
    </div>
  );
}
