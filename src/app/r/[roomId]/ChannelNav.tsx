"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DEFAULT_PAGE_ICON, IconMark } from "@/components/IconMark";
import { PageMenu } from "@/components/db/PageMenu";
import { Icon, type IconName } from "@/components/Icon";
import { MenuDivider, MenuItem, MenuLabel, Popover, usePopover, type Anchor } from "@/components/ui/Popover";
import { confirmAction, promptText } from "@/components/ui/overlay";
import { openSourceEdit, pickTemplateForNew, SourceMenu, SourceName, type SourceTarget } from "@/components/window/channelSource";
import { useUnreadCounts } from "@/lib/local/chat";
import {
  CHANNEL_KINDS,
  channelHref,
  createCategory,
  createChannel,
  deleteCategory,
  deleteChannel,
  moveCategory,
  moveChannel,
  renameCategory,
  renameChannel,
  useCategories,
  useChannels,
  type Channel,
  type ChannelKind,
} from "@/lib/local/channels";
import type { Category, DbPage } from "@/lib/local/db";
import { linkTemplate, useChannelTemplates, type TemplateKind } from "@/lib/local/channelTemplates";
import { nameSuffixOf, useDatabase, usePages, useViews } from "@/lib/local/requests";
import { setSidebarView } from "@/lib/local/templates";
import { DONE, P } from "@/lib/requests/defaults";
import { applyView } from "@/lib/requests/logic";

const KIND_ICON: Record<ChannelKind, IconName> = { db: "db", chat: "chat", note: "note", window: "window" };
const DEFAULT_NAME: Record<ChannelKind, string> = { db: "新しいデータベース", chat: "新しいチャット", note: "新しいノート", window: "新しいウィンドウ" };

type Target = { type: "empty" } | { type: "category"; cat: Category } | { type: "channel"; ch: Channel };
type Step = "main" | "kinds" | "move" | "sidebar" | "source";
type Drag = { type: "channel"; ch: Channel } | { type: "category"; id: string };
type Drop = { type: "channel"; categoryId: string | null; index: number } | { type: "category"; index: number };

/**
 * Discord のようなサイドバー：カテゴリーの中にチャンネル（データベース・チャット・ノート・ウィンドウ）が並ぶ。
 * カテゴリーの＋や右クリックで作成、ドラッグで移動・並べ替え。
 */
