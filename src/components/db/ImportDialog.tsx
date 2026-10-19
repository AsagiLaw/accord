"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { toast } from "@/components/ui/overlay";
import { Select } from "@/components/ui/Select";
import type { Database } from "@/lib/local/db";
import { addOption, createPage, newPageDefaults } from "@/lib/local/requests";
import { convertCell, guessProp, parseCsv } from "@/lib/requests/csv";
import { DONE } from "@/lib/requests/defaults";
import { formatValue } from "@/lib/requests/logic";

/** Notion のステータスの英語表記を、こちらの選択肢に寄せる */
const STATUS_WORDS: Record<string, string> = { done: DONE, complete: DONE, completed: DONE, 完了: DONE, 納品済み: DONE };

/**
 * Notion から書き出した CSV を取り込む。
 * 列ごとにどの項目に入れるかを選び（名前から自動で推測）、確認してから追加する。
 */
export function ImportDialog({ database, userId, onClose }: { database: Database; userId: string; onClose: () => void }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [map, setMap] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const headers = rows?.[0] ?? [];
  const body = rows?.slice(1) ?? [];
  const titleCol = map.indexOf("title");

  const load = async (file: File) => {
    setError("");
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) return setError("中身のある CSV を選んでください（1行目は列の名前、2行目からデータ）");
    setRows(parsed);
    const used = new Set<string>();
    setMap(
      parsed[0].map((h) => {
        const id = guessProp(h, database.props);
        if (!id || used.has(id)) return "";
        used.add(id);
        return id;
      }),
    );
  };

  /** 1行を、項目ごとの値にする */
  const convert = (row: string[]) => {
    const values: Record<string, unknown> = {};
    map.forEach((propId, col) => {
      const prop = database.props.find((p) => p.id === propId);
      if (!prop || prop.type === "title") return;
      let v = convertCell(prop, row[col] ?? "");
      if (prop.type === "status" && typeof v === "string") v = STATUS_WORDS[v.toLowerCase()] ?? v;
      if (v !== undefined) values[propId] = v;
    });
    return values;
  };

  const run = async () => {
    setBusy(true);
    // 知らない選択肢は、先に選択肢として足しておく
    for (const propId of map) {
      const prop = database.props.find((p) => p.id === propId);
      if (!prop || (prop.type !== "select" && prop.type !== "status" && prop.type !== "multiselect")) continue;
      const seen = new Set(body.flatMap((r) => {
        const v = convert(r)[propId];
        return Array.isArray(v) ? v : v ? [String(v)] : [];
      }));
      for (const o of seen) if (!(prop.options ?? []).includes(o)) await addOption(database.id, propId, o);
    }
    let n = 0;
    for (const row of body) {
      const title = row[titleCol]?.trim();
      if (!title) continue;
      await createPage(database, userId, title, { ...newPageDefaults(database, userId), ...convert(row) });
      n++;
    }
    setBusy(false);
    toast(`${n}件を取り込みました`);
    onClose();
  };

  return (
    <div className="sheet-backdrop fixed inset-0 z-[55] flex items-end justify-center bg-black/50 sm:items-center">
      <div role="dialog" aria-modal="true" aria-label="Notion から取り込む" className="flex max-h-[92dvh] w-full max-w-3xl flex-col rounded-t-[20px] border border-line bg-card sm:rounded-[14px]">
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h3 className="font-bold">Notion から取り込む</h3>
          <div className="flex gap-2">
            <button className="btn-sub" onClick={onClose}>
              キャンセル
            </button>
            <button className="btn" disabled={!rows || titleCol < 0 || busy} onClick={run}>
              {busy ? "取り込み中…" : rows ? `${body.filter((r) => r[titleCol]?.trim()).length}件を取り込む` : "取り込む"}
            </button>
          </div>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <label
            className="btn-sub cursor-pointer"
            title={[
              "1. Notion で依頼のデータベースを開き、右上の「…」→「エクスポート」→ 形式「Markdown と CSV」で書き出す",
              "2. 届いた zip を開き、中の CSV ファイルをここで選ぶ",
              "3. 列ごとに、どの項目に入れるかを確認する（名前から自動で選んであります）",
            ].join("\n")}
          >
            <Icon name="upload" />
            CSV ファイルを選ぶ
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) load(f);
              }}
            />
          </label>
          {error && <p className="text-sm text-warn">{error}</p>}

          {rows && (
            <>
              <section>
                <h4 className="mb-1 text-sm font-bold">列の対応</h4>
                {titleCol < 0 && <p className="mb-2 text-sm text-warn">「{database.props.find((p) => p.type === "title")?.name}」に入れる列を選んでください（必須）</p>}
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {headers.map((h, col) => (
                    <label key={col} className="flex items-center gap-2 text-sm">
                      <span className="w-32 shrink-0 truncate" title={h}>
                        {h || `（${col + 1}列目）`}
                      </span>
                      <Icon name="r" size={14} className="shrink-0 text-muted" />
                      <Select
                        value={map[col] ?? ""}
                        onChange={(v) => setMap(map.map((x, k) => (k === col ? v : x === v && v ? "" : x)))}
                        label={`「${h || `${col + 1}列目`}」を入れる項目`}
                        size="lg"
                        className="min-w-0 flex-1"
                        options={[
                          { value: "", label: "取り込まない" },
                          ...database.props.filter((p) => p.type !== "media" && p.type !== "user").map((p) => ({ value: p.id, label: p.name })),
                        ]}
                      />
                    </label>
                  ))}
                </div>
              </section>
              <section>
                <h4 className="mb-1 text-sm font-bold">取り込み後の見え方（最初の3件）</h4>
                <div className="overflow-x-auto rounded-[10px] border border-line">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-muted">
                        {database.props.map((p) => (
                          <th key={p.id} className="px-2 py-1 font-normal whitespace-nowrap">
                            {p.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {body.slice(0, 3).map((r, i) => {
                        const v = convert(r);
                        return (
                          <tr key={i} className="border-b border-line last:border-0">
                            {database.props.map((p) => (
                              <td key={p.id} className="px-2 py-1 whitespace-nowrap">
                                {p.type === "title" ? (r[titleCol] ?? "") : formatValue(p, v[p.id]) || <span className="text-muted">—</span>}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
