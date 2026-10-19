"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { UserCardButton } from "@/components/account/UserCard";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { ImageViewer } from "@/components/ImageViewer";
import { MediaPicker } from "@/components/MediaPicker";
import { ThumbImage } from "@/components/ThumbImage";
import { choose, confirmAction, promptText, toast } from "@/components/ui/overlay";
import { Popover, usePopover } from "@/components/ui/Popover";
import { addSpeaker, changeSpeaker, deleteMessage, editMessage, sendMessage, useChatReads, useMessagesByIds } from "@/lib/local/chat";
import type { Chat, Media, Message, Profile, RoomRole } from "@/lib/local/db";
import { ensureMyMedia } from "@/lib/local/boxes";
import { ensureInBox, uploadToRoom, useMediaByIds } from "@/lib/local/media";
import { MEDIA_DRAG_TYPE } from "@/lib/media/export";
import { isImageFile } from "@/lib/media/image";
import { useAllProfiles, type MemberWithProfile } from "@/lib/local/rooms";
import { InviteCard } from "./InviteCard";
import { LongText } from "./LongText";
import { jumpToMessage, useMessageWindow } from "./useMessageWindow";
import { useReadProgress } from "./useReadProgress";

const WEEK = "日月火水木金土";
const dayLabel = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`;
};
const timeLabel = (t: number) => new Date(t).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
/** 返信の引用などに出す、発言の短い中身 */
const previewOf = (m: Message) => (m.inviteId ? "（ルームへの招待）" : m.text || "（画像）");

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
  // 読み込んでいない古い発言への返信は、引用する発言だけを ID で引く
  const loadedIds = useMemo(() => new Set((messages ?? []).map((m) => m.id)), [messages]);
  const replies = useMessagesByIds(useMemo(() => [...new Set((messages ?? []).flatMap((m) => (m.replyTo && !loadedIds.has(m.replyTo) ? [m.replyTo] : [])))], [messages, loadedIds]));
  // 添付した画像は、どのボックスに入っていても ID で引く（チャットを見られる人なら必ず見られる）
  const byId = useMediaByIds(useMemo(() => (messages ?? []).flatMap((m) => m.mediaIds), [messages]));
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.displayName ?? "退出した人";
  // やり取り再現チャット：話者を選んで、依頼者とのやり取りを写して記録する
  const reenact = chat.kind === "reenact";
  const speakers = chat.speakers ?? ["依頼者", "自分"];
  const who = (m: Message) => (reenact ? (m.speaker ?? speakers[0]) : nameOf(m.authorId));
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
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [viewer, setViewer] = useState<{ items: Media[]; start: number } | null>(null);
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

  if (!messages || !byId) return <p className="loading text-muted">読み込み中…</p>;

  const open = (ids: string[], i: number) => {
    const items = ids.map((id) => byId.get(id)).filter((m): m is Media => !!m);
    if (items.length) setViewer({ items, start: Math.min(i, items.length - 1) });
  };

  return (
    <div data-name={reenact ? "やり取り再現チャット" : "チャット"} className="flex h-full min-h-0 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={list}
        data-name="発言一覧"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          win.onScroll(el);
          read.measure();
        }}
        className={`min-h-0 flex-1 overflow-y-auto pb-2 ${reenact ? "rounded-[14px] bg-tint/40 px-3" : ""}`}
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
                mine={reenact ? who(m) === "自分" : m.authorId === me.id}
                canEdit={reenact || m.authorId === me.id}
                grouped={grouped}
                authorName={who(m)}
                author={authorOf(m)}
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
                reply={m.replyTo ? (messages.find((x) => x.id === m.replyTo) ?? replies?.get(m.replyTo)) : undefined}
                onJumpReply={(r) => jumpToMessage(chat.id, r)}
                replyName={(r) => who(r)}
                media={byId}
                onReply={() => setReplyTo(m)}
                onOpen={(idx) => open(m.mediaIds, idx)}
              />
            </div>
          );
        })}
      </div>
      {read.newBelow > 0 && <NewBelowButton count={read.newBelow} list={list} />}
      </div>
      {readOnlyNotice ? (
        <p className="border-t border-line pt-2 text-center text-sm text-muted">{readOnlyNotice}</p>
      ) : (
        <Composer
          chat={chat}
          me={me}
          speakers={reenact ? speakers : null}
          replyTo={replyTo}
          replyName={replyTo ? who(replyTo) : ""}
          onClearReply={() => setReplyTo(null)}
          onSent={win.dismissUnread}
        />
      )}
      {viewer && <ImageViewer items={viewer.items} start={viewer.start} roomId={chat.roomId} onClose={() => setViewer(null)} />}
    </div>
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

/** 下にまだ見ていない発言があるときに出すボタン。押すと一番下へ */
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
      className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-ink shadow-md hover:opacity-90"
    >
      新しい発言 {count}件
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
  canEdit,
  grouped,
  authorName,
  speakerTone,
  onChangeSpeaker,
  reply,
  replyName,
  media,
  onReply,
  onOpen,
  onJumpReply,
}: {
  m: Message;
  meId: string;
  author?: Author;
  /** 自分の発言の左に出す既読 */
  readMark?: React.ReactNode;
  mine: boolean;
  canEdit: boolean;
  grouped: boolean;
  authorName: string;
  speakerTone?: number;
  onChangeSpeaker?: () => void;
  reply?: Message;
  replyName: (m: Message) => string;
  media: Map<string, Media>;
  onReply: () => void;
  onOpen: (index: number) => void;
  /** 引用した発言まで動く */
  onJumpReply: (r: Message) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  const images = m.mediaIds.filter((id) => media.has(id));
  const missing = m.mediaIds.length - images.length;

  const save = async () => {
    if (!draft.trim() && !m.mediaIds.length) return;
    await editMessage(m.id, draft.trim());
    setEditing(false);
  };

  return (
    <div data-name={`発言（${authorName}）`} className={`group flex gap-2 ${mine ? "justify-end" : "justify-start"} ${grouped ? "mt-0.5" : "mt-3"}`}>
      {/* ほかの人の発言は、左にアイコン（続けて送った発言では空けておく）。押すとプロフィールのカード */}
      {!mine && author && (
        <div className="w-9 shrink-0">
          {!grouped && (
            <UserCardButton userId={author.id} role={author.role} label={authorName} className="mt-0.5 block rounded-full hover:opacity-85">
              <Avatar name={authorName} src={author.avatar} size={36} />
            </UserCardButton>
          )}
        </div>
      )}
      <div className={`flex max-w-[min(560px,85%)] min-w-0 flex-col ${mine ? "items-end" : "items-start"}`}>
        {!grouped && (
          <div className="mb-0.5 flex items-baseline gap-2 px-1 text-xs text-muted">
            {onChangeSpeaker ? (
              <button className="font-bold text-ink underline decoration-dotted" title="押して話者を変える" onClick={onChangeSpeaker}>
                {authorName}
              </button>
            ) : (
              !mine &&
              (author ? (
                <UserCardButton userId={author.id} role={author.role} label={authorName} className="font-bold text-ink hover:underline">
                  {authorName}
                </UserCardButton>
              ) : (
                <b className="text-ink">{authorName}</b>
              ))
            )}
            <span>{timeLabel(m.createdAt)}</span>
          </div>
        )}
        {reply !== undefined || m.replyTo ? (
          reply ? (
            <button
              type="button"
              onClick={() => onJumpReply(reply)}
              title="引用した発言へ"
              className="mb-0.5 block max-w-full truncate rounded-[10px] border-l-4 border-accent bg-tint px-2 py-0.5 text-left text-xs text-muted hover:text-ink"
            >
              <b>{replyName(reply)}</b>：{previewOf(reply)}
            </button>
          ) : (
            <div className="mb-0.5 max-w-full truncate rounded-[10px] border-l-4 border-accent bg-tint px-2 py-0.5 text-xs text-muted">削除された発言</div>
          )
        ) : null}
        <div className="flex items-end gap-1">
          {mine && <Actions canEdit={canEdit} onReply={onReply} onEdit={m.inviteId ? undefined : () => setEditing(true)} invite={!!m.inviteId} id={m.id} />}
          {readMark}
          {/* ルームへの招待は、吹き出しの代わりにカードで出す */}
          {m.inviteId ? (
            <InviteCard inviteId={m.inviteId} meId={meId} mine={mine} />
          ) : (
            // 画像は吹き出しに入れず、そのまま並べる（LINE と同じ）。文字や編集中の欄があるときだけ、その下に吹き出しを出す
            <div className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
              {images.length > 0 && (
                <div className={`grid gap-1 ${images.length > 1 ? "grid-cols-2" : ""}`}>
                  {images.map((id, i) => (
                    <button key={id} onClick={() => onOpen(i)} className="block h-40 w-40 overflow-hidden rounded-[10px] sm:h-48 sm:w-48" aria-label={`画像を開く：${media.get(id)?.name}`}>
                      <ThumbImage id={id} alt={media.get(id)?.name ?? ""} />
                    </button>
                  ))}
                </div>
              )}
              {(missing > 0 || editing || !!m.text) && (
                <div
                  className={`rounded-[16px] px-3 py-2 ${
                    speakerTone !== undefined
                      ? SPEAKER_TONES[Math.max(0, speakerTone) % SPEAKER_TONES.length]
                      : mine
                        ? "bg-accent text-accent-ink"
                        : "border border-line bg-card"
                  }`}
                >
                  {missing > 0 && <p className="text-xs opacity-70">（削除された画像 {missing}枚）</p>}
                  {editing ? (
                    <div className="space-y-1">
                      <textarea
                        value={draft}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            save();
                          }
                          if (e.key === "Escape") setEditing(false);
                        }}
                        rows={Math.min(6, draft.split("\n").length + 1)}
                        className="field min-w-56 text-ink"
                      />
                      <div className="flex justify-end gap-1 text-xs">
                        <button className="rounded-full px-2 py-0.5 underline" onClick={() => setEditing(false)}>
                          やめる
                        </button>
                        <button className="rounded-full px-2 py-0.5 font-bold underline" onClick={save}>
                          保存
                        </button>
                      </div>
                    </div>
                  ) : (
                    m.text && (
                      <LongText text={m.text}>{m.editedAt && <span className="ml-1 text-[11px] opacity-70">（編集済み）</span>}</LongText>
                    )
                  )}
                </div>
              )}
            </div>
          )}
          {!mine && <Actions canEdit={canEdit} onReply={onReply} onEdit={m.inviteId ? undefined : () => setEditing(true)} invite={!!m.inviteId} id={m.id} />}
        </div>
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

/** 発言の横の操作。onEdit が無い発言（招待のカード）は、直せない。invite は招待のカード（消すと招待も取り消す） */
function Actions({ canEdit, onReply, onEdit, invite, id }: { canEdit: boolean; onReply: () => void; onEdit?: () => void; invite?: boolean; id: string }) {
  const btn = "grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-tint hover:text-ink";
  return (
    <div className="flex shrink-0 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-60">
      <button className={btn} aria-label="返信" title="返信" onClick={onReply}>
        <Icon name="reply" size={16} />
      </button>
      {canEdit && (
        <>
          {onEdit && (
            <button className={btn} aria-label="編集" title="編集" onClick={onEdit}>
              <Icon name="edit" size={16} />
            </button>
          )}
          <button
            className={btn}
            aria-label={invite ? "招待を取り消す" : "削除"}
            title={invite ? "招待を取り消す" : "削除"}
            onClick={async () => {
              const ok = invite
                ? await confirmAction("この招待を取り消します", "取り消す", "招待のカードが消え、相手はこの招待で参加できなくなります（もう参加していれば、そのままです）。")
                : await confirmAction("この発言を削除します", "削除", "添付した画像はメディアに残ります。");
              if (ok) deleteMessage(id);
            }}
          >
            <Icon name="del" size={16} />
          </button>
        </>
      )}
    </div>
  );
}

function Composer({
  chat,
  me,
  speakers,
  replyTo,
  replyName,
  onClearReply,
  onSent,
}: {
  chat: Chat;
  me: Profile;
  /** 再現チャットのとき、選べる話者 */
  speakers: string[] | null;
  replyTo: Message | null;
  replyName: string;
  onClearReply: () => void;
  /** 送ったあと（「ここから未読」の線を消す） */
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [speaker, setSpeaker] = useState(speakers?.[0] ?? "");
  const input = useRef<HTMLTextAreaElement>(null);
  const canSend = (text.trim() || attached.length) && !uploading;

  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);

  const send = async () => {
    if (!canSend) return;
    let mediaIds = attached;
    // DM で送る画像は、送った人のマイメディアに入れる（ほかのボックスから選んだ画像は、マイメディアにコピーして送る）
    if (chat.dm && attached.length) {
      const r = await ensureInBox(attached, await ensureMyMedia(me.id), me.id);
      mediaIds = r.ids;
      if (r.copied) toast(`${r.copied}枚をマイメディアにコピーして送りました`);
    }
    await sendMessage(chat, me.id, { text: text.trim(), mediaIds, replyTo: replyTo?.id ?? null, speaker: speakers ? speaker || speakers[0] : null });
    setText("");
    setAttached([]);
    onClearReply();
    onSent();
  };

  // 貼り付け・ドロップした画像も、まずメディアに入れてから添付する
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

  return (
    <div
      data-name="入力欄"
      className="border-t border-line pt-2"
      // メディアの画像をドラッグしてきたときは、ファイルの追加として扱わない（同じ画像が二重に増えないように）
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && !e.dataTransfer.types.includes(MEDIA_DRAG_TYPE) && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length || e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) return;
        e.preventDefault();
        uploadAndAttach([...e.dataTransfer.files]);
      }}
    >
      {replyTo && (
        <div className="mb-1 flex items-center gap-2 rounded-[10px] bg-tint px-3 py-1 text-sm">
          <Icon name="reply" size={14} />
          <span className="min-w-0 flex-1 truncate">
            <b>{replyName}</b> に返信：{previewOf(replyTo)}
          </span>
          <button aria-label="返信をやめる" onClick={onClearReply} className="grid h-6 w-6 place-items-center rounded-full hover:bg-tint">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      {(attached.length > 0 || uploading) && (
        <div className="mb-1 flex flex-wrap gap-1.5">
          {attached.map((id) => (
            <div key={id} className="relative h-16 w-16 overflow-hidden rounded-md">
              <ThumbImage id={id} alt="" />
              <button
                aria-label="添付を外す"
                onClick={() => setAttached(attached.filter((x) => x !== id))}
                className="absolute top-0.5 right-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white"
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
          {uploading && <span className="self-center text-sm text-muted">メディアに追加中…</span>}
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
      <div className="flex items-end gap-2">
        <button className="btn-sub w-10 shrink-0 px-0" aria-label="メディアから画像を貼る" title="メディアから画像を貼る" onClick={() => setPicking(true)}>
          <Icon name="img" />
        </button>
        <textarea
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              uploadAndAttach(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={Math.min(6, text.split("\n").length)}
          placeholder={speakers ? `${speaker || speakers[0]}の発言` : "メッセージを入力"}
          title="Enterで送信・Shift＋Enterで改行"
          aria-label="メッセージ"
          className="field min-h-[36px] flex-1 resize-none py-1.5 text-sm"
        />
        <button className="btn w-12 shrink-0 px-0" aria-label="送信" disabled={!canSend} onClick={send}>
          <Icon name="send" />
        </button>
      </div>
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
