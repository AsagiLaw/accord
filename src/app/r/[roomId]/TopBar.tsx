"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { DEFAULT_PAGE_ICON, IconMark } from "@/components/IconMark";
import { IconPicker } from "@/components/IconPicker";
import { usePopover } from "@/components/ui/Popover";
import { renameChannel, setChannelIcon, type ChannelKind } from "@/lib/local/channels";
import { renameChat, useChat } from "@/lib/local/chat";
import { renameNote, useNote } from "@/lib/local/notes";
import { nameSuffixOf, setDatabaseIcon, setPageIcon, updatePageTitle, useDatabase, usePage } from "@/lib/local/requests";
import type { PageTemplate } from "@/lib/local/db";
import { updateTemplate } from "@/lib/local/templates";
import { renameWindow, useWindowPage } from "@/lib/local/windows";

/**
 * Discord のような、メイン画面の上の細いバー。今の画面のアイコンと名前を出す（データベースのページは「データベース › ページ」）。
 * 今開いている画面のアイコン・名前は、押すとその場で変えられる。
 * 右には、画面ごとの操作（TopBarActions で入れる）。スマホでは、左のメニューのボタンの分をあける
 */
export function TopBar({ roomId, slotRef }: { roomId: string; slotRef: (el: HTMLElement | null) => void }) {
  const pathname = usePathname();
  const [kind, id, sub, subId] = pathname.slice(`/r/${roomId}`.length).split("/").filter(Boolean);
  return (
    <header data-name="上部バー" className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line pr-2 pl-[60px] text-sm md:h-8 md:px-[clamp(16px,4vw,40px)]">
      {/* メディアは場所の表示と操作をまとめて右の場所に入れるので、ここには何も出さない */}
      <nav aria-label="今の画面" className={`min-w-0 flex-1 items-center gap-0.5 ${kind === "media" ? "hidden" : "flex"}`}>
        {kind === "window" ? (
          <WindowCrumb roomId={roomId} id={id} />
        ) : kind === "db" ? (
          <DbCrumb roomId={roomId} dbId={id} pageId={sub === "p" ? subId : undefined} templateId={sub === "t" ? subId : undefined} />
        ) : kind === "note" ? (
          <NoteCrumb roomId={roomId} id={id} />
        ) : kind === "chat" ? (
          <ChatCrumb roomId={roomId} id={id} />
        ) : kind === "settings" ? (
          <Crumb icon={<Icon name="gear" size={16} />} label="設定" />
        ) : null}
      </nav>
      <div ref={slotRef} data-name="上部バーの操作" className={`flex items-center gap-2 ${kind === "media" ? "min-w-0 flex-1" : "shrink-0"}`} />
    </header>
  );
}

/** アイコンと名前（変えられないもの）。href があれば、押すとそこへ（前の階層は薄く出す） */
function Crumb({ icon, label, href }: { icon: React.ReactNode; label: string; href?: string }) {
  const body = (
    <>
      <span className="grid w-4 shrink-0 place-items-center text-[15px] leading-none">{icon}</span>
      <span className="truncate">{label}</span>
    </>
  );
  return href ? (
    // 前の階層（リンク）は、幅が足りないときに先に縮める（今開いているものの名前を残す）
    <Link href={href} className="flex min-w-[2.8em] shrink-[1000] items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-muted hover:bg-tint hover:text-ink">
      {body}
    </Link>
  ) : (
    <span className="flex min-w-0 items-center gap-1.5 px-1 font-bold">{body}</span>
  );
}

/**
 * 今開いている画面のアイコンと名前。アイコンを押すとアイコンを選べ、名前を押すとその場で名前を変えられる（Enter か外を押すと保存、Esc でやめる）
 */
function EditCrumb({
  roomId,
  icon,
  iconValue,
  onIcon,
  removeLabel,
  name,
  onRename,
  prefix = "",
  suffix = "",
  placeholder = "無題",
}: {
  roomId: string;
  /** 出すアイコン */
  icon: React.ReactNode;
  /** 今設定しているアイコン（無ければ標準のアイコンを出している） */
  iconValue?: string;
  onIcon: (icon: string | undefined) => unknown;
  removeLabel?: string;
  name: string;
  onRename: (name: string) => unknown;
  /** 名前の前後に添える言葉（「テンプレート「」」や「様」）。名前を変えるときは入力欄の外に出す */
  prefix?: string;
  suffix?: string;
  placeholder?: string;
}) {
  const iconPop = usePopover();
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => {
    const v = draft?.trim() ?? "";
    setDraft(null);
    // 空にしたときは、元の名前のまま
    if (v && v !== name) void onRename(v);
  };
  return (
    <span className="flex min-w-0 items-center gap-0.5 font-bold">
      <button onClick={iconPop.toggle} aria-label="アイコンを変える" title="アイコンを変える" className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] text-[15px] leading-none hover:bg-tint">
        {icon}
      </button>
      {iconPop.anchor && <IconPicker anchor={iconPop.anchor} roomId={roomId} hasIcon={!!iconValue} removeLabel={removeLabel} onPick={(i) => void onIcon(i)} onClose={iconPop.close} />}
      {draft !== null ? (
        <span className="flex min-w-0 items-center">
          {prefix && <span className="shrink-0 font-normal text-muted">{prefix}</span>}
          <input
            autoFocus
            value={draft}
            placeholder={placeholder}
            aria-label="名前"
            size={Math.max(6, [...draft].length * 2 + 2)}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={save}
            onKeyDown={(e) => {
              // 日本語の変換を決めるための Enter では保存しない
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setDraft(null);
            }}
            className="h-6 min-w-0 rounded-[6px] border border-accent bg-card px-1 text-sm font-bold outline-none"
          />
          {suffix && <span className="shrink-0 font-normal text-muted">{suffix}</span>}
        </span>
      ) : (
        <button onClick={() => setDraft(name)} title="名前を変える" className="flex min-w-0 items-center rounded-[6px] px-1 py-0.5 hover:bg-tint">
          {prefix && <span className="shrink-0 font-normal text-muted">{prefix}</span>}
          <span className={`truncate ${name ? "" : "text-muted"}`}>{name || placeholder}</span>
          {suffix && <span className="shrink-0 font-normal text-muted">{suffix}</span>}
        </button>
      )}
    </span>
  );
}

