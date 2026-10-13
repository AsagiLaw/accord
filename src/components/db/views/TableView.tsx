"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { DEFAULT_PAGE_ICON, IconMark } from "@/components/IconMark";
import { IconPicker } from "@/components/IconPicker";
import { PageMenu } from "../PageMenu";
import { PropChatPopup } from "../PropChat";
import { Popover, MenuItem, usePopover } from "@/components/ui/Popover";
import type { CalcType, DbPage, Property } from "@/lib/local/db";
import { createBlankPage, setPageIcon, updatePageTitle, updatePageValue } from "@/lib/local/requests";
import { useSaveView } from "../viewSave";
import { sortsOf, valueOf } from "@/lib/requests/logic";
import { AddPropertyMenu, PropertyMenu, calcLabel, calcsFor, calculate, visibleProps } from "../editors";
import { PropIcon } from "../meta";
import { PropInput } from "../PropInput";
import { StageSettings } from "../StageSettings";
import { PropValue, SelectEditor, StageEditor } from "../values";
import { PageName, pageHref, type ViewProps } from "./common";
import { PageLink as PeekLink } from "../PageLink";
import { asValueProp, valueTypeOf } from "@/lib/requests/formula";
import { GroupHead, colorHueOf, groupPages, groupPropOf, groupSumText, useCollapsed } from "./groups";

const MIN_W = 60;
const MAX_W = 800;
const clampW = (w: number) => Math.round(Math.max(MIN_W, Math.min(MAX_W, w)));

/**
 * Notion のような表。セルを押すとその場で編集、列の見出しからメニュー、下に新規と集計。
 * 列の見出しの右端をドラッグで幅を変え、ダブルクリックで中身にちょうどいい幅にする。
 */
