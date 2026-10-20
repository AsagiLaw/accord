"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_PAGE_ICON, IconMark } from "@/components/IconMark";
import { DatabasePopup } from "@/components/db/DatabasePopup";
import { NewPageDialog } from "@/components/db/NewPageDialog";
import { PageMenu } from "@/components/db/PageMenu";
import { FilterScreens, SortScreens, sortText } from "@/components/db/ViewSettings";
import { ViewSaveContext } from "@/components/db/viewSave";
import { NavRow } from "@/components/ui/SettingsMenu";
import { Icon, type IconName } from "@/components/Icon";
import { MenuDivider, MenuItem, MenuLabel, Popover, usePopover, type Anchor } from "@/components/ui/Popover";
import { confirmAction, promptText } from "@/components/ui/overlay";
import { openSourceEdit, pickTemplateForNew, SourceMenu, SourceName, type SourceTarget } from "@/components/window/channelSource";
import { useUnreadCounts } from "@/lib/local/chat";
import { hasUnseenUpdate, useNoteSeen } from "@/lib/local/noteSeen";
import {
  CHANNEL_KINDS,
  channelHref,
  createCategory,
  createChannel,
  createDbCategory,
  deleteCategory,
  deleteChannel,
  deleteDatabase,
  moveCategory,
  moveChannel,
  renameCategory,
  renameChannel,
  useCategories,
  useChannels,
  type Channel,
  type ChannelKind,
} from "@/lib/local/channels";
import type { Category, Database, DbPage, DbView } from "@/lib/local/db";
import { linkTemplate, useChannelTemplates, type TemplateKind } from "@/lib/local/channelTemplates";
import { updateDatabase, useDatabase, useDatabases, usePages, useViews } from "@/lib/local/requests";
import { useMembers } from "@/lib/local/rooms";
import { setSidebarFilter, setSidebarView } from "@/lib/local/templates";
import { P } from "@/lib/requests/defaults";
import { applyView } from "@/lib/requests/logic";
import { badgeTone, useDoNotDisturb } from "@/lib/local/dnd";
import { DueBadge } from "@/components/db/views/common";
import { dueStatus, isPageDone } from "@/lib/requests/due";

const KIND_ICON: Record<ChannelKind, IconName> = { chat: "chat", note: "note", window: "window" };
const DEFAULT_NAME: Record<ChannelKind, string> = { chat: "新しいチャット", note: "新しいノート", window: "新しいウィンドウ" };

/** 作るカテゴリーの種類：通常カテゴリー（チャンネルを入れる）・データベースカテゴリー（データベースのページが並ぶ） */
type CategoryKind = "normal" | "db";
/** category はデータベースカテゴリー（cat.dbId がある）のときもある */
type Target = { type: "empty" } | { type: "category"; cat: Category } | { type: "channel"; ch: Channel };
type Step = "main" | "kinds" | "catKinds" | "move" | "sidebar" | "source" | "addPage";
/** サイドバーから足すページのテンプレート：既定のテンプレート・使わない・選んだテンプレート（ID） */
type AddChoice = { dbId: string; template: "default" | "none" | string };
type Drag = { type: "channel"; ch: Channel } | { type: "category"; id: string };
type Drop = { type: "channel"; categoryId: string | null; index: number } | { type: "category"; index: number };

/**
 * Discord のようなサイドバー：カテゴリーの中にチャンネル（チャット・ノート・ウィンドウ）が並ぶ。
 * データベースはデータベースカテゴリーとして出し、中にページが並ぶ（「⋯」の「編集」でデータベースの画面をポップアップで開く）。
 * カテゴリーの＋や右クリックで作成、ドラッグで移動・並べ替え。
 */
