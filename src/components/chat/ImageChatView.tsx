"use client";

import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { ImageViewer } from "@/components/ImageViewer";
import { MediaPicker } from "@/components/MediaPicker";
import { ThumbImage } from "@/components/ThumbImage";
import { EmojiPicker } from "@/components/db/meta";
import { IconMark } from "@/components/IconMark";
import { MenuDivider, MenuItem, MenuLabel, Popover, usePopover } from "@/components/ui/Popover";
import { confirmAction } from "@/components/ui/overlay";
import { deleteImageUser, deleteMessage, changeSpeaker, saveImageUser, chatImageScope, useScopedImageUsers } from "@/lib/local/chat";
import type { Chat, ImageUser, Media, Message, Profile } from "@/lib/local/db";
import { useMediaByIds } from "@/lib/local/media";
import { useAllProfiles } from "@/lib/local/rooms";
import { useTyping } from "@/lib/local/typing";
import { LongText } from "./LongText";
import { SendStatus, useSendState } from "./SendStatus";
import { UploadGauge } from "@/components/media/Thumb";
import { NewBelowButton, UnreadLine } from "./ChatView";
import { Composer } from "./Composer";
import { DayDivider, EditBox, EditedMark, MenuDots, MessageMenu, MessageTime, sameDay, useMessageGestures, type MenuState } from "./messageParts";
import { emojiOnly } from "./RichText";
import { useChatPosition } from "./useChatPosition";
import { useMessageWindow } from "./useMessageWindow";
import { useReadProgress } from "./useReadProgress";
import { ChatSkeleton } from "@/components/Skeleton";
import { isBackdropClick } from "@/components/ui/backdrop";

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
 * 発言の操作（「…」・右クリック・長押しのメニュー、その場で直す欄）と入力欄は、ふつうのチャットと同じもの
 */
