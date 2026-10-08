"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { MenuDivider, MenuItem, MenuLabel } from "@/components/ui/Popover";
import { ChoiceScreen, NavRow } from "@/components/ui/SettingsMenu";
import { useSaveView } from "./viewSave";
import { confirmAction } from "@/components/ui/overlay";
import type { CalcType, Database, DbPage, DbView, Filter, FilterOp, PropType, Property } from "@/lib/local/db";
import { addProperty, canDeleteProp, countPropMessages, deleteProperty, isLocked, saveView, updateProperty } from "@/lib/local/requests";
import { P } from "@/lib/requests/defaults";
import { FILTER_OPS, formatValue, valueOf } from "@/lib/requests/logic";
import type { MemberWithProfile } from "@/lib/local/rooms";
import { PROP_TYPES, PropIcon, Tag, colorOf } from "./meta";

// ---- ビューで表示する項目 ----

/** ビューに出す項目（タイトル以外）。設定が無ければ、ビューの種類ごとの決まった数だけ */
export function visibleProps(database: Database, view: DbView): Property[] {
  // チャットの項目は、はじめは出さない（「プロパティの表示/非表示」で表示にすると、発言の数と最後の発言を出す）
  const all = database.props.filter((p) => p.type !== "title");
  const others = all.filter((p) => p.type !== "chat" && p.type !== "imageChat");
  if (view.options.visible) return view.options.visible.map((id) => all.find((p) => p.id === id)).filter((p): p is Property => !!p);
  if (view.type === "table") return others;
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
];

const ADDABLE: PropType[] = ["text", "number", "date", "select", "multiselect", "status", "stage", "user", "media", "checkbox", "url", "email", "phone", "created", "edited"];

/** テーブルの列の見出しを押したときのメニュー */
export function PropertyMenu({
  database,
  view,
  prop,
  onDone,
  onStageSettings,
}: {
  database: Database;
  view: DbView;
  prop: Property;
  onDone: () => void;
  onStageSettings?: (prop: Property) => void;
}) {
  const [name, setName] = useState(prop.name);
  const save = useSaveView();
  // 種類・表示は、プルダウンではなく中の画面の一覧から選ぶ
  const [screen, setScreen] = useState<"top" | "type" | "format">("top");
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
          setScreen("top");
        }}
        onBack={() => setScreen("top")}
      />
    );
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
          工程の設定（プランごとの工程と％）
        </MenuItem>
      )}
      {prop.type === "number" && (
        <NavRow icon="hash" label="数値の表示" value={NUMBER_FORMATS.find((f) => f.id === (prop.format ?? ""))?.label} onClick={() => setScreen("format")} />
      )}
      {locked && (
        <p className="px-2 pb-1 text-xs text-muted">
          {prop.type === "title"
            ? "タイトルの項目です。"
            : isChat
              ? "チャットの項目です。会話と繋がっているので、種類は変えられません。"
              : "依頼の計算（工程・収入）に使うので、種類の変更と削除はできません。"}
        </p>
      )}
      <MenuDivider />
      <MenuItem icon={<Icon name="up" size={16} />} onClick={() => (save({ ...view, sort: { prop: prop.id, dir: "asc" } }), onDone())}>
        昇順で並べ替え
      </MenuItem>
      <MenuItem icon={<Icon name="dn" size={16} />} onClick={() => (save({ ...view, sort: { prop: prop.id, dir: "desc" } }), onDone())}>
        降順で並べ替え
      </MenuItem>
      <MenuItem
        icon={<Icon name="filter" size={16} />}
        onClick={() => (save({ ...view, filters: [...view.filters, { prop: prop.id, op: opsFor(prop.type)[0], value: "" }] }), onDone())}
      >
        この項目で絞り込む
      </MenuItem>
      {prop.type !== "title" && (
        <MenuItem icon={<Icon name="eyeoff" size={16} />} onClick={() => (setVisible(view, shown.filter((x) => x !== prop.id), save), onDone())}>
          このビューで隠す
        </MenuItem>
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
              const body = isChat ? `すべてのページの「${prop.name}」の会話（発言${said}件）も消えます。元に戻せません。本当に削除しますか？` : "すべてのページから、この項目の値が消えます。";
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
      {[...ADDABLE, "chat" as const, "imageChat" as const].map((t) => (
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
  if (type === "number") return ["none", "count", "filled", "empty", "sum", "avg", "min", "max"];
  if (type === "date") return ["none", "count", "filled", "empty", "min", "max"];
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
