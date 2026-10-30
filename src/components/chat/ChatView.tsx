"use client";

import { useMemo, useRef, useState } from "react";
import { UserCardButton } from "@/components/account/UserCard";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { ImageViewer } from "@/components/ImageViewer";
import { ThumbImage } from "@/components/ThumbImage";
import { choose, confirmAction, promptText, toast } from "@/components/ui/overlay";
import { Popover, usePopover, type Anchor } from "@/components/ui/Popover";
import {
  addSpeaker,
  changeSpeaker,
  deleteMessage,
  setPinned,
  toggleReaction,
  useChatReads,
  useMessagesByIds,
  useReactions,
  type ReactionGroup,
} from "@/lib/local/chat";
import type { Chat, Media, Message, Profile, RoomRole } from "@/lib/local/db";
import { useMediaByIds } from "@/lib/local/media";
import { useAllProfiles, type MemberWithProfile } from "@/lib/local/rooms";
import { useTyping } from "@/lib/local/typing";
import { InviteCard } from "./InviteCard";
import { SendStatus, useSendState } from "./SendStatus";
import { UploadGauge } from "@/components/media/Thumb";
import { LongText } from "./LongText";
import { Composer } from "./Composer";
import { EmojiPicker } from "./EmojiPicker";
import { recentEmoji } from "./emoji";
import { DayDivider, EditBox, EditedMark, MenuDots, MessageMenu, MessageTime, previewOf, sameDay, useMessageGestures, type MenuState } from "./messageParts";
import { emojiOnly, MentionProvider, mentions } from "./RichText";
import { useChatPosition } from "./useChatPosition";
import { jumpToMessage, useMessageWindow } from "./useMessageWindow";
import { useReadProgress } from "./useReadProgress";
import { ChatSkeleton } from "@/components/Skeleton";

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
  // 再現チャットで、次の発言を話す人
  const [speaker, setSpeaker] = useState(speakers[0]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ items: Media[]; start: number } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [reactPick, setReactPick] = useState<MenuState | null>(null);
  // よく使う絵文字（発言のメニューの上に出す）
  const [quick, setQuick] = useState(() => recentEmoji());
  const ready = !!messages && !!byId;
  // 既読は、画面に出た発言の分だけ付ける
  const read = useReadProgress(chat.id, me.id, list, ready ? messages : undefined);
  const { content, far, onScroll: followScroll } = useChatPosition(list, ready, messages?.at(-1), me.id, win.located, win.relocate);

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
              followScroll(el);
              win.onScroll(el);
              read.measure();
            }}
            className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-3 pb-2 ${reenact ? "rounded-[14px] bg-tint/40 px-3 pt-0" : ""}`}
          >
            <div ref={content}>
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
              <button type="button" onClick={() => void win.loadOlder(list.current)} className="mx-auto my-2 block rounded-full px-3 py-1 text-xs text-muted hover:bg-tint hover:text-ink">
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
                  {newDay && <DayDivider at={m.createdAt} />}
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
            header={reenact && <ReenactSpeakers chatId={chat.id} speakers={speakers} speaker={speaker} onSpeaker={setSpeaker} />}
            speaker={reenact ? speaker || speakers[0] : null}
            replyTo={replyTo}
            replyName={replyTo ? who(replyTo) : ""}
            onClearReply={() => setReplyTo(null)}
            onSent={win.dismissUnread}
            onEditLast={editLast}
            mentionables={mentionables}
            typing={typing}
            typers={typing.typers.map(nameOf)}
            placeholder={
              reenact ? `${speaker || speakers[0]}の発言` : `${chat.dm ? `@${nameOf(chat.dm.find((id) => id !== me.id) ?? "")}` : `#${chat.name || "チャット"}`} へメッセージを送信`
            }
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
  // 右クリック・指で触る端末の長押しで、メニュー（Discord と同じ）
  const gestures = useMessageGestures(onMenu, editing);

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
  // 発言の操作のメニューを開く「…」（吹き出しの横）
  const dots = !editing && <MenuDots open={dotsOpen} onOpen={onMenu} />;
  // 続けて送った発言は、乗せたときだけ時刻を出す
  const hoverTime = grouped && !editing && <MessageTime at={m.createdAt} className="shrink-0 self-end pb-0.5 text-[10px] text-muted opacity-0 group-hover:opacity-100" />;

  return (
    <div
      data-name={`発言（${authorName}）`}
      {...gestures}
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
            <MessageTime at={m.createdAt} />
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
                          {m.editedAt && <EditedMark at={m.editedAt} />}
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

/** やり取り再現チャットの、次の発言を話す人の並び（入力欄の上） */
function ReenactSpeakers({ chatId, speakers, speaker, onSpeaker }: { chatId: string; speakers: string[]; speaker: string; onSpeaker: (name: string) => void }) {
  return (
    <div data-name="話す人の選択" className="mb-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">話す人</span>
      {speakers.map((sp) => (
        <button
          key={sp}
          aria-pressed={speaker === sp}
          onClick={() => onSpeaker(sp)}
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
          await addSpeaker(chatId, name);
          onSpeaker(name);
        }}
      >
        ＋話者
      </button>
    </div>
  );
}