export function ImageChatView({
  chat,
  me,
  readOnlyNotice,
  fixedUsers = [],
}: {
  chat: Chat;
  me: Profile;
  readOnlyNotice?: string;
  fixedUsers?: ImageUser[];
}) {
  // fixedUsers：最初から入っている話す人（依頼者・参加者など）。名前はページやメンバーから取るので、ここでは直せない
  const roomUsers = useScopedImageUsers(chat.roomId, chat.id);
  const users = [...fixedUsers, ...(roomUsers ?? [])];
  // 発言は新しい方から少しずつ読み込む（上の端まで戻ると、その前を足す）
  const win = useMessageWindow(chat.id, me.id);
  const messages = win.messages;
  const list = useRef<HTMLDivElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
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
  // 「入力中…」には、書いている人（イメージユーザーではなく、ルームの人）の名前を出す
  const profiles = useAllProfiles();
  const nameOf = (id: string) => profiles?.find((p) => p.id === id)?.displayName ?? "退出した人";
  const typing = useTyping(chat.id, me.id);
  const canEdit = !readOnlyNotice;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [viewer, setViewer] = useState<{ items: Media[]; start: number } | null>(null);
  const ready = !!messages;
  // 既読は、画面に出た発言の分だけ付ける
  const read = useReadProgress(chat.id, me.id, list, messages);
  const { content, far, onScroll: followScroll } = useChatPosition(list, ready, messages?.at(-1), me.id, win.located, win.relocate);

  if (!messages) return <ChatSkeleton />;
  const userOf = (m: Message) => users.find((u) => u.id === m.speaker);
  const remove = async (m: Message, skipConfirm?: boolean) => {
    if (skipConfirm || (await confirmAction("この発言を削除します", "削除", "添付した画像はメディアに残ります。"))) await deleteMessage(m.id);
  };
  const endEdit = () => {
    setEditingId(null);
    composerInput.current?.focus();
  };
  /** 入力欄が空のときに ↑ で、最後の発言を直す（ふつうのチャットと同じ。イメージチャットの発言はメンバーの誰でも直せる） */
  const editLast = () => {
    const m = messages.at(-1);
    if (!m || !canEdit) return false;
    setEditingId(m.id);
    requestAnimationFrame(() => document.querySelector(`[data-msg="${CSS.escape(m.id)}"]`)?.scrollIntoView({ block: "nearest" }));
    return true;
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-name="イメージチャット">
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
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-3 pb-2"
        >
          <div ref={content}>
          {win.hasOlder && (
            <button type="button" onClick={() => void win.loadOlder(list.current)} className="mx-auto my-2 block rounded-full px-3 py-1 text-xs text-muted hover:bg-tint hover:text-ink">
              さらに前の発言を読み込む
            </button>
          )}
          {!messages.length && <p className="py-8 text-center text-sm text-muted">イメージユーザーを選んで、会話を書いていきましょう。</p>}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
            const firstUnread = m.id === win.unreadId;
            const grouped = !newDay && !firstUnread && prev?.speaker === m.speaker;
            const hasMenu = canEdit || !!m.text;
            return (
              <div key={m.id} data-msg={m.id} data-at={m.createdAt}>
                {newDay && <DayDivider at={m.createdAt} />}
                {firstUnread && <UnreadLine />}
                <ImageMessage
                  m={m}
                  user={userOf(m)}
                  right={!!speaker && m.speaker === speaker}
                  grouped={grouped}
                  media={byId}
                  mine={m.authorId === me.id}
                  editing={editingId === m.id}
                  active={menu?.m.id === m.id}
                  dotsOpen={menu?.m.id === m.id && menu.anchor instanceof HTMLElement}
                  onMenu={hasMenu ? (anchor) => setMenu({ m, anchor }) : undefined}
                  onEditEnd={endEdit}
                  onDelete={() => void remove(m)}
                  onOpen={(idx) => {
                    const items = m.mediaIds.map((id) => byId.get(id)).filter((x): x is Media => !!x);
                    if (items.length) setViewer({ items, start: Math.min(idx, items.length - 1) });
                  }}
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
          header={<ImageSpeakers chat={chat} me={me} scope={chatImageScope(chat.id)} users={users} speaker={speaker} onSpeaker={setSpeaker} />}
          speaker={speaker}
          disabledTitle={speaker ? undefined : "上の「＋イメージユーザー」で話す人を作ると書けます"}
          onSent={win.dismissUnread}
          onEditLast={editLast}
          typing={typing}
          typers={typing.typers.map(nameOf)}
          placeholder={`${users.find((u) => u.id === speaker)?.name ?? "イメージユーザー"}の発言`}
        />
      )}
      {menu && (
        <MessageMenu
          state={menu}
          social={false}
          canReply={false}
          canEdit={canEdit}
          onClose={() => setMenu(null)}
          onEdit={() => setEditingId(menu.m.id)}
          onDelete={(skip) => void remove(menu.m, skip)}
          extra={(close) =>
            canEdit && (
              <>
                <MenuDivider />
                <MenuLabel>話している人を変える</MenuLabel>
                {users.map((u) => (
                  <MenuItem
                    key={u.id}
                    icon={<ImageUserIcon user={u} size={20} />}
                    active={u.id === menu.m.speaker}
                    onClick={() => {
                      close();
                      void changeSpeaker(menu.m.id, u.id);
                    }}
                  >
                    {u.name}
                  </MenuItem>
                ))}
              </>
            )
          }
        />
      )}
      {viewer && <ImageViewer items={viewer.items} start={viewer.start} roomId={chat.roomId} onClose={() => setViewer(null)} />}
    </div>
  );
}

