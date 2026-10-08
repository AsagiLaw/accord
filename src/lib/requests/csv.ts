import type { Property } from "@/lib/local/db";

/** CSV を行と列に分ける（"…" で囲んだ中のカンマ・改行・"" に対応。先頭の BOM は外す） */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Notion の書き出しに出てくる日付を YYYY-MM-DD にする。
 * 例：2026/10/06、2026-10-06、2026年10月6日、October 6, 2026、Oct 6, 2026 10:00 AM。
 * 期間（「→」区切り）は最初の日付を使う。
 */
export function parseDate(raw: string): string | null {
  const s = raw.split("→")[0].trim();
  if (!s) return null;
  let m = s.match(/(\d{4})[/\-.年]\s*(\d{1,2})[/\-.月]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.startsWith(m![1].toLowerCase().slice(0, 3)));
    if (mi >= 0) return `${m[3]}-${pad(mi + 1)}-${pad(+m[2])}`;
  }
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${pad(+m[1])}-${pad(+m[2])}`;
  return null;
}

/** 金額・数値（¥ や , や 円 や % を外す） */
export function parseNumber(raw: string): number | null {
  const s = raw.replace(/[¥￥,，円%\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** CSV の1セルを項目の型に合わせて変換する。使えない値は undefined */
export function convertCell(prop: Property, raw: string): unknown {
  const s = raw.trim();
  if (!s) return undefined;
  switch (prop.type) {
    case "number": {
      const n = parseNumber(s);
      // 進行が 0.5 のように割合で入っているときは % に直す
      if (n !== null && prop.format === "percent" && n > 0 && n <= 1 && s.includes(".")) return Math.round(n * 100);
      return n ?? undefined;
    }
    case "date":
      return parseDate(s) ?? undefined;
    case "multiselect":
      return s
        .split(/[,、]/)
        .map((x) => x.trim())
        .filter(Boolean);
    case "checkbox":
      return /^(yes|true|1|✓|☑|はい|済|完了|on)$/i.test(s);
    case "media":
    case "user":
    case "created":
    case "edited":
      return undefined;
    default:
      return s;
  }
}

/** 列の名前から、どの項目に入れるかを推測する */
export function guessProp(header: string, props: Property[]): string {
  const h = header.trim().toLowerCase();
  const exact = props.find((p) => p.name.toLowerCase() === h);
  if (exact) return exact.id;
  const aliases: Record<string, string[]> = {
    title: ["名前", "name", "タイトル", "title", "依頼者", "クライアント"],
    p_n: ["枚数", "数"],
    p_use: ["用途", "内容"],
    p_recv: ["受付", "依頼日", "作成", "created"],
    p_start: ["開始"],
    p_due: ["納期", "締切", "締め切り", "期限", "due"],
    p_fee: ["料金", "金額", "報酬", "価格", "依頼料"],
    p_win: ["窓口", "経路"],
    p_plan: ["プラン"],
    p_prog: ["進行", "進捗"],
    p_status: ["ステータス", "状態", "status"],
  };
  for (const [id, words] of Object.entries(aliases)) {
    if (props.some((p) => p.id === id) && words.some((w) => h.includes(w))) return id;
  }
  return "";
}
