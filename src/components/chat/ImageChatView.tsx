"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { ImageViewer } from "@/components/ImageViewer";
import { MediaPicker } from "@/components/MediaPicker";
import { ThumbImage } from "@/components/ThumbImage";
import { EmojiPicker } from "@/components/db/meta";
import { IconMark } from "@/components/IconMark";
import { MenuDivider, MenuItem, MenuLabel, Popover, usePopover } from "@/components/ui/Popover";
import { confirmAction } from "@/components/ui/overlay";
import { deleteImageUser, deleteMessage, editMessage, changeSpeaker, saveImageUser, sendMessage, useImageUsers } from "@/lib/local/chat";
import type { Chat, ImageUser, Media, Message, Profile } from "@/lib/local/db";
import { useMediaByIds } from "@/lib/local/media";
import { LongText } from "./LongText";
import { NewBelowButton, UnreadLine } from "./ChatView";
import { useMessageWindow } from "./useMessageWindow";
import { useReadProgress } from "./useReadProgress";
import { ChatSkeleton } from "@/components/Skeleton";

/** イメージユーザーのアイコン（絵文字かメディアの画像。無ければ名前の1文字目） */
export function ImageUserIcon({ user, size = 32 }: { user: ImageUser | undefined; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-tint font-bold" style={{ width: size, height: size, fontSize: size * 0.55 }}>
      {user?.mediaId ? <ThumbImage id={user.mediaId} alt="" /> : user?.icon ? <IconMark icon={user.icon} /> : user ? Array.from(user.name)[0] : "？"}
    </span>
  );
}

const SPEAKER_KEY = (chatId: string) => `irai-note:image-speaker:${chatId}`;
/** 最初から入っている話す人（ID が @ で始まる）は、名前やアイコンをここでは直せない */
const isFixed = (u: ImageUser) => u.id.startsWith("@");

/**
 * イメージチャット：イメージユーザー（名前とアイコン）で会話を再現する。
 * 下で選んでいるイメージユーザーの発言が右、それ以外が左。別の人に切り替えると左右が入れ替わる。
 */