function ImageMessage({
  m,
  user,
  right,
  grouped,
  media,
  mine,
  editing,
  active,
  dotsOpen,
  onMenu,
  onEditEnd,
  onDelete,
  onOpen,
}: {
  m: Message;
  user: ImageUser | undefined;
  right: boolean;
  grouped: boolean;
  media: Map<string, Media>;
  /** 自分が書いた発言（届くまで「送信中…」を出す） */
  mine: boolean;
  editing: boolean;
  /** この発言のメニューを開いている（行に色を付けたままにする） */
  active: boolean;
  /** 「…」のボタンからメニューを開いている（乗せていなくてもボタンを出したままにする） */
  dotsOpen: boolean;
  /** メニューを開く。メニューに出すものが無い発言（見るだけで、文章の無い発言）は無し */
  onMenu?: (anchor: MenuState["anchor"]) => void;
  onEditEnd: () => void;
  onDelete: () => void;
  onOpen: (i: number) => void;
}) {
  const images = m.mediaIds.filter((id) => media.has(id));
  const missing = m.mediaIds.length - images.length;
  const name = user?.name ?? "削除されたユーザー";
  // 自分の発言が届くまでは薄く出す（Discord と同じ）
  const send = useSendState(m, mine);
  const pending = send === "sending" || send === "offline";
  const big = !editing && !missing && emojiOnly(m.text);
  // 右クリック・指で触る端末の長押しで、メニュー（ふつうのチャットと同じ）
  const gestures = useMessageGestures((anchor) => onMenu?.(anchor), editing || !onMenu);
  // 発言の操作のメニューを開く「…」（吹き出しの横）
  const dots = !editing && onMenu && <MenuDots open={dotsOpen} onOpen={onMenu} />;
  // 続けて送った発言は、乗せたときだけ時刻を出す
  const hoverTime = grouped && !editing && <MessageTime at={m.createdAt} className="shrink-0 self-end pb-0.5 text-[10px] text-muted opacity-0 group-hover:opacity-100" />;
  // アイコン（続けて送った発言では空けておく）。右の発言は右、左の発言は左に出す
  const icon = <span className="mt-0.5 w-[34px] shrink-0">{!grouped && <ImageUserIcon user={user} size={34} />}</span>;

  return (
    <div
      data-name={`発言（${name}）`}
      {...gestures}
      className={`group relative flex gap-2 rounded-[10px] px-1.5 [-webkit-touch-callout:none] ${right ? "justify-end" : "justify-start"} ${grouped ? "mt-0.5 py-px" : "mt-2.5 pt-1 pb-px"} ${
        active ? "bg-ink/[0.04]" : "hover:bg-ink/[0.03]"
      }`}
    >
      {!right && icon}
      <div className={`flex min-w-0 flex-col ${editing ? "w-full max-w-[min(560px,85%)]" : "max-w-[min(560px,85%)]"} ${right ? "items-end" : "items-start"}`}>
        {!grouped && (
          <div className={`mb-0.5 flex max-w-full items-baseline gap-2 px-1 text-xs text-muted ${right ? "flex-row-reverse" : ""}`}>
            <b className="min-w-0 truncate text-ink">{name}</b>
            <MessageTime at={m.createdAt} className="shrink-0" />
          </div>
        )}
        {editing ? (
          <EditBox m={m} onDone={onEditEnd} onDelete={onDelete} />
        ) : (
          <div className="flex max-w-full min-w-0 items-end gap-1.5">
            {right && hoverTime}
            {right && dots}
            {/* 画像は吹き出しに入れず、そのまま並べる（LINE と同じ）。文字があるときだけ、その下に吹き出しを出す。狭いブロックでは幅に合わせて縮む */}
            <div className={`flex min-w-0 flex-col gap-1 transition-opacity ${right ? "items-end" : "items-start"} ${pending ? "opacity-60" : ""}`}>
              {images.length > 0 && (
                <div className={`grid max-w-full gap-1 ${images.length > 1 ? "w-[324px] grid-cols-2 sm:w-[388px]" : "w-40 sm:w-48"}`}>
                  {images.map((id, i) => (
                    <button key={id} onClick={() => onOpen(i)} className="relative block aspect-square w-full overflow-hidden rounded-[12px]" aria-label={`画像を開く：${media.get(id)?.name}`}>
                      <ThumbImage id={id} alt={media.get(id)?.name ?? ""} />
                      <UploadGauge id={id} className="absolute right-2 bottom-2 left-2 h-1.5 rounded-full bg-black/50 shadow-[0_0_4px_#0008]" />
                    </button>
                  ))}
                </div>
              )}
              {big ? (
                // 絵文字だけの短い発言は、吹き出しに入れずに大きく出す（ふつうのチャットと同じ）
                <p className="px-1 text-[40px] leading-tight">
                  {m.text}
                  {m.editedAt && <EditedMark at={m.editedAt} />}
                </p>
              ) : (
                (missing > 0 || !!m.text) && (
                  <div className={`max-w-full rounded-[18px] px-3 py-2 ${right ? "rounded-br-[6px] bg-accent text-accent-ink" : "rounded-bl-[6px] border border-line bg-card"}`}>
                    {missing > 0 && <p className="text-xs opacity-70">（削除された画像 {missing}枚）</p>}
                    {m.text && (
                      <LongText text={m.text} tone={right ? "accent" : "card"}>
                        {m.editedAt && <EditedMark at={m.editedAt} />}
                      </LongText>
                    )}
                  </div>
                )
              )}
            </div>
            {!right && dots}
            {!right && hoverTime}
          </div>
        )}
        <SendStatus m={m} state={send} />
      </div>
      {right && icon}
    </div>
  );
}

