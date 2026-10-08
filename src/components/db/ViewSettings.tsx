"use client";

import { Fragment, useState } from "react";
import { PropVisibilityScreen } from "@/components/blockSettings";
import { Icon, type IconName } from "@/components/Icon";
import { MenuDivider, MenuItem } from "@/components/ui/Popover";
import { BackHead, ChoiceScreen, EmptyNote, MenuTitle, NavRow, SectionHead, TextField, ToggleRow, type Choice } from "@/components/ui/SettingsMenu";
import { confirmAction } from "@/components/ui/overlay";
import type { Database, DbView, ViewType } from "@/lib/local/db";
import { deleteView, duplicateView } from "@/lib/local/requests";
import type { MemberWithProfile } from "@/lib/local/rooms";
import { FILTER_OPS } from "@/lib/requests/logic";
import { AddPropertyMenu, FilterValue, filterLabel, opsFor, setVisible, visibleProps } from "./editors";
import { PROP_TYPES, VIEW_TYPES } from "./meta";
import { useSaveView } from "./viewSave";

// データベースのビューの設定（Notion のビューの設定と同じ形。ブロックの設定とも同じ）。
// 行を押すと中の画面に進み、左上の「‹」で戻る。選ぶものはプルダウンを使わず、一覧から押して選ぶ。
// ツールバーのフィルター・並び替えのボタンからも、同じ画面を使う

/** 中の画面に進む前の見出し：戻る先があれば「‹」付き、なければ設定の見出し */
const Head = ({ title, onBack }: { title: string; onBack?: () => void }) => (onBack ? <BackHead title={title} onBack={onBack} /> : <MenuTitle>{title}</MenuTitle>);

// ---- フィルター ----

export type FilterStep = { kind: "list" } | { kind: "add" } | { kind: "edit"; index: number } | { kind: "prop"; index: number } | { kind: "op"; index: number };

/**
 * フィルターの画面：条件の一覧 → 条件を直す（項目・条件・値）／条件を足す（項目を選ぶ）。
 * start で最初の画面を決める。onExit があれば、一覧の「‹」でそこへ戻る（ビューの設定のトップ）
 */
