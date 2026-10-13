"use client";

import { Fragment, useState } from "react";
import { PropVisibilityScreen } from "@/components/blockSettings";
import { Icon, type IconName } from "@/components/Icon";
import { MenuDivider, MenuItem } from "@/components/ui/Popover";
import { BackHead, ChoiceScreen, EmptyNote, MenuTitle, NavRow, SectionHead, TextField, ToggleRow, type Choice } from "@/components/ui/SettingsMenu";
import { confirmAction } from "@/components/ui/overlay";
import type { Database, DbView, Sort, ViewType } from "@/lib/local/db";
import { deleteView, duplicateView } from "@/lib/local/requests";
import type { MemberWithProfile } from "@/lib/local/rooms";
import { FILTER_OPS, sortsOf, withSorts } from "@/lib/requests/logic";
import { AddPropertyMenu, FilterValue, filterLabel, opsFor, setVisible, visibleProps } from "./editors";
import { PROP_TYPES, VIEW_TYPES } from "./meta";
import { useSaveView } from "./viewSave";
import { colorableProps, groupPropOf, groupableProps } from "./views/groups";
import { TIMELINE_SCALES } from "./views/TimelineView";
import { asValueProp, isDateLike, isNumberLike, valueTypeOf } from "@/lib/requests/formula";

// データベースのビューの設定（Notion のビューの設定と同じ形。ブロックの設定とも同じ）。
// 行を押すと中の画面に進み、左上の「‹」で戻る。選ぶものはプルダウンを使わず、一覧から押して選ぶ。
// ツールバーのフィルター・並び替えのボタンからも、同じ画面を使う

/** 中の画面に進む前の見出し：戻る先があれば「‹」付き、なければ設定の見出し */
const Head = ({ title, onBack }: { title: string; onBack?: () => void }) => (onBack ? <BackHead title={title} onBack={onBack} /> : <MenuTitle>{title}</MenuTitle>);

// ---- フィルター ----

export type FilterStep = { kind: "list" } | { kind: "mode" } | { kind: "add" } | { kind: "edit"; index: number } | { kind: "prop"; index: number } | { kind: "op"; index: number };

/** 条件のつなぎ方 */
export const FILTER_MODES: Choice<"and" | "or">[] = [
  { id: "and", label: "すべての条件に合う" },
  { id: "or", label: "どれか1つの条件に合う" },
];

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
        {view.filters.length > 1 && (
          <NavRow icon="filter" label="つなぎ方" value={FILTER_MODES.find((m) => m.id === (view.filterMode ?? "and"))?.label} onClick={() => setStep({ kind: "mode" })} />
        )}
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

  if (step.kind === "mode")
    return (
      <ChoiceScreen
        title="つなぎ方"
        items={FILTER_MODES}
        selected={view.filterMode ?? "and"}
        onPick={(mode) => {
          void saveView({ ...view, filterMode: mode === "or" ? "or" : undefined });
          list();
        }}
        onBack={list}
      />
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
          const type = valueTypeOf(database, p);
          await saveView({ ...view, filters: [...view.filters, { prop: p.id, op: opsFor(type)[0], value: type === "checkbox" ? "true" : "" }] });
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
          const p = database.props.find((x) => x.id === id);
          const type = p && valueTypeOf(database, p);
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
        items={opsFor(prop && valueTypeOf(database, prop)).map((o) => ({ id: o, label: FILTER_OPS[o] }))}
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
            <FilterValue prop={prop && asValueProp(database, prop)} value={f.value} onChange={(value) => void set({ value })} members={members} />
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
  const sorts = sortsOf(view);
  if (!sorts.length) return "並べ替えない";
  const name = (id: string) => database.props.find((p) => p.id === id)?.name ?? "?";
  return sorts.map((x) => `${name(x.prop)}（${x.dir === "asc" ? "昇順" : "降順"}）`).join(" → ");
}

type SortStep = { kind: "top" } | { kind: "add" } | { kind: "edit"; index: number } | { kind: "prop"; index: number } | { kind: "dir"; index: number };

