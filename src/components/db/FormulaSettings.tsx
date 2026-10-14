"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { Database, Property } from "@/lib/local/db";
import { updateProperty, useDatabase, usePages } from "@/lib/local/requests";
import { FUNCTIONS, evalFormula, formulaToSimple, simpleToFormula, type SimpleFormula, type SimpleOp } from "@/lib/requests/formula";
import { formatValue } from "@/lib/requests/logic";
import { PropIcon } from "./meta";

/*
 * 数式の項目の設定。「かんたん」は項目と計算を選んで作り、「式」は式を書く（項目や関数は押して入れられる）。
 * どこからでも開けるように、開く項目を覚えておき、ルームの画面に置いた FormulaSettingsHost が出す
 */

let open: { dbId: string; propId: string } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

/** 数式の設定を開く（項目のメニュー・項目を足したとき） */
export function openFormulaSettings(dbId: string, propId: string) {
  open = { dbId, propId };
  emit();
}
const close = () => {
  open = null;
  emit();
};

/** ルームの画面に1つ置く */
export function FormulaSettingsHost() {
  const cur = useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    () => open,
    () => null,
  );
  return cur ? <FormulaDialog key={`${cur.dbId}:${cur.propId}`} dbId={cur.dbId} propId={cur.propId} /> : null;
}

function FormulaDialog({ dbId, propId }: { dbId: string; propId: string }) {
  const database = useDatabase(dbId);
  const prop = database?.props.find((p) => p.id === propId);
  if (database === undefined) return null;
  if (!database || !prop) return null;
  return <FormulaEditor database={database} prop={prop} />;
}

const OPS: { id: SimpleOp; label: string }[] = [
  { id: "+", label: "＋ 足す" },
  { id: "-", label: "− 引く" },
  { id: "*", label: "× かける" },
  { id: "/", label: "÷ 割る" },
  { id: "days", label: "日数の差（B − A）" },
];

const FORMATS = [
  { id: "", label: "数値（1,234）" },
  { id: "yen", label: "円（¥1,234）" },
  { id: "percent", label: "パーセント（12%）" },
  { id: "plain", label: "区切りなし（1234）" },
];

