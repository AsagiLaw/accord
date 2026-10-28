"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { UserCardButton } from "@/components/account/UserCard";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { ImageViewer } from "@/components/ImageViewer";
import { MediaPicker } from "@/components/MediaPicker";
import { ThumbImage } from "@/components/ThumbImage";
import { choose, confirmAction, promptText, toast } from "@/components/ui/overlay";
import { MenuDivider, MenuItem, Popover, usePopover, type Anchor } from "@/components/ui/Popover";
import {
  addSpeaker,
  changeSpeaker,
  deleteMessage,
  editMessage,
  sendMessage,
  setPinned,
  toggleReaction,
  useChatReads,
  useMessagesByIds,
  useReactions,
  type ReactionGroup,
} from "@/lib/local/chat";
import type { Chat, Media, Message, Profile, RoomRole } from "@/lib/local/db";
import { ensureMyMedia } from "@/lib/local/boxes";
import { ensureInBox, uploadToRoom, useMediaByIds } from "@/lib/local/media";
import { MEDIA_DRAG_TYPE } from "@/lib/media/export";
import { IMAGE_ACCEPT, isImageFile } from "@/lib/media/image";
import { useAllProfiles, type MemberWithProfile } from "@/lib/local/rooms";
import { useTyping } from "@/lib/local/typing";
import { InviteCard } from "./InviteCard";
import { SendStatus, useSendState } from "./SendStatus";
import { UploadGauge } from "@/components/media/Thumb";
import { copyText, LongText } from "./LongText";
import { EmojiPicker } from "./EmojiPicker";
import { recentEmoji } from "./emoji";
import { emojiOnly, MentionProvider, mentions, plainText } from "./RichText";
import { jumpToMessage, useMessageWindow } from "./useMessageWindow";
import { useAutoGrow } from "./useAutoGrow";
import { useReadProgress } from "./useReadProgress";
import { ChatSkeleton } from "@/components/Skeleton";

