"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { MediaPicker } from "@/components/MediaPicker";
import { ThumbImage } from "@/components/ThumbImage";
import { toast } from "@/components/ui/overlay";
import { MenuItem, Popover, usePopover } from "@/components/ui/Popover";
import { sendMessage } from "@/lib/local/chat";
import type { Chat, Message, Profile } from "@/lib/local/db";
import { ensureMyMedia } from "@/lib/local/boxes";
import { ensureInBox, uploadToRoom } from "@/lib/local/media";
import { MEDIA_DRAG_TYPE } from "@/lib/media/export";
import { IMAGE_ACCEPT, isImageFile } from "@/lib/media/image";
import { EmojiPicker } from "./EmojiPicker";
import { previewOf } from "./messageParts";
import { useAutoGrow } from "./useAutoGrow";

/** 下書き（人とチャットごと。送るまで、ほかのチャットへ移っても残す：Discord と同じ） */
const draftKey = (userId: string, chatId: string) => `accord:draft:${userId}:${chatId}`;
const loadDraft = (userId: string, chatId: string) => {
  try {
    return localStorage.getItem(draftKey(userId, chatId)) ?? "";
  } catch {
    return "";
  }
};
const saveDraft = (userId: string, chatId: string, text: string) => {
  try {
    if (text) localStorage.setItem(draftKey(userId, chatId), text);
    else localStorage.removeItem(draftKey(userId, chatId));
  } catch {
    // 覚えられなくても、書いている文章はそのまま
  }
};

export type Mentionable = { id: string; name: string; avatar?: string };

/** 入力中の人の並び（Discord と同じ言い方） */
const typingLabel = (names: string[]) =>
  names.length === 1 ? `${names[0]}が入力中…` : names.length === 2 ? `${names[0]}と${names[1]}が入力中…` : names.length > 2 ? "何人かが入力中…" : "";

/**
 * 発言の入力欄（チャット・やり取り再現チャット・イメージチャットで同じもの）。
 * ＋で画像を添付・絵文字・@ で人を呼ぶ・空の欄で ↑ を押すと最後の発言を直す・下書き・「○○が入力中…」
 */
