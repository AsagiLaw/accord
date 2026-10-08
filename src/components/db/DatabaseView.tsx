"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { IconMark, mediaIcon } from "@/components/IconMark";
import { MediaPicker } from "@/components/MediaPicker";
import { MenuDivider, MenuItem, MenuLabel, Popover, usePopover } from "@/components/ui/Popover";
import { TabStrip } from "@/components/ui/TabStrip";
import { choose, promptText } from "@/components/ui/overlay";
import type { CalEvent, Database, DbPage, DbView, PageTemplate, ViewType } from "@/lib/local/db";
import { createView, nameSuffixOf, setDatabaseIcon, updateDatabase } from "@/lib/local/requests";
import type { MemberWithProfile } from "@/lib/local/rooms";
import { filterLabel } from "./editors";
import { ImportDialog } from "./ImportDialog";
import { EmojiPicker, VIEW_TYPES } from "./meta";
import { NewPageDialog } from "./NewPageDialog";
import { StageSettings } from "./StageSettings";
import { TemplateMenu } from "./TemplateMenu";
import { FilterScreens, SortScreens, ViewSettingsMenu } from "./ViewSettings";
import { ViewRenderer } from "./views/ViewRenderer";

type Pop = { kind: "icon" | "addView" | "more" | "addFilter" | "sort" | "templates" | "view" } | { kind: "filter"; index: number };