const WEEK = "日月火水木金土";
const dayLabel = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`;
};
const timeLabel = (t: number) => new Date(t).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
/** 時刻に乗せたときに出す、日付つきの時刻 */
const fullTime = (t: number) => new Date(t).toLocaleString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
/** 返信の引用などに出す、発言の短い中身 */
const previewOf = (m: Message) => (m.inviteId ? "（ルームへの招待）" : plainText(m.text) || "（画像）");

/** 発言の操作のメニュー（右クリック・長押し・「…」）と、リアクションの絵文字の選択 */
type MenuState = { m: Message; anchor: Anchor };

export function ChatView({
  chat,
  me,
  members,
  readOnlyNotice,
}: {
  chat: Chat;
  me: Profile;
  members: MemberWithProfile[];
  /** 書き込めないときに、入力欄の代わりに出す説明 */
  readOnlyNotice?: string;
}) {
  // 発言は新しい方から少しずつ読み込む（上の端まで戻ると、その前を足す）
  const win = useMessageWindow(chat.id, me.id);
  const messages = win.messages;
  const list = useRef<HTMLDivElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  // 読み込んでいない古い発言への返信は、引用する発言だけを ID で引く
  const loadedIds = useMemo(() => new Set((messages ?? []).map((m) => m.id)), [messages]);
  const replies = useMessagesByIds(useMemo(() => [...new Set((messages ?? []).flatMap((m) => (m.replyTo && !loadedIds.has(m.replyTo) ? [m.replyTo] : [])))], [messages, loadedIds]));
  // 添付した画像は、どのボックスに入っていても ID で引く（チャットを見られる人なら必ず見られる）
  const byId = useMediaByIds(useMemo(() => (messages ?? []).flatMap((m) => m.mediaIds), [messages]));
  const reactions = useReactions(chat.id);
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.displayName ?? "退出した人";
  // やり取り再現チャット：話者を選んで、依頼者とのやり取りを写して記録する
  const reenact = chat.kind === "reenact";
  const speakers = chat.speakers ?? ["依頼者", "自分"];
  const who = (m: Message) => (reenact ? (m.speaker ?? speakers[0]) : nameOf(m.authorId));
  // 書き込めるか（フレンドでなくなった DM・話せる人に入っていないときは、返信・リアクション・ピン留めもしない）
  const canWrite = !readOnlyNotice;
  // リアクション・ピン留め・メンションは、ふつうのチャットと DM だけ（再現チャットは会話の書き起こしなので使わない）
  const social = !reenact;
  // 発言の横に出すアイコン（ルームのチャットではカードに役割も出す。DM と再現チャットでは出さない）
  const profiles = useAllProfiles();
  const authorOf = (m: Message): Author | undefined =>
    reenact
      ? undefined
      : { id: m.authorId, avatar: profiles?.find((p) => p.id === m.authorId)?.avatar, role: chat.dm ? undefined : members.find((x) => x.userId === m.authorId)?.role };
  // 既読（LINE と同じ）：自分の発言を、ほかの人がどこまで読んだか。読める人は DM の相手・ルームのメンバー（話せる人が決まっていればその中）
  const reads = useChatReads(chat.id);
  const audience = useMemo(
    () => (chat.dm ?? members.map((m) => m.userId)).filter((id) => id !== me.id && (!chat.allowed || chat.allowed.includes(id))),
    [chat.dm, chat.allowed, members, me.id],
  );
  const readersOf = (m: Message) => audience.filter((id) => (reads?.get(id) ?? 0) >= m.createdAt);
  // メンションに使える人（@名前）。自分の名前へのメンションは強く出す
  const mentionNames = useMemo(
    () => ({ names: social ? [...new Set([me.displayName, ...members.map((m) => m.displayName)].filter(Boolean))] : [], me: me.displayName }),
    [social, me.displayName, members],
  );
  const mentionables = useMemo(
    () =>
      social
        ? audience.filter((id) => members.some((m) => m.userId === id)).map((id) => ({ id, name: nameOf(id), avatar: profiles?.find((p) => p.id === id)?.avatar }))
        : [],
    // nameOf は members から引く
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [social, audience, members, profiles],
  );
  const typing = useTyping(chat.id, me.id);
  const pinned = useMemo(() => new Set(chat.pinned ?? []), [chat.pinned]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ items: Media[]; start: number } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [reactPick, setReactPick] = useState<MenuState | null>(null);
  // よく使う絵文字（発言のメニューの上に出す）
  const [quick, setQuick] = useState(() => recentEmoji());
  // 一番下から遠くまで戻ったか（「最新の発言へ」を出す）
  const [far, setFar] = useState(false);
  const stick = useRef(true);
  const placed = useRef(false);
  const last = messages?.at(-1);
  const ready = !!messages && !!byId;
  // 既読は、画面に出た発言の分だけ付ける
  const read = useReadProgress(chat.id, me.id, list, ready ? messages : undefined);

  // 開いたとき：読んでいない発言が溜まっていれば「ここから未読」の線を上の方に出す。無ければ一番下から。
  // そのあとは、一番下を見ているときだけ、新しい発言が来ても一番下に付いていく
  useLayoutEffect(() => {
    const el = list.current;
    if (!el || !ready) return;
    if (!placed.current) {
      placed.current = true;
      const line = el.querySelector<HTMLElement>("[data-unread-line]");
      if (line) {
        el.scrollTop += line.getBoundingClientRect().top - el.getBoundingClientRect().top - 40;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        return;
      }
    }
    if (stick.current || last?.authorId === me.id) el.scrollTop = el.scrollHeight;
  }, [ready, last?.id, last?.authorId, me.id]);

  if (!messages || !byId) return <ChatSkeleton />;

  const open = (ids: string[], i: number) => {
    const items = ids.map((id) => byId.get(id)).filter((m): m is Media => !!m);
    if (items.length) setViewer({ items, start: Math.min(i, items.length - 1) });
  };
  const canEditOf = (m: Message) => reenact || m.authorId === me.id;
  const react = (m: Message, emoji: string) => {
    void toggleReaction(m, me.id, emoji);
    setQuick(recentEmoji());
  };
  const reply = (m: Message) => {
    setReplyTo(m);
    composerInput.current?.focus();
  };
  const remove = async (m: Message, skipConfirm?: boolean) => {
    const ok =
      skipConfirm ||
      (m.inviteId
        ? await confirmAction("この招待を取り消します", "取り消す", "招待のカードが消え、相手はこの招待で参加できなくなります（もう参加していれば、そのままです）。")
        : await confirmAction("この発言を削除します", "削除", "添付した画像はメディアに残ります。"));
    if (ok) await deleteMessage(m.id);
  };
  const endEdit = () => {
    setEditingId(null);
    composerInput.current?.focus();
  };
  /** 入力欄が空のときに ↑ で、自分の最後の発言を直す（Discord と同じ） */
  const editLast = () => {
    const m = [...messages].reverse().find((x) => canEditOf(x) && !x.inviteId);
    if (!m) return false;
    setEditingId(m.id);
    requestAnimationFrame(() => document.querySelector(`[data-msg="${CSS.escape(m.id)}"]`)?.scrollIntoView({ block: "nearest" }));
    return true;
  };

  return (
    <MentionProvider value={mentionNames}>
      <div data-name={reenact ? "やり取り再現チャット" : "チャット"} className="flex h-full min-h-0 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={list}
            data-name="発言一覧"
            onScroll={(e) => {
              const el = e.currentTarget;
              const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
              stick.current = gap < 80;
              const isFar = gap > el.clientHeight * 1.5;
              if (isFar !== far) setFar(isFar);
              win.onScroll(el);
              read.measure();
            }}
            className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-3 pb-2 ${reenact ? "rounded-[14px] bg-tint/40 px-3 pt-0" : ""}`}
          >
            {reenact && (
              <p
                title="依頼者とのやり取りを写して残す場所です。名前を押すと話者を、編集ボタンで文章を直せます"
                className="sticky top-0 z-10 -mx-3 mb-2 flex items-center gap-1.5 border-b border-dashed border-accent bg-bg/90 px-3 py-1.5 text-xs text-muted backdrop-blur"
              >
                <Icon name="ppl" size={14} />
                やり取り再現
              </p>
            )}
            {win.hasOlder && (
              <button type="button" onClick={(e) => void win.loadOlder(e.currentTarget.parentElement)} className="mx-auto my-2 block rounded-full px-3 py-1 text-xs text-muted hover:bg-tint hover:text-ink">
                さらに前の発言を読み込む
              </button>
            )}
            {!messages.length && <p className="py-10 text-center text-sm text-muted">まだ発言はありません。最初のメッセージを送ってみましょう。</p>}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
              const firstUnread = m.id === win.unreadId;
              const grouped = !newDay && !firstUnread && who(prev) === who(m) && prev.authorId === m.authorId && m.createdAt - prev.createdAt < 5 * 60_000 && !m.replyTo;
              const mine = reenact ? who(m) === "自分" : m.authorId === me.id;
              const r = m.replyTo ? (messages.find((x) => x.id === m.replyTo) ?? replies?.get(m.replyTo)) : undefined;
              return (
                <div key={m.id} data-msg={m.id} data-at={m.createdAt}>
                  {newDay && (
                    <div className="my-4 flex items-center gap-3 text-xs text-muted">
                      <span className="h-px flex-1 bg-line" />
                      {dayLabel(m.createdAt)}
                      <span className="h-px flex-1 bg-line" />
                    </div>
                  )}
                  {firstUnread && <UnreadLine />}
                  <MessageItem
                    m={m}
                    meId={me.id}
                    mine={mine}
                    social={social && canWrite}
                    grouped={grouped}
                    authorName={who(m)}
                    author={authorOf(m)}
                    pinned={pinned.has(m.id)}
                    mentionsMe={social && !mine && mentions(m.text, me.displayName)}
                    speakerTone={reenact ? speakers.indexOf(who(m)) : undefined}
                    onChangeSpeaker={
                      reenact
                        ? async () => {
                            const i = await choose("話者を変える", [...speakers.map((x) => ({ label: x })), { label: "＋ 新しい話者" }]);
                            if (i === null) return;
                            const name = i < speakers.length ? speakers[i] : await promptText("新しい話者の名前", "", "例：スタッフ");
                            if (!name) return;
                            await addSpeaker(chat.id, name);
                            await changeSpeaker(m.id, name);
                          }
                        : undefined
                    }
                    readMark={!reenact && m.authorId === me.id ? <ReadMark readers={readersOf(m)} audience={audience} nameOf={nameOf} /> : undefined}
                    reply={r}
                    replyAuthor={r ? authorOf(r) : undefined}
                    onJumpReply={(x) => jumpToMessage(chat.id, x)}
                    replyName={(x) => who(x)}
                    media={byId}
                    reactions={social ? reactions?.get(m.id) : undefined}
                    nameOf={nameOf}
                    editing={editingId === m.id}
                    active={menu?.m.id === m.id || reactPick?.m.id === m.id}
                    dotsOpen={menu?.m.id === m.id && menu.anchor instanceof HTMLElement}
                    onEditEnd={endEdit}
                    onReact={(emoji) => react(m, emoji)}
                    onPickReaction={(anchor) => setReactPick({ m, anchor })}
                    onMenu={(anchor) => setMenu({ m, anchor })}
                    onDelete={(skip) => void remove(m, skip)}
                    onOpen={(idx) => open(m.mediaIds, idx)}
                  />
                </div>
              );
            })}
          </div>
          {read.newBelow > 0 ? <NewBelowButton count={read.newBelow} list={list} /> : far && <NewBelowButton count={0} list={list} />}
        </div>
        {readOnlyNotice ? (
          <p className="border-t border-line pt-2 text-center text-sm text-muted">{readOnlyNotice}</p>
        ) : (
          <Composer
            chat={chat}
            me={me}
            inputRef={composerInput}
            speakers={reenact ? speakers : null}
            replyTo={replyTo}
            replyName={replyTo ? who(replyTo) : ""}
            onClearReply={() => setReplyTo(null)}
            onSent={win.dismissUnread}
            onEditLast={editLast}
            mentionables={mentionables}
            typing={typing}
            typers={typing.typers.map(nameOf)}
            target={chat.dm ? `@${nameOf(chat.dm.find((id) => id !== me.id) ?? "")}` : `#${chat.name || "チャット"}`}
          />
        )}
        {menu && (
          <MessageMenu
            state={menu}
            social={social && canWrite}
            canReply={canWrite}
            canEdit={canEditOf(menu.m)}
            pinned={pinned.has(menu.m.id)}
            quick={quick}
            onClose={() => setMenu(null)}
            onReact={(emoji) => react(menu.m, emoji)}
            onMoreReactions={() => setReactPick(menu)}
            onReply={() => reply(menu.m)}
            onEdit={() => setEditingId(menu.m.id)}
            onPin={() => void setPinned(chat.id, menu.m.id, !pinned.has(menu.m.id)).then(() => toast(pinned.has(menu.m.id) ? "ピン留めを外しました" : "ピン留めしました"))}
            onDelete={(skip) => void remove(menu.m, skip)}
          />
        )}
        {reactPick && <EmojiPicker anchor={reactPick.anchor} onClose={() => setReactPick(null)} onPick={(emoji) => react(reactPick.m, emoji)} />}
        {viewer && <ImageViewer items={viewer.items} start={viewer.start} roomId={chat.roomId} onClose={() => setViewer(null)} />}
      </div>
    </MentionProvider>
  );
}