function FormulaEditor({ database, prop }: { database: Database; prop: Property }) {
  const pages = usePages(database.id) ?? [];
  const [text, setText] = useState(prop.formula ?? "");
  const startSimple = formulaToSimple(prop.formula ?? "");
  const [tab, setTab] = useState<"simple" | "text">(!prop.formula || startSimple ? "simple" : "text");
  // かんたんで使える項目（数・日付・ほかの数式）。A の最初はいちばん上の数値の項目
  const usable = database.props.filter((p) => p.id !== prop.id && (p.type === "number" || p.type === "date" || p.type === "created" || p.type === "edited" || p.type === "formula"));
  const [simple, setSimple] = useState<SimpleFormula>(startSimple ?? { a: usable[0]?.name ?? "", op: "*", b: { kind: "num", value: "1" } });
  const [format, setFormat] = useState(prop.format ?? "");
  const [notice, setNotice] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  const formula = tab === "simple" ? simpleToFormula(simple) : text;
  // 試しの計算：いちばん上のページで計算してみる
  const sample = pages[0];
  const result = sample ? evalFormula(database, sample, { ...prop, formula }) : null;

  /** 式の今の位置に文字を入れる */
  const insert = (s: string, back = 0) => {
    const el = area.current;
    const at = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    const next = text.slice(0, at) + s + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = at + s.length - back;
      el?.setSelectionRange(pos, pos);
    });
  };
  const toTab = (t: "simple" | "text") => {
    setNotice("");
    if (t === tab) return;
    if (t === "text") setText(simpleToFormula(simple));
    else {
      const s = text.trim() ? formulaToSimple(text) : simple;
      if (!s) return setNotice("この式は「かんたん」では作れません");
      setSimple(s);
    }
    setTab(t);
  };
  const save = async () => {
    await updateProperty(database.id, prop.id, { formula: formula.trim(), format: (format || undefined) as Property["format"] });
    close();
  };

  const select = "field py-1";
  return (
    <div className="fixed inset-0 z-[56] flex items-end justify-center bg-black/50 sm:items-center" onClick={(e) => e.target === e.currentTarget && close()} data-overlay="">
      <div role="dialog" aria-modal="true" aria-label="数式の設定" data-name="数式の設定ダイアログ" className="flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-[20px] border border-line bg-card sm:rounded-[14px]">
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h3 className="font-bold">数式の設定（{prop.name}）</h3>
          <div className="flex gap-2">
            <button className="btn-sub" onClick={close}>
              キャンセル
            </button>
            <button className="btn" onClick={save}>
              保存
            </button>
          </div>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {/* かんたん・式の切り替え */}
          <div className="flex w-fit gap-0.5 rounded-[10px] border border-line p-0.5" role="tablist">
            {(
              [
                ["simple", "かんたん"],
                ["text", "式"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => toTab(id)} className={`rounded-[8px] px-4 py-1 ${tab === id ? "bg-tint font-bold" : "text-muted hover:bg-tint/60"}`}>
                {label}
              </button>
            ))}
          </div>
          {notice && <p className="text-warn">{notice}</p>}

          {tab === "simple" ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <select value={simple.a} onChange={(e) => setSimple({ ...simple, a: e.target.value })} className={select} aria-label="A">
                {!usable.some((p) => p.name === simple.a) && <option value={simple.a}>{simple.a || "項目を選ぶ"}</option>}
                {usable.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select value={simple.op} onChange={(e) => setSimple({ ...simple, op: e.target.value as SimpleOp })} className={select} aria-label="計算">
                {OPS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <div className="flex gap-1.5">
                <select
                  value={simple.b.kind === "prop" ? `p:${simple.b.name}` : simple.b.kind}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSimple({ ...simple, b: v === "num" ? { kind: "num", value: simple.b.kind === "num" ? simple.b.value : "1" } : v === "today" ? { kind: "today" } : { kind: "prop", name: v.slice(2) } });
                  }}
                  className={select}
                  aria-label="B"
                >
                  <option value="num">数を入れる</option>
                  <option value="today">今日</option>
                  {usable.map((p) => (
                    <option key={p.id} value={`p:${p.name}`}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {simple.b.kind === "num" && (
                  <input type="number" step="any" value={simple.b.value} onChange={(e) => setSimple({ ...simple, b: { kind: "num", value: e.target.value } })} className="field w-24 py-1" aria-label="数" />
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                ref={area}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                spellCheck={false}
                placeholder="{依頼料} * 0.78"
                className="field w-full font-mono"
                aria-label="式"
              />
              <div>
                <p className="mb-1 text-xs text-muted">項目</p>
                <div className="flex flex-wrap gap-1">
                  {database.props
                    .filter((p) => p.id !== prop.id && p.type !== "chat" && p.type !== "imageChat" && p.type !== "page")
                    .map((p) => (
                      <button key={p.id} onClick={() => insert(`{${p.name}}`)} className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs hover:bg-tint">
                        <PropIcon type={p.type} size={12} />
                        {p.name}
                      </button>
                    ))}
                </div>
              </div>
              {/* 関数は「条件・数・文字・日付」に分けて並べる（中身の説明は、カーソルを合わせると出る） */}
              {(["条件", "数", "文字", "日付"] as const).map((g) => (
                <div key={g}>
                  <p className="mb-1 text-xs text-muted">{g}</p>
                  <div className="flex flex-wrap gap-1">
                    {FUNCTIONS.filter((f) => f.group === g).map((f) => (
                      <button
                        key={f.en}
                        title={`${f.ja}(${f.args})：${f.note}（${f.en}() でも可）`}
                        onClick={() => insert(`${f.ja}()`, 1)}
                        className="rounded-full border border-line px-2 py-0.5 font-mono text-xs hover:bg-tint"
                      >
                        {f.ja}()
                      </button>
                    ))}
                    {g === "条件" &&
                      ["+", "-", "*", "/", ">", "<", "=="].map((o) => (
                        <button key={o} onClick={() => insert(` ${o} `)} className="w-8 rounded-full border border-line py-0.5 font-mono text-xs hover:bg-tint">
                          {o}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <label className="flex items-center gap-2">
            <span className="w-24 shrink-0">数の表示</span>
            <select value={format} onChange={(e) => setFormat(e.target.value)} className={select}>
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          {/* 試しの計算 */}
          <div className="rounded-[10px] bg-tint px-3 py-2" data-name="数式の結果">
            <p className="text-xs text-muted">{sample ? `結果（${sample.title || "無題"}）` : "結果"}</p>
            {!sample ? (
              <p className="text-muted">ページがまだありません</p>
            ) : result?.error ? (
              <p className="text-warn">{result.error}</p>
            ) : (
              <p className="font-bold">{result && result.value !== null && result.value !== "" ? formatValue({ ...prop, type: "formula", format: (format || undefined) as Property["format"] }, result.value) || "（空）" : "（空）"}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
