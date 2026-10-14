"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { MenuDivider, MenuItem, MenuLabel } from "@/components/ui/Popover";
import { BackHead, ChoiceScreen, NavRow, OptionRow, SectionHead, TextField } from "@/components/ui/SettingsMenu";
import { useSaveView } from "./viewSave";
import { confirmAction } from "@/components/ui/overlay";
import type { CalcType, Database, DbPage, DbView, Filter, FilterOp, PropType, Property } from "@/lib/local/db";
import { addProperty, canDeleteProp, countPropMessages, deleteProperty, isLocked, saveView, updateProperty, useDatabase } from "@/lib/local/requests";
import { P } from "@/lib/requests/defaults";
import { FILTER_OPS, formatValue, serialText, sortsOf, valueOf, withSorts } from "@/lib/requests/logic";
import { canHaveDefault } from "@/lib/requests/props";
import { useMembers, type MemberWithProfile } from "@/lib/local/rooms";
import { openFormulaSettings } from "./FormulaSettings";
import { PROP_TYPES, PropIcon, Tag, colorOf } from "./meta";
import { valueTypeOf } from "@/lib/requests/formula";

// ---- ビューで表示する項目 ----

/** ビューに出す項目（タイトル以外）。設定が無ければ、ビューの種類ごとの決まった数だけ */
export function visibleProps(database: Database, view: DbView): Property[] {
  // チャットの項目は、テーブルでははじめから出す（発言の数と最後の発言）。ボード・リストなどのカードには、はじめは出さない
  const all = database.props.filter((p) => p.type !== "title");
  const others = all.filter((p) => p.type !== "chat" && p.type !== "imageChat");
  if (view.options.visible) return view.options.visible.map((id) => all.find((p) => p.id === id)).filter((p): p is Property => !!p);
  if (view.type === "table") return all;
  if (view.type === "board" || view.type === "gallery") return others.filter((p) => p.type === "select" || p.type === "status" || p.type === "date").slice(0, 3);
  if (view.type === "list" && database.kind !== "request") return others.slice(0, 3);
  // 依頼のリストは、はじめはプランを出す（前は決め打ちで出していた）。ゲージ・期限はリストの設定で出す
  if (view.type === "list") return others.filter((p) => p.id === P.plan);
  return [];
}

/** ビューに出す項目を決める。save は保存する先（ブロックだけのビューならブロックに保存する。useSaveView） */
export function setVisible(view: DbView, ids: string[], save: (view: DbView) => Promise<void> | void = saveView) {
  return save({ ...view, options: { ...view.options, visible: ids } });
}

// ---- フィルター ----

export function opsFor(type: PropType | undefined): FilterOp[] {
  switch (type) {
    case "select":
    case "status":
    case "user":
    case "multiselect":
    case "stage":
      return ["is", "isNot", "empty", "notEmpty"];
    case "checkbox":
      return ["is", "isNot"];
    case "number":
    case "date":
    case "created":
    case "edited":
      return ["gt", "lt", "is", "empty", "notEmpty"];
    case "formula":
      return ["is", "isNot", "contains", "gt", "lt", "empty", "notEmpty"];
    case "serial":
      return ["is", "gt", "lt"];
    default:
      return ["contains", "is", "empty", "notEmpty"];
  }
}

/** フィルターの短い説明（「ステータス：完了 でない」など） */
export function filterLabel(database: Database, f: Filter, members: MemberWithProfile[] = []) {
  const prop = database.props.find((p) => p.id === f.prop);
  const needs = f.op !== "empty" && f.op !== "notEmpty";
  return `${prop?.name ?? "?"}${needs ? `：${valueLabel(prop, f.value, members)}` : ""} ${FILTER_OPS[f.op]}`;
}