export function ImageChatView({ chat, me, readOnlyNotice, fixedUsers = [] }: { chat: Chat; me: Profile; readOnlyNotice?: string; fixedUsers?: ImageUser[] }) {
  // fixedUsers：最初から入っている話す人（依頼者・参加者など）。名前はページやメンバーから取るので、ここでは直せない
  const roomUsers = useImageUsers(chat.roomId);
  const users = [...fixedUsers, ...(roomUsers ?? [])];
  // 発言は新しい方から少しずつ読み込む（上の端まで戻ると、その前を足す）
  const win = useMessageWindow(chat.id, me.id);
  const messages = win.messages;
  const list = useRef<HTMLDivElement>(null);
  // 添付した画像は、どのボックスに入っていても ID で引く
  const media = useMediaByIds(useMemo(() => (messages ?? []).flatMap((m) => m.mediaIds), [messages]));
  const byId = useMemo(() => media ?? new Map<string, Media>(), [media]);
  const [speakerState, setSpeakerState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SPEAKER_KEY(chat.id));
    } catch {
      return null;
    }
  });
  const speaker = users.find((u) => u.id === speakerState)?.id ?? users[0]?.id ?? null;
  const setSpeaker = (id: string) => {
    setSpeakerState(id);
    try {
      localStorage.setItem(SPEAKER_KEY(chat.id), id);
    } catch {
      // 保存できなくても、このページの間は効く
    }
  };
  const [viewer, setViewer] = useState<{ items: Media[]; start: number } | null>(null);
  const last = messages?.at(-1);
  const stick = useRef(true);
  const placed = useRef(false);
  const ready = !!messages;
  // 既読は、画面に出た発言の分だけ付ける
  const read = useReadProgress(chat.id, me.id, list, messages);

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

  if (!messages) return <ChatSkeleton />;
  const userOf = (m: Message) => users.find((u) => u.id === m.speaker);

  return (
    <div className="flex h-full min-h-0 flex-col" data-name="イメージチャット">
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
        className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-2"
      >
        {win.hasOlder && (
          <button type="button" onClick={(e) => void win.loadOlder(e.currentTarget.parentElement)} className="mx-auto block rounded-full px-3 py-1 text-xs text-muted hover:bg-tint hover:text-ink">
            さらに前の発言を読み込む
          </button>
        )}
        {!messages.length && <p className="py-8 text-center text-sm text-muted">イメージユーザーを選んで、会話を書いていきましょう。</p>}
        {messages.map((m, i) => {
          const u = userOf(m);
          const right = !!speaker && m.speaker === speaker;
          const firstUnread = m.id === win.unreadId;
          const grouped = !firstUnread && messages[i - 1]?.speaker === m.speaker;
          return (
            <div key={m.id} data-msg={m.id} data-at={m.createdAt}>
            {firstUnread && <UnreadLine />}
            <ImageMessage
              m={m}
              user={u}
              users={users}
              right={right}
              grouped={grouped}
              media={byId}
              canEdit={!readOnlyNotice}
              onOpen={(idx) => {
                const items = m.mediaIds.map((id) => byId.get(id)).filter((x): x is Media => !!x);
                if (items.length) setViewer({ items, start: idx });
              }}
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
        <ImageComposer chat={chat} me={me} users={users} speaker={speaker} onSpeaker={setSpeaker} onSent={win.dismissUnread} />
      )}
      {viewer && <ImageViewer items={viewer.items} start={viewer.start} roomId={chat.roomId} onClose={() => setViewer(null)} />}
    </div>
  );
}

function ImageMessage({
  m,
  user,
  users,
  right,
  grouped,
  media,
  canEdit,
  onOpen,
}: {
  m: Message;
  user: ImageUser | undefined;
  users: ImageUser[];
  right: boolean;
  grouped: boolean;
  media: Map<string, Media>;
  canEdit: boolean;
  onOpen: (i: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  const menu = usePopover();
  const images = m.mediaIds.filter((id) => media.has(id));
  const name = user?.name ?? "削除されたユーザー";

  return (
    <div data-name={`発言（${name}）`} className={`group flex items-end gap-2 ${right ? "flex-row-reverse" : ""} ${grouped ? "-mt-1" : ""}`}>
      <span className={grouped ? "invisible" : ""}>
        <ImageUserIcon user={user} size={34} />
      </span>
      <div className={`flex max-w-[min(520px,78%)] flex-col ${right ? "items-end" : "items-start"}`}>
        {!grouped && <span className="mb-0.5 px-1 text-xs font-bold text-muted">{name}</span>}
        {/* 画像は吹き出しに入れず、そのまま並べる（LINE と同じ）。文字や編集中の欄があるときだけ、その下に吹き出しを出す */}
        {images.length > 0 && (
          <div className={`grid gap-1 ${images.length > 1 ? "grid-cols-2" : ""}`}>
            {images.map((id, i) => (
              <button key={id} onClick={() => onOpen(i)} className="block h-40 w-40 overflow-hidden rounded-[12px]" aria-label="画像を開く">
                <ThumbImage id={id} alt="" />
              </button>
            ))}
          </div>
        )}
        {(editing || !!m.text) && (
          <div
            className={`${images.length > 0 ? "mt-1 " : ""}rounded-[18px] px-3 py-2 ${right ? "rounded-br-[6px] bg-accent text-accent-ink" : "rounded-bl-[6px] border border-line bg-card"}`}
          >
            {editing ? (
              <div className="space-y-1">
                <textarea
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void editMessage(m.id, draft.trim()).then(() => setEditing(false));
                    }
                    if (e.key === "Escape") setEditing(false);
                  }}
                  rows={Math.min(6, draft.split("\n").length + 1)}
                  className="field min-w-56 text-ink"
                />
                <div className="flex justify-end gap-2 text-xs">
                  <button className="underline" onClick={() => setEditing(false)}>
                    やめる
                  </button>
                  <button className="font-bold underline" onClick={() => editMessage(m.id, draft.trim()).then(() => setEditing(false))}>
                    保存
                  </button>
                </div>
              </div>
            ) : (
              m.text && <LongText text={m.text} />
            )}
          </div>
        )}
      </div>
      {canEdit && (
        <button
          aria-label="この発言のメニュー"
          onClick={menu.toggle}
          className="mb-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted opacity-0 group-hover:opacity-100 hover:bg-tint focus:opacity-100 max-md:opacity-60"
        >
          <Icon name="dots" size={16} />
        </button>
      )}
      {menu.anchor && (
        <Popover anchor={menu.anchor} onClose={menu.close} width={220} label="発言のメニュー">
          <MenuItem icon={<Icon name="edit" size={16} />} onClick={() => (setEditing(true), menu.close())}>
            文章を直す
          </MenuItem>
          <MenuDivider />
          <MenuLabel>話している人を変える</MenuLabel>
          {users.map((u) => (
            <MenuItem key={u.id} icon={<ImageUserIcon user={u} size={20} />} active={u.id === m.speaker} onClick={() => (changeSpeaker(m.id, u.id), menu.close())}>
              {u.name}
            </MenuItem>
          ))}
          <MenuDivider />
          <MenuItem
            icon={<Icon name="del" size={16} />}
            danger
            onClick={async () => {
              menu.close();
              if (await confirmAction("この発言を削除します", "削除")) await deleteMessage(m.id);
            }}
          >
            削除
          </MenuItem>
        </Popover>
      )}
    </div>
  );
}