export function Composer({
  chat,
  me,
  inputRef,
  header,
  speaker = null,
  disabledTitle,
  replyTo = null,
  replyName = "",
  onClearReply = () => {},
  onSent,
  onEditLast,
  mentionables = [],
  typing,
  typers,
  placeholder,
}: {
  chat: Chat;
  me: Profile;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** 話す人を選ぶ並び（やり取り再現チャット・イメージチャット）。欄の上に出す */
  header?: React.ReactNode;
  /** 送る発言の話す人（再現チャットは名前、イメージチャットはイメージユーザーの ID）。ふつうのチャットは null */
  speaker?: string | null;
  /** 書けないとき（イメージチャットで話す人がまだいないなど）の説明。あれば欄を使えなくする */
  disabledTitle?: string;
  replyTo?: Message | null;
  replyName?: string;
  onClearReply?: () => void;
  /** 送ったあと（「ここから未読」の線を消す） */
  onSent: () => void;
  /** 空の欄で ↑ を押したとき（最後の発言を直す）。直せる発言が無ければ false */
  onEditLast: () => boolean;
  /** @ で呼べる人 */
  mentionables?: Mentionable[];
  typing: { ping: () => void; stop: () => void };
  /** 入力中のほかの人の名前 */
  typers: string[];
  /** 欄の中に薄く出す言葉（#チャンネル へメッセージを送信 など） */
  placeholder: string;
}) {
  const [text, setText] = useState(() => loadDraft(me.id, chat.id));
  const [attached, setAttached] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [emojiAt, setEmojiAt] = useState<HTMLElement | null>(null);
  const plus = usePopover();
  const file = useRef<HTMLInputElement>(null);
  const input = inputRef;
  const disabled = disabledTitle !== undefined;
  // 欄の外へ移っても（絵文字を選ぶときなど）、入れる位置を覚えておく
  const caret = useRef<{ start: number; end: number }>({ start: text.length, end: text.length });
  // @ のあとに打っている名前（メンションの候補を出す）
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null);
  useAutoGrow(input, text);
  const canSend = (text.trim() || attached.length) && !uploading && !disabled;
  const candidates = mention ? mentionables.filter((p) => p.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 8) : [];

  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo, input]);

  // 下書きを覚える
  useEffect(() => {
    const t = setTimeout(() => saveDraft(me.id, chat.id, text), 300);
    return () => clearTimeout(t);
  }, [me.id, chat.id, text]);

  const remember = (el: HTMLTextAreaElement) => {
    caret.current = { start: el.selectionStart, end: el.selectionEnd };
    const before = el.value.slice(0, el.selectionStart);
    const at = mentionables.length && el.selectionStart === el.selectionEnd ? /(^|\s)@([^\s@]{0,24})$/.exec(before) : null;
    setMention((cur) => (at ? { start: el.selectionStart - at[2].length - 1, query: at[2], index: cur?.query === at[2] ? cur.index : 0 } : null));
  };

  /** 欄の文章を置き換えて、カーソルを pos に置く */
  const replace = (next: string, pos: number) => {
    setText(next);
    caret.current = { start: pos, end: pos };
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const insert = (s: string) => {
    const { start, end } = caret.current;
    const a = Math.min(start, text.length);
    const b = Math.min(end, text.length);
    replace(text.slice(0, a) + s + text.slice(b), a + s.length);
  };

  const pickMention = (p: Mentionable) => {
    if (!mention) return;
    const end = mention.start + 1 + mention.query.length;
    const s = `@${p.name} `;
    replace(text.slice(0, mention.start) + s + text.slice(end), mention.start + s.length);
    setMention(null);
  };

  /** 選んだ文字を書式の記号で囲む（Ctrl+B など。Discord と同じ） */
  const wrap = (el: HTMLTextAreaElement, mark: string) => {
    const { selectionStart: a, selectionEnd: b } = el;
    replace(text.slice(0, a) + mark + text.slice(a, b) + mark + text.slice(b), b + mark.length * (a === b ? 1 : 2));
  };

  const send = async () => {
    if (!canSend) return;
    const body = { text: text.trim(), replyTo: replyTo?.id ?? null, speaker };
    let mediaIds = attached;
    // 欄は送り終わるのを待たずにすぐ空にする（Discord と同じ。続けて打った文字が消えないように）
    setText("");
    saveDraft(me.id, chat.id, "");
    setAttached([]);
    setMention(null);
    typing.stop();
    onClearReply();
    onSent();
    // DM で送る画像は、送った人のマイメディアに入れる（ほかのボックスから選んだ画像は、マイメディアにコピーして送る）
    if (chat.dm && mediaIds.length) {
      const r = await ensureInBox(mediaIds, await ensureMyMedia(me.id), me.id);
      mediaIds = r.ids;
      if (r.copied) toast(`${r.copied}枚をマイメディアにコピーして送りました`);
    }
    await sendMessage(chat, me.id, { ...body, mediaIds });
  };

  // 貼り付け・ドロップ・選んだ画像も、まずメディアに入れてから添付する
  const uploadAndAttach = async (files: File[]) => {
    const images = files.filter(isImageFile);
    if (!images.length || disabled) return;
    setUploading(true);
    const { ids, toMine } = await uploadToRoom(chat.roomId, me.id, images);
    setUploading(false);
    setAttached((a) => [...a, ...ids]);
    // DM や、ボックスが紐づいていない・見るだけのルームでは、送った人のマイメディアに入る
    toast(`${ids.length}枚を${toMine ? "マイメディア" : "メディア"}に追加して添付しました`);
  };

  const iconBtn = "grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted hover:bg-tint hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div
      data-name="入力欄"
      className="relative pt-1"
      // メディアの画像をドラッグしてきたときは、ファイルの追加として扱わない（同じ画像が二重に増えないように）
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && !e.dataTransfer.types.includes(MEDIA_DRAG_TYPE) && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length || e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) return;
        e.preventDefault();
        uploadAndAttach([...e.dataTransfer.files]);
      }}
    >
      {mention && candidates.length > 0 && (
        // @ のあとに打った名前の候補（↑↓で選んで Enter・Tab で入れる）
        <div role="listbox" aria-label="メンションする人" className="anim-pop absolute right-0 bottom-full left-0 z-20 mb-1 rounded-[12px] border border-line bg-card p-1.5 shadow-xl">
          <p className="px-2 pt-0.5 pb-1 text-xs font-bold text-muted">メンバー</p>
          {candidates.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={i === mention.index}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setMention({ ...mention, index: i })}
              onClick={() => pickMention(p)}
              className={`flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-sm ${i === mention.index ? "bg-tint" : ""}`}
            >
              <Avatar name={p.name} src={p.avatar} size={24} />
              <span className="min-w-0 flex-1 truncate font-bold">{p.name}</span>
            </button>
          ))}
        </div>
      )}
      {header}
      <div className={`overflow-hidden rounded-[14px] border border-line bg-card transition-colors focus-within:border-accent ${disabled ? "opacity-60" : ""}`}>
        {replyTo && (
          <div className="flex items-center gap-2 border-b border-line bg-tint px-3 py-1 text-sm">
            <Icon name="reply" size={14} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate text-muted">
              <b className="text-ink">{replyName}</b> に返信：{previewOf(replyTo)}
            </span>
            <button aria-label="返信をやめる" title="返信をやめる（Esc）" onClick={onClearReply} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted hover:bg-card hover:text-ink">
              <Icon name="x" size={14} />
            </button>
          </div>
        )}
        {(attached.length > 0 || uploading) && (
          <div className="flex flex-wrap gap-2 border-b border-line p-2">
            {attached.map((id) => (
              <div key={id} className="relative h-20 w-20 overflow-hidden rounded-[10px] border border-line">
                <ThumbImage id={id} alt="" />
                <button
                  aria-label="添付を外す"
                  title="添付を外す"
                  onClick={() => setAttached(attached.filter((x) => x !== id))}
                  className="absolute top-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white hover:bg-warn"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
            {uploading && <span className="self-center text-sm text-muted">メディアに追加中…</span>}
          </div>
        )}
        <div className="flex items-end gap-0.5 px-1 py-0.5" title={disabledTitle}>
          <button className={iconBtn} aria-label="画像を添付" title="画像を添付" disabled={disabled} onClick={plus.toggle}>
            <Icon name="add" />
          </button>
          <textarea
            ref={input}
            value={text}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value);
              remember(e.target);
              if (e.target.value.trim()) typing.ping();
              else typing.stop();
            }}
            onSelect={(e) => remember(e.currentTarget)}
            onBlur={() => setMention(null)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) {
                e.preventDefault();
                uploadAndAttach(files);
              }
            }}
            onKeyDown={(e) => {
              const composing = e.nativeEvent.isComposing;
              if (mention && candidates.length && !composing) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const n = candidates.length;
                  setMention({ ...mention, index: (mention.index + (e.key === "ArrowDown" ? 1 : n - 1)) % n });
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  pickMention(candidates[Math.min(mention.index, candidates.length - 1)]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMention(null);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey && !composing) {
                e.preventDefault();
                void send();
                return;
              }
              if (e.key === "ArrowUp" && !text && !composing && !attached.length) {
                if (onEditLast()) e.preventDefault();
                return;
              }
              if (e.key === "Escape" && replyTo) {
                e.preventDefault();
                onClearReply();
                return;
              }
              const mark = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey ? { b: "**", i: "*", u: "__" }[e.key.toLowerCase()] : undefined;
              if (mark && !composing) {
                e.preventDefault();
                wrap(e.currentTarget, mark);
              }
            }}
            rows={1}
            placeholder={placeholder}
            title={disabledTitle ?? `Enterで送信・Shift＋Enterで改行・空の欄で ↑ を押すと最後の発言を直す${mentionables.length ? "・@ で人を呼ぶ" : ""}`}
            aria-label="メッセージ"
            className="min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none! placeholder:text-muted"
          />
          <button
            className={iconBtn}
            aria-label="絵文字"
            title="絵文字"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => setEmojiAt(emojiAt ? null : e.currentTarget)}
          >
            <Icon name="smile" />
          </button>
          <button
            className="mb-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition hover:opacity-90 disabled:bg-transparent disabled:text-muted disabled:opacity-60"
            aria-label="送信"
            title="送信（Enter）"
            disabled={!canSend}
            onClick={() => void send()}
          >
            <Icon name="send" size={18} />
          </button>
        </div>
      </div>
      {/* 入力中の人（出たり消えたりしても欄が動かないよう、場所はいつも空けておく） */}
      <div aria-live="polite" className="flex h-5 items-center gap-1.5 px-2 text-xs text-muted">
        {typers.length > 0 && (
          <>
            <span className="typing-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span className="truncate">{typingLabel(typers)}</span>
          </>
        )}
      </div>
      <input
        ref={file}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          void uploadAndAttach(files);
        }}
      />
      {plus.anchor && (
        <Popover anchor={plus.anchor} onClose={plus.close} width={220} label="画像を添付">
          <MenuItem
            icon={<Icon name="upload" size={16} />}
            onClick={() => {
              plus.close();
              file.current?.click();
            }}
          >
            画像をアップロード
          </MenuItem>
          <MenuItem
            icon={<Icon name="img" size={16} />}
            onClick={() => {
              plus.close();
              setPicking(true);
            }}
          >
            メディアから選ぶ
          </MenuItem>
        </Popover>
      )}
      {emojiAt && <EmojiPicker anchor={emojiAt} onClose={() => setEmojiAt(null)} onPick={insert} />}
      {picking && (
        <MediaPicker
          roomId={chat.roomId}
          userId={me.id}
          onClose={() => setPicking(false)}
          onPick={(ids) => {
            setAttached((a) => [...a, ...ids.filter((id) => !a.includes(id))]);
            setPicking(false);
            input.current?.focus();
          }}
        />
      )}
    </div>
  );
}
