"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import type { Database, DbPage, DbView, Property, PropType, TagColor } from "@/lib/local/db";
import type { MemberWithProfile } from "@/lib/local/rooms";
import { asValueProp } from "@/lib/requests/formula";
import { formatValue, valueOf } from "@/lib/requests/logic";
import { stageOf } from "@/lib/requests/stages";
import { TAG_COLORS, Tag, colorOf } from "../meta";

// ビューのグループ分け（テーブル・リスト・ギャラリー・タイムライン・ボード・グラフで同じ決まり）と、色分け

/** グループ分けに使える項目の種類 */
const GROUPABLE: PropType[] = ["select", "status", "multiselect", "user", "checkbox", "stage"];
export const groupableProps = (database: Pick<Database, "props">) => database.props.filter((p) => GROUPABLE.includes(p.type));

/** 色分けに使える項目（選択肢に色があるもの） */
export const colorableProps = (database: Pick<Database, "props">) => database.props.filter((p) => p.type === "select" || p.type === "status" || p.type === "multiselect");

export type PageGroup = { key: string; label: string; color?: TagColor; pages: DbPage[] };

/** 項目の中の、グループの並び（空は "" で、最後） */
function groupKeys(prop: Property, members: MemberWithProfile[]): string[] {
  switch (prop.type) {
    case "select":
    case "status":
    case "multiselect":
      return [...(prop.options ?? []), ""];
    case "user":
      return [...members.map((m) => m.userId), ""];
    case "checkbox":
      return ["true", "false"];
    case "stage":
      return [...new Set(Object.values(prop.stages ?? {}).flatMap((l) => l.map((s) => s.name))), ""];
    default:
      return [""];
  }
}

/** ページが入るグループ（いくつも選べる項目は、選んだ数だけ入る） */
function keysOf(prop: Property, page: DbPage, known: string[]): string[] {
  const v = valueOf(page, prop.id);
  if (prop.type === "checkbox") return [v ? "true" : "false"];
  if (prop.type === "stage") {
    const name = stageOf(prop, page).current?.name;
    return [name && known.includes(name) ? name : ""];
  }
  const list = Array.isArray(v) ? v.map(String) : v === undefined || v === null || v === "" ? [] : [String(v)];
  const hit = list.filter((x) => known.includes(x) && x !== "");
  return hit.length ? hit : [""];
}

/**
 * ページをグループに分ける。並びは選択肢などの順（ビューで並べ替えていればその順）、空のグループは最後。
 * 「なし」のグループは、ページが無ければ出さない。hideEmptyGroups なら、ページが無いグループも出さない
 */
export function groupPages(prop: Property, pages: DbPage[], view: Pick<DbView, "options">, members: MemberWithProfile[]): PageGroup[] {
  const keys = groupKeys(prop, members);
  const order = view.options.groupOrder ?? [];
  const sorted = [...order.filter((k) => keys.includes(k)), ...keys.filter((k) => !order.includes(k))];
  const map = new Map<string, DbPage[]>(sorted.map((k) => [k, []]));
  for (const p of pages) for (const k of keysOf(prop, p, keys)) map.get(k)?.push(p);
  return sorted
    .map((key) => ({ key, label: groupLabel(prop, key, members), color: prop.type === "select" || prop.type === "status" || prop.type === "multiselect" ? (key ? colorOf(prop, key) : undefined) : undefined, pages: map.get(key) ?? [] }))
    .filter((g) => g.pages.length || (g.key !== "" && !view.options.hideEmptyGroups));
}

/** グループの名前 */
export function groupLabel(prop: Property, key: string, members: MemberWithProfile[]) {
  if (prop.type === "checkbox") return key === "true" ? "チェックあり" : "チェックなし";
  if (key === "") return `${prop.name}なし`;
  if (prop.type === "user") return members.find((m) => m.userId === key)?.displayName ?? "退出した人";
  return key;
}

/** グループ分けの項目（ボードは決めていなければステータスか選択、ほかのビューは決めたときだけ） */
export function groupPropOf(database: Pick<Database, "props">, view: Pick<DbView, "type" | "options">): Property | undefined {
  const chosen = database.props.find((p) => p.id === view.options.group && GROUPABLE.includes(p.type));
  if (chosen || view.type !== "board") return chosen;
  return database.props.find((p) => p.type === "status") ?? database.props.find((p) => p.type === "select");
}

/** グループの合計（groupSum の項目。数の表示の決まりで） */
export function groupSumText(database: Pick<Database, "props">, view: Pick<DbView, "options">, pages: DbPage[]) {
  const prop = database.props.find((p) => p.id === view.options.groupSum);
  if (!prop) return "";
  const total = pages.reduce((a, p) => a + (Number(valueOf(p, prop.id)) || 0), 0);
  return formatValue(asValueProp(database, prop), total);
}

/** グループの見出し（押すとたたむ）。名前・件数・合計 */
export function GroupHead({ group, sum, collapsed, onToggle }: { group: PageGroup; sum: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="flex min-h-8 w-full items-center gap-2 rounded-[8px] px-1 text-left text-sm hover:bg-tint" aria-expanded={!collapsed} data-name={`グループ「${group.label}」`}>
      <Icon name="rt" size={14} className={`shrink-0 text-muted transition-transform ${collapsed ? "" : "rotate-90"}`} />
      {group.color ? <Tag color={group.color}>{group.label}</Tag> : <span className="font-bold">{group.label}</span>}
      <span className="text-xs text-muted">{group.pages.length}件</span>
      {sum && <span className="text-xs text-muted">{sum}</span>}
    </button>
  );
}

/** たたんだグループを覚える（その場だけ） */
export function useCollapsed() {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  return {
    isClosed: (k: string) => closed.has(k),
    toggle: (k: string) =>
      setClosed((cur) => {
        const next = new Set(cur);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      }),
  };
}

/** 色分けの色（選んだ選択肢の色）。色分けしていない・空なら undefined */
export function colorHueOf(database: Pick<Database, "props">, view: Pick<DbView, "options">, page: DbPage): string | undefined {
  const prop = database.props.find((p) => p.id === view.options.colorBy && (p.type === "select" || p.type === "status" || p.type === "multiselect"));
  if (!prop) return undefined;
  const v = valueOf(page, prop.id);
  const key = Array.isArray(v) ? v[0] : v;
  return key ? TAG_COLORS[colorOf(prop, String(key))].hue : undefined;
}

/** 色分けの色で、うすく塗った背景（文字は読めるまま） */
export const tintOf = (hue: string, pct = 16) => `color-mix(in srgb, ${hue} ${pct}%, var(--card))`;