export function FilterScreens({ database, view, members, start, onExit }: { database: Database; view: DbView; members: MemberWithProfile[]; start: FilterStep; onExit?: () => void }) {
  const [step, setStep] = useState<FilterStep>(start);
  const saveView = useSaveView();
  const list = () => setStep({ kind: "list" });

  if (step.kind === "list")
    return (
      <div>
        <Head title="フィルター" onBack={onExit} />
        <p className="px-2 pb-1 text-xs text-muted">すべての条件に合うものだけを出します</p>
        {view.filters.map((f, i) => (
          <NavRow key={i} icon="filter" label={filterLabel(database, f, members)} onClick={() => setStep({ kind: "edit", index: i })} />
        ))}
        {!view.filters.length && <EmptyNote>条件はありません</EmptyNote>}
        <MenuDivider />
        <MenuItem icon={<Icon name="add" size={16} />} onClick={() => setStep({ kind: "add" })}>
          条件を追加
        </MenuItem>
      </div>
    );

  if (step.kind === "add")
    return (
      <ChoiceScreen
        title="条件を追加"
        section="どの項目で絞り込みますか"
        search="項目を検索"
        items={database.props.map((p) => ({ id: p.id, label: p.name, icon: PROP_TYPES[p.type].icon }))}
        selected=""
        onPick={async (id) => {
          const p = database.props.find((x) => x.id === id);
          if (!p) return;
          await saveView({ ...view, filters: [...view.filters, { prop: p.id, op: opsFor(p.type)[0], value: p.type === "checkbox" ? "true" : "" }] });
          setStep({ kind: "edit", index: view.filters.length });
        }}
        onBack={list}
      />
    );

  const index = step.index;
  const f = view.filters[index];
  const edit = () => setStep({ kind: "edit", index });
  if (!f)
    return (
      <div>
        <BackHead title="フィルター" onBack={list} />
        <EmptyNote>読み込み中…</EmptyNote>
      </div>
    );
  const prop = database.props.find((p) => p.id === f.prop);
  const set = (patch: Partial<typeof f>) => saveView({ ...view, filters: view.filters.map((x, i) => (i === index ? { ...x, ...patch } : x)) });

  if (step.kind === "prop")
    return (
      <ChoiceScreen
        title="項目"
        search="項目を検索"
        items={database.props.map((p) => ({ id: p.id, label: p.name, icon: PROP_TYPES[p.type].icon }))}
        selected={f.prop}
        // 項目を変えたら、条件と値はその項目に合わせて最初から
        onPick={(id) => {
          const type = database.props.find((p) => p.id === id)?.type;
          void set({ prop: id, op: opsFor(type)[0], value: type === "checkbox" ? "true" : "" });
          edit();
        }}
        onBack={edit}
      />
    );
  if (step.kind === "op")
    return (
      <ChoiceScreen
        title="条件"
        items={opsFor(prop?.type).map((o) => ({ id: o, label: FILTER_OPS[o] }))}
        selected={f.op}
        onPick={(op) => {
          void set({ op });
          edit();
        }}
        onBack={edit}
      />
    );

  const needs = f.op !== "empty" && f.op !== "notEmpty";
  return (
    <div>
      <BackHead title="フィルター" onBack={list} />
      <NavRow icon={prop ? PROP_TYPES[prop.type].icon : "tag"} label="項目" value={prop?.name ?? "?"} onClick={() => setStep({ kind: "prop", index })} />
      <NavRow icon="filter" label="条件" value={FILTER_OPS[f.op]} onClick={() => setStep({ kind: "op", index })} />
      {needs && (
        <>
          <SectionHead label="値" />
          <div className="px-1 pb-1">
            <FilterValue prop={prop} value={f.value} onChange={(value) => void set({ value })} members={members} />
          </div>
        </>
      )}
      <MenuDivider />
      <MenuItem
        icon={<Icon name="del" size={16} />}
        danger
        onClick={() => {
          void saveView({ ...view, filters: view.filters.filter((_, i) => i !== index) });
          list();
        }}
      >
        この条件を消す
      </MenuItem>
    </div>
  );
}

// ---- 並び替え ----

const DIRS: Choice<"asc" | "desc">[] = [
  { id: "asc", label: "昇順（小→大・古→新）", icon: "up" },
  { id: "desc", label: "降順（大→小・新→古）", icon: "dn" },
];

/** 並び替えの短い説明 */
export function sortText(database: Database, view: DbView) {
  if (!view.sort) return "並べ替えない";
  return `${database.props.find((p) => p.id === view.sort!.prop)?.name ?? "?"}（${view.sort.dir === "asc" ? "昇順" : "降順"}）`;
}

/** 並び替えの画面：並べる項目と順番。onBack があれば「‹」で戻る（ビューの設定のトップ） */
export function SortScreens({ database, view, onBack }: { database: Database; view: DbView; onBack?: () => void }) {
  const [step, setStep] = useState<"top" | "prop" | "dir">("top");
  const saveView = useSaveView();
  const top = () => setStep("top");
  const sort = view.sort;

  if (step === "prop")
    return (
      <ChoiceScreen
        title="並べる項目"
        items={[{ id: "", label: "並べ替えない（追加した順）", icon: "x" as IconName }, ...database.props.map((p) => ({ id: p.id, label: p.name, icon: PROP_TYPES[p.type].icon }))]}
        selected={sort?.prop ?? ""}
        onPick={(id) => {
          void saveView({ ...view, sort: id ? { prop: id, dir: sort?.dir ?? "asc" } : null });
          top();
        }}
        onBack={top}
      />
    );
  if (step === "dir" && sort)
    return (
      <ChoiceScreen
        title="順番"
        items={DIRS}
        selected={sort.dir}
        onPick={(dir) => {
          void saveView({ ...view, sort: { ...sort, dir } });
          top();
        }}
        onBack={top}
      />
    );
  return (
    <div>
      <Head title="並び替え" onBack={onBack} />
      <NavRow icon="sort" label="並べる項目" value={sort ? (database.props.find((p) => p.id === sort.prop)?.name ?? "?") : "並べ替えない"} onClick={() => setStep("prop")} />
      {sort && <NavRow icon={sort.dir === "asc" ? "up" : "dn"} label="順番" value={DIRS.find((d) => d.id === sort.dir)?.label} onClick={() => setStep("dir")} />}
    </div>
  );
}

