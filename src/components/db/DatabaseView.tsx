"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { IconMark, mediaIcon } from "@/components/IconMark";
import { MediaPicker } from "@/components/MediaPicker";
import { MenuDivider, MenuItem, MenuLabel, Popover, usePopover } from "@/components/ui/Popover";
import { TabStrip } from "@/components/ui/TabStrip";
import { promptText, toast } from "@/components/ui/overlay";
import type { CalEvent, Database, DbPage, DbView, PageTemplate, ViewType } from "@/lib/local/db";
import { restoreInlineDb, trashInlineDb } from "@/lib/local/inlineDbs";
import { createView, saveView, setDatabaseIcon, TRASH_DAYS, updateDatabase, useTrash } from "@/lib/local/requests";
import { dueDaysOf, dueProp } from "@/lib/requests/due";
import type { MemberWithProfile } from "@/lib/local/rooms";
import { sortsOf } from "@/lib/requests/logic";
import { filterLabel } from "./editors";
import { ImportDialog } from "./ImportDialog";
import { EmojiPicker, VIEW_TYPES } from "./meta";
import { NewPageDialog } from "./NewPageDialog";
import { DueSettings } from "./DueSettings";
import { TrashDialog } from "./TrashDialog";
import { TemplateMenu } from "./TemplateMenu";
import { FilterScreens, SortScreens, ViewSettingsMenu } from "./ViewSettings";
import { EmptyHint } from "./views/common";
import { ViewRenderer } from "./views/ViewRenderer";

