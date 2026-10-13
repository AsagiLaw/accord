import type { Database, Property, StatusGroup } from "@/lib/local/db";
import { today } from "./logic";

// 項目に付いた設定の決まり：ステータスのグループ・はじめから入る値（通し番号の見せ方は logic.ts の serialText）

export const STATUS_GROUPS: { id: StatusGroup; label: string }[] = [
  { id: "todo", label: "未着手" },
  { id: "doing", label: "進行中" },
  { id: "done", label: "完了" },
];

/** ステータスの選択肢のグループ。決めていなければ名前から（完了・済・キャンセルなどは完了、未着手・未対応などは未着手、ほかは進行中） */
export function statusGroupOf(prop: Pick<Property, "groups">, option: string): StatusGroup {
  const g = prop.groups?.[option];
  if (g) return g;
  if (/完了|済|done|キャンセル|中止/i.test(option)) return "done";
  if (/未着手|未対応|未開始|todo|not ?started/i.test(option)) return "todo";
  return "doing";
}

/** はじめから入る値を使える項目の種類 */
export const canHaveDefault = (p: Property) => ["text", "number", "date", "select", "multiselect", "status", "user", "checkbox", "url", "email", "phone"].includes(p.type);

/** 項目のはじめから入る値（作る人・今日を、実際の値にする）。決めていなければ undefined */
export function defaultOf(p: Property, userId?: string): unknown {
  const v = p.defaultValue;
  if (v === undefined || v === null || v === "" || !canHaveDefault(p)) return undefined;
  if (v === "@today") return today();
  if (v === "@me") return userId;
  return v;
}

/** データベースの項目のはじめから入る値を全部 */
export function defaultsOf(database: Pick<Database, "props">, userId?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of database.props) {
    const v = defaultOf(p, userId);
    if (v !== undefined) out[p.id] = v;
  }
  return out;
}