function ImageComposer({
  chat,
  me,
  users,
  speaker,
  onSpeaker,
  onSent,
}: {
  chat: Chat;
  me: Profile;
  users: ImageUser[];
  speaker: string | null;
  onSpeaker: (id: string) => void;
  /** 送ったあと（「ここから未読」の線を消す） */
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [editingUser, setEditingUser] = useState<ImageUser | "new" | null>(null);
  const userMenu = usePopover();
  const [menuUser, setMenuUser] = useState<ImageUser | null>(null);
  const canSend = !!speaker && (text.trim() || attached.length);

  const send = async () => {
    if (!canSend || !speaker) return;
    await sendMessage(chat, me.id, { text: text.trim(), mediaIds: attached, replyTo: null, speaker });
    setText("");
    setAttached([]);
    onSent();
  };

  return (
    <div data-name="入力欄" className="border-t border-line pt-2">
      <div data-name="話す人の選択" className="mb-1.5 flex gap-1.5 overflow-x-auto pb-1">
        {users.map((u) => (
          <button
            key={u.id}
            aria-pressed={speaker === u.id}
            onClick={() => onSpeaker(u.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (isFixed(u)) return;
              setMenuUser(u);
              userMenu.openAt(e);
            }}
            title={isFixed(u) ? `${u.name}（最初から入っている人）` : `${u.name}（右クリックで編集）`}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border py-0.5 pr-3 pl-0.5 text-sm ${speaker === u.id ? "border-accent bg-accent text-accent-ink" : "border-line hover:bg-tint"}`}
          >
            <ImageUserIcon user={u} size={24} />
            {u.name}
          </button>
        ))}
        <button onClick={() => setEditingUser("new")} className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-line px-3 py-0.5 text-sm text-muted hover:bg-tint">
          <Icon name="add" size={14} />
          イメージユーザー
        </button>
        {speaker && !speaker.startsWith("@") && (
          <button
            aria-label="選んでいるイメージユーザーを編集"
            onClick={(e) => {
              setMenuUser(users.find((u) => u.id === speaker) ?? null);
              userMenu.open(e);
            }}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted hover:bg-tint"
          >
            <Icon name="dots" size={16} />
          </button>
        )}
      </div>
      {attached.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1.5">
          {attached.map((id) => (
            <div key={id} className="relative h-14 w-14 overflow-hidden rounded-md">
              <ThumbImage id={id} alt="" />
              <button aria-label="添付を外す" onClick={() => setAttached(attached.filter((x) => x !== id))} className="absolute top-0.5 right-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white">
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button className="btn-sub w-10 shrink-0 px-0" aria-label="メディアから画像を貼る" onClick={() => setPicking(true)}>
          <Icon name="img" />
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          rows={Math.min(5, text.split("\n").length)}
          // ふつうのチャットと同じ文字。話す人は上の並びで分かる。話す人がまだいないときの案内は、カーソルを合わせたときに出す
          placeholder="メッセージを入力"
          title={speaker ? "Enterで送信・Shift＋Enterで改行" : "上の「＋イメージユーザー」で話す人を作ると書けます"}
          aria-label="メッセージ"
          disabled={!speaker}
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
            setAttached((a) => [...a, ...ids.filter((x) => !a.includes(x))]);
            setPicking(false);
          }}
        />
      )}
      {userMenu.anchor && menuUser && (
        <Popover anchor={userMenu.anchor} onClose={userMenu.close} width={220} label={`イメージユーザー「${menuUser.name}」`}>
          <MenuItem icon={<Icon name="edit" size={16} />} onClick={() => (setEditingUser(menuUser), userMenu.close())}>
            名前とアイコンを変える
          </MenuItem>
          <MenuItem
            icon={<Icon name="del" size={16} />}
            danger
            onClick={async () => {
              userMenu.close();
              if (await confirmAction(`イメージユーザー「${menuUser.name}」を削除します`, "削除", "このユーザーの発言は「削除されたユーザー」として残ります。ほかのブロックからも使えなくなります。")) await deleteImageUser(menuUser.id);
            }}
          >
            削除
          </MenuItem>
        </Popover>
      )}
      {editingUser && (
        <ImageUserDialog
          roomId={chat.roomId}
          userId={me.id}
          user={editingUser === "new" ? null : editingUser}
          onClose={(id) => {
            setEditingUser(null);
            if (id) onSpeaker(id);
          }}
        />
      )}
    </div>
  );
}

/** イメージユーザーを作る・直す（名前と、絵文字かメディアの画像のアイコン） */
function ImageUserDialog({ roomId, userId, user, onClose }: { roomId: string; userId: string; user: ImageUser | null; onClose: (id?: string) => void }) {
  const [name, setName] = useState(user?.name ?? "");
  const [icon, setIcon] = useState<string | undefined>(user?.icon);
  const [mediaId, setMediaId] = useState<string | undefined>(user?.mediaId);
  const [picking, setPicking] = useState(false);
  const preview: ImageUser = { id: "", roomId, name: name || "？", icon, mediaId, createdAt: 0 };

  return (
    <div className="sheet-backdrop fixed inset-0 z-[57] flex items-end justify-center bg-black/50 sm:items-center" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="イメージユーザー"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onClose(await saveImageUser({ id: user?.id, roomId, name: name.trim(), icon: mediaId ? undefined : icon, mediaId }));
        }}
        className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-[20px] border border-line bg-card sm:rounded-[14px]"
      >
        {/* 見出しは、ほかのポップアップと同じ形（下に線、右上に「×」） */}
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h3 className="w-fit font-bold" title="作ったイメージユーザーは、ルームの誰でも、どのイメージチャットでも使えます">
            {user ? "イメージユーザーを直す" : "イメージユーザーを作る"}
          </h3>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-full hover:bg-tint" aria-label="閉じる" onClick={() => onClose()}>
            <Icon name="x" />
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto p-4">
        <div className="flex items-center gap-3">
          <ImageUserIcon user={preview} size={56} />
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="名前（例：依頼者さん）" className="field" aria-label="名前" />
        </div>
        {/* アイコン：ほかのアイコン選びと同じく、上のタブで絵文字かメディアの画像を選ぶ */}
        <div className="rounded-[12px] border border-line p-2">
          <EmojiPicker
            onPick={(e) => {
              setIcon(e);
              setMediaId(undefined);
            }}
            onMedia={() => setPicking(true)}
            onRemove={icon || mediaId ? () => (setIcon(undefined), setMediaId(undefined)) : undefined}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-sub" onClick={() => onClose()}>
            キャンセル
          </button>
          <button className="btn" disabled={!name.trim()}>
            {user ? "保存" : "作る"}
          </button>
        </div>
        </div>
        {picking && (
          <MediaPicker
            roomId={roomId}
            userId={userId}
            onClose={() => setPicking(false)}
            onPick={(ids) => {
              if (ids[0]) {
                setMediaId(ids[0]);
                setIcon(undefined);
              }
              setPicking(false);
            }}
          />
        )}
      </form>
    </div>
  );
}