/** データベースの画面（Notion のように、ビューのタブ・検索・フィルター・並び替え・ビューの設定） */
export function DatabaseView({
  database,
  views,
  view,
  pages,
  events,
  members,
  userId,
  openNew = false,
  onCloseNew,
  onSwitchView,
}: {
  database: Database;
  views: DbView[];
  view: DbView | undefined;
  pages: DbPage[];
  events: CalEvent[];
  members: MemberWithProfile[];
  userId: string;
  openNew?: boolean;
  onCloseNew?: () => void;
  /** ビューを切り替える。無ければ URL（?v=）で切り替える（ポップアップでは URL を変えない） */
  onSwitchView?: (id: string) => void;
}) {
  const router = useRouter();
  const trash = useTrash(database.id);
  const [dialog, setDialog] = useState<"new" | "import" | "iconMedia" | "due" | "trash" | null>(null);
  // テンプレートから追加するときの、選んだテンプレート
  const [template, setTemplate] = useState<PageTemplate | null>(null);
  const pop = usePopover();
  const [popKind, setPopKind] = useState<"icon" | "more" | null>(null);
  const openPop = (k: "icon" | "more") => (e: React.MouseEvent<HTMLElement>) => {
    setPopKind(k);
    pop.open(e);
  };
  const switchTo = (id: string) => (onSwitchView ? onSwitchView(id) : router.replace(`?v=${id}`));
  const showNew = dialog === "new" || openNew;
  // 「追加」で使う既定のテンプレート
  const defaultTemplate = database.templates?.find((t) => t.id === database.defaultTemplateId);
  const newPage = (t: PageTemplate | null) => (setTemplate(t), setDialog("new"));

  return (
    <div data-name={`データベース画面「${database.name || "無題"}」`} className="space-y-3">
      {/* 見出し：アイコンと名前（押して変更） */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={openPop("icon")}
          aria-label="アイコンを変える"
          title="アイコンを変える"
          className="grid h-11 w-11 place-items-center rounded-[10px] text-[28px] hover:bg-tint"
        >
          <IconMark icon={database.icon} size={32} fallback={<Icon name="db" size={26} className="text-muted" />} />
        </button>
        <button
          onClick={async () => {
            const name = await promptText("データベースの名前", database.name);
            if (name) await updateDatabase(database.id, { name });
          }}
          title="押して名前を変える"
          className={`mr-auto rounded-[8px] px-1 text-[28px] font-bold hover:bg-tint ${database.name ? "" : "text-muted"}`}
        >
          {database.name || "無題"}
        </button>
        <button className="btn-sub w-10 px-0" aria-label="データベースのメニュー" title="データベースのメニュー" onClick={openPop("more")}>
          <Icon name="dots" />
        </button>
        <NewPageButton database={database} label="ページを追加" onNew={newPage} />
      </div>

      <ViewArea database={database} views={views} view={view} pages={pages} events={events} members={members} userId={userId} onSwitch={switchTo} onNew={() => newPage(defaultTemplate ?? null)} />

      {pop.anchor && popKind && (
        <Popover
          anchor={pop.anchor}
          onClose={pop.close}
          width={popKind === "icon" ? 340 : 300}
          align={popKind === "more" ? "end" : "start"}
          label={{ icon: "アイコン", more: "データベースのメニュー" }[popKind]}
        >
          {popKind === "icon" && (
            <EmojiPicker
              icons
              removeLabel="標準に戻す"
              onPick={(e) => (setDatabaseIcon(database.id, e), pop.close())}
              onRemove={database.icon ? () => (setDatabaseIcon(database.id, undefined), pop.close()) : undefined}
              onMedia={() => (pop.close(), setDialog("iconMedia"))}
            />
          )}
          {popKind === "more" && (
            <div>
              <MenuItem icon={<Icon name="edit" size={16} />} onClick={async () => {
                pop.close();
                const name = await promptText("データベースの名前", database.name);
                if (name) await updateDatabase(database.id, { name });
              }}>
                名前を変更
              </MenuItem>
              {/* 工程の設定は工程の項目ごとなので、ここには置かない（列の見出しのメニューから開く） */}
              <MenuItem icon={<Icon name="bell" size={16} />} right={<span className="text-xs text-muted">{dueProp(database) ? `${dueDaysOf(database)}日前から` : "なし"}</span>} onClick={() => (pop.close(), setDialog("due"))}>
                納期のお知らせ
              </MenuItem>
              <MenuDivider />
              <MenuItem icon={<Icon name="upload" size={16} />} onClick={() => (pop.close(), setDialog("import"))}>
                Notion から取り込む
              </MenuItem>
              <MenuItem icon={<Icon name="del" size={16} />} right={trash?.length ? <span className="text-xs text-muted">{trash.length}件</span> : undefined} onClick={() => (pop.close(), setDialog("trash"))}>
                ゴミ箱
              </MenuItem>
              {/* ノートの中のデータベース：ノートの本文からブロックを外して、ルームのゴミ箱に入れる（Notion と同じ） */}
              {database.noteId && !database.deletedAt && (
                <>
                  <MenuDivider />
                  <MenuItem
                    icon={<Icon name="del" size={16} />}
                    danger
                    onClick={async () => {
                      pop.close();
                      await trashInlineDb(database, userId);
                      router.push(`/r/${database.roomId}/note/${database.noteId}`);
                      toast(`「${database.name || "無題"}」をゴミ箱に入れました（${TRASH_DAYS}日後に完全に削除）`, { label: "元に戻す", run: () => void restoreInlineDb(database, userId) });
                    }}
                  >
                    ゴミ箱に入れる
                  </MenuItem>
                </>
              )}
            </div>
          )}
        </Popover>
      )}

      {showNew && (
        <NewPageDialog
          database={database}
          members={members}
          userId={userId}
          template={dialog === "new" ? (template ?? undefined) : (defaultTemplate ?? undefined)}
          onClose={() => {
            setDialog(null);
            setTemplate(null);
            onCloseNew?.();
          }}
        />
      )}
      {dialog === "import" && <ImportDialog database={database} userId={userId} onClose={() => setDialog(null)} />}
      {dialog === "due" && <DueSettings database={database} onClose={() => setDialog(null)} />}
      {dialog === "trash" && <TrashDialog database={database} onClose={() => setDialog(null)} />}
      {/* アイコンにするメディアの画像を1枚選ぶ */}
      {dialog === "iconMedia" && (
        <MediaPicker
          roomId={database.roomId}
          userId={userId}
          single
          pickLabel="アイコンにする"
          onClose={() => setDialog(null)}
          onPick={(ids) => {
            setDialog(null);
            if (ids[0]) void setDatabaseIcon(database.id, mediaIcon(ids[0]));
          }}
        />
      )}
    </div>
  );
}

/**
 * 「追加」のボタン：押すと既定のテンプレートで追加する。右の「▼」から、テンプレートを選んで追加・テンプレートを作る（Notion の「新規」と同じ）。
 * small はノートの中のデータベースの「新規」
 */
export function NewPageButton({ database, label, small = false, onNew }: { database: Database; label: string; small?: boolean; onNew: (template: PageTemplate | null) => void }) {
  const pop = usePopover();
  const defaultTemplate = database.templates?.find((t) => t.id === database.defaultTemplateId);
  return (
    <div className="flex shrink-0">
      <button
        className={`btn rounded-r-none ${small ? "h-7 min-h-0 gap-1 px-2.5 text-sm" : ""}`}
        title={defaultTemplate ? `テンプレート「${defaultTemplate.name}」で追加` : undefined}
        onClick={() => onNew(defaultTemplate ?? null)}
      >
        <Icon name="add" size={small ? 16 : undefined} />
        {label}
      </button>
      <button
        className={`btn rounded-l-none border-l border-accent-ink/30 ${small ? "h-7 min-h-0 px-1" : "px-2"}`}
        aria-label="テンプレートから追加"
        title="テンプレートから追加・テンプレートを作る"
        aria-expanded={!!pop.anchor}
        onClick={pop.toggle}
      >
        <Icon name="dn" size={small ? 16 : undefined} />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={300} align="end" label="テンプレート">
          <TemplateMenu database={database} close={pop.close} onPick={onNew} />
        </Popover>
      )}
    </div>
  );
}