/** フィルターの値を、人が読める言葉にする（自分・今日・チェックあり など） */
function valueLabel(prop: Property | undefined, v: string | undefined, members: MemberWithProfile[]) {
  if (!v) return "（未入力）";
  if (v === "@me") return "自分";
  if (v === "@today") return "今日";
  if (prop?.type === "checkbox") return v === "true" ? "チェックあり" : "チェックなし";
  if (prop?.type === "user") return members.find((m) => m.userId === v)?.displayName ?? "退出した人";
  return v;
}

/** 条件の値を選ぶ。項目の種類ごとに選びやすい形にする */
export function FilterValue({ prop, value, onChange, members }: { prop: Property | undefined; value: string | undefined; onChange: (v: string) => void; members: MemberWithProfile[] }) {
  const chip = (v: string, label: React.ReactNode) => (
    <button key={v} onClick={() => onChange(v)} className={`rounded-full border px-2.5 py-0.5 text-xs ${value === v ? "border-accent bg-accent text-accent-ink" : "border-line hover:bg-tint"}`}>
      {label}
    </button>
  );
  if (prop?.type === "checkbox") return <div className="flex gap-1.5">{[chip("true", "チェックあり"), chip("false", "チェックなし")]}</div>;
  if (prop?.type === "user") return <div className="flex flex-wrap gap-1.5">{[chip("@me", "自分"), ...members.map((m) => chip(m.userId, m.displayName))]}</div>;
  if (prop?.type === "stage") {
    const names = [...new Set(Object.values(prop.stages ?? {}).flatMap((l) => l.map((s) => s.name)))];
    return <div className="flex flex-wrap gap-1.5">{names.map((n) => chip(n, n))}</div>;
  }
  if (prop?.options) {
    return (
      <div className="flex flex-wrap gap-1">
        {prop.options.map((o) => (
          <button key={o} onClick={() => onChange(o)} className={`rounded-[8px] p-0.5 ${value === o ? "ring-2 ring-accent" : ""}`}>
            <Tag color={colorOf(prop, o)}>{o}</Tag>
          </button>
        ))}
      </div>
    );
  }
  const dateLike = prop?.type === "date" || prop?.type === "created" || prop?.type === "edited";
  return (
    <div className="flex items-center gap-1.5">
      {dateLike && chip("@today", "今日")}
      <input
        autoFocus
        type={dateLike ? "date" : prop?.type === "number" ? "number" : "text"}
        value={value?.startsWith("@") ? "" : (value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        placeholder="値を入力"
        className="field py-1"
        aria-label="値"
      />
    </div>
  );
}

// フィルターと並び替えを直す画面は ViewSettings.tsx（ビューの設定と、ツールバーのボタンで同じものを使う）

// ---- 項目（列）のメニュー ----

const NUMBER_FORMATS = [
  { id: "", label: "数値（1,234）" },
  { id: "yen", label: "円（¥1,234）" },
  { id: "percent", label: "パーセント（12%）" },
  { id: "plain", label: "区切りなし（1234）" },
];

const ADDABLE: PropType[] = ["text", "number", "date", "select", "multiselect", "status", "stage", "formula", "serial", "user", "media", "checkbox", "url", "email", "phone", "created", "edited"];

const DIGITS = [
  { id: "0", label: "そのまま（1, 12, 123）" },
  { id: "2", label: "2桁（01）" },
  { id: "3", label: "3桁（001）" },
  { id: "4", label: "4桁（0001）" },
];

/** はじめから入る値を、人が読める言葉にする */
function defaultLabel(prop: Property, members: MemberWithProfile[]) {
  const v = prop.defaultValue;
  if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) return "なし";
  if (v === "@me") return "自分";
  if (v === "@today") return "今日";
  if (prop.type === "checkbox") return v ? "チェックあり" : "なし";
  if (prop.type === "user") return members.find((m) => m.userId === v)?.displayName ?? "退出した人";
  if (Array.isArray(v)) return v.join("、");
  return formatValue(prop, v);
}

/** はじめから入る値を決める画面（項目の種類ごとに選びやすい形）。決めたらすぐ保存する */
function DefaultValueScreen({ database, prop, onBack }: { database: Database; prop: Property; onBack: () => void }) {
  const members = useMembers(database.roomId) ?? [];
  const set = (v: unknown) => updateProperty(database.id, prop.id, { defaultValue: v === "" || (Array.isArray(v) && !v.length) ? undefined : v });
  const cur = prop.defaultValue;
  const choice = (id: string, label: React.ReactNode, on: boolean, onClick: () => void) => (
    <OptionRow key={id} selected={on} onClick={onClick}>
      {label}
    </OptionRow>
  );
  let body: React.ReactNode;
  if (prop.type === "select" || prop.type === "status")
    body = [choice("", "なし", cur === undefined, () => void set(undefined)), ...(prop.options ?? []).map((o) => choice(o, <Tag color={colorOf(prop, o)}>{o}</Tag>, cur === o, () => void set(o)))];
  else if (prop.type === "multiselect") {
    const list = Array.isArray(cur) ? (cur as string[]) : [];
    body = (prop.options ?? []).map((o) => choice(o, <Tag color={colorOf(prop, o)}>{o}</Tag>, list.includes(o), () => void set(list.includes(o) ? list.filter((x) => x !== o) : [...list, o])));
  } else if (prop.type === "user")
    body = [choice("", "なし", cur === undefined, () => void set(undefined)), choice("@me", "自分（作った人）", cur === "@me", () => void set("@me")), ...members.map((m) => choice(m.userId, m.displayName, cur === m.userId, () => void set(m.userId)))];
  else if (prop.type === "checkbox") body = [choice("", "なし", !cur, () => void set(undefined)), choice("on", "チェックあり", !!cur, () => void set(true))];
  else if (prop.type === "date")
    body = (
      <>
        {choice("", "なし", cur === undefined, () => void set(undefined))}
        {choice("@today", "今日（作った日）", cur === "@today", () => void set("@today"))}
        <div className="px-2 py-1">
          <input type="date" value={typeof cur === "string" && cur !== "@today" ? cur : ""} onChange={(e) => void set(e.target.value)} className="field py-1" aria-label="決まった日付" />
        </div>
      </>
    );
  else
    body = (
      <div className="px-1 pb-1">
        <input
          autoFocus
          type={prop.type === "number" ? "number" : "text"}
          defaultValue={cur === undefined ? "" : String(cur)}
          onBlur={(e) => void set(prop.type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (e.target as HTMLInputElement).blur()}
          placeholder="なし"
          className="field py-1"
          aria-label="はじめから入る値"
        />
      </div>
    );
  return (
    <div>
      <BackHead title="はじめの値" onBack={onBack} />
      {body}
    </div>
  );
}

/** 通し番号の形：頭に付ける文字と桁数 */
function SerialScreen({ database, prop, onBack }: { database: Database; prop: Property; onBack: () => void }) {
  return (
    <div>
      <BackHead title="番号の形" onBack={onBack} />
      <TextField label="頭に付ける文字" defaultValue={prop.prefix ?? ""} placeholder="例：#" onChange={(v) => void updateProperty(database.id, prop.id, { prefix: v || undefined })} />
      <SectionHead label="桁数" />
      {DIGITS.map((d) => (
        <OptionRow key={d.id} selected={String(prop.digits ?? 0) === d.id} onClick={() => void updateProperty(database.id, prop.id, { digits: Number(d.id) || undefined })}>
          {d.label}
        </OptionRow>
      ))}
      <p className="px-2 pt-1 text-xs text-muted">例：{serialText(prop, 12)}</p>
    </div>
  );
}

/** 「ページ」の項目のテンプレート：このデータベースのテンプレートから選ぶか、使わない（空のノート） */
function SubTemplateScreen({ database, prop, onBack }: { database: Database; prop: Property; onBack: () => void }) {
  return (
    <ChoiceScreen
      title="テンプレート"
      section="別ページを作るときのテンプレート"
      items={[
        { id: "", label: "テンプレートを使わない", icon: "x" as const, note: "空のノート" },
        ...(database.templates ?? []).map((t) => ({ id: t.id, label: t.name, icon: t.kind === "window" ? ("window" as const) : ("note" as const), emoji: t.icon, note: t.kind === "window" ? "ウィンドウ型（テンプレートと繋ぐ）" : "ノート型（中身をコピーして書ける）" })),
      ]}
      selected={prop.templateId ?? ""}
      onPick={(id) => {
        void updateProperty(database.id, prop.id, { templateId: id || undefined });
        onBack();
      }}
      onBack={onBack}
    />
  );
}

/** 「ページ」の項目のテンプレートの短い説明 */
const subTemplateText = (database: Database, prop: Property) =>
  prop.templateId ? (database.templates?.find((t) => t.id === prop.templateId)?.name ?? "見つかりません") : "使わない";

/** テーブルの列の見出しを押したときのメニュー */
export function PropertyMenu({
  database: givenDb,
  view,
  prop: givenProp,
  onDone,
  onStageSettings,
}: {
  database: Database;
  view: DbView;
  prop: Property;
  onDone: () => void;
  onStageSettings?: (prop: Property) => void;
}) {
  // 開いている間に設定を変えたら、すぐ出るように、いつも保存されている最新の項目を使う（渡された項目は開いたときのもの）
  const database = useDatabase(givenDb.id) ?? givenDb;
  const prop = database.props.find((p) => p.id === givenProp.id) ?? givenProp;
  const [name, setName] = useState(prop.name);
  const save = useSaveView();
  // 種類・表示は、プルダウンではなく中の画面の一覧から選ぶ
  const [screen, setScreen] = useState<"top" | "type" | "format" | "serial" | "default" | "subTemplate">("top");
  const members = useMembers(database.roomId) ?? [];
  const locked = isLocked(database, prop.id);
  const isChat = prop.type === "chat" || prop.type === "imageChat";
  const saveName = () => name.trim() && name.trim() !== prop.name && updateProperty(database.id, prop.id, { name: name.trim() });
  const shown = visibleProps(database, view).map((p) => p.id);

  if (screen === "type")
    return (
      <ChoiceScreen
        title="種類"
        items={ADDABLE.map((t) => ({ id: t, label: PROP_TYPES[t].label, icon: PROP_TYPES[t].icon, note: PROP_TYPES[t].note }))}
        selected={prop.type}
        onPick={(t) => {
          void updateProperty(database.id, prop.id, { type: t, options: prop.options ?? [] });
          // 数式にしたら、そのまま式の設定を開く
          if (t === "formula") return (onDone(), openFormulaSettings(database.id, prop.id));
          setScreen("top");
        }}
        onBack={() => setScreen("top")}
      />
    );
  if (screen === "serial") return <SerialScreen database={database} prop={prop} onBack={() => setScreen("top")} />;
  if (screen === "subTemplate") return <SubTemplateScreen database={database} prop={prop} onBack={() => setScreen("top")} />;
  if (screen === "default") return <DefaultValueScreen database={database} prop={prop} onBack={() => setScreen("top")} />;
  if (screen === "format")
    return (
      <ChoiceScreen
        title="数値の表示"
        items={NUMBER_FORMATS}
        selected={prop.format ?? ""}
        onPick={(f) => {
          void updateProperty(database.id, prop.id, { format: (f || undefined) as Property["format"] });
          setScreen("top");
        }}
        onBack={() => setScreen("top")}
      />
    );

  return (
    <div>
      <div className="flex items-center gap-1.5 p-1">
        <PropIcon type={prop.type} size={16} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (saveName(), onDone())}
          className="field py-1"
          aria-label="項目の名前"
        />
      </div>
      {!locked && prop.type !== "title" && <NavRow icon={PROP_TYPES[prop.type].icon} label="種類" value={PROP_TYPES[prop.type].label} onClick={() => setScreen("type")} />}
      {prop.type === "stage" && onStageSettings && (
        <MenuItem icon={<Icon name="timeline" size={16} />} onClick={() => (onStageSettings(prop), onDone())}>
          工程の設定（プランごとの工程と割合）
        </MenuItem>
      )}
      {prop.type === "formula" && (
        <MenuItem icon={<Icon name="formula" size={16} />} onClick={() => (onDone(), openFormulaSettings(database.id, prop.id))} right={<span className="max-w-32 truncate font-mono text-xs text-muted">{prop.formula}</span>}>
          式の設定
        </MenuItem>
      )}
      {prop.type === "number" && (
        <NavRow icon="hash" label="数値の表示" value={NUMBER_FORMATS.find((f) => f.id === (prop.format ?? ""))?.label} onClick={() => setScreen("format")} />
      )}
      {prop.type === "serial" && <NavRow icon="hash" label="番号の形" value={serialText(prop, 1)} onClick={() => setScreen("serial")} />}
      {prop.type === "page" && (
        <>
          <NavRow icon="note" label="テンプレート" value={subTemplateText(database, prop)} onClick={() => setScreen("subTemplate")} />
          <p className="px-2 pb-1 text-xs text-muted">別ページは、はじめて開いたときにこのテンプレートで作ります（作った別ページは、テンプレートを変えても変わりません）</p>
        </>
      )}
      {canHaveDefault(prop) && <NavRow icon="add" label="はじめの値" value={defaultLabel(prop, members)} onClick={() => setScreen("default")} />}
      {locked && (
        <p className="px-2 pb-1 text-xs text-muted">
          {prop.type === "title"
            ? "タイトルの項目です。"
            : isChat
              ? "チャットの項目です。会話と繋がっているので、種類は変えられません。"
              : prop.type === "page"
                ? "ページの項目です。別ページと繋がっているので、種類は変えられません。"
                : "依頼の計算（工程・収入）に使うので、種類の変更と削除はできません。"}
        </p>
      )}
      <MenuDivider />
      {/* 並べ替え・絞り込み・隠すは、このビューを変える操作。固定したビューでは出さない */}
      {!view.options.locked && (
        <>
        {/* 並べ替え：この項目をいちばん先に比べる（ほかの並び替えはその後に残す） */}
        {(["asc", "desc"] as const).map((dir) => (
          <MenuItem
            key={dir}
            icon={<Icon name={dir === "asc" ? "up" : "dn"} size={16} />}
            onClick={() => (save(withSorts(view, [{ prop: prop.id, dir }, ...sortsOf(view).filter((x) => x.prop !== prop.id)])), onDone())}
          >
            {dir === "asc" ? "昇順で並べ替え" : "降順で並べ替え"}
          </MenuItem>
        ))}
        <MenuItem
          icon={<Icon name="filter" size={16} />}
          onClick={() => (save({ ...view, filters: [...view.filters, { prop: prop.id, op: opsFor(valueTypeOf(database, prop))[0], value: valueTypeOf(database, prop) === "checkbox" ? "true" : "" }] }), onDone())}
        >
          この項目で絞り込む
        </MenuItem>
        {prop.type !== "title" && (
          <MenuItem icon={<Icon name="eyeoff" size={16} />} onClick={() => (setVisible(view, shown.filter((x) => x !== prop.id), save), onDone())}>
            このビューで隠す
          </MenuItem>
        )}
        </>
      )}
      {canDeleteProp(database, prop.id) && (
        <>
          <MenuDivider />
          <MenuItem
            icon={<Icon name="del" size={16} />}
            danger
            onClick={async () => {
              // チャットの項目は、発言があれば、数を出して本当に消してよいかを確かめる（発言が1件も無ければ、そのまま消す）
              const said = isChat ? await countPropMessages(database.id, prop.id) : 0;
              const body = isChat
                ? `すべてのページの「${prop.name}」の会話（発言${said}件）も消えます。元に戻せません。本当に削除しますか？`
                : prop.type === "page"
                  ? `すべてのページの「${prop.name}」の別ページ（中身も）が消えます。元に戻せません。本当に削除しますか？`
                  : "すべてのページから、この項目の値が消えます。";
              if ((!isChat || said > 0) && !(await confirmAction(`項目「${prop.name}」を削除します`, "削除", body))) return;
              await deleteProperty(database.id, prop.id);
              onDone();
            }}
          >
            項目を削除
          </MenuItem>
        </>
      )}
    </div>
  );
}

/** 「＋」から項目を足す。足した項目は、このビューにも表示する */
export function AddPropertyMenu({ database, view, onDone }: { database: Database; view: DbView; onDone: () => void }) {
  const [name, setName] = useState("");
  const save = useSaveView();
  return (
    <div>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="項目の名前" className="field mb-1 py-1" aria-label="項目の名前" />
      <MenuLabel>種類を選ぶと追加されます</MenuLabel>
      {[...ADDABLE, "chat" as const, "imageChat" as const, "page" as const].map((t) => (
        <MenuItem
          key={t}
          icon={<PropIcon type={t} size={16} />}
          // 説明は右に短く（長いと種類の名前が隠れるので、はみ出す分は「…」）
          right={<span className="max-w-[55%] shrink-0 truncate text-xs text-muted">{PROP_TYPES[t].note}</span>}
          onClick={async () => {
            const prop = await addProperty(database.id, name.trim() || PROP_TYPES[t].label, t);
            // ここから足した項目は、このビューにも出す（チャットの項目も、表に列で出る）
            await setVisible(view, [...visibleProps(database, view).map((p) => p.id), prop.id], save);
            onDone();
            // 数式は、足したらすぐ式の設定を開く
            if (t === "formula") openFormulaSettings(database.id, prop.id);
          }}
        >
          {PROP_TYPES[t].label}
        </MenuItem>
      ))}
    </div>
  );
}

// ---- 列の集計 ----

export const CALCS: Record<CalcType, string> = {
  none: "計算しない",
  count: "すべての件数",
  filled: "入力済みの件数",
  empty: "空の件数",
  sum: "合計",
  avg: "平均",
  min: "最小",
  max: "最大",
};

/** チェックボックスは「入力済み」を「チェック済み」と呼ぶ */
export function calcLabel(prop: Property, t: CalcType) {
  if (prop.type === "checkbox" && t === "filled") return "チェック済み";
  if (prop.type === "checkbox" && t === "empty") return "未チェック";
  return CALCS[t];
}

export function calcsFor(type: PropType): CalcType[] {
  if (type === "number" || type === "formula") return ["none", "count", "filled", "empty", "sum", "avg", "min", "max"];
  if (type === "date") return ["none", "count", "filled", "empty", "min", "max"];
  if (type === "serial") return ["none", "count", "min", "max"];
  return ["none", "count", "filled", "empty"];
}

export function calculate(prop: Property, pages: DbPage[], calc: CalcType): string {
  const vals = pages.map((p) => valueOf(p, prop.id));
  const filled = vals.filter((v) => (prop.type === "checkbox" ? !!v : !(v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length))));
  const nums = filled.map(Number).filter((n) => Number.isFinite(n));
  switch (calc) {
    case "none":
      return "";
    case "count":
      return `${pages.length}件`;
    case "filled":
      return `${filled.length}件`;
    case "empty":
      return `${pages.length - filled.length}件`;
    case "sum":
      return formatValue(prop, nums.reduce((a, b) => a + b, 0));
    case "avg":
      return nums.length ? formatValue(prop, Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10) : "—";
    case "min":
    case "max": {
      if (prop.type === "date") {
        const ds = filled.map(String).sort();
        return ds.length ? formatValue(prop, calc === "min" ? ds[0] : ds.at(-1)) : "—";
      }
      return nums.length ? formatValue(prop, calc === "min" ? Math.min(...nums) : Math.max(...nums)) : "—";
    }
  }
}