export function ChannelNav({ roomId, userId }: { roomId: string; userId: string }) {
  const categories = useCategories(roomId) ?? [];
  const channels = useChannels(roomId) ?? [];
  const templates = useChannelTemplates(roomId) ?? [];
  const unread = useUnreadCounts(roomId, userId);
  const pathname = usePathname();
  const router = useRouter();
  const menu = usePopover();
  const [target, setTarget] = useState<Target>({ type: "empty" });
  const [step, setStep] = useState<Step>("main");
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

  // ブラウザのタブにも未読の数を出す
  useEffect(() => {
    document.title = total ? `(${total}) 依頼ノート` : "依頼ノート";
  }, [total]);

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
  const newCategory = async (before?: string) => {
    menu.close();
    const name = await promptText("カテゴリーを作成", "", "カテゴリーの名前");
    if (name) await createCategory(roomId, name, before);
  };

  const listOf = (categoryId: string | null) => channels.filter((c) => c.categoryId === categoryId);

  // ---- ドラッグ ----
  const onRowDragOver = (e: React.DragEvent, ch: Channel, index: number) => {
    if (drag?.type !== "channel") return;
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setDrop({ type: "channel", categoryId: ch.categoryId, index: e.clientY > r.top + r.height / 2 ? index + 1 : index });
  };
  const onHeaderDragOver = (e: React.DragEvent, cat: Category, catIndex: number) => {
    if (!drag) return;
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
          <Link href={href} draggable={false} className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 ${n && !active ? "font-bold" : ""}`}>
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
          {ch.kind === "db" && <DbUnread dbId={ch.id} roomId={roomId} userId={userId} hide={active} />}
          {n > 0 && !active && <span className="mr-1 rounded-full bg-warn px-2 text-xs text-white">{n}</span>}
          <button
            aria-label={`「${ch.name || "無題"}」のメニュー`}
            onClick={(e) => openMenu({ type: "channel", ch }, "main", e.currentTarget)}
            className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-full opacity-60 hover:bg-tint hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
          >
            <Icon name="dots" size={16} />
          </button>
        </div>
        {ch.kind === "db" && <DbPages dbId={ch.id} roomId={roomId} userId={userId} />}
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
              data-name={`カテゴリー「${cat.name}」`}
              className={`group mb-0.5 flex items-center gap-0.5 pr-1 text-xs text-muted ${drag?.type === "category" && drag.id === cat.id ? "opacity-40" : ""}`}
            >
              <button onClick={() => toggle(cat.id)} aria-expanded={!isCollapsed} className="flex min-w-0 flex-1 items-center gap-0.5 py-1 pl-1 text-left hover:text-ink">
                <Icon name={isCollapsed ? "rt" : "dn"} size={14} className="shrink-0" />
                <span className="truncate font-bold tracking-wide">{cat.name}</span>
              </button>
              <button
                aria-label={`「${cat.name}」にチャンネルを作成`}
                title="チャンネルを作成"
                onClick={(e) => openMenu({ type: "category", cat }, "kinds", e.currentTarget)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-tint hover:text-ink"
              >
                <Icon name="add" size={16} />
              </button>
            </div>
            {!isCollapsed && channelList(cat.id)}
            {isCollapsed && listOf(cat.id).filter((c) => pathname.startsWith(channelHref(roomId, c))).map((c) => row(c, listOf(cat.id).indexOf(c)))}
          </div>
        );
      })}
      {drop?.type === "category" && drop.index === categories.length && <div className="mt-4">{line}</div>}

      {!channels.length && !categories.length && <p className="px-3 pt-3 text-xs text-muted">右クリックでカテゴリーやチャンネルを作れます</p>}

      {menu.anchor && (
        <Popover anchor={menu.anchor} onClose={menu.close} width={240} label={target.type === "channel" ? "チャンネルのメニュー" : target.type === "category" ? "カテゴリーのメニュー" : "サイドバーのメニュー"}>
          <ChannelMenu
            target={target}
            step={step}
            setStep={setStep}
            categories={categories}
            channels={channels}
            onNewChannel={newChannel}
            onNewCategory={newCategory}
            close={menu.close}
            roomId={roomId}
            router={router}
            pathname={pathname}
          />
        </Popover>
      )}
    </div>
  );
}

function ChannelMenu({
  target,
  step,
  setStep,
  categories,
  channels,
  onNewChannel,
  onNewCategory,
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
  onNewChannel: (kind: ChannelKind, categoryId: string | null) => void;
  onNewCategory: (before?: string) => void;
  close: () => void;
  roomId: string;
  router: ReturnType<typeof useRouter>;
  pathname: string;
}) {
  const categoryId = target.type === "category" ? target.cat.id : target.type === "channel" ? target.ch.categoryId : null;

  // 編集：テンプレートと繋いでいれば、テンプレートを直すか、分けて（ここだけの内容にして）直すかを選ぶ
  const sourceOf = (ch: Channel): SourceTarget => ({ kind: ch.kind as TemplateKind, id: ch.id, name: ch.name, sourceId: ch.sourceId });
  const openEdit = (ch: Channel) => {
    close();
    void openSourceEdit(sourceOf(ch), channelHref(roomId, ch), router);
  };

  if (step === "kinds") {
    return (
      <div>
        <MenuLabel>{target.type === "category" ? `「${target.cat.name}」に作るチャンネル` : "作るチャンネル"}</MenuLabel>
        {(Object.keys(CHANNEL_KINDS) as ChannelKind[]).map((k) => (
          <MenuItem key={k} icon={<Icon name={KIND_ICON[k]} size={16} />} onClick={() => onNewChannel(k, categoryId)}>
            <span className="block">{CHANNEL_KINDS[k].label}</span>
            <span className="block truncate text-xs text-muted">{CHANNEL_KINDS[k].note}</span>
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
        {categories.map((c) => (
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

  if (target.type === "channel" && step === "sidebar") return <SidebarViewMenu dbId={target.ch.id} close={close} />;
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
        {ch.kind === "db" && (
          <MenuItem icon={<Icon name="filter" size={16} />} onClick={() => setStep("sidebar")}>
            サイドバーに出すページ
          </MenuItem>
        )}
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
            const body =
              ch.kind === "db"
                ? "中のページ、ページのチャット・メモ、ビューもすべて消えます。画像はメディアに残ります。元に戻せません。"
                : ch.kind === "chat"
                  ? "発言はすべて消えます。画像はメディアに残ります。元に戻せません。"
                  : "中に置いたチャットの発言も消えます。画像はメディアに残ります。元に戻せません。";
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
        <MenuItem icon={<Icon name="folder" size={16} />} onClick={() => onNewCategory(cat.id)}>
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
      <MenuItem icon={<Icon name="folder" size={16} />} onClick={() => onNewCategory()}>
        カテゴリーを作成
      </MenuItem>
      <MenuItem icon={<Icon name="add" size={16} />} onClick={() => setStep("kinds")}>
        チャンネルを作成
      </MenuItem>
    </div>
  );
}

/** データベースのチャンネルの未読（中の依頼のチャットの未読の合計） */
function DbUnread({ dbId, roomId, userId, hide }: { dbId: string; roomId: string; userId: string; hide: boolean }) {
  const pages = usePages(dbId) ?? [];
  const unread = useUnreadCounts(roomId, userId);
  const n = pages.reduce((a, p) => a + (p.chatId ? (unread?.get(p.chatId) ?? 0) : 0) + (p.reenactChatId ? (unread?.get(p.reenactChatId) ?? 0) : 0), 0);
  if (!n || hide) return null;
  return <span className="mr-1 rounded-full bg-warn px-2 text-xs text-white">{n}</span>;
}

/** サイドバーに出すページを、データベースのビューで選ぶ（そのビューのフィルター・並び順で出る） */
function SidebarViewMenu({ dbId, close }: { dbId: string; close: () => void }) {
  const database = useDatabase(dbId);
  const views = useViews(dbId) ?? [];
  if (!database) return null;
  const cur = database.sidebarViewId;
  const pick = async (id: string | null | undefined) => {
    close();
    await setSidebarView(dbId, id);
  };
  return (
    <div>
      <MenuLabel>サイドバーに出すページ（ビューのフィルター・並び順で出ます）</MenuLabel>
      <MenuItem active={cur === null || (cur === undefined && database.kind !== "request")} onClick={() => pick(null)}>
        出さない
      </MenuItem>
      {database.kind === "request" && (
        <MenuItem active={cur === undefined} onClick={() => pick(undefined)}>
          終わっていない依頼（納期の近い順）
        </MenuItem>
      )}
      {views.map((v) => (
        <MenuItem key={v.id} active={cur === v.id} onClick={() => pick(v.id)}>
          ビュー「{v.name}」のページ
        </MenuItem>
      ))}
    </div>
  );
}

/**
 * データベースの下にページを並べる。どのページを出すかはデータベースの設定（ビュー）で決める。依頼は、はじめは終わっていない依頼を納期順。
 * ページを右クリックすると、編集（ウィンドウ型のページ）と削除
 */
function DbPages({ dbId, roomId, userId }: { dbId: string; roomId: string; userId: string }) {
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
  const view = setting ? views.find((v) => v.id === setting) : undefined;
  let active: DbPage[];
  if (view) active = applyView(database, pages, view, userId);
  else if (setting === undefined && database.kind === "request")
    active = pages.filter((p) => p.values[P.status] !== DONE).sort((a, b) => String(a.values[P.due] ?? "9999").localeCompare(String(b.values[P.due] ?? "9999")));
  else return null;
  const href = `/r/${roomId}/db/${dbId}`;
  return (
    <>
      {active.map((p) => {
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
            className={`flex min-h-[32px] items-center gap-2 rounded-[10px] pr-2 pl-9 text-sm transition ${on ? "bg-accent font-bold text-accent-ink" : "hover:bg-tint"} ${n && !on ? "font-bold" : ""}`}
          >
            <span className="min-w-0 flex-1 truncate">
              <span className="mr-1.5">
                <IconMark icon={p.icon || DEFAULT_PAGE_ICON} />
              </span>
              {p.title || <span className="text-muted">無題</span>}
              {p.title && nameSuffixOf(database)}
            </span>
            {n > 0 && !on && <span className="rounded-full bg-warn px-2 text-xs text-white">{n}</span>}
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
    </>
  );
}