/** 並び替えの画面：並び替えの一覧（上から順に比べる）→ 1つを直す（項目・順番・上下・消す）／足す。onBack があれば「‹」で戻る（ビューの設定のトップ） */
export function SortScreens({ database, view, onBack }: { database: Database; view: DbView; onBack?: () => void }) {
  const [step, setStep] = useState<SortStep>({ kind: "top" });
  const saveView = useSaveView();
  const sorts = sortsOf(view);
  const top = () => setStep({ kind: "top" });
  const put = (next: Sort[]) => saveView(withSorts(view, next));
  const name = (id: string) => database.props.find((p) => p.id === id)?.name ?? "?";
  const propItems = (except: string[]) => database.props.filter((p) => !except.includes(p.id)).map((p) => ({ id: p.id, label: p.name, icon: PROP_TYPES[p.type].icon }));

  if (step.kind === "add")
    return (
      <ChoiceScreen
        title="並び替えを追加"
        search="項目を検索"
        items={propItems(sorts.map((x) => x.prop))}
        selected=""
        onPick={(id) => {
          void put([...sorts, { prop: id, dir: "asc" }]);
          top();
        }}
        onBack={top}
      />
    );
  if (step.kind !== "top") {
    const index = step.index;
    const cur = sorts[index];
    const edit = () => setStep({ kind: "edit", index });
    if (!cur)
      return (
        <div>
          <BackHead title="並び替え" onBack={top} />
          <EmptyNote>読み込み中…</EmptyNote>
        </div>
      );
    const set = (patch: Partial<Sort>) => put(sorts.map((x, i) => (i === index ? { ...x, ...patch } : x)));
    if (step.kind === "prop")
      return (
        <ChoiceScreen
          title="並べる項目"
          search="項目を検索"
          items={propItems(sorts.filter((_, i) => i !== index).map((x) => x.prop))}
          selected={cur.prop}
          onPick={(id) => {
            void set({ prop: id });
            edit();
          }}
          onBack={edit}
        />
      );
    if (step.kind === "dir")
      return (
        <ChoiceScreen
          title="順番"
          items={DIRS}
          selected={cur.dir}
          onPick={(dir) => {
            void set({ dir });
            edit();
          }}
          onBack={edit}
        />
      );
    const move = (d: -1 | 1) => {
      const next = [...sorts];
      [next[index], next[index + d]] = [next[index + d], next[index]];
      void put(next);
      setStep({ kind: "edit", index: index + d });
    };
    return (
      <div>
        <BackHead title={`並び替え ${index + 1}`} onBack={top} />
        <NavRow icon="sort" label="並べる項目" value={name(cur.prop)} onClick={() => setStep({ kind: "prop", index })} />
        <NavRow icon={cur.dir === "asc" ? "up" : "dn"} label="順番" value={DIRS.find((d) => d.id === cur.dir)?.label} onClick={() => setStep({ kind: "dir", index })} />
        {sorts.length > 1 && (
          <>
            <MenuDivider />
            {index > 0 && (
              <MenuItem icon={<Icon name="up" size={16} />} onClick={() => move(-1)}>
                先に比べる
              </MenuItem>
            )}
            {index < sorts.length - 1 && (
              <MenuItem icon={<Icon name="dn" size={16} />} onClick={() => move(1)}>
                後に比べる
              </MenuItem>
            )}
          </>
        )}
        <MenuDivider />
        <MenuItem
          icon={<Icon name="del" size={16} />}
          danger
          onClick={() => {
            void put(sorts.filter((_, i) => i !== index));
            top();
          }}
        >
          この並び替えを消す
        </MenuItem>
      </div>
    );
  }
  return (
    <div>
      <Head title="並び替え" onBack={onBack} />
      {sorts.map((x, i) => (
        <NavRow key={`${x.prop}:${i}`} icon={x.dir === "asc" ? "up" : "dn"} label={`${i + 1}. ${name(x.prop)}`} value={x.dir === "asc" ? "昇順" : "降順"} onClick={() => setStep({ kind: "edit", index: i })} />
      ))}
      {!sorts.length && <EmptyNote>並べ替えない（追加した順）</EmptyNote>}
      <MenuDivider />
      <MenuItem icon={<Icon name="add" size={16} />} onClick={() => setStep({ kind: "add" })}>
        並び替えを追加
      </MenuItem>
      {sorts.length > 0 && (
        <MenuItem icon={<Icon name="x" size={16} />} onClick={() => void put([])}>
          並び替えをやめる
        </MenuItem>
      )}
    </div>
  );
}