// ---- ビューの設定 ----

/** ビューの形ごとの設定1つ（グループ・ゲージ・期限など）。none を付けると「なし」なども選べる */
type Opt = { key: string; label: string; icon: IconName; value: string | undefined; items: Choice<string>[]; none?: string; note?: string; set: (v: string | undefined) => void };

type Screen = "top" | "layout" | "props" | "addProp" | "filters" | "sort" | "source" | `opt:${string}`;

/**
 * オールビューのブロック（Notion のリンクされたビュー）で使うとき。ビューはブロックが持つので、
 * 複製・削除はブロックの中で行い、どのデータベースを出すか（ソース）を一番下で選べる
 */
export type BlockViewSource = {
  databases: Database[];
  onPickDb: (dbId: string) => void;
  onDuplicate: () => void;
  /** ビューが1つだけのときは消せない */
  onDelete?: () => void;
  /** ウィンドウの中：高さは区画で決まるので、サイズは出さない */
  inWindow?: boolean;
  /** タイトルの行（ビューの名前・タブ・データベース）を出していない */
  hideHead?: boolean;
  onHideHead?: (hide: boolean) => void;
};

/**
 * ビューの設定（Notion の「⋯」と同じ）：トップから、レイアウト・プロパティの表示/非表示・フィルター・並び替えに進む。
 * ビューの形ごとの設定（グループ・ゲージ・期限など）は、レイアウトの画面の下に出す。
 * 変更はその場で反映する（保存ボタンは無い）
 */