/** 次の発言を話すイメージユーザーの並び（入力欄の上）。右クリック・「…」で名前とアイコンを直す・消す */
function ImageSpeakers({
  chat,
  me,
  scope,
  users,
  speaker,
  onSpeaker,
}: {
  chat: Chat;
  me: Profile;
  scope: string;
  users: ImageUser[];
  speaker: string | null;
  onSpeaker: (id: string) => void;
}) {
  const [editingUser, setEditingUser] = useState<ImageUser | "new" | null>(null);
  const userMenu = usePopover();
  const [menuUser, setMenuUser] = useState<ImageUser | null>(null);

  return (
    <>
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
            title="選んでいるイメージユーザーを編集"
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
              if (await confirmAction(`イメージユーザー「${menuUser.name}」を削除します`, "削除", `このユーザーの発言は「削除されたユーザー」として残ります。`)) await deleteImageUser(menuUser.id);
            }}
          >
            削除
          </MenuItem>
        </Popover>
      )}
      {editingUser && (
        <ImageUserDialog
          roomId={chat.roomId}
          scope={scope}
          userId={me.id}
          user={editingUser === "new" ? null : editingUser}
          onClose={(id) => {
            setEditingUser(null);
            if (id) onSpeaker(id);
          }}
        />
      )}
    </>
  );
}

/** イメージユーザーを作る・直す（名前と、絵文字かメディアの画像のアイコン） */
function ImageUserDialog({ roomId, scope, userId, user, onClose }: { roomId: string; scope: string; userId: string; user: ImageUser | null; onClose: (id?: string) => void }) {
  const [name, setName] = useState(user?.name ?? "");
  const [icon, setIcon] = useState<string | undefined>(user?.icon);
  const [mediaId, setMediaId] = useState<string | undefined>(user?.mediaId);
  const [picking, setPicking] = useState(false);
  const preview: ImageUser = { id: "", roomId, name: name || "？", icon, mediaId, createdAt: 0 };

  return (
    <div className="sheet-backdrop fixed inset-0 z-[57] flex items-end justify-center bg-black/50 sm:items-center" onClick={(e) => isBackdropClick(e) && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="イメージユーザー"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          // 新しく作るときだけ区切りを付ける（前に作った区切りの無いものは、直してもそのまま）
          onClose(await saveImageUser({ id: user?.id, roomId, ...(user ? {} : { scope }), name: name.trim(), icon: mediaId ? undefined : icon, mediaId }));
        }}
        className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-[20px] border border-line bg-card sm:rounded-[14px]"
      >
        {/* 見出しは、ほかのポップアップと同じ形（下に線、右上に「×」） */}
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h3 className="w-fit font-bold" title="作ったイメージユーザーは、このイメージチャットだけで使えます">
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