export function ChannelNav({ roomId, userId }: { roomId: string; userId: string }) {
  const categories = useCategories(roomId) ?? [];
  const channels = useChannels(roomId) ?? [];
  const databases = useDatabases(roomId);
  const templates = useChannelTemplates(roomId) ?? [];
  const unread = useUnreadCounts(roomId, userId);
  const noteSeen = useNoteSeen(userId);
  const pathname = usePathname();
  const router = useRouter();
  const menu = usePopover();
  const [target, setTarget] = useState<Target>({ type: "empty" });
  const [step, setStep] = useState<Step>("main");
  const [adding, setAdding] = useState<AddChoice | null>(null);
  // データベースの画面のポップアップ（ほかの画面へ移ったら閉じる）
  const [editing, setEditing] = useState<{ dbId: string; at: string } | null>(null);
  const editingNow = editing && editing.at === pathname ? editing : null;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(`irai-note:collapsed:${roomId}`) ?? "[]");
    } catch {
      return [];
    }
  });
  const total = [...(unread?.values() ?? [])].reduce((a, b) => a + b, 0);

  // ブラウザのタブにも未読の数を出す（取り込み中は出さない）
  const quiet = useDoNotDisturb();
  useEffect(() => {
    document.title = total && !quiet ? `(${total}) Accord` : "Accord";
  }, [total, quiet]);

  const toggle = (id: string) => {
    const next = collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id];
    setCollapsed(next);
    try {
      localStorage.setItem(`irai-note:collapsed:${roomId}`, JSON.stringify(next));
    } catch {
      // 保存できなくても、このページの間は効く
    }
  };

  const openMenu = (t: Target, s: Step, at: Anchor | null) => {
    setTarget(t);
    setStep(s);
    if (at) menu.close();
    // 閉じてから開き直すと位置が変わるので、次の描画で開く
    setTimeout(() => at && (at instanceof HTMLElement ? menu.open({ currentTarget: at }) : menu.openAt({ clientX: at.x, clientY: at.y, preventDefault() {} })));
  };
  const onContext = (t: Target) => (e: React.MouseEvent) => {
    // ここから開いたポップアップ（データベースの画面など）の中の右クリックも React ではここまで伝わるので、一覧の外なら何もしない
    if (!e.currentTarget.contains(e.target as Node)) return;
    e.preventDefault();
    e.stopPropagation();
    openMenu(t, "main", { x: e.clientX, y: e.clientY });
  };

  const newChannel = async (kind: ChannelKind, categoryId: string | null) => {
    menu.close();
    const name = await promptText(`${CHANNEL_KINDS[kind].label}を作成`, DEFAULT_NAME[kind], "名前");
    if (!name) return;
    // ウィンドウ・ノートは、はじめからテンプレートを使える（テンプレートがあるときだけ聞く）
    const template = kind === "window" || kind === "note" ? await pickTemplateForNew(templates, kind) : undefined;
    if (template === null) return;
    const id = await createChannel(roomId, userId, kind, name, categoryId);
    if (template) await linkTemplate(kind as TemplateKind, id, template.id);
    router.push(channelHref(roomId, { kind, id }));
  };
  const newCategory = async (kind: CategoryKind, before?: string) => {
    menu.close();
    if (kind === "db") {
      // 作ったら、項目やビューを整えられるように、データベースの画面をポップアップで開く
      const name = await promptText("データベースカテゴリーを作成", "新しいデータベース", "名前");
      if (!name) return;
      const dbId = await createDbCategory(roomId, name, before);
      setEditing({ dbId, at: pathname });
      return;
    }
    const name = await promptText("カテゴリーを作成", "", "カテゴリーの名前");
    if (name) await createCategory(roomId, name, before);
  };

  const listOf = (categoryId: string | null) => channels.filter((c) => c.categoryId === categoryId);
  /** カテゴリーの名前（データベースカテゴリーは、データベースの名前） */
  const nameOf = (cat: Category) => (cat.dbId ? (databases?.find((d) => d.id === cat.dbId)?.name ?? cat.name) : cat.name);

  // ---- ドラッグ ----
  const onRowDragOver = (e: React.DragEvent, ch: Channel, index: number) => {
    if (drag?.type !== "channel") return;
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setDrop({ type: "channel", categoryId: ch.categoryId, index: e.clientY > r.top + r.height / 2 ? index + 1 : index });
  };
  const onHeaderDragOver = (e: React.DragEvent, cat: Category, catIndex: number) => {
    // データベースカテゴリーには、チャンネルは入れられない
    if (!drag || (drag.type === "channel" && cat.dbId)) return;
    e.preventDefault();
    e.stopPropagation();
    if (drag.type === "channel") setDrop({ type: "channel", categoryId: cat.id, index: listOf(cat.id).length });
    else {
      const r = e.currentTarget.getBoundingClientRect();
      setDrop({ type: "category", index: e.clientY > r.top + r.height / 2 ? catIndex + 1 : catIndex });
    }
  };
  const finish = async () => {
    const d = drag;
    const p = drop;
    setDrag(null);
    setDrop(null);
    if (!d || !p) return;
    if (d.type === "channel" && p.type === "channel") {
      // 同じカテゴリーの中で下へ動かすときは、自分が抜けた分だけ位置がずれる
      const list = listOf(p.categoryId);
      const from = list.findIndex((c) => c.kind === d.ch.kind && c.id === d.ch.id);
      const index = from >= 0 && from < p.index ? p.index - 1 : p.index;
      await moveChannel(d.ch, p.categoryId, index, channels);
    }
    if (d.type === "category" && p.type === "category") {
      const from = categories.findIndex((c) => c.id === d.id);
      await moveCategory(roomId, d.id, from < p.index ? p.index - 1 : p.index);
    }
  };
  const line = <div className="mx-2 h-0.5 rounded-full bg-accent" />;

  const row = (ch: Channel, index: number) => {
    const href = channelHref(roomId, ch);
    const active = pathname === href;
    const n = ch.kind === "chat" ? (unread?.get(ch.id) ?? 0) : 0;
    // ノート：ほかの人が直して、まだ開いていない更新があれば、名前を太くして印を出す
    const updated = ch.kind === "note" && !active && hasUnseenUpdate(noteSeen, userId, ch);
    const showLine = drop?.type === "channel" && drop.categoryId === ch.categoryId && drop.index === index;
    return (
      <div key={`${ch.kind}:${ch.id}`}>
        {showLine && line}
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            setDrag({ type: "channel", ch });
          }}
          onDragOver={(e) => onRowDragOver(e, ch, index)}
          onDrop={(e) => (e.preventDefault(), finish())}
          onDragEnd={() => (setDrag(null), setDrop(null))}
          onContextMenu={onContext({ type: "channel", ch })}
          data-name={`チャンネル「${ch.name || "無題"}」（${CHANNEL_KINDS[ch.kind].label}）`}
          className={`group flex min-h-[36px] items-center rounded-[10px] transition ${active ? "bg-accent font-bold text-accent-ink" : "hover:bg-tint"} ${drag?.type === "channel" && drag.ch.id === ch.id ? "opacity-40" : ""}`}
        >
          <Link href={href} draggable={false} className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 ${(n && !active) || updated ? "font-bold" : ""}`}>
            {ch.icon ? (
              <span className="w-4 shrink-0 text-center">
                <IconMark icon={ch.icon} />
              </span>
            ) : (
              <Icon name={KIND_ICON[ch.kind]} size={16} className="shrink-0" />
            )}
            <span className={`truncate ${ch.name ? "" : "text-muted"}`}>{ch.name || "無題"}</span>
            {ch.sourceId && (
              <span title="テンプレートと繋いでいます" className="shrink-0 opacity-60">
                <Icon name="link" size={12} />
              </span>
            )}
          </Link>
          {n > 0 && !active && <UnreadBadge n={n} className="mr-1" />}
          {updated && <UpdatedDot />}
          <button
            aria-label={`「${ch.name || "無題"}」のメニュー`}
            onClick={(e) => openMenu({ type: "channel", ch }, "main", e.currentTarget)}
            className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-full opacity-60 hover:bg-tint hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
          >
            <Icon name="dots" size={16} />
          </button>
        </div>
      </div>
    );
  };

  const channelList = (categoryId: string | null) => {
    const list = listOf(categoryId);
    const endLine = drop?.type === "channel" && drop.categoryId === categoryId && drop.index === list.length;
    return (
      <div className="space-y-0.5">
        {list.map(row)}
        {endLine && line}
      </div>
    );
  };

  const uncategorized = listOf(null);

  return (
    <div
      data-name="チャンネル一覧"
      onContextMenu={onContext({ type: "empty" })}
      onDragOver={(e) => {
        // カテゴリーの外（一番上）に出す
        if (drag?.type === "channel") {
          e.preventDefault();
          if (!uncategorized.length) setDrop({ type: "channel", categoryId: null, index: 0 });
        }
        if (drag?.type === "category") {
          e.preventDefault();
          setDrop({ type: "category", index: categories.length });
        }
      }}
      onDrop={(e) => (e.preventDefault(), finish())}
      className="min-h-full pt-px pb-2"
    >
      {(uncategorized.length > 0 || (drag?.type === "channel" && drop?.type === "channel" && drop.categoryId === null)) && (
        <div className="mt-3">{channelList(null)}</div>
      )}

      {categories.map((cat, ci) => {
        const isCollapsed = collapsed.includes(cat.id) && !(drag?.type === "channel" && drop?.type === "channel" && drop.categoryId === cat.id);
        const catLine = drop?.type === "category" && drop.index === ci;
        const name = nameOf(cat);
        const dbId = cat.dbId;
        return (
          <div key={cat.id} className="mt-4">
            {catLine && line}
            <div
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setDrag({ type: "category", id: cat.id });
              }}
              onDragOver={(e) => onHeaderDragOver(e, cat, ci)}
              onDrop={(e) => (e.preventDefault(), e.stopPropagation(), finish())}
              onDragEnd={() => (setDrag(null), setDrop(null))}
              onContextMenu={onContext({ type: "category", cat })}
              data-name={dbId ? `データベースカテゴリー「${name}」` : `カテゴリー「${cat.name}」`}
              className={`group mb-0.5 flex items-center gap-0.5 pr-1 text-xs text-muted ${drag?.type === "category" && drag.id === cat.id ? "opacity-40" : ""}`}
            >
              <button onClick={() => toggle(cat.id)} aria-expanded={!isCollapsed} className="flex min-w-0 flex-1 items-center gap-0.5 py-1 pl-1 text-left hover:text-ink">
                <Icon name={isCollapsed ? "rt" : "dn"} size={14} className="shrink-0" />
                <span className="truncate font-bold tracking-wide">{name}</span>
              </button>
              {dbId ? (
                // データベースカテゴリー：中のページのチャットの未読と、⋯（編集などのメニュー）と、＋（ページを追加）
                <>
                  <DbUnread dbId={dbId} roomId={roomId} userId={userId} />
                  <button
                    aria-label={`「${name}」のメニュー`}
                    title="メニュー"
                    onClick={(e) => openMenu({ type: "category", cat }, "main", e.currentTarget)}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-tint hover:text-ink"
                  >
                    <Icon name="dots" size={16} />
                  </button>
                  <button
                    aria-label={`「${name}」にページを追加`}
                    title="ページを追加"
                    onClick={() => setAdding({ dbId, template: "default" })}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-tint hover:text-ink"
                  >
                    <Icon name="add" size={16} />
                  </button>
                </>
              ) : (
                <button
                  aria-label={`「${cat.name}」にチャンネルを作成`}
                  title="チャンネルを作成"
                  onClick={(e) => openMenu({ type: "category", cat }, "kinds", e.currentTarget)}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-tint hover:text-ink"
                >
                  <Icon name="add" size={16} />
                </button>
              )}
            </div>
            {dbId ? (
              // 閉じているときは、今開いているページだけ出す（チャンネルと同じ）
              <DbPages dbId={dbId} roomId={roomId} userId={userId} onlyActive={isCollapsed} />
            ) : (
              <>
                {!isCollapsed && channelList(cat.id)}
                {isCollapsed && listOf(cat.id).filter((c) => pathname.startsWith(channelHref(roomId, c))).map((c) => row(c, listOf(cat.id).indexOf(c)))}
              </>
            )}
          </div>
        );
      })}
      {drop?.type === "category" && drop.index === categories.length && <div className="mt-4">{line}</div>}

      {!channels.length && !categories.length && <p className="px-3 pt-3 text-xs text-muted">右クリックでカテゴリーやチャンネルを作れます</p>}

      {menu.anchor && (
        <Popover anchor={menu.anchor} onClose={menu.close} width={step === "sidebar" ? 300 : 240} label={target.type === "channel" ? "チャンネルのメニュー" : target.type === "category" ? "カテゴリーのメニュー" : "サイドバーのメニュー"}>
          <ChannelMenu
            target={target}
            step={step}
            setStep={setStep}
            categories={categories}
            channels={channels}
            nameOf={nameOf}
            onNewChannel={newChannel}
            onNewCategory={newCategory}
            onAddPage={setAdding}
            onEditDb={(dbId) => setEditing({ dbId, at: pathname })}
            close={menu.close}
            roomId={roomId}
            router={router}
            pathname={pathname}
          />
        </Popover>
      )}
      {adding && <SidebarNewPage choice={adding} roomId={roomId} userId={userId} onClose={() => setAdding(null)} />}
      {editingNow && <DatabasePopup roomId={roomId} dbId={editingNow.dbId} userId={userId} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** サイドバーの「⋯」から足すページの画面（データベースの「ページを追加」と同じ。作ったらそのページを開く）。サイドバーの中だと画面いっぱいに出ないので、body に出す */
function SidebarNewPage({ choice, roomId, userId, onClose }: { choice: AddChoice; roomId: string; userId: string; onClose: () => void }) {
  const database = useDatabase(choice.dbId);
  const members = useMembers(roomId);
  if (!database || !members) return null;
  const id = choice.template === "default" ? database.defaultTemplateId : choice.template === "none" ? null : choice.template;
  const template = id ? database.templates?.find((t) => t.id === id) : undefined;
  return createPortal(<NewPageDialog database={database} members={members} userId={userId} template={template} onClose={onClose} />, document.body);
}

/** 「⋯」の「テンプレートを選んで追加」：テンプレートを使わないか、このデータベースのテンプレートから選ぶ */
function AddPageMenu({ dbId, onAdd }: { dbId: string; onAdd: (template: AddChoice["template"]) => void }) {
  const database = useDatabase(dbId);
  if (!database) return null;
  return (
    <div>
      <MenuLabel>「{database.name}」にページを追加</MenuLabel>
      <MenuItem icon={<Icon name="x" size={16} />} onClick={() => onAdd("none")}>
        テンプレートを使わない
      </MenuItem>
      {(database.templates ?? []).map((t) => (
        <MenuItem
          key={t.id}
          icon={t.icon ? <IconMark icon={t.icon} /> : <Icon name={t.kind === "window" ? "window" : "note"} size={16} />}
          right={t.id === database.defaultTemplateId ? <span className="text-xs text-muted">既定</span> : undefined}
          onClick={() => onAdd(t.id)}
        >
          {t.name}
        </MenuItem>
      ))}
    </div>
  );
}

/** データベースの「⋯」のページを追加：既定のテンプレートで足す。テンプレートがあれば、選んで足す行も出す */
function AddPageItems({ dbId, onAdd, onPick }: { dbId: string; onAdd: () => void; onPick: () => void }) {
  const database = useDatabase(dbId);
  const fallback = database?.templates?.find((t) => t.id === database.defaultTemplateId);
  return (
    <>
      <MenuItem icon={<Icon name="add" size={16} />} onClick={onAdd} right={fallback ? <span className="max-w-24 truncate text-xs text-muted">{fallback.name}</span> : undefined}>
        ページを追加
      </MenuItem>
      {!!database?.templates?.length && (
        <MenuItem icon={<Icon name="copy" size={16} />} onClick={onPick}>
          テンプレートを選んで追加
        </MenuItem>
      )}
      <MenuDivider />
    </>
  );
}

function ChannelMenu({
  target,
  step,
  setStep,
  categories,
  channels,
  nameOf,
  onNewChannel,
  onNewCategory,
  onAddPage,
  onEditDb,
  close,
  roomId,
  router,
  pathname,
}: {
  target: Target;
  step: Step;
  setStep: (s: Step) => void;
  categories: Category[];
  channels: Channel[];
  nameOf: (cat: Category) => string;
  onNewChannel: (kind: ChannelKind, categoryId: string | null) => void;
  onNewCategory: (kind: CategoryKind, before?: string) => void;
  onAddPage: (choice: AddChoice) => void;
  onEditDb: (dbId: string) => void;
  close: () => void;
  roomId: string;
  router: ReturnType<typeof useRouter>;
  pathname: string;
}) {
  const categoryId = target.type === "category" ? target.cat.id : target.type === "channel" ? target.ch.categoryId : null;
  // データベースカテゴリーのメニューのときの、データベース
  const dbId = target.type === "category" ? target.cat.dbId : undefined;

  // 編集：テンプレートと繋いでいれば、テンプレートを直すか、分けて（ここだけの内容にして）直すかを選ぶ
  const sourceOf = (ch: Channel): SourceTarget => ({ kind: ch.kind as TemplateKind, id: ch.id, name: ch.name, sourceId: ch.sourceId });
  const openEdit = (ch: Channel) => {
    close();
    void openSourceEdit(sourceOf(ch), channelHref(roomId, ch), router);
  };

  if (step === "catKinds") {
    // 「この上にカテゴリーを作成」のときは、そのカテゴリーの上に作る
    const before = target.type === "category" ? target.cat.id : undefined;
    return (
      <div>
        <MenuLabel>作るカテゴリー</MenuLabel>
        <MenuItem icon={<Icon name="folder" size={16} />} title="チャット・ノート・ウィンドウのチャンネルを入れる" onClick={() => onNewCategory("normal", before)}>
          通常カテゴリー
        </MenuItem>
        <MenuItem icon={<Icon name="db" size={16} />} title="データベースのページを並べる。⋯の「編集」でデータベースの画面を開く" onClick={() => onNewCategory("db", before)}>
          データベースカテゴリー
        </MenuItem>
      </div>
    );
  }

  if (step === "kinds") {
    // カテゴリーの＋では、そのカテゴリーに合う種類を一番上に出す（名前が種類と同じ「ノート」なら、ノート。そうでなければ、中に一番多い種類）
    const kinds = Object.keys(CHANNEL_KINDS) as ChannelKind[];
    let first: ChannelKind | undefined;
    if (target.type === "category") {
      const cat = target.cat;
      first = kinds.find((k) => CHANNEL_KINDS[k].label === cat.name);
      if (!first) {
        const count = (k: ChannelKind) => channels.filter((c) => c.categoryId === cat.id && c.kind === k).length;
        first = [...kinds].sort((a, b) => count(b) - count(a)).find((k) => count(k) > 0);
      }
    }
    const ordered = first ? [first, ...kinds.filter((k) => k !== first)] : kinds;
    return (
      <div>
        <MenuLabel>{target.type === "category" ? `「${target.cat.name}」に作るチャンネル` : "作るチャンネル"}</MenuLabel>
        {ordered.map((k) => (
          <MenuItem key={k} icon={<Icon name={KIND_ICON[k]} size={16} />} title={CHANNEL_KINDS[k].note} onClick={() => onNewChannel(k, categoryId)}>
            <span className={k === first ? "font-bold" : ""}>{CHANNEL_KINDS[k].label}</span>
          </MenuItem>
        ))}
      </div>
    );
  }

  if (target.type === "channel" && step === "move") {
    const ch = target.ch;
    const go = async (cid: string | null) => {
      close();
      await moveChannel(ch, cid, channels.filter((c) => c.categoryId === cid && c.id !== ch.id).length, channels);
    };
    return (
      <div>
        <MenuLabel>「{ch.name || "無題"}」の移動先</MenuLabel>
        {/* データベースカテゴリーには入れられない */}
        {categories
          .filter((c) => !c.dbId)
          .map((c) => (
            <MenuItem key={c.id} active={c.id === ch.categoryId} onClick={() => go(c.id)}>
              {c.name}
            </MenuItem>
          ))}
        <MenuItem active={ch.categoryId === null} onClick={() => go(null)}>
          カテゴリーの外（一番上）
        </MenuItem>
      </div>
    );
  }

  if (dbId && step === "sidebar") return <SidebarViewMenu dbId={dbId} close={close} />;
  if (dbId && step === "addPage") return <AddPageMenu dbId={dbId} onAdd={(template) => (close(), onAddPage({ dbId, template }))} />;
  if (target.type === "channel" && step === "source") return <SourceMenu target={sourceOf(target.ch)} roomId={roomId} close={close} />;

  if (target.type === "channel") {
    const ch = target.ch;
    const siblings = channels.filter((c) => c.categoryId === ch.categoryId);
    const i = siblings.findIndex((c) => c.kind === ch.kind && c.id === ch.id);
    const step1 = (d: -1 | 1) => async () => {
      close();
      await moveChannel(ch, ch.categoryId, i + d, channels);
    };
    return (
      <div>
        <MenuLabel>
          {CHANNEL_KINDS[ch.kind].label}「{ch.name || "無題"}」
        </MenuLabel>
        {/* ウィンドウは、ここから編集モードで開く（画面の右上には編集ボタンを置かない）。
            テンプレートと繋いだノートも、ここから（ふだんは読むだけ） */}
        {(ch.kind === "window" || (ch.kind === "note" && ch.sourceId)) && (
          <MenuItem icon={<Icon name={ch.kind === "window" ? "window" : "edit"} size={16} />} onClick={() => openEdit(ch)}>
            編集
          </MenuItem>
        )}
        {(ch.kind === "window" || ch.kind === "note") && (
          <MenuItem icon={<Icon name="copy" size={16} />} onClick={() => setStep("source")} right={<SourceName roomId={roomId} sourceId={ch.sourceId} />}>
            ソース
          </MenuItem>
        )}
        <MenuItem
          icon={<Icon name="edit" size={16} />}
          onClick={async () => {
            close();
            const name = await promptText("チャンネルの名前", ch.name);
            if (name) await renameChannel(ch, name);
          }}
        >
          名前を変更
        </MenuItem>
        <MenuItem icon={<Icon name="folder" size={16} />} onClick={() => setStep("move")}>
          カテゴリーへ移動
        </MenuItem>
        {i > 0 && (
          <MenuItem icon={<Icon name="up" size={16} />} onClick={step1(-1)}>
            上へ
          </MenuItem>
        )}
        {i < siblings.length - 1 && (
          <MenuItem icon={<Icon name="dn" size={16} />} onClick={step1(1)}>
            下へ
          </MenuItem>
        )}
        <MenuDivider />
        <MenuItem icon={<Icon name="add" size={16} />} onClick={() => setStep("kinds")}>
          同じカテゴリーにチャンネルを作成
        </MenuItem>
        <MenuDivider />
        <MenuItem
          icon={<Icon name="del" size={16} />}
          danger
          onClick={async () => {
            close();
            const body = ch.kind === "chat" ? "発言はすべて消えます。画像はメディアに残ります。元に戻せません。" : "中に置いたチャットの発言も消えます。画像はメディアに残ります。元に戻せません。";
            if (!(await confirmAction(`「${ch.name || "無題"}」を削除します`, "削除", body))) return;
            if (pathname.startsWith(channelHref(roomId, ch))) router.push(`/r/${roomId}`);
            await deleteChannel(ch);
          }}
        >
          チャンネルを削除
        </MenuItem>
      </div>
    );
  }

  if (target.type === "category" && dbId) {
    // データベースカテゴリー：編集（データベースの画面をポップアップで）・ページの追加・名前・サイドバーに出すページ・削除
    const name = nameOf(target.cat);
    return (
      <div>
        <MenuLabel>データベース「{name}」</MenuLabel>
        <MenuItem icon={<Icon name="db" size={16} />} onClick={() => (close(), onEditDb(dbId))}>
          編集
        </MenuItem>
        <AddPageItems dbId={dbId} onAdd={() => (close(), onAddPage({ dbId, template: "default" }))} onPick={() => setStep("addPage")} />
        <MenuItem
          icon={<Icon name="edit" size={16} />}
          onClick={async () => {
            close();
            const next = await promptText("データベースの名前", name);
            if (next) await updateDatabase(dbId, { name: next });
          }}
        >
          名前を変更
        </MenuItem>
        <MenuItem icon={<Icon name="filter" size={16} />} onClick={() => setStep("sidebar")}>
          サイドバーに出すページ
        </MenuItem>
        <MenuItem icon={<Icon name="folder" size={16} />} onClick={() => setStep("catKinds")}>
          この上にカテゴリーを作成
        </MenuItem>
        <MenuDivider />
        <MenuItem
          icon={<Icon name="del" size={16} />}
          danger
          onClick={async () => {
            close();
            const body = "中のページ、ページのチャット・メモ、ビューもすべて消えます。画像はメディアに残ります。元に戻せません。";
            if (!(await confirmAction(`データベース「${name}」を削除します`, "削除", body))) return;
            if (pathname.startsWith(`/r/${roomId}/db/${dbId}`)) router.push(`/r/${roomId}`);
            await deleteDatabase(dbId);
          }}
        >
          データベースを削除
        </MenuItem>
      </div>
    );
  }

  if (target.type === "category") {
    const cat = target.cat;
    return (
      <div>
        <MenuLabel>カテゴリー「{cat.name}」</MenuLabel>
        <MenuItem icon={<Icon name="add" size={16} />} onClick={() => setStep("kinds")}>
          チャンネルを作成
        </MenuItem>
        <MenuItem
          icon={<Icon name="edit" size={16} />}
          onClick={async () => {
            close();
            const name = await promptText("カテゴリーの名前", cat.name);
            if (name) await renameCategory(cat.id, name);
          }}
        >
          名前を変更
        </MenuItem>
        <MenuItem icon={<Icon name="folder" size={16} />} onClick={() => setStep("catKinds")}>
          この上にカテゴリーを作成
        </MenuItem>
        <MenuDivider />
        <MenuItem
          icon={<Icon name="del" size={16} />}
          danger
          onClick={async () => {
            close();
            if (await confirmAction(`カテゴリー「${cat.name}」を削除します`, "削除", "中のチャンネルは消えず、カテゴリーの外（一番上）に移ります。")) await deleteCategory(roomId, cat.id);
          }}
        >
          カテゴリーを削除
        </MenuItem>
      </div>
    );
  }

  return (
    <div>
      <MenuItem icon={<Icon name="folder" size={16} />} onClick={() => setStep("catKinds")}>
        カテゴリーを作成
      </MenuItem>
      <MenuItem icon={<Icon name="add" size={16} />} onClick={() => setStep("kinds")}>
        チャンネルを作成
      </MenuItem>
    </div>
  );
}

/** ノートの「更新あり」の印（未読の数と同じ色の点）。取り込み中は灰色で控えめにする */
function UpdatedDot() {
  const quiet = useDoNotDisturb();
  return <span role="img" aria-label="更新あり" title="ほかの人が更新しました" className={`mr-2.5 h-2 w-2 shrink-0 rounded-full ${badgeTone(quiet)}`} />;
}

/** 未読の数。取り込み中は灰色で控えめにする */
function UnreadBadge({ n, className = "" }: { n: number; className?: string }) {
  const quiet = useDoNotDisturb();
  return <span className={`rounded-full px-2 text-xs ${badgeTone(quiet)} ${className}`}>{n}</span>;
}

/** データベースカテゴリーの未読（中のページのチャットの未読の合計） */
function DbUnread({ dbId, roomId, userId }: { dbId: string; roomId: string; userId: string }) {
  const pages = usePages(dbId) ?? [];
  const unread = useUnreadCounts(roomId, userId);
  const n = pages.reduce((a, p) => a + (p.chatId ? (unread?.get(p.chatId) ?? 0) : 0) + (p.reenactChatId ? (unread?.get(p.reenactChatId) ?? 0) : 0), 0);
  if (!n) return null;
  return <UnreadBadge n={n} className="mr-0.5" />;
}

/** サイドバーに出すページを、ビューを使わずに決めるとき（sidebarViewId がこれ） */
const SIDEBAR_FILTER = "@filter";

/** サイドバーのフィルターと並び替えを、ビューの形にしたもの（ビューのフィルター・並び替えの画面と、ページの絞り込みにそのまま使う） */
const sidebarFilterView = (database: Database): DbView => ({
  id: SIDEBAR_FILTER,
  dbId: database.id,
  name: "サイドバー",
  type: "list",
  filters: [],
  sort: null,
  options: {},
  order: 0,
  ...database.sidebarFilter,
});

/**
 * サイドバーに出すページを選ぶ：出さない・データベースのビュー（そのビューのフィルター・並び順で出る）・フィルターで決める。
 * 「フィルターで決める」は、ビューを作らずに、ここだけのフィルターと並び替えを決める（画面はビューの設定と同じ）
 */
function SidebarViewMenu({ dbId, close }: { dbId: string; close: () => void }) {
  const database = useDatabase(dbId);
  const views = useViews(dbId) ?? [];
  const members = useMembers(database?.roomId ?? "") ?? [];
  const [screen, setScreen] = useState<"top" | "filters" | "sort">("top");
  if (!database) return null;
  const cur = database.sidebarViewId;
  const pick = async (id: string | null | undefined) => {
    close();
    await setSidebarView(dbId, id);
  };
  const own = cur === SIDEBAR_FILTER;
  const view = sidebarFilterView(database);
  const top = () => setScreen("top");
  // フィルター・並び替えの画面で直したものは、ビューではなく、このデータベースのサイドバーの設定に入れる
  const save = (v: DbView) => setSidebarFilter(dbId, { filters: v.filters, filterMode: v.filterMode, sort: v.sort, sorts: v.sorts });
  if (screen !== "top")
    return (
      <ViewSaveContext.Provider value={save}>
        {screen === "filters" ? <FilterScreens database={database} view={view} members={members} start={{ kind: "list" }} onExit={top} /> : <SortScreens database={database} view={view} onBack={top} />}
      </ViewSaveContext.Provider>
    );
  return (
    <div>
      <MenuLabel>サイドバーに出すページ</MenuLabel>
      <MenuItem active={cur === null} onClick={() => pick(null)}>
        出さない
      </MenuItem>
      <MenuItem active={cur === undefined} onClick={() => pick(undefined)}>
        {database.kind === "request" ? "終わっていない依頼（納期の近い順）" : "すべてのページ"}
      </MenuItem>
      {/* 選んでもメニューは閉じず、その下にフィルターと並び替えの行を出す */}
      <MenuItem icon={<Icon name="filter" size={16} />} active={own} onClick={() => !own && void setSidebarView(dbId, SIDEBAR_FILTER)}>
        フィルターで決める
      </MenuItem>
      {own && (
        <div className="pl-3">
          <NavRow icon="filter" label="フィルター" value={view.filters.length ? `${view.filters.length}個の条件` : "条件なし（すべて）"} onClick={() => setScreen("filters")} />
          <NavRow icon="sort" label="並び替え" value={sortText(database, view)} onClick={() => setScreen("sort")} />
        </div>
      )}
      {views.length > 0 && <MenuLabel>ビューのフィルター・並び順で出す</MenuLabel>}
      {views.map((v) => (
        <MenuItem key={v.id} active={cur === v.id} onClick={() => pick(v.id)}>
          ビュー「{v.name}」のページ
        </MenuItem>
      ))}
    </div>
  );
}

/**
 * データベースカテゴリーの中にページを並べる（チャンネルと同じ形の行）。どのページを出すかはデータベースの設定（ビュー）で決める。
 * はじめは、依頼は終わっていない依頼を納期順、ほかはすべてのページ。onlyActive（カテゴリーを閉じているとき）は、今開いているページだけ。
 * ページを右クリックすると、編集（ウィンドウ型のページ）と削除
 */
function DbPages({ dbId, roomId, userId, onlyActive }: { dbId: string; roomId: string; userId: string; onlyActive: boolean }) {
  const database = useDatabase(dbId);
  const pages = usePages(dbId) ?? [];
  const views = useViews(dbId) ?? [];
  const unread = useUnreadCounts(roomId, userId);
  const pathname = usePathname();
  const router = useRouter();
  const menu = usePopover();
  const [target, setTarget] = useState<DbPage | null>(null);
  if (!database) return null;
  const setting = database.sidebarViewId;
  const view = setting === SIDEBAR_FILTER ? sidebarFilterView(database) : setting ? views.find((v) => v.id === setting) : undefined;
  let shown: DbPage[];
  if (view) shown = applyView(database, pages, view, userId);
  else if (setting === undefined && database.kind === "request")
    shown = pages.filter((p) => !isPageDone(database, p)).sort((a, b) => String(a.values[P.due] ?? "9999").localeCompare(String(b.values[P.due] ?? "9999")));
  else if (setting === undefined) shown = pages;
  else return null;
  const href = `/r/${roomId}/db/${dbId}`;
  if (onlyActive) shown = shown.filter((p) => pathname === `${href}/p/${p.id}`);
  return (
    <div className="space-y-0.5">
      {shown.map((p) => {
        const ph = `${href}/p/${p.id}`;
        const n = (p.chatId ? (unread?.get(p.chatId) ?? 0) : 0) + (p.reenactChatId ? (unread?.get(p.reenactChatId) ?? 0) : 0);
        const on = pathname === ph;
        return (
          <Link
            key={p.id}
            href={ph}
            onContextMenu={(e) => {
              e.stopPropagation();
              setTarget(p);
              menu.openAt(e);
            }}
            data-name={`ページ「${p.title || "無題"}」`}
            className={`flex min-h-[36px] items-center gap-2 rounded-[10px] py-1.5 pr-2 pl-3 transition ${on ? "bg-accent font-bold text-accent-ink" : "hover:bg-tint"} ${n && !on ? "font-bold" : ""}`}
          >
            <span className="w-4 shrink-0 text-center">
              <IconMark icon={p.icon || DEFAULT_PAGE_ICON} />
            </span>
            <span className="min-w-0 flex-1 truncate">
              {p.title || <span className="text-muted">無題</span>}
            </span>
            {(() => {
              const due = dueStatus(database, p);
              return due && <DueBadge state={due} />;
            })()}
            {n > 0 && !on && <UnreadBadge n={n} />}
          </Link>
        );
      })}
      {menu.anchor && target && (
        <Popover anchor={menu.anchor} onClose={menu.close} width={280} label={`ページのメニュー`}>
          <PageMenu
            database={database}
            page={target}
            close={menu.close}
            onDeleted={() => pathname === `${href}/p/${target.id}` && router.push(href)}
          />
        </Popover>
      )}
    </div>
  );
}