// 再現チャットで話者ごとに色を変える（0：依頼者、1：自分、2以降：追加した話者）
const SPEAKER_TONES = [
  "border-2 border-dashed border-line bg-card",
  "border-2 border-dashed border-accent bg-accent/15",
  "border-2 border-dashed border-yellow-500/70 bg-yellow-500/10",
  "border-2 border-dashed border-purple-500/70 bg-purple-500/10",
  "border-2 border-dashed border-pink-500/70 bg-pink-500/10",
];

/** 開いたときの最初の未読の上に引く線（Discord と同じ） */
export function UnreadLine() {
  return (
    <div data-unread-line="" className="my-3 flex items-center gap-2 text-xs font-bold text-red-500">
      <span className="h-px flex-1 bg-red-500/70" />
      ここから未読
      <span className="h-px flex-1 bg-red-500/70" />
    </div>
  );
}

/** 下にまだ見ていない発言があるとき（count 件）・上の方まで戻ったとき（count が 0）に出すボタン。押すと一番下へ */
export function NewBelowButton({ count, list }: { count: number; list: React.RefObject<HTMLElement | null> }) {
  return (
    <button
      type="button"
      onClick={() => {
        const el = list.current;
        if (!el) return;
        // 遠いときは、なめらかに動くと時間がかかるので、すぐに動く
        const far = el.scrollHeight - el.scrollTop - el.clientHeight > el.clientHeight * 3;
        el.scrollTo({ top: el.scrollHeight, behavior: far ? "instant" : "smooth" });
      }}
      className={`absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full px-3 py-1 text-xs font-bold shadow-md hover:opacity-90 ${
        count ? "bg-accent text-accent-ink" : "border border-line bg-card text-ink"
      }`}
    >
      {count ? `新しい発言 ${count}件` : "最新の発言へ"}
      <Icon name="dn" size={14} />
    </button>
  );
}