export function TableView({ database, view, pages, members, userId }: ViewProps) {
  const titleProp = database.props.find((p) => p.type === "title")!;
  const cols = visibleProps(database, view);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const header = usePopover();
  const [headerProp, setHeaderProp] = useState<Property | "add" | null>(null);
  const cell = usePopover();
  const [cellAt, setCellAt] = useState<{ page: DbPage; prop: Property } | null>(null);
  const calc = usePopover();
  const [calcProp, setCalcProp] = useState<Property | null>(null);
  const [stageProp, setStageProp] = useState<Property | null>(null);
  // ページのアイコンを選んでいるページ
  const iconPop = usePopover();
  const [iconFor, setIconFor] = useState<DbPage | null>(null);
  const openIcon = (e: React.MouseEvent<HTMLElement>, p: DbPage) => {
    setIconFor(p);
    iconPop.open(e);
  };
  // ページの名前を右クリックしたときのメニュー（開く・編集・削除）
  const router = useRouter();
  const rowMenu = usePopover();
  const [menuFor, setMenuFor] = useState<DbPage | null>(null);
  const vertical = view.options.layout === "vertical";
  // 固定したビュー：列の幅を変えたり、項目を足したりしない
  const locked = !!view.options.locked;
  // 文章を右端で折り返す
  const wrap = !!view.options.wrap;
  // グループ分け（横一列の表だけ）
  const group = vertical ? undefined : groupPropOf(database, view);
  const collapsed = useCollapsed();
  // 列の幅・集計は、ビューに保存する（ブロックだけのビューなら、ブロックに）
  const saveView = useSaveView();

  // ---- 列の幅 ----
  const box = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<Record<string, number>>({});
  const drag = useRef<{ key: string; x: number; w: number } | null>(null);
  const widthOf = (key: string, def: number) => live[key] ?? view.options.widths?.[key] ?? def;
  const saveWidth = async (key: string, w: number) => {
    await saveView({ ...view, options: { ...view.options, widths: { ...view.options.widths, [key]: clampW(w) } } });
    setLive((cur) => {
      const next = { ...cur };
      delete next[key];
      return next;
    });
  };
  /** 見出しとセルの中身の本来の幅を測り、いちばん広いものに合わせる */
  const fit = (key: string, extra: number) => {
    const el = box.current;
    if (!el) return;
    el.classList.add("fit-measuring");
    let max = 0;
    el.querySelectorAll<HTMLElement>(`[data-fit="${CSS.escape(key)}"]`).forEach((x) => (max = Math.max(max, x.getBoundingClientRect().width)));
    el.classList.remove("fit-measuring");
    if (max) void saveWidth(key, max + extra);
  };
  // 固定したビューでは、列の幅は変えない（つまみを出さない）
  const resizer = (key: string, def: number, extra: number) =>
    !locked && (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label="列の幅を変える（ダブルクリックでちょうどいい幅）"
      title="ドラッグで幅を変える／ダブルクリックでちょうどいい幅"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { key, x: e.clientX, w: widthOf(key, def) };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) setLive((cur) => ({ ...cur, [d.key]: clampW(d.w + e.clientX - d.x) }));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && Math.abs(e.clientX - d.x) > 1) void saveWidth(d.key, d.w + e.clientX - d.x);
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        fit(key, extra);
      }}
      className="absolute top-0 -right-[3px] z-[2] h-full w-1.5 cursor-col-resize touch-none rounded-full hover:bg-accent/60 active:bg-accent"
    />
  );

  /** セルを押したとき：チェックボックスはその場で切り替え、自動の日時は変えられない、ほかは編集を開く */
  const [chatAt, setChatAt] = useState<{ page: DbPage; prop: Property } | null>(null);
  const openCell = (e: React.MouseEvent<HTMLElement>, p: DbPage, c: Property) => {
    if (c.type === "checkbox") return void updatePageValue(p.id, c.id, !valueOf(p, c.id));
    // チャットの項目は、会話をポップアップで開く
    if (c.type === "chat" || c.type === "imageChat") return setChatAt({ page: p, prop: c });
    // 自動の日時と数式は、ここでは変えない（数式は列の見出しの「式の設定」から）
    if (c.type === "created" || c.type === "edited" || c.type === "formula" || c.type === "serial") return;
    setCellAt({ page: p, prop: c });
    cell.open(e);
  };

  const titleCell = (p: DbPage, fitKey: string) =>
    editingTitle === p.id ? (
      <input
        autoFocus
        defaultValue={p.title}
        onBlur={(e) => {
          if (e.target.value.trim() !== p.title) void updatePageTitle(p.id, e.target.value.trim());
          setEditingTitle(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditingTitle(null);
        }}
        className="w-full bg-tint px-2 py-1.5 font-bold outline-none"
        aria-label="名前"
      />
    ) : (
      // アイコンは名前の左（付けていなければ標準のアイコン）。押すと変えられる（Notion と同じ）。右クリックでメニュー
      <div
        className="relative"
        onContextMenu={(e) => {
          setMenuFor(p);
          rowMenu.openAt(e);
        }}
      >
        <button onClick={() => setEditingTitle(p.id)} className="flex w-full items-center overflow-hidden py-1.5 pr-14 pl-9 text-left font-bold hover:bg-tint" title="押して名前を変える">
          <span data-fit={fitKey} className="flex min-w-0">
            <PageName database={database} page={p} noIcon />
          </span>
        </button>
        <button
          onClick={(e) => openIcon(e, p)}
          aria-label={`${p.title || "無題"}のアイコンを変える`}
          title="アイコンを変える"
          className="absolute top-1/2 left-1 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-[6px] text-base hover:bg-tint"
        >
          <IconMark icon={p.icon || DEFAULT_PAGE_ICON} />
        </button>
      </div>
    );

  const openLink = (p: DbPage) => (
    <PeekLink
      database={database}
      pageId={p.id}
      className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1 rounded-[6px] border border-line bg-card px-1.5 py-0.5 text-xs text-muted opacity-0 group-hover:opacity-100 hover:text-ink focus:opacity-100 max-md:opacity-70"
    >
      <Icon name="open" size={12} />
      開く
    </PeekLink>
  );

  /** 項目の見出し（押すとメニュー） */
  const propButton = (p: Property, fitKey: string) => (
    <button
      onClick={(e) => {
        setHeaderProp(p);
        header.open(e);
      }}
      className="flex w-full items-center overflow-hidden px-2 py-1.5 text-left whitespace-nowrap text-muted hover:bg-tint"
    >
      <span data-fit={fitKey} className="flex min-w-0 items-center gap-1.5">
        <PropIcon type={p.type} />
        <span className="truncate">{p.name}</span>
        {(() => {
          const s = sortsOf(view).find((x) => x.prop === p.id);
          return s && <Icon name={s.dir === "asc" ? "up" : "dn"} size={14} />;
        })()}
      </span>
    </button>
  );

  /** 値のセル（押すとその場で編集） */
  const valueCell = (p: DbPage, c: Property, fitKey: string) => (
    <button
      onClick={(e) => openCell(e, p, c)}
      // 折り返すときは、セルの右端で次の行へ（行の高さは中身に合わせる）
      className={`flex min-h-[34px] w-full overflow-hidden px-2 py-1 text-left hover:bg-tint ${wrap ? "items-start break-words whitespace-normal" : "items-center whitespace-nowrap"}`}
      aria-label={`${p.title || "無題"}の${c.name}`}
    >
      <span data-fit={fitKey} className={wrap ? "min-w-0 [&_*]:whitespace-normal" : "flex min-w-0 items-center"}>
        <PropValue prop={c} value={valueOf(p, c.id)} members={members} page={p} />
      </span>
    </button>
  );

  const popovers = (
    <>
      {chatAt && (
        <PropChatPopup
          database={database}
          // 開いている間にページが変わっても（チャットができたなど）、新しいほうを使う
          page={pages.find((x) => x.id === chatAt.page.id) ?? chatAt.page}
          prop={chatAt.prop}
          members={members}
          userId={userId}
          onClose={() => setChatAt(null)}
        />
      )}
      {rowMenu.anchor && menuFor && (
        <Popover anchor={rowMenu.anchor} onClose={rowMenu.close} width={280} label="ページのメニュー">
          <PageMenu
            database={database}
            page={menuFor}
            close={rowMenu.close}
            onOpen={() => router.push(pageHref(database, menuFor.id))}
          />
        </Popover>
      )}
      {iconPop.anchor && iconFor && (
        <IconPicker anchor={iconPop.anchor} roomId={database.roomId} hasIcon={!!iconFor.icon} onPick={(i) => void setPageIcon(iconFor.id, i)} onClose={iconPop.close} />
      )}
      {header.anchor && headerProp && (
        <Popover anchor={header.anchor} onClose={header.close} width={300} label={headerProp === "add" ? "項目を追加" : `項目「${headerProp.name}」`}>
          {headerProp === "add" ? (
            <AddPropertyMenu database={database} view={view} onDone={header.close} />
          ) : (
            <PropertyMenu database={database} view={view} prop={headerProp} onDone={header.close} onStageSettings={setStageProp} />
          )}
        </Popover>
      )}
      {cell.anchor && cellAt && (
        <Popover anchor={cell.anchor} onClose={cell.close} width={cellAt.prop.type === "media" ? 320 : 280} label={cellAt.prop.name}>
          <CellEditor database={database} page={pages.find((x) => x.id === cellAt.page.id) ?? cellAt.page} prop={cellAt.prop} members={members} userId={userId} onDone={cell.close} />
        </Popover>
      )}
      {stageProp && <StageSettings database={database} prop={database.props.find((x) => x.id === stageProp.id) ?? stageProp} onClose={() => setStageProp(null)} />}
    </>
  );

  // ---- 縦一列：行と列を入れ替えた表。項目が縦（行）、ページが横（列）に並ぶ ----
  if (vertical) {
    const LABEL = "__label";
    const labelW = widthOf(LABEL, 170);
    const pageW = (p: DbPage) => widthOf(p.id, 220);
    const total = labelW + pages.reduce((a, p) => a + pageW(p), 0) + 44;
    const labelCell = (p: Property, isHeader = false) => (
      <th scope="row" className={`sticky left-0 z-[1] border-r border-line bg-card p-0 text-left font-normal ${isHeader ? "relative" : ""}`}>
        {propButton(p, LABEL)}
        {isHeader && resizer(LABEL, 170, 24)}
      </th>
    );
    return (
      <div ref={box} className="overflow-x-auto rounded-[12px] border border-line bg-card">
        <table className="table-fixed border-collapse text-sm" style={{ width: total }}>
          <colgroup>
            <col style={{ width: labelW }} />
            {pages.map((p) => (
              <col key={p.id} style={{ width: pageW(p) }} />
            ))}
            <col style={{ width: 44 }} />
          </colgroup>
          <thead>
            <tr className="border-b border-line">
              {labelCell(titleProp, true)}
              {pages.map((p) => (
                <th key={p.id} data-name={`ページの列「${p.title || "無題"}」`} className="group relative border-r border-line p-0 text-left">
                  {titleCell(p, p.id)}
                  {openLink(p)}
                  {resizer(p.id, 220, 112)}
                </th>
              ))}
              <th className="p-0 align-top">
                <button
                  aria-label="新規"
                  title="新規"
                  onClick={async () => setEditingTitle((await createBlankPage(database, userId)).id)}
                  className="grid h-full min-h-[34px] w-full place-items-center text-muted hover:bg-tint"
                >
                  <Icon name="add" size={16} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {cols.map((c) => (
              <tr key={c.id} className="border-b border-line">
                {labelCell(c)}
                {pages.map((p) => (
                  <td key={p.id} className="border-r border-line p-0">
                    {valueCell(p, c, p.id)}
                  </td>
                ))}
                <td />
              </tr>
            ))}
            <tr>
              <td className="sticky left-0 bg-card p-0">
                <button
                  onClick={(e) => {
                    setHeaderProp("add");
                    header.open(e);
                  }}
                  className="flex w-full items-center gap-1.5 overflow-hidden px-2 py-1.5 text-left whitespace-nowrap text-muted hover:bg-tint"
                >
                  <Icon name="add" size={16} />
                  項目を追加
                </button>
              </td>
              <td colSpan={pages.length + 1} />
            </tr>
          </tbody>
        </table>
        {!pages.length && <p className="px-3 py-2 text-sm text-muted">該当するものはありません。右上の＋で追加できます。</p>}
        {popovers}
      </div>
    );
  }

  // ---- 横一列：ふつうの表 ----
  const colW = (p: Property) => widthOf(p.id, p.type === "title" ? 260 : 180);
  const total = colW(titleProp) + cols.reduce((a, c) => a + colW(c), 0) + 44;
  const headerCell = (p: Property) => (
    <th key={p.id} className="relative border-r border-line p-0 font-normal">
      {propButton(p, p.id)}
      {resizer(p.id, p.type === "title" ? 260 : 180, p.type === "title" ? 112 : 24)}
    </th>
  );

  /** ページ1行。色分けしていれば、行の左の端に色の線 */
  const row = (p: DbPage) => {
    const hue = colorHueOf(database, view, p);
    return (
      <tr key={p.id} className="group border-b border-line">
        <td className="relative border-r border-line p-0" style={hue ? { boxShadow: `inset 3px 0 0 ${hue}` } : undefined}>
          {titleCell(p, titleProp.id)}
          {openLink(p)}
        </td>
        {cols.map((c) => (
          <td key={c.id} className={`border-r border-line p-0 ${wrap ? "align-top" : ""}`}>
            {valueCell(p, c, c.id)}
          </td>
        ))}
        <td />
      </tr>
    );
  };
  const groups = group ? groupPages(group, pages, view, members) : null;
  /** グループの下の「新規」で入れる値（そのグループの値。入れられない項目なら undefined） */
  const groupValue = (key: string): unknown => {
    if (!group || key === "") return undefined;
    if (group.type === "checkbox") return key === "true";
    if (group.type === "multiselect") return [key];
    if (group.type === "select" || group.type === "status" || group.type === "user") return key;
    return undefined;
  };

  return (
    <div ref={box} className="overflow-x-auto rounded-[12px] border border-line bg-card">
      <table className="table-fixed border-collapse text-sm" style={{ width: total }}>
        <colgroup>
          <col style={{ width: colW(titleProp) }} />
          {cols.map((c) => (
            <col key={c.id} style={{ width: colW(c) }} />
          ))}
          <col style={{ width: 44 }} />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            {headerCell(titleProp)}
            {cols.map(headerCell)}
            <th className="p-0">
              {/* 固定したビューでは、項目を足さない（足した項目をこのビューに出せないため） */}
              {!locked && (
                <button
                  aria-label="項目を追加"
                  title="項目を追加"
                  onClick={(e) => {
                    setHeaderProp("add");
                    header.open(e);
                  }}
                  className="grid h-8 w-full place-items-center text-muted hover:bg-tint"
                >
                  <Icon name="add" size={16} />
                </button>
              )}
            </th>
          </tr>
        </thead>
        {/* グループ分けしていれば、グループごとに見出しの行を付けて分ける（たためる。グループの下の「新規」はそのグループの値で作る） */}
        {groups ? (
          groups.map((g) => (
            <tbody key={g.key || "__none"}>
              <tr className="border-b border-line bg-bg/40">
                <td colSpan={cols.length + 2} className="px-1 py-0.5">
                  <GroupHead group={g} sum={groupSumText(database, view, g.pages)} collapsed={collapsed.isClosed(g.key)} onToggle={() => collapsed.toggle(g.key)} />
                </td>
              </tr>
              {!collapsed.isClosed(g.key) && g.pages.map(row)}
              {!collapsed.isClosed(g.key) && groupValue(g.key) !== undefined && (
                <tr className="border-b border-line">
                  <td colSpan={cols.length + 2} className="p-0">
                    <button
                      onClick={async () => setEditingTitle((await createBlankPage(database, userId, { [group!.id]: groupValue(g.key) })).id)}
                      className="flex w-full items-center gap-1.5 px-2 py-1 pl-7 text-left text-sm text-muted hover:bg-tint"
                    >
                      <Icon name="add" size={14} />
                      新規
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          ))
        ) : (
          <tbody>{pages.map(row)}</tbody>
        )}
        <tfoot>
          <tr className="border-b border-line">
            <td colSpan={cols.length + 2} className="p-0">
              <button
                onClick={async () => setEditingTitle((await createBlankPage(database, userId)).id)}
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-muted hover:bg-tint"
              >
                <Icon name="add" size={16} />
                新規
              </button>
            </td>
          </tr>
          <tr className="text-xs text-muted">
            {[titleProp, ...cols].map((c) => {
              const type: CalcType = view.options.calc?.[c.id] ?? "none";
              return (
                <td key={c.id} className="overflow-hidden p-0 text-right">
                  <button
                    onClick={(e) => {
                      setCalcProp(c);
                      calc.open(e);
                    }}
                    className="w-full truncate px-2 py-1 text-right opacity-60 hover:bg-tint hover:opacity-100"
                  >
                    {type === "none" ? "計算" : `${calcLabel(asValueProp(database, c), type)}　${calculate(asValueProp(database, c), pages, type)}`}
                  </button>
                </td>
              );
            })}
            <td />
          </tr>
        </tfoot>
      </table>
      {!pages.length && <p className="px-3 py-2 text-sm text-muted">該当するものはありません</p>}

      {popovers}
      {calc.anchor && calcProp && (
        <Popover anchor={calc.anchor} onClose={calc.close} width={200} label={`「${calcProp.name}」の計算`}>
          {calcsFor(valueTypeOf(database, calcProp)).map((t) => (
            <MenuItem
              key={t}
              active={(view.options.calc?.[calcProp.id] ?? "none") === t}
              onClick={() => {
                void saveView({ ...view, options: { ...view.options, calc: { ...view.options.calc, [calcProp.id]: t } } });
                calc.close();
              }}
            >
              {calcLabel(calcProp, t)}
            </MenuItem>
          ))}
        </Popover>
      )}
    </div>
  );
}

/** セルを押したときに出る編集 */
function CellEditor({
  database,
  page,
  prop,
  members,
  userId,
  onDone,
}: {
  database: ViewProps["database"];
  page: DbPage;
  prop: Property;
  members: ViewProps["members"];
  userId: string;
  onDone: () => void;
}) {
  const value = valueOf(page, prop.id);
  const set = (v: unknown) => updatePageValue(page.id, prop.id, v);
  if (prop.type === "select" || prop.type === "status" || prop.type === "multiselect") {
    return <SelectEditor database={database} prop={prop} value={value} onChange={set} onDone={onDone} />;
  }
  if (prop.type === "stage") return <StageEditor database={database} prop={prop} page={page} onChange={set} onDone={onDone} />;
  return (
    <div className="p-1" onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && prop.type !== "media" && onDone()}>
      <PropInput database={database} prop={prop} value={value} onChange={set} members={members} userId={userId} page={page} />
    </div>
  );
}