export function ViewSettingsMenu({
  database,
  view,
  members,
  canDelete = false,
  onSwitch,
  onClose,
  block,
}: {
  database: Database;
  view: DbView;
  members: MemberWithProfile[];
  canDelete?: boolean;
  onSwitch?: (viewId: string) => void;
  onClose: () => void;
  /** オールビューのブロックから開いたとき（ビューの複製・削除はブロックの中。ソースを選べる） */
  block?: BlockViewSource;
}) {
  const [screen, setScreen] = useState<Screen>("top");
  const saveView = useSaveView();
  const top = () => setScreen("top");
  const set = (patch: Partial<DbView>) => saveView({ ...view, ...patch });
  const setOpt = (patch: Partial<DbView["options"]>) => saveView({ ...view, options: { ...view.options, ...patch } });

  // チャットの項目も選べる（はじめは非表示）
  const listable = database.props.filter((p) => p.type !== "title");
  const shown = visibleProps(database, view);
  const hasProps = view.type === "table" || view.type === "board" || view.type === "list" || view.type === "gallery";
  const sortable = view.type !== "summary" && view.type !== "calendar";
  const pick = (list: { id: string; name: string; type: keyof typeof PROP_TYPES }[]): Choice<string>[] => list.map((p) => ({ id: p.id, label: p.name, icon: PROP_TYPES[p.type].icon }));
  const of = (...types: string[]) => database.props.filter((p) => types.includes(p.type));
  const nums = of("number");
  const stageProps = of("stage");
  const gaugeProps = [...stageProps, ...nums];
  const dates = of("date");
  const groups = of("select", "status");
  const medias = of("media");
  const request = database.kind === "request";

  // ビューの形ごとの設定
  const stageOpt: Opt = {
    key: "stage",
    label: "工程の期限を出す",
    icon: "timeline",
    value: view.options.stage,
    items: pick(stageProps),
    none: "出さない",
    note: stageProps.length ? undefined : "「工程」の項目を作ると、開始〜終わりの間に工程の期限を％の位置で出せます",
    set: (stage) => setOpt({ stage, stages: !!stage }),
  };
  // オールビューのブロックの高さ（小・中・大で、見える件数が決まる）
  const sizeOpt: Opt = {
    key: "size",
    label: "サイズ",
    icon: "expand",
    value: view.options.size,
    // カレンダーは日付を減らさず、1日のマスに出す件数が変わる
    items:
      view.type === "calendar"
        ? [
            { id: "s", label: "小", note: "1日に1件まで" },
            { id: "m", label: "中", note: "1日に2件まで" },
            { id: "l", label: "大", note: "1日に4件まで" },
          ]
        : view.type === "timeline"
          ? [
              { id: "s", label: "小", note: "低め。帯が5本ほど" },
              { id: "m", label: "中", note: "帯が11本ほど" },
              { id: "l", label: "大", note: "高め。帯が19本ほど" },
            ]
          : [
              { id: "s", label: "小", note: "低め。リストなら3件ほど" },
              { id: "m", label: "中", note: "リストなら6件ほど" },
              { id: "l", label: "大", note: "高め。リストなら10件ほど" },
            ],
    none: view.type === "calendar" ? "自動（その日の分を全部出す）" : "自動（中身に合わせる）",
    note:
      view.type === "calendar"
        ? "入りきらない日は、その日の「▼」からポップアップで見られます"
        : "入りきらない分は、下の「▼ すべて見る」からポップアップで見られます",
    set: (size) => setOpt({ size: size as DbView["options"]["size"] }),
  };
  const typeOpts: Opt[] =
    view.type === "board"
      ? [{ key: "group", label: "グループ（列に分ける項目）", icon: "board", value: view.options.group ?? groups[0]?.id, items: pick(groups), set: (group) => setOpt({ group }) }]
      : view.type === "list"
        ? [
            { key: "gauge", label: "ゲージ", icon: "chart", value: view.options.gauge, items: pick(gaugeProps), none: "なし", set: (gauge) => setOpt({ gauge }) },
            { key: "date", label: "期限", icon: "calendar", value: view.options.date, items: pick(dates), none: "なし", set: (date) => setOpt({ date }) },
          ]
        : view.type === "gallery"
          ? [{ key: "cover", label: "表紙の画像", icon: "img", value: view.options.cover ?? medias[0]?.id, items: pick(medias), set: (cover) => setOpt({ cover }) }]
          : view.type === "table"
            ? [
                {
                  key: "layout",
                  label: "テーブルの向き",
                  icon: "table",
                  value: view.options.layout ?? "horizontal",
                  items: [
                    { id: "horizontal", label: "横一列", note: "ふつうの表。項目が横に並ぶ" },
                    { id: "vertical", label: "縦一列", note: "項目が縦、ページが横に並ぶ（行と列を入れ替えた表）" },
                  ],
                  set: (layout) => setOpt({ layout: layout as DbView["options"]["layout"] }),
                },
              ]
            : view.type === "progress"
              ? [
                  { key: "gauge", label: "進み具合に使う項目", icon: "chart", value: view.options.gauge, items: pick(gaugeProps), none: "自動（工程か％の項目）", set: (gauge) => setOpt({ gauge }) },
                  {
                    key: "gaugeStyle",
                    label: "ゲージの形",
                    icon: "status",
                    value: view.options.gaugeStyle ?? "line",
                    items: [
                      { id: "line", label: "ラインゲージ" },
                      { id: "circle", label: "サークルゲージ" },
                    ],
                    set: (gaugeStyle) => setOpt({ gaugeStyle: gaugeStyle as DbView["options"]["gaugeStyle"] }),
                  },
                ]
              : view.type === "calendar"
                ? [
                    {
                      key: "range",
                      label: "表示の期間",
                      icon: "calendar",
                      value: view.options.calendarRange ?? "month",
                      items: [
                        { id: "day", label: "デイリー（1日）", note: "1日の予定を大きく並べる。‹ › で前の日・次の日へ" },
                        { id: "week", label: "ウィークリー（1週間）", note: "1週間を大きく並べる。予定が多い週に見やすい" },
                        { id: "month", label: "マンスリー（1か月）", note: "1か月を1枚に並べる" },
                        { id: "year", label: "イヤリー（1年）", note: "12か月を小さく並べる。予定のある日に色が付き、押すとその日の予定が出る" },
                      ],
                      set: (range) => setOpt({ calendarRange: range as DbView["options"]["calendarRange"] }),
                    },
                    stageOpt,
                    { key: "date", label: "出す日付", icon: "calendar", value: view.options.date, items: pick(dates), none: request ? "なし" : "1つ目の日付", set: (date) => setOpt({ date }) },
                  ]
                : view.type === "timeline"
                  ? [
                      stageOpt,
                      { key: "start", label: "開始の日付", icon: "calendar", value: view.options.start, items: pick(dates), none: request ? "依頼開始日" : "1つ目の日付", set: (start) => setOpt({ start }) },
                      { key: "end", label: "終わりの日付", icon: "calendar", value: view.options.end, items: pick(dates), none: request ? "納期" : "2つ目の日付", set: (end) => setOpt({ end }) },
                    ]
                  : view.type === "summary"
                    ? [
                        { key: "sum", label: "合計する数値", icon: "hash", value: view.options.sum, items: pick(nums), none: "なし", set: (sum) => setOpt({ sum }) },
                        { key: "date", label: "月ごとに分ける日付", icon: "calendar", value: view.options.date, items: pick(dates), none: "なし", set: (date) => setOpt({ date }) },
                      ]
                    : [];
  const opts: Opt[] = [...(block && !block.inWindow ? [sizeOpt] : []), ...typeOpts];
  const optItems = (o: Opt): Choice<string>[] => [...(o.none !== undefined ? [{ id: "", label: o.none }] : []), ...o.items];
  const optValue = (o: Opt) => optItems(o).find((x) => x.id === (o.value ?? ""))?.label ?? "選んでいません";

  if (screen === "layout")
    return (
      // レイアウトは四角を並べて選ぶ。選んだレイアウトの詳しい設定は、その下に出す（Notion と同じ）
      <div>
        <BackHead title="レイアウト" onBack={top} />
        <div className="grid grid-cols-3 gap-1.5 px-1 pb-1">
          {(Object.keys(VIEW_TYPES) as ViewType[]).map((t) => (
            <button
              key={t}
              title={VIEW_TYPES[t].note}
              aria-pressed={view.type === t}
              onClick={() => void set({ type: t, options: { ...view.options, ...(t === "calendar" || t === "timeline" ? { stages: view.options.stages ?? true } : {}) } })}
              className={`grid justify-items-center gap-1 rounded-[10px] border px-1 py-2 text-xs ${view.type === t ? "border-accent bg-tint font-bold" : "border-line hover:bg-tint"}`}
            >
              <Icon name={VIEW_TYPES[t].icon} size={20} />
              {VIEW_TYPES[t].label}
            </button>
          ))}
        </div>
        <p className="px-2 pb-1 text-xs text-muted">{VIEW_TYPES[view.type].note}</p>
        {(opts.length > 0 || block?.onHideHead) && (
          <>
            <MenuDivider />
            <SectionHead label={`${VIEW_TYPES[view.type].label}の設定`} />
            {/* オールビュー：タイトルの行を隠して、縦の場所をビューに使う */}
            {block?.onHideHead && (
              <ToggleRow
                icon="text"
                label="タイトルを非表示"
                note="ビューの名前・タブ・データベースの行を出さない。歯車は、カーソルを合わせると右上に出ます"
                on={!!block.hideHead}
                onChange={block.onHideHead}
              />
            )}
            {opts.map((o) => (
              <Fragment key={o.key}>
                <NavRow icon={o.icon} label={o.label} value={optValue(o)} onClick={() => setScreen(`opt:${o.key}`)} />
                {/* カレンダー：表示の期間のすぐ下に、切り替えボタンを出すかどうか */}
                {o.key === "range" && (
                  <ToggleRow
                    icon="calendar"
                    label="切り替えボタンを追加する"
                    note="右上に「日・週・月・年」のボタンを出して、編集モードでなくても切り替えられるようにする（切り替えはその場だけ）"
                    on={!!view.options.calendarSwitch}
                    onChange={(on) => setOpt({ calendarSwitch: on || undefined })}
                  />
                )}
              </Fragment>
            ))}
          </>
        )}
      </div>
    );
  if (screen === "props") return <PropVisibilityScreen all={listable} shown={shown} onSave={(ids) => void setVisible(view, ids, saveView)} onBack={top} onAdd={() => setScreen("addProp")} />;
  if (screen === "addProp")
    return (
      <div>
        <BackHead title="項目を追加" onBack={() => setScreen("props")} />
        {/* 足した項目は、このビューにも出す */}
        <AddPropertyMenu database={database} view={{ ...view, options: { ...view.options, visible: shown.map((s) => s.id) } }} onDone={() => setScreen("props")} />
      </div>
    );
  if (screen === "source" && block)
    return (
      <ChoiceScreen
        title="ソース"
        section="データベースを選ぶ"
        items={block.databases.map((d) => ({ id: d.id, label: d.name, icon: "db" as const, emoji: d.icon }))}
        selected={database.id}
        onPick={(id) => {
          if (id !== database.id) block.onPickDb(id);
          top();
        }}
        onBack={top}
      />
    );
  if (screen === "filters") return <FilterScreens database={database} view={view} members={members} start={{ kind: "list" }} onExit={top} />;
  if (screen === "sort") return <SortScreens database={database} view={view} onBack={top} />;
  const opt = screen.startsWith("opt:") ? opts.find((o) => `opt:${o.key}` === screen) : undefined;
  if (opt)
    return (
      <ChoiceScreen
        title={opt.label}
        section={opt.note}
        items={optItems(opt)}
        selected={opt.value ?? ""}
        onPick={(id) => {
          void opt.set(id || undefined);
          setScreen("layout");
        }}
        onBack={() => setScreen("layout")}
      />
    );

  return (
    <div>
      <MenuTitle>{block ? "オールビューの設定" : "ビューの設定"}</MenuTitle>
      {/* key：ビューを選び直したら、名前の欄も入れ直す */}
      <TextField key={view.id} label="ビューの名前" defaultValue={view.name} onChange={(v) => v.trim() && void set({ name: v.trim() })} />
      <MenuDivider />
      <NavRow icon={VIEW_TYPES[view.type].icon} label="レイアウト" value={VIEW_TYPES[view.type].label} onClick={() => setScreen("layout")} />
      {hasProps && <NavRow icon="eye" label="プロパティの表示/非表示" value={`${shown.length}個を表示`} onClick={() => setScreen("props")} />}
      <NavRow icon="filter" label="フィルター" value={view.filters.length ? `${view.filters.length}件` : "なし"} onClick={() => setScreen("filters")} />
      {sortable && <NavRow icon="sort" label="並び替え" value={sortText(database, view)} onClick={() => setScreen("sort")} />}
      {/* オールビューのブロック：どのデータベースを出すかは一番下（シングルビューと同じ） */}
      {block && <NavRow icon="db" label="ソース" value={database.name} onClick={() => setScreen("source")} />}
      <MenuDivider />
      <MenuItem
        icon={<Icon name="copy" size={16} />}
        onClick={async () => {
          if (block) {
            block.onDuplicate();
            onClose();
            return;
          }
          const copy = await duplicateView(view);
          onClose();
          onSwitch?.(copy.id);
        }}
      >
        ビューを複製
      </MenuItem>
      {block?.onDelete && (
        <MenuItem
          icon={<Icon name="del" size={16} />}
          danger
          onClick={async () => {
            if (!(await confirmAction(`ビュー「${view.name}」を削除します`, "削除", "このブロックのビューだけが消えます。データベースとページはそのままです。"))) return;
            block.onDelete?.();
            onClose();
          }}
        >
          ビューを削除
        </MenuItem>
      )}
      {!block && canDelete && (
        <MenuItem
          icon={<Icon name="del" size={16} />}
          danger
          onClick={async () => {
            if (!(await confirmAction(`ビュー「${view.name}」を削除します`, "削除", "中のページは消えません。"))) return;
            await deleteView(view.id);
            onClose();
          }}
        >
          ビューを削除
        </MenuItem>
      )}
    </div>
  );
}