/** 発言した人（アイコンとプロフィールのカード用） */
type Author = { id: string; avatar?: string; role?: RoomRole };

function MessageItem({
  m,
  meId,
  author,
  readMark,
  mine,
  social,
  grouped,
  authorName,
  pinned,
  mentionsMe,
  speakerTone,
  onChangeSpeaker,
  reply,
  replyAuthor,
  replyName,
  media,
  reactions,
  nameOf,
  editing,
  active,
  dotsOpen,
  onEditEnd,
  onReact,
  onPickReaction,
  onMenu,
  onDelete,
  onOpen,
  onJumpReply,
}: {
  m: Message;
  meId: string;
  author?: Author;
  /** 自分の発言の左に出す既読 */
  readMark?: React.ReactNode;
  mine: boolean;
  /** リアクションを付けられるか */
  social: boolean;
  grouped: boolean;
  authorName: string;
  pinned: boolean;
  /** 自分へのメンションがある（Discord と同じく、行に色を付ける） */
  mentionsMe: boolean;
  speakerTone?: number;
  onChangeSpeaker?: () => void;
  reply?: Message;
  replyAuthor?: Author;
  replyName: (m: Message) => string;
  media: Map<string, Media>;
  reactions?: ReactionGroup[];
  nameOf: (id: string) => string;
  editing: boolean;
  /** この発言のメニュー・絵文字の選択を開いている（行に色を付けたままにする） */
  active: boolean;
  /** 「…」のボタンからメニューを開いている（乗せていなくてもボタンを出したままにする） */
  dotsOpen: boolean;
  onEditEnd: () => void;
  onReact: (emoji: string) => void;
  onPickReaction: (anchor: Anchor) => void;
  onMenu: (anchor: Anchor) => void;
  onDelete: (skipConfirm: boolean) => void;
  onOpen: (index: number) => void;
  /** 引用した発言まで動く */
  onJumpReply: (r: Message) => void;
}) {
  const images = m.mediaIds.filter((id) => media.has(id));
  const missing = m.mediaIds.length - images.length;
  // 自分の発言が届くまでは薄く出す（Discord と同じ）
  const send = useSendState(m, m.authorId === meId);
  const pending = send === "sending" || send === "offline";
  const big = !editing && !missing && !m.inviteId && speakerTone === undefined && emojiOnly(m.text);
  // 指で触る端末は、長押しでメニュー（Discord と同じ）
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean } | null>(null);

  // アイコン（続けて送った発言では空けておく）。押すとプロフィールのカード。ほかの人の発言は左、自分の発言は右に出す
  const icon = author && (
    <div className="w-9 shrink-0">
      {!grouped && (
        <UserCardButton userId={author.id} role={author.role} label={authorName} className="mt-0.5 block rounded-full hover:opacity-85">
          <Avatar name={authorName} src={author.avatar} size={36} />
        </UserCardButton>
      )}
    </div>
  );
  // 発言の操作のメニューを開く「…」（吹き出しの横。文字に重ならないよう、場所はいつも空けておき、乗せたときに出す。指で触る端末ではいつも薄く出す）
  const dots = !editing && (
    <button
      type="button"
      aria-label="発言の操作"
      title="発言の操作"
      onClick={(e) => onMenu(e.currentTarget)}
      className={`grid h-6 w-6 shrink-0 self-end place-items-center rounded-full text-muted transition-opacity hover:bg-tint hover:text-ink focus-visible:opacity-100 ${
        dotsOpen ? "bg-tint text-ink opacity-100" : "opacity-0 group-hover:opacity-100 pointer-coarse:opacity-60"
      }`}
    >
      <Icon name="dots" size={16} />
    </button>
  );
  // 続けて送った発言は、乗せたときだけ時刻を出す
  const hoverTime = grouped && !editing && (
    <time dateTime={new Date(m.createdAt).toISOString()} title={fullTime(m.createdAt)} className="shrink-0 self-end pb-0.5 text-[10px] text-muted opacity-0 group-hover:opacity-100">
      {timeLabel(m.createdAt)}
    </time>
  );

  return (
    <div
      data-name={`発言（${authorName}）`}
      onContextMenu={(e) => {
        // 文字を選んでいるとき・リンクの上では、ブラウザのメニュー（コピー・リンクのコピー）を出す
        const sel = window.getSelection();
        if ((sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) || (e.target as Element).closest("a, textarea, input") || editing) return;
        e.preventDefault();
        onMenu({ x: e.clientX, y: e.clientY });
      }}
      onTouchStart={(e) => {
        if (editing || e.touches.length !== 1) return;
        const t = e.touches[0];
        const p = { x: t.clientX, y: t.clientY, fired: false, timer: setTimeout(() => {
          p.fired = true;
          navigator.vibrate?.(10);
          onMenu({ x: p.x, y: p.y });
        }, 450) };
        press.current = p;
      }}
      onTouchMove={(e) => {
        const p = press.current;
        const t = e.touches[0];
        if (p && !p.fired && Math.hypot(t.clientX - p.x, t.clientY - p.y) > 8) {
          clearTimeout(p.timer);
          press.current = null;
        }
      }}
      onTouchEnd={(e) => {
        const p = press.current;
        press.current = null;
        if (!p) return;
        clearTimeout(p.timer);
        // 長押しでメニューを出したときは、指を離しても画像などを開かない
        if (p.fired) e.preventDefault();
      }}
      className={`group relative flex gap-2 rounded-[10px] px-1.5 [-webkit-touch-callout:none] ${mine ? "justify-end" : "justify-start"} ${grouped ? "mt-0.5 py-px" : "mt-2.5 pt-1 pb-px"} ${
        mentionsMe ? "bg-yellow-400/10 shadow-[inset_3px_0_0_#eab308]" : active ? "bg-ink/[0.04]" : "hover:bg-ink/[0.03]"
      }`}
    >
      {!mine && icon}
      <div className={`flex min-w-0 flex-col ${editing ? "w-full max-w-[min(560px,85%)]" : "max-w-[min(560px,85%)]"} ${mine ? "items-end" : "items-start"}`}>
        {!grouped && (
          // 自分の発言は、名前をアイコンの側（右）に寄せる
          <div className={`mb-0.5 flex items-baseline gap-2 px-1 text-xs text-muted ${mine ? "flex-row-reverse" : ""}`}>
            {onChangeSpeaker ? (
              <button className="font-bold text-ink underline decoration-dotted" title="押して話者を変える" onClick={onChangeSpeaker}>
                {authorName}
              </button>
            ) : author ? (
              <UserCardButton userId={author.id} role={author.role} label={authorName} className="font-bold text-ink hover:underline">
                {authorName}
              </UserCardButton>
            ) : (
              <b className="text-ink">{authorName}</b>
            )}
            <time dateTime={new Date(m.createdAt).toISOString()} title={fullTime(m.createdAt)}>
              {timeLabel(m.createdAt)}
            </time>
            {pinned && (
              <span title="ピン留め中" className="self-center text-muted">
                <Icon name="pin" size={12} />
              </span>
            )}
          </div>
        )}
        {reply !== undefined || m.replyTo ? (
          reply ? (
            // 引用：Discord と同じく、引用した人の小さなアイコン・名前・短い中身。押すとその発言まで動く
            <button
              type="button"
              onClick={() => onJumpReply(reply)}
              title="引用した発言へ"
              className="mb-0.5 flex max-w-full min-w-0 items-center gap-1.5 rounded-[8px] px-1.5 py-0.5 text-left text-xs text-muted hover:bg-tint hover:text-ink"
            >
              <Icon name="reply" size={12} className="shrink-0 -scale-x-100" />
              {replyAuthor && <Avatar name={replyName(reply)} src={replyAuthor.avatar} size={16} />}
              <b className="shrink-0 text-ink/80">{replyName(reply)}</b>
              <span className="min-w-0 truncate">{previewOf(reply)}</span>
            </button>
          ) : (
            <div className="mb-0.5 flex items-center gap-1.5 px-1.5 text-xs text-muted italic">
              <Icon name="reply" size={12} className="-scale-x-100" />
              削除された発言
            </div>
          )
        ) : null}
        {editing ? (
          <EditBox m={m} onDone={onEditEnd} onDelete={() => onDelete(false)} />
        ) : (
          <div className="flex max-w-full min-w-0 items-end gap-1.5">
            {mine && hoverTime}
            {mine && dots}
            {!send && readMark}
            {/* ルームへの招待は、吹き出しの代わりにカードで出す */}
            {m.inviteId ? (
              <InviteCard inviteId={m.inviteId} meId={meId} mine={mine} />
            ) : (
              // 画像は吹き出しに入れず、そのまま並べる（LINE と同じ）。文字があるときだけ、その下に吹き出しを出す
              // 狭いブロックの中では、画像も吹き出しも幅に合わせて縮む
              <div className={`flex min-w-0 flex-col gap-1 transition-opacity ${mine ? "items-end" : "items-start"} ${pending ? "opacity-60" : ""}`}>
                {images.length > 0 && (
                  <div className={`grid max-w-full gap-1 ${images.length > 1 ? "w-[324px] grid-cols-2 sm:w-[388px]" : "w-40 sm:w-48"}`}>
                    {images.map((id, i) => (
                      <button key={id} onClick={() => onOpen(i)} className="relative block aspect-square w-full overflow-hidden rounded-[10px]" aria-label={`画像を開く：${media.get(id)?.name}`}>
                        <ThumbImage id={id} alt={media.get(id)?.name ?? ""} />
                        <UploadGauge id={id} className="absolute right-2 bottom-2 left-2 h-1.5 rounded-full bg-black/50 shadow-[0_0_4px_#0008]" />
                      </button>
                    ))}
                  </div>
                )}
                {big ? (
                  // 絵文字だけの短い発言は、吹き出しに入れずに大きく出す（Discord・LINE と同じ）
                  <p className="px-1 text-[40px] leading-tight">
                    {m.text}
                    {m.editedAt && <span className="ml-1 align-middle text-[11px] text-muted">（編集済み）</span>}
                  </p>
                ) : (
                  (missing > 0 || !!m.text) && (
                    <div
                      className={`max-w-full rounded-[16px] px-3 py-2 ${
                        speakerTone !== undefined
                          ? SPEAKER_TONES[Math.max(0, speakerTone) % SPEAKER_TONES.length]
                          : mine
                            ? "bg-accent text-accent-ink"
                            : "border border-line bg-card"
                      }`}
                    >
                      {missing > 0 && <p className="text-xs opacity-70">（削除された画像 {missing}枚）</p>}
                      {m.text && (
                        <LongText text={m.text} tone={mine && speakerTone === undefined ? "accent" : "card"}>
                          {m.editedAt && (
                            <span title={`編集：${fullTime(m.editedAt)}`} className="ml-1 inline-block text-[11px] whitespace-nowrap opacity-70">
                              （編集済み）
                            </span>
                          )}
                        </LongText>
                      )}
                    </div>
                  )
                )}
              </div>
            )}
            {!mine && dots}
            {!mine && hoverTime}
          </div>
        )}
        {reactions && reactions.length > 0 && (
          <Reactions groups={reactions} meId={meId} mine={mine} nameOf={nameOf} onToggle={social ? onReact : undefined} onAdd={social ? onPickReaction : undefined} />
        )}
        <SendStatus m={m} state={send} />
      </div>
      {mine && icon}
    </div>
  );
}