// ---- ビューの設定 ----

/** ビューの形ごとの設定1つ（グループ・ゲージ・期限など）。none を付けると「なし」なども選べる */
type ChoiceOpt = { kind?: "choice"; key: string; label: string; icon: IconName; value: string | undefined; items: Choice<string>[]; none?: string; note?: string; set: (v: string | undefined) => void };
/** スイッチ（オン・オフ）と、数を入れる欄 */
type ToggleOpt = { kind: "toggle"; key: string; label: string; icon: IconName; on: boolean; set: (on: boolean) => void };
type NumberOpt = { kind: "number"; key: string; label: string; icon: IconName; value: number | undefined; set: (n: number | undefined) => void };
type Opt = ChoiceOpt | ToggleOpt | NumberOpt;

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
  const hasProps = view.type === "table" || view.type === "board" || view.type === "list" || view.type === "gallery" || (view.type === "timeline" && !!view.options.timelineTable);
  const sortable = view.type !== "summary" && view.type !== "calendar" && view.type !== "workload" && view.type !== "chart";
  const pick = (list: { id: string; name: string; type: keyof typeof PROP_TYPES }[]): Choice<string>[] => list.map((p) => ({ id: p.id, label: p.name, icon: PROP_TYPES[p.type].icon }));
  const of = (...types: string[]) => database.props.filter((p) => types.includes(p.type));
  // 数と日付（数式の項目も、数や日付を出すものなら選べる）
  const nums = database.props.filter((p) => isNumberLike(database, p));
  const stageProps = of("stage");
  const gaugeProps = [...stageProps, ...nums];
  const dates = database.props.filter((p) => isDateLike(database, p));
  const groupables = groupableProps(database);
  const medias = of("media");
  const request = database.kind === "request";

  // ビューの形ごとの設定
  const stageOpt: ChoiceOpt = {
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
  const sizeOpt: ChoiceOpt = {
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
      ? [{ key: "group", label: "グループ（列に分ける項目）", icon: "board", value: groupPropOf(database, view)?.id, items: pick(groupables), set: (group) => setOpt({ group }) }]
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
                    {
                      key: "date",
                      label: "出す日付",
                      icon: "calendar",
                      value: view.options.date,
                      // 日付の項目と工程の項目。工程を選ぶと、工程ごとの期限を出す
                      items: pick([...dates, ...stageProps]),
                      none: request ? "なし" : "1つ目の日付",
                      note: stageProps.length ? "工程の項目を選ぶと、工程ごとの期限を出します（工程の設定の開始日〜終了日を割合で分けた日）" : undefined,
                      set: (date) => setOpt({ date }),
                    },
                  ]
                : view.type === "timeline"
                  ? [
                      {
                        ...stageOpt,
                        label: "工程の期間を表示する",
                        none: "表示しない",
                        note: stageProps.length
                          ? "選んだ工程の、工程の設定の開始日〜終了日を帯にして、工程の割合で分けて出します"
                          : "「工程」の項目を作ると、工程の期間を割合で分けて出せます",
                      },
                      {
                        key: "scale",
                        label: "幅",
                        icon: "timeline",
                        value: view.options.timelineScale ?? "month",
                        note: "はじめに出す幅。タイムラインの右上のドロップダウンで、その場だけ切り替えられます",
                        items: TIMELINE_SCALES.map((s) => ({ id: s.id, label: s.label })),
                        set: (scale) => setOpt({ timelineScale: scale as DbView["options"]["timelineScale"] }),
                      },
                      { key: "start", label: "開始の日付", icon: "calendar", value: view.options.start, items: pick(dates), none: request ? "依頼開始日" : "1つ目の日付", set: (start) => setOpt({ start }) },
                      { key: "end", label: "終わりの日付", icon: "calendar", value: view.options.end, items: pick(dates), none: request ? "納期" : "2つ目の日付", set: (end) => setOpt({ end }) },
                    ]
                  : view.type === "summary"
                    ? [
                        { key: "sum", label: "合計する数値", icon: "hash", value: view.options.sum, items: pick(nums), none: "なし", set: (sum) => setOpt({ sum }) },
                        { key: "date", label: "月ごとに分ける日付", icon: "calendar", value: view.options.date, items: pick(dates), none: "なし", set: (date) => setOpt({ date }) },
                        { key: "split", label: "項目ごとに分ける", icon: "list", value: view.options.split, items: pick(groupables), none: "分けない", set: (split) => setOpt({ split }) },
                        ...(view.options.date
                          ? [
                              {
                                key: "period",
                                label: "期間",
                                icon: "calendar" as const,
                                value: view.options.period ?? "all",
                                items: [
                                  { id: "all", label: "すべて" },
                                  { id: "year", label: "今年" },
                                  { id: "last12", label: "直近12か月" },
                                ],
                                set: (period: string | undefined) => setOpt({ period: period === "all" ? undefined : (period as DbView["options"]["period"]) }),
                              },
                              { kind: "toggle" as const, key: "compare", label: "去年と比べる", icon: "chart" as const, on: !!view.options.compare, set: (on: boolean) => setOpt({ compare: on || undefined }) },
                            ]
                          : []),
                      ]
                    : view.type === "workload"
                      ? [
                          { key: "start", label: "開始の日付", icon: "calendar", value: view.options.start, items: pick(dates), none: request ? "依頼開始日" : "1つ目の日付", set: (start) => setOpt({ start }) },
                          { key: "end", label: "終わりの日付", icon: "calendar", value: view.options.end, items: pick(dates), none: request ? "納期" : "2つ目の日付", set: (end) => setOpt({ end }) },
                          {
                            key: "workUnit",
                            label: "期間の単位",
                            icon: "calendar",
                            value: view.options.workUnit ?? "week",
                            items: [
                              { id: "week", label: "週ごと" },
                              { id: "month", label: "月ごと" },
                            ],
                            set: (u) => setOpt({ workUnit: u === "month" ? "month" : undefined }),
                          },
                          { key: "sum", label: "数えるもの", icon: "hash", value: view.options.sum, items: pick(nums), none: "件数", set: (sum) => setOpt({ sum }) },
                          { kind: "number", key: "limit", label: "1期間の上限", icon: "flag", value: view.options.limit, set: (limit) => setOpt({ limit: limit && limit > 0 ? limit : undefined }) },
                          { kind: "toggle", key: "includeDone", label: "終わったページも数える", icon: "check", on: !!view.options.includeDone, set: (on) => setOpt({ includeDone: on || undefined }) },
                        ]
                      : view.type === "chart"
                        ? [
                            {
                              key: "chartType",
                              label: "グラフの形",
                              icon: "pie",
                              value: view.options.chartType ?? "bar",
                              items: [
                                { id: "bar", label: "棒", icon: "chart" },
                                { id: "donut", label: "ドーナツ", icon: "pie" },
                                { id: "line", label: "折れ線（月ごとの推移）", icon: "timeline" },
                              ],
                              set: (t) => setOpt({ chartType: t === "bar" ? undefined : (t as DbView["options"]["chartType"]) }),
                            },
                            view.options.chartType === "line"
                              ? { key: "date", label: "月ごとに分ける日付", icon: "calendar", value: view.options.date, items: pick(dates), none: "なし", set: (date) => setOpt({ date }) }
                              : {
                                  key: "group",
                                  label: "分ける項目",
                                  icon: "list",
                                  value: view.options.group ?? groupables.find((p) => p.type === "status" || p.type === "select")?.id,
                                  items: pick(groupables),
                                  set: (group) => setOpt({ group }),
                                },
                            { key: "sum", label: "数えるもの", icon: "hash", value: view.options.sum, items: pick(nums), none: "件数", set: (sum) => setOpt({ sum }) },
                          ]
                        : [];
  // グループ分け（テーブル・リスト・ギャラリー・タイムライン。ボードは列の項目）と、グループごとの合計・空のグループを隠す
  const grouped = !!groupPropOf(database, view);
  const groupOpts = (choose: boolean): Opt[] => [
    ...(choose ? [{ key: "group", label: "グループ分け", icon: "list" as const, value: view.options.group, items: pick(groupables), none: "分けない", set: (group: string | undefined) => setOpt({ group }) }] : []),
    ...(grouped
      ? [
          { key: "groupSum", label: "グループごとの合計", icon: "hash" as const, value: view.options.groupSum, items: pick(nums), none: "なし", set: (groupSum: string | undefined) => setOpt({ groupSum }) },
          { kind: "toggle" as const, key: "hideEmptyGroups", label: "ページの無いグループを隠す", icon: "eyeoff" as const, on: !!view.options.hideEmptyGroups, set: (on: boolean) => setOpt({ hideEmptyGroups: on || undefined }) },
        ]
      : []),
  ];
  const colorOpt: Opt = { key: "colorBy", label: "色分け", icon: "palette", value: view.options.colorBy, items: pick(colorableProps(database)), none: "しない", set: (colorBy) => setOpt({ colorBy }) };
  const openOpt: Opt = {
    key: "openAs",
    label: "ページの開き方",
    icon: "open",
    value: view.options.openAs ?? "peek",
    items: [
      { id: "peek", label: "真ん中に重ねる", icon: "window" },
      { id: "side", label: "右から出す", icon: "sidePanel" },
      { id: "page", label: "ページの画面で開く", icon: "open" },
    ],
    set: (v) => setOpt({ openAs: v === "peek" ? undefined : (v as DbView["options"]["openAs"]) }),
  };
  const moreOpts: Opt[] =
    view.type === "table"
      ? [
          { kind: "toggle", key: "wrap", label: "文章を右端で折り返す", icon: "text", on: !!view.options.wrap, set: (on) => setOpt({ wrap: on || undefined }) },
          ...(view.options.layout === "vertical" ? [] : groupOpts(true)),
          colorOpt,
          openOpt,
        ]
      : view.type === "board"
        ? [...groupOpts(false), { key: "cover", label: "カードの表紙", icon: "img", value: view.options.cover, items: pick(medias), none: "なし", set: (cover) => setOpt({ cover }) }, colorOpt, openOpt]
        : view.type === "list"
          ? [...groupOpts(true), colorOpt, openOpt]
          : view.type === "gallery"
            ? [
                {
                  key: "cardSize",
                  label: "カードの大きさ",
                  icon: "gallery",
                  value: view.options.cardSize ?? "m",
                  items: [
                    { id: "s", label: "小" },
                    { id: "m", label: "中" },
                    { id: "l", label: "大" },
                  ],
                  set: (v) => setOpt({ cardSize: v === "m" ? undefined : (v as DbView["options"]["cardSize"]) }),
                },
                {
                  key: "imageFit",
                  label: "画像の収め方",
                  icon: "crop",
                  value: view.options.imageFit ?? "cover",
                  items: [
                    { id: "cover", label: "切り抜いて並べる" },
                    { id: "contain", label: "全体を見せる" },
                  ],
                  set: (v) => setOpt({ imageFit: v === "contain" ? "contain" : undefined }),
                },
                ...groupOpts(true),
                colorOpt,
                openOpt,
              ]
            : view.type === "progress"
              ? [openOpt]
              : view.type === "calendar"
                ? [
                    {
                      key: "weekStart",
                      label: "週の始まり",
                      icon: "calendar",
                      value: String(view.options.weekStart ?? 0),
                      items: [
                        { id: "0", label: "日曜" },
                        { id: "1", label: "月曜" },
                      ],
                      set: (v) => setOpt({ weekStart: v === "1" ? 1 : undefined }),
                    },
                    { kind: "toggle", key: "hideWeekends", label: "土日を隠す", icon: "eyeoff", on: !!view.options.hideWeekends, set: (on) => setOpt({ hideWeekends: on || undefined }) },
                    colorOpt,
                    openOpt,
                  ]
                : view.type === "timeline"
                  ? [
                      { kind: "toggle", key: "timelineTable", label: "左に表を出す", icon: "table", on: !!view.options.timelineTable, set: (on) => setOpt({ timelineTable: on || undefined }) },
                      ...groupOpts(true),
                      colorOpt,
                      openOpt,
                    ]
                  : view.type === "workload"
                    ? [openOpt]
                    : [];
  const opts: Opt[] = [...(block && !block.inWindow ? [sizeOpt] : []), ...typeOpts, ...moreOpts];
  const isChoice = (o: Opt): o is ChoiceOpt => o.kind === undefined || o.kind === "choice";
  const optItems = (o: ChoiceOpt): Choice<string>[] => [...(o.none !== undefined ? [{ id: "", label: o.none }] : []), ...o.items];
  const optValue = (o: ChoiceOpt) => optItems(o).find((x) => x.id === (o.value ?? ""))?.label ?? "選んでいません";

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
                {o.kind === "toggle" ? (
                  <ToggleRow icon={o.icon} label={o.label} on={o.on} onChange={o.set} />
                ) : o.kind === "number" ? (
                  <label className="flex min-h-[34px] items-center gap-2 rounded-[8px] px-2">
                    <span className="grid w-5 shrink-0 place-items-center text-muted">
                      <Icon name={o.icon} size={16} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    <input
                      key={`${view.id}:${o.value ?? ""}`}
                      type="number"
                      min={0}
                      step="any"
                      defaultValue={o.value ?? ""}
                      placeholder="なし"
                      onBlur={(e) => o.set(e.target.value === "" ? undefined : Number(e.target.value))}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      className="field w-20 py-1"
                      aria-label={o.label}
                    />
                  </label>
                ) : (
                  <NavRow icon={o.icon} label={o.label} value={optValue(o)} onClick={() => setScreen(`opt:${o.key}`)} />
                )}
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
                {/* カレンダー：設定のいちばん下に、予定の文章を右端で折り返すかどうか */}
                {view.type === "calendar" && o.key === "date" && (
                  <ToggleRow
                    icon="text"
                    label="文章を右端で折り返す"
                    note="予定の名前が長いとき、…で切らずに、マスの右端で折り返して全部出す"
                    on={!!view.options.calendarWrap}
                    onChange={(on) => setOpt({ calendarWrap: on || undefined })}
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
  const opt = screen.startsWith("opt:") ? opts.filter(isChoice).find((o) => `opt:${o.key}` === screen) : undefined;
  if (opt)
    return (
      <ChoiceScreen
        title={opt.label}
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
      {/* ビューの固定：固定中は、並び替え・フィルター・列の幅などを変えられない（ページの中身は変えられる） */}
      <ToggleRow icon="lock" label="ビューを固定" on={!!view.options.locked} onChange={(on) => setOpt({ locked: on || undefined })} />
      {!view.options.locked && (
        <>
      {/* key：ビューを選び直したら、名前の欄も入れ直す */}
      <TextField key={view.id} label="ビューの名前" defaultValue={view.name} onChange={(v) => v.trim() && void set({ name: v.trim() })} />
      <MenuDivider />
      <NavRow icon={VIEW_TYPES[view.type].icon} label="レイアウト" value={VIEW_TYPES[view.type].label} onClick={() => setScreen("layout")} />
      {hasProps && <NavRow icon="eye" label="プロパティの表示/非表示" value={`${shown.length}個を表示`} onClick={() => setScreen("props")} />}
      <NavRow icon="filter" label="フィルター" value={view.filters.length ? `${view.filters.length}件` : "なし"} onClick={() => setScreen("filters")} />
      {sortable && <NavRow icon="sort" label="並び替え" value={sortText(database, view)} onClick={() => setScreen("sort")} />}
      {/* オールビューのブロック：どのデータベースを出すかは一番下（シングルビューと同じ） */}
      {block && <NavRow icon="db" label="ソース" value={database.name} onClick={() => setScreen("source")} />}
        </>
      )}
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