const KIND_ICON: Record<ChannelKind, IconName> = { db: "db", chat: "chat", note: "note", window: "window" };

/** サイドバーに出るもの（ウィンドウ・ノート・チャット・データベース）の、アイコンと名前を変えられる表示 */
function ChannelCrumb({ roomId, kind, id, name, icon, template }: { roomId: string; kind: ChannelKind; id: string; name: string; icon?: string; template?: boolean }) {
  const rename = (n: string) =>
    kind === "window" ? renameWindow(id, n) : kind === "note" ? renameNote(id, n) : kind === "chat" ? renameChat(id, n) : renameChannel({ kind, id }, n);
  return (
    <EditCrumb
      roomId={roomId}
      icon={<IconMark icon={icon} fallback={<Icon name={KIND_ICON[kind]} size={16} />} />}
      iconValue={icon}
      onIcon={(i) => (kind === "db" ? setDatabaseIcon(id, i) : setChannelIcon({ kind, id }, i))}
      removeLabel="種類のアイコンに戻す"
      name={name}
      onRename={rename}
      prefix={template ? "テンプレート「" : ""}
      suffix={template ? "」" : ""}
    />
  );
}

const Sep = () => <Icon name="rt" size={14} className="shrink-0 text-muted" />;

function WindowCrumb({ roomId, id }: { roomId: string; id: string }) {
  const win = useWindowPage(id);
  const source = useWindowPage(win?.sourceId ?? undefined);
  if (!win) return null;
  return (
    <>
      <ChannelCrumb roomId={roomId} kind="window" id={id} name={win.name} icon={win.icon} template={win.template} />
      {source && <SourceChip name={source.name} />}
    </>
  );
}

function NoteCrumb({ roomId, id }: { roomId: string; id: string }) {
  const note = useNote(id);
  const source = useNote(note?.sourceId ?? undefined);
  if (!note) return null;
  return (
    <>
      <ChannelCrumb roomId={roomId} kind="note" id={id} name={note.title} icon={note.icon} template={note.template} />
      {source && <SourceChip name={source.title} />}
    </>
  );
}

/** テンプレートと繋いでいるときの印（ソースのテンプレートの名前） */
function SourceChip({ name }: { name: string }) {
  return (
    <span className="ml-1 flex min-w-0 shrink items-center gap-1 rounded-full bg-tint px-2 py-0.5 text-xs text-muted" title="ソースのテンプレート">
      <Icon name="link" size={12} className="shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}

function ChatCrumb({ roomId, id }: { roomId: string; id: string }) {
  const chat = useChat(id);
  if (!chat) return null;
  return <ChannelCrumb roomId={roomId} kind="chat" id={id} name={chat.name} icon={chat.icon} />;
}

function DbCrumb({ roomId, dbId, pageId, templateId }: { roomId: string; dbId: string; pageId?: string; templateId?: string }) {
  const database = useDatabase(dbId);
  if (!database) return null;
  const href = `/r/${roomId}/db/${dbId}`;
  const icon = <IconMark icon={database.icon} fallback={<Icon name="db" size={16} />} />;
  const inner = !!(pageId || templateId);
  const template = templateId ? database.templates?.find((t) => t.id === templateId) : undefined;
  return (
    <>
      {/* データベースの画面ではアイコンと名前を変えられる。ページの中では、押すとデータベースへ戻る */}
      {inner ? <Crumb icon={icon} label={database.name} href={href} /> : <ChannelCrumb roomId={roomId} kind="db" id={dbId} name={database.name} icon={database.icon} />}
      {pageId && (
        <>
          <Sep />
          <PageCrumb roomId={roomId} pageId={pageId} suffix={nameSuffixOf(database)} templates={database.templates ?? []} />
        </>
      )}
      {template && (
        <>
          <Sep />
          <EditCrumb
            roomId={roomId}
            icon={<IconMark icon={template.icon} fallback={<Icon name="copy" size={16} />} />}
            iconValue={template.icon}
            onIcon={(i) => updateTemplate(dbId, template.id, { icon: i })}
            name={template.name}
            onRename={(n) => updateTemplate(dbId, template.id, { name: n })}
            prefix="テンプレート「"
            suffix="」"
          />
        </>
      )}
    </>
  );
}

function PageCrumb({ roomId, pageId, suffix, templates }: { roomId: string; pageId: string; suffix: string; templates: PageTemplate[] }) {
  const page = usePage(pageId);
  if (!page) return null;
  const source = page.sourceId ? templates.find((t) => t.id === page.sourceId) : undefined;
  return (
    <>
      <EditCrumb
        roomId={roomId}
        icon={<IconMark icon={page.icon || DEFAULT_PAGE_ICON} />}
        iconValue={page.icon}
        onIcon={(i) => setPageIcon(page.id, i)}
        name={page.title}
        onRename={(n) => updatePageTitle(page.id, n)}
        suffix={page.title ? suffix : ""}
      />
      {source && <SourceChip name={source.name} />}
    </>
  );
}