/** 発言の下のリアクション。押すと自分の分を付ける・外す。乗せると付けた人の名前 */
function Reactions({
  groups,
  meId,
  mine,
  nameOf,
  onToggle,
  onAdd,
}: {
  groups: ReactionGroup[];
  meId: string;
  mine: boolean;
  nameOf: (id: string) => string;
  onToggle?: (emoji: string) => void;
  onAdd?: (anchor: Anchor) => void;
}) {
  return (
    <div data-name="リアクション" className={`mt-1 flex max-w-full flex-wrap gap-1 ${mine ? "justify-end" : ""}`}>
      {groups.map((g) => {
        const on = g.users.includes(meId);
        const names = g.users.map((id) => (id === meId ? "あなた" : nameOf(id)));
        return (
          <button
            key={g.emoji}
            type="button"
            disabled={!onToggle}
            aria-pressed={on}
            title={`${names.slice(0, 10).join("、")}${names.length > 10 ? ` ほか${names.length - 10}人` : ""}`}
            onClick={() => onToggle?.(g.emoji)}
            className={`flex h-7 items-center gap-1 rounded-[8px] border px-1.5 transition-colors ${
              on ? "border-accent bg-accent/15 text-accent" : "border-transparent bg-ink/[0.06] text-muted hover:border-line"
            } disabled:cursor-default`}
          >
            <span className="text-[17px] leading-none">{g.emoji}</span>
            <span className="text-xs font-bold tabular-nums">{g.users.length}</span>
          </button>
        );
      })}
      {onAdd && (
        <button
          type="button"
          aria-label="リアクションを付ける"
          title="リアクションを付ける"
          onClick={(e) => onAdd(e.currentTarget)}
          className="hidden h-7 w-8 place-items-center rounded-[8px] bg-ink/[0.06] text-muted group-hover:grid hover:text-ink"
        >
          <Icon name="smile" size={16} />
        </button>
      )}
    </div>
  );
}