/** データベースの画面（Notion のように、ビューのタブ・検索・フィルター・並び替え・ビューの設定） */
export function DatabaseView({
  database,
  views,
  view,
  pages,
  events,
  members,
  userId,
  openNew,
  onCloseNew,
}: {
  database: Database;
  views: DbView[];
  view: DbView | undefined;
  pages: DbPage[];
  events: CalEvent[];
  members: MemberWithProfile[];
  userId: string;
  openNew: boolean;
  onCloseNew: () => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"new" | "plans" | "import" | "iconMedia" | null>(null);
  // テンプレートから追加するときの、選んだテンプレート
  const [template, setTemplate] = useState<PageTemplate | null>(null);
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
    if (!el) return;
    setPopKind({ kind: "view" });
    pop.open({ currentTarget: el });
  };
  const label = database.kind === "request" ? "依頼" : "ページ";
  const switchTo = (id: string) => router.replace(`?v=${id}`);
  const showNew = dialog === "new" || openNew;
  // 「追加」で使う既定のテンプレート
  const defaultTemplate = database.templates?.find((t) => t.id === database.defaultTemplateId);

  return (
    <div data-name={`データベース画面「${database.name}」`} className="space-y-3">
      {/* 見出し：アイコンと名前（押して変更） */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={openPop({ kind: "icon" })}
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
          className="mr-auto rounded-[8px] px-1 text-[28px] font-bold hover:bg-tint"
        >
          {database.name}
        </button>
        <button className="btn-sub w-10 px-0" aria-label="データベースのメニュー" title="データベースのメニュー" onClick={openPop({ kind: "more" })}>
          <Icon name="dots" />
        </button>
        <div className="flex">
          <button
            className="btn rounded-r-none"
            title={defaultTemplate ? `テンプレート「${defaultTemplate.name}」で追加` : undefined}
            onClick={() => (setTemplate(defaultTemplate ?? null), setDialog("new"))}
          >
            <Icon name="add" />
            {label}を追加
          </button>
          <button
            className="btn rounded-l-none border-l border-accent-ink/30 px-2"
            aria-label="テンプレートから追加"
            title="テンプレートから追加・テンプレートを作る"
            onClick={openPop({ kind: "templates" })}
          >
            <Icon name="dn" />
          </button>
        </div>
      </div>

      {/* ビューのタブとツールバー */}
      <div className="flex flex-wrap items-end gap-x-2 border-b border-line">
        {/* タブのブロックと同じタブの並び。選んでいるビューをもう一度押すと、ビューの設定 */}
        <TabStrip
          items={views.map((v) => ({
            id: v.id,
            title: v.id === view?.id ? "もう一度押すとビューの設定" : v.name,
            content: (
              <>
                <Icon name={VIEW_TYPES[v.type].icon} size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">{v.name}</span>
              </>
            ),
          }))}
          active={view?.id ?? ""}
          onSelect={(id) => (id === view?.id ? openSettings() : switchTo(id))}
          label="ビュー"
          unit="ビュー"
          className="min-w-0 flex-1 pt-1 pl-1"
          after={
            <button className="mb-0.5 grid h-7 w-7 shrink-0 place-items-center self-center rounded-[6px] text-muted hover:bg-tint" aria-label="ビューを追加" title="ビューを追加" onClick={openPop({ kind: "addView" })}>
              <Icon name="add" size={16} />
            </button>
          }
        />
        {view && (
          <div data-name="ビューのツールバー" className="flex shrink-0 items-center gap-0.5 py-1 text-sm text-muted">
            {search !== null ? (
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onBlur={() => !search && setSearch(null)}
                onKeyDown={(e) => e.key === "Escape" && setSearch(null)}
                placeholder="検索"
                aria-label="このビューを検索"
                className="field w-36 py-1"
              />
            ) : (
              <ToolButton icon="search" label="検索" onClick={() => setSearch("")} />
            )}
            <ToolButton icon="filter" label="フィルター" active={view.filters.length > 0} onClick={openPop({ kind: "addFilter" })} />
            <ToolButton icon="sort" label="並び替え" active={!!view.sort} onClick={openPop({ kind: "sort" })} />
            <ToolButton ref={settingsBtn} icon="dots" label="ビューの設定" onClick={openPop({ kind: "view" })} />
          </div>
        )}
      </div>

      {/* かかっている条件（押すとその場で直せる） */}
      {view && (view.filters.length > 0 || view.sort) && (
        <div data-name="かかっている条件" className="flex flex-wrap items-center gap-1.5">
          {view.sort && (
            <button onClick={openPop({ kind: "sort" })} className="flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-xs hover:bg-tint">
              <Icon name={view.sort.dir === "asc" ? "up" : "dn"} size={12} />
              {database.props.find((p) => p.id === view.sort!.prop)?.name ?? "?"}
            </button>
          )}
          {view.filters.map((f, i) => (
            <button key={i} onClick={openPop({ kind: "filter", index: i })} className="flex items-center gap-1 rounded-full border border-accent bg-tint px-2.5 py-0.5 text-xs">
              <Icon name="filter" size={12} />
              {filterLabel(database, f, members)}
            </button>
          ))}
          <button onClick={openPop({ kind: "addFilter" })} className="rounded-full px-2 py-0.5 text-xs text-muted hover:bg-tint">
            ＋ 条件
          </button>
        </div>
      )}

      {view ? (
        <ViewRenderer key={`view:${view.id}`} database={database} view={view} allPages={pages} events={events} members={members} userId={userId} search={search ?? ""} />
      ) : (
        <p className="text-muted">ビューがありません。タブの右の＋から追加してください。</p>
      )}

      {pop.anchor && popKind && (
        <Popover
          anchor={pop.anchor}
          onClose={pop.close}
          width={popKind.kind === "icon" ? 340 : popKind.kind === "view" ? 320 : 300}
          align={popKind.kind === "templates" || popKind.kind === "more" || popKind.kind === "sort" || popKind.kind === "addFilter" || popKind.kind === "filter" || popKind.kind === "view" ? "end" : "start"}
          label={{ icon: "アイコン", addView: "ビューを追加", more: "データベースのメニュー", templates: "テンプレート", addFilter: "フィルター", sort: "並び替え", filter: "フィルター", view: "ビューの設定" }[popKind.kind]}
        >
          {popKind.kind === "icon" && (
            <EmojiPicker
              icons
              removeLabel="標準に戻す"
              onPick={(e) => (setDatabaseIcon(database.id, e), pop.close())}
              onRemove={database.icon ? () => (setDatabaseIcon(database.id, undefined), pop.close()) : undefined}
              onMedia={() => (pop.close(), setDialog("iconMedia"))}
            />
          )}
          {popKind.kind === "templates" && <TemplateMenu database={database} close={pop.close} onPick={(t) => (setTemplate(t), setDialog("new"))} />}
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
                    switchTo(v.id);
                    openSettings();
                  }}
                >
                  <span className="block">{VIEW_TYPES[t].label}</span>
                  <span className="block truncate text-xs text-muted">{VIEW_TYPES[t].note}</span>
                </MenuItem>
              ))}
            </div>
          )}
          {popKind.kind === "more" && (
            <div>
              <MenuItem icon={<Icon name="edit" size={16} />} onClick={async () => {
                pop.close();
                const name = await promptText("データベースの名前", database.name);
                if (name) await updateDatabase(database.id, { name });
              }}>
                名前を変更
              </MenuItem>
              <MenuItem
                icon={<Icon name="text" size={16} />}
                right={<span className="text-xs text-muted">{nameSuffixOf(database) || "なし"}</span>}
                onClick={async () => {
                  pop.close();
                  const k = await choose("ページの名前の後ろに付ける言葉", [{ label: "言葉を入れる", detail: `今：${nameSuffixOf(database) || "なし"}（例：様）` }, { label: "付けない" }]);
                  if (k === 1) await updateDatabase(database.id, { nameSuffix: "" });
                  if (k === 0) {
                    const v = await promptText("ページの名前の後ろに付ける言葉", nameSuffixOf(database), "例：様");
                    if (v) await updateDatabase(database.id, { nameSuffix: v });
                  }
                }}
              >
                名前の後ろに付ける言葉
              </MenuItem>
              {database.props.some((p) => p.type === "stage") && (
                <MenuItem icon={<Icon name="timeline" size={16} />} onClick={() => (pop.close(), setDialog("plans"))}>
                  工程の設定（プランごとの工程と％）
                </MenuItem>
              )}
              <MenuDivider />
              <MenuItem icon={<Icon name="upload" size={16} />} onClick={() => (pop.close(), setDialog("import"))}>
                Notion から取り込む
              </MenuItem>
            </div>
          )}
          {/* フィルター・並び替え・ビューの設定は、どれも行を押すと中の画面に進む形（ブロックの設定と同じ） */}
          {view && popKind.kind === "addFilter" && <FilterScreens key="filters" database={database} view={view} members={members} start={view.filters.length ? { kind: "list" } : { kind: "add" }} />}
          {view && popKind.kind === "filter" && <FilterScreens key={`filter:${popKind.index}`} database={database} view={view} members={members} start={{ kind: "edit", index: popKind.index }} />}
          {view && popKind.kind === "sort" && <SortScreens database={database} view={view} />}
          {view && popKind.kind === "view" && <ViewSettingsMenu key={view.id} database={database} view={view} members={members} canDelete={views.length > 1} onSwitch={switchTo} onClose={pop.close} />}
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
            onCloseNew();
          }}
        />
      )}
      {dialog === "plans" && database.props.find((p) => p.type === "stage") && (
        <StageSettings database={database} prop={database.props.find((p) => p.type === "stage")!} onClose={() => setDialog(null)} />
      )}
      {dialog === "import" && <ImportDialog database={database} userId={userId} onClose={() => setDialog(null)} />}
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

function ToolButton({
  icon,
  label,
  onClick,
  active,
  ref,
}: {
  icon: "search" | "filter" | "sort" | "dots";
  label: string;
  onClick: (e: React.MouseEvent<HTMLElement>) => void;
  active?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-8 items-center gap-1 rounded-[8px] px-2 hover:bg-tint ${active ? "text-accent" : ""}`}
    >
      <Icon name={icon} size={17} />
      <span className="hidden 2xl:inline">{label}</span>
    </button>
  );
}