type Pop = { kind: "addView" | "addFilter" | "sort" | "view" } | { kind: "filter"; index: number };

/**
 * ビューのタブとツールバー（検索・フィルター・並び替え・ビューの設定）、かかっている条件、ビュー。データベースの画面とノートの中のデータベースで共通。
 * inline（ノートの中）では、ツールバーはカーソルを合わせたときだけ出し（Notion と同じ）、右に end（「新規」のボタン）を置く。
 * locked は読むだけのとき（ビューの追加・設定を出さない）。titleToggle はレイアウトの設定に出す「データベースのタイトルを表示」
 */
export function ViewArea({
  database,
  views,
  view,
  pages,
  events,
  members,
  userId,
  onSwitch,
  onNew,
  end,
  inline = false,
  locked = false,
  titleToggle,
}: {
  database: Database;
  views: DbView[];
  view: DbView | undefined;
  pages: DbPage[];
  events: CalEvent[];
  members: MemberWithProfile[];
  userId: string;
  onSwitch: (id: string) => void;
  onNew: () => void;
  end?: React.ReactNode;
  inline?: boolean;
  locked?: boolean;
  titleToggle?: { shown: boolean; onChange: (shown: boolean) => void };
}) {
  const [search, setSearch] = useState<string | null>(null);
  const pop = usePopover();
  const [popKind, setPopKind] = useState<Pop | null>(null);
  const openPop = (k: Pop) => (e: React.MouseEvent<HTMLElement>) => {
    setPopKind(k);
    pop.open(e);
  };
  // ビューの設定は、ツールバーの「⋯」のそばに出す（選んでいるタブをもう一度押したときも）
  const settingsBtn = useRef<HTMLButtonElement>(null);
  const openSettings = () => {
    const el = settingsBtn.current;
    if (!el || locked) return;
    setPopKind({ kind: "view" });
    pop.open({ currentTarget: el });
  };
  const label = "ページ";
  // ノートの中では、ツールバーはカーソルを合わせたとき・検索中・メニューを開いている間だけ出す（スマホではいつも）
  const hover = inline && search === null && !pop.anchor ? "md:opacity-0 md:group-hover/db:opacity-100 md:focus-within:opacity-100" : "";

  return (
    <>
      {/* ビューのタブとツールバー */}
      <div className={`flex flex-wrap items-end gap-x-2 border-b border-line ${inline ? "mb-1" : ""}`}>
        {/* タブのブロックと同じタブの並び。選んでいるビューをもう一度押すと、ビューの設定 */}
        <TabStrip
          items={views.map((v) => ({
            id: v.id,
            title: v.id === view?.id && !locked ? `${v.name}（もう一度押すとビューの設定）` : v.name,
            content: (
              <>
                <Icon name={VIEW_TYPES[v.type].icon} size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">{v.name}</span>
              </>
            ),
          }))}
          active={view?.id ?? ""}
          onSelect={(id) => (id === view?.id ? openSettings() : onSwitch(id))}
          label="ビュー"
          unit="ビュー"
          className="min-w-0 flex-1 pt-1 pl-1"
          after={
            !locked && (
              <button
                className={`mb-0.5 grid h-7 w-7 shrink-0 place-items-center self-center rounded-[6px] text-muted hover:bg-tint ${hover}`}
                aria-label="ビューを追加"
                title="ビューを追加"
                onClick={openPop({ kind: "addView" })}
              >
                <Icon name="add" size={16} />
              </button>
            )
          }
        />
        {view && (
          <div data-name="ビューのツールバー" className="flex shrink-0 items-center gap-0.5 py-1 text-sm text-muted">
            <div className={`flex items-center gap-0.5 transition-opacity ${hover}`}>
              {search !== null ? (
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onBlur={() => !search && setSearch(null)}
                  onKeyDown={(e) => e.key === "Escape" && setSearch(null)}
                  placeholder="検索"
                  aria-label="このビューを検索"
                  className={`field py-1 ${inline ? "h-7 w-32 min-h-0" : "w-36"}`}
                />
              ) : (
                <ToolButton icon="search" label="検索" small={inline} onClick={() => setSearch("")} />
              )}
              {/* 固定したビュー：フィルター・並び替えは変えられない。鍵を押すと、ビューの設定（固定を外すスイッチ） */}
              {locked ? null : view.options.locked ? (
                <ToolButton icon="lock" label="固定中" small={inline} active onClick={openPop({ kind: "view" })} />
              ) : (
                <>
                  <ToolButton icon="filter" label="フィルター" small={inline} active={view.filters.length > 0} onClick={openPop({ kind: "addFilter" })} />
                  <ToolButton icon="sort" label="並び替え" small={inline} active={sortsOf(view).length > 0} onClick={openPop({ kind: "sort" })} />
                </>
              )}
              {!locked && <ToolButton ref={settingsBtn} icon="dots" label="ビューの設定" small={inline} onClick={openPop({ kind: "view" })} />}
            </div>
            {end && <span className="ml-1">{end}</span>}
          </div>
        )}
      </div>

      {/* かかっている条件（押すとその場で直せる） */}
      {view && (view.filters.length > 0 || sortsOf(view).length > 0) && (
        <div data-name="かかっている条件" className={`flex flex-wrap items-center gap-1.5 ${inline ? "mb-1.5" : ""}`}>
          {sortsOf(view).map((x, i) => (
            <button key={`sort:${x.prop}:${i}`} disabled={!!view.options.locked || locked} onClick={openPop({ kind: "sort" })} className="flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-xs enabled:hover:bg-tint">
              <Icon name={x.dir === "asc" ? "up" : "dn"} size={12} />
              {database.props.find((p) => p.id === x.prop)?.name ?? "?"}
            </button>
          ))}
          {view.filters.length > 1 && view.filterMode === "or" && <span className="text-xs text-muted">どれか1つ：</span>}
          {view.filters.map((f, i) => (
            <button key={i} disabled={!!view.options.locked || locked} onClick={openPop({ kind: "filter", index: i })} className="flex items-center gap-1 rounded-full border border-accent bg-tint px-2.5 py-0.5 text-xs">
              <Icon name="filter" size={12} />
              {filterLabel(database, f, members)}
            </button>
          ))}
          {!view.options.locked && !locked && (
            <button onClick={openPop({ kind: "addFilter" })} className="rounded-full px-2 py-0.5 text-xs text-muted hover:bg-tint">
              ＋ 条件
            </button>
          )}
        </div>
      )}

      {view ? (
        // 何も出ないときの次の一手：検索中なら検索を消す、条件があれば外す、どちらも無ければ追加する
        <EmptyHint.Provider
          value={
            search ? (
              <button className="btn-sub h-8 min-h-0 px-3 text-xs" onClick={() => setSearch(null)}>
                検索を消す
              </button>
            ) : view.filters.length > 0 && !view.options.locked && !locked ? (
              <button className="btn-sub h-8 min-h-0 px-3 text-xs" onClick={() => void saveView({ ...view, filters: [] })}>
                条件を外して全部を見る
              </button>
            ) : locked ? null : (
              <button className="btn-sub h-8 min-h-0 gap-1 px-3 text-xs" onClick={onNew}>
                <Icon name="add" size={14} />
                {label}を追加
              </button>
            )
          }
        >
          <ViewRenderer key={`view:${view.id}`} database={database} view={view} allPages={pages} events={events} members={members} userId={userId} search={search ?? ""} />
        </EmptyHint.Provider>
      ) : (
        <p className="text-muted">ビューがありません。タブの右の＋から追加してください。</p>
      )}

      {pop.anchor && popKind && (
        <Popover
          anchor={pop.anchor}
          onClose={pop.close}
          width={popKind.kind === "view" ? 320 : popKind.kind === "addView" ? 280 : 300}
          align={popKind.kind === "addView" ? "start" : "end"}
          label={{ addView: "ビューを追加", addFilter: "フィルター", sort: "並び替え", filter: "フィルター", view: "ビューの設定" }[popKind.kind]}
        >
          {popKind.kind === "addView" && (
            <div>
              <MenuLabel>どの形で表示しますか</MenuLabel>
              {(Object.keys(VIEW_TYPES) as ViewType[]).map((t) => (
                <MenuItem
                  key={t}
                  icon={<Icon name={VIEW_TYPES[t].icon} size={16} />}
                  onClick={async () => {
                    pop.close();
                    const v = await createView(database.id, VIEW_TYPES[t].label, t);
                    onSwitch(v.id);
                    openSettings();
                  }}
                >
                  <span className="block" title={VIEW_TYPES[t].note}>
                    {VIEW_TYPES[t].label}
                  </span>
                </MenuItem>
              ))}
            </div>
          )}
          {/* フィルター・並び替え・ビューの設定は、どれも行を押すと中の画面に進む形（ブロックの設定と同じ） */}
          {view && popKind.kind === "addFilter" && <FilterScreens key="filters" database={database} view={view} members={members} start={view.filters.length ? { kind: "list" } : { kind: "add" }} />}
          {view && popKind.kind === "filter" && <FilterScreens key={`filter:${popKind.index}`} database={database} view={view} members={members} start={{ kind: "edit", index: popKind.index }} />}
          {view && popKind.kind === "sort" && <SortScreens database={database} view={view} />}
          {view && popKind.kind === "view" && (
            <ViewSettingsMenu key={view.id} database={database} view={view} members={members} canDelete={views.length > 1} onSwitch={onSwitch} onClose={pop.close} titleToggle={titleToggle} />
          )}
        </Popover>
      )}
    </>
  );
}

function ToolButton({
  icon,
  label,
  onClick,
  active,
  small = false,
  ref,
}: {
  icon: "search" | "filter" | "sort" | "dots" | "lock";
  label: string;
  onClick: (e: React.MouseEvent<HTMLElement>) => void;
  active?: boolean;
  /** ノートの中のデータベース：小さく、アイコンだけ */
  small?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex items-center gap-1 rounded-[8px] hover:bg-tint ${small ? "h-7 px-1.5" : "h-8 px-2"} ${active ? "text-accent" : ""}`}
    >
      <Icon name={icon} size={small ? 16 : 17} />
      {!small && <span className="hidden 2xl:inline">{label}</span>}
    </button>
  );
}