/** 発言の操作のメニュー（右クリック・長押し・「…」）。いちばん上に、よく使う絵文字のリアクション */
function MessageMenu({
  state,
  social,
  canReply,
  canEdit,
  pinned,
  quick,
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
  pinned: boolean;
  quick: string[];
  onClose: () => void;
  onReact: (emoji: string) => void;
  onMoreReactions: () => void;
  onReply: () => void;
  onEdit: () => void;
  onPin: () => void;
  onDelete: (skipConfirm: boolean) => void;
}) {
  const { m, anchor } = state;
  const run = (f: () => void) => () => {
    onClose();
    f();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={236} label="発言の操作">
      {social && (
        <>
          <div className="flex items-center justify-between px-0.5 pb-1">
            {quick.slice(0, 5).map((e) => (
              <button key={e} type="button" aria-label={`${e} でリアクション`} onClick={run(() => onReact(e))} className="grid h-9 w-9 place-items-center rounded-full bg-ink/[0.05] text-lg hover:bg-tint">
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
function EditBox({ m, onDone, onDelete }: { m: Message; onDone: () => void; onDelete: () => void }) {
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

/**
 * 既読（LINE と同じ）。読める人が1人（DM など）なら「既読」、2人以上なら「既読 2」のように読んだ人数。
 * 人数を押すと、読んだ人と、まだ読んでいない人の一覧。だれも読んでいなければ何も出さない
 */
function ReadMark({ readers, audience, nameOf }: { readers: string[]; audience: string[]; nameOf: (id: string) => string }) {
  const pop = usePopover();
  if (!readers.length) return null;
  const cls = "shrink-0 self-end pb-0.5 text-[11px] leading-none text-muted";
  if (audience.length === 1) return <span className={cls}>既読</span>;
  const unread = audience.filter((id) => !readers.includes(id));
  const people = (ids: string[]) => (
    <ul className="grid gap-0.5 pb-1">
      {ids.map((id) => (
        <li key={id} className="truncate rounded-[8px] px-2 py-1 text-sm">
          {nameOf(id)}
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <button type="button" onClick={pop.toggle} title="押すと読んだ人" className={`${cls} hover:text-ink hover:underline`}>
        既読 {readers.length}
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={220} label="既読の人">
          <p className="px-2 pt-1 pb-0.5 text-xs text-muted">読んだ人 {readers.length}人</p>
          {people(readers)}
          {unread.length > 0 && (
            <>
              <p className="border-t border-line px-2 pt-1.5 pb-0.5 text-xs text-muted">まだ読んでいない人 {unread.length}人</p>
              {people(unread)}
            </>
          )}
        </Popover>
      )}
    </>
  );
}

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

type Mentionable = { id: string; name: string; avatar?: string };

/** 入力中の人の並び（Discord と同じ言い方） */
const typingLabel = (names: string[]) =>
  names.length === 1 ? `${names[0]}が入力中…` : names.length === 2 ? `${names[0]}と${names[1]}が入力中…` : names.length > 2 ? "何人かが入力中…" : "";

function Composer({
  chat,
  me,
  inputRef,
  speakers,
  replyTo,
  replyName,
  onClearReply,
  onSent,
  onEditLast,
  mentionables,
  typing,
  typers,
  target,
}: {
  chat: Chat;
  me: Profile;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** 再現チャットのとき、選べる話者 */
  speakers: string[] | null;
  replyTo: Message | null;
  replyName: string;
  onClearReply: () => void;
  /** 送ったあと（「ここから未読」の線を消す） */
  onSent: () => void;
  /** 空の欄で ↑ を押したとき（自分の最後の発言を直す）。直せる発言が無ければ false */
  onEditLast: () => boolean;
  /** @ で呼べる人 */
  mentionables: Mentionable[];
  typing: { ping: () => void; stop: () => void };
  /** 入力中のほかの人の名前 */
  typers: string[];
  /** 送る先（欄の中に薄く出す：#チャンネル・@相手） */
  target: string;
}) {
  const [text, setText] = useState(() => loadDraft(me.id, chat.id));
  const [attached, setAttached] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [speaker, setSpeaker] = useState(speakers?.[0] ?? "");
  const [emojiAt, setEmojiAt] = useState<HTMLElement | null>(null);
  const plus = usePopover();
  const file = useRef<HTMLInputElement>(null);
  const input = inputRef;
  // 欄の外へ移っても（絵文字を選ぶときなど）、入れる位置を覚えておく
  const caret = useRef<{ start: number; end: number }>({ start: text.length, end: text.length });
  // @ のあとに打っている名前（メンションの候補を出す）
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null);
  useAutoGrow(input, text);
  const canSend = (text.trim() || attached.length) && !uploading;
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
    const body = { text: text.trim(), replyTo: replyTo?.id ?? null, speaker: speakers ? speaker || speakers[0] : null };
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
    if (!images.length) return;
    setUploading(true);
    const { ids, toMine } = await uploadToRoom(chat.roomId, me.id, images);
    setUploading(false);
    setAttached((a) => [...a, ...ids]);
    // DM や、ボックスが紐づいていない・見るだけのルームでは、送った人のマイメディアに入る
    toast(`${ids.length}枚を${toMine ? "マイメディア" : "メディア"}に追加して添付しました`);
  };

  const iconBtn = "grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted hover:bg-tint hover:text-ink";

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
      {speakers && (
        <div data-name="話す人の選択" className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">話す人</span>
          {speakers.map((sp) => (
            <button
              key={sp}
              aria-pressed={speaker === sp}
              onClick={() => setSpeaker(sp)}
              className={`rounded-full border px-3 py-0.5 text-sm ${speaker === sp ? "border-accent bg-accent text-accent-ink" : "border-line hover:bg-tint"}`}
            >
              {sp}
            </button>
          ))}
          <button
            className="rounded-full border border-dashed border-line px-3 py-0.5 text-sm text-muted hover:bg-tint"
            onClick={async () => {
              const name = await promptText("話者を追加", "", "例：スタッフ");
              if (!name) return;
              await addSpeaker(chat.id, name);
              setSpeaker(name);
            }}
          >
            ＋話者
          </button>
        </div>
      )}
      <div className="overflow-hidden rounded-[14px] border border-line bg-card transition-colors focus-within:border-accent">
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
        <div className="flex items-end gap-0.5 px-1 py-0.5">
          <button className={iconBtn} aria-label="画像を添付" title="画像を添付" onClick={plus.toggle}>
            <Icon name="add" />
          </button>
          <textarea
            ref={input}
            value={text}
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
            placeholder={speakers ? `${speaker || speakers[0]}の発言` : `${target} へメッセージを送信`}
            title="Enterで送信・Shift＋Enterで改行・空の欄で ↑ を押すと最後の発言を直す・@ で人を呼ぶ"
            aria-label="メッセージ"
            className="min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none! placeholder:text-muted"
          />
          <button className={iconBtn} aria-label="絵文字" title="絵文字" onMouseDown={(e) => e.preventDefault()} onClick={(e) => setEmojiAt(emojiAt ? null : e.currentTarget)}>
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
