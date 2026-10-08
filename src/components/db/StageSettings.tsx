"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import type { Database, Property, StageStep } from "@/lib/local/db";
import { updateProperty } from "@/lib/local/requests";
import { Tag, colorOf } from "./meta";

/**
 * 工程の設定：どの選択の項目（プランなど）で切り替えるかと、選択肢ごとの工程の名前と％。
 * ％は「その工程まで終わったときの進み具合」。タイムラインでは開始日〜終了日のその位置が期限になる。
 */
export function StageSettings({ database, prop, onClose }: { database: Database; prop: Property; onClose: () => void }) {
  const choices = database.props.filter((p) => p.type === "select" || p.type === "status");
  const [basedOn, setBasedOn] = useState<string>(prop.basedOn ?? "");
  const [stages, setStages] = useState<Record<string, StageStep[]>>(() => structuredClone(prop.stages ?? {}));
  const base = choices.find((p) => p.id === basedOn);
  const keys = base ? (base.options ?? []) : [""];
  const listOf = (k: string) => stages[k] ?? [];
  const set = (k: string, list: StageStep[]) => setStages({ ...stages, [k]: list });

  const save = async () => {
    const cleaned: Record<string, StageStep[]> = {};
    for (const k of keys) {
      cleaned[k] = listOf(k)
        .filter((s) => s.name.trim())
        .map((s) => ({ name: s.name.trim(), pct: Math.max(0, Math.min(100, Math.round(s.pct))) }))
        .sort((a, b) => a.pct - b.pct);
    }
    await updateProperty(database.id, prop.id, { basedOn: basedOn || undefined, stages: cleaned });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[56] flex items-end justify-center bg-black/50 sm:items-center">
      <div role="dialog" aria-modal="true" aria-label="工程の設定" data-name="工程の設定ダイアログ" className="flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-[20px] border border-line bg-card sm:rounded-[14px]">
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h3 className="font-bold">工程の設定（{prop.name}）</h3>
          <div className="flex gap-2">
            <button className="btn-sub" onClick={onClose}>
              キャンセル
            </button>
            <button className="btn" onClick={save}>
              保存
            </button>
          </div>
        </div>
        <div className="space-y-5 overflow-y-auto px-5 py-4 text-sm">
          <p className="text-muted">
            工程ごとに「その工程まで終わったら何％か」を決めます。ページで工程を選ぶとその％が進み具合になり、タイムラインでは開始日〜終了日のその位置が工程の期限になります。
          </p>
          <label className="flex items-center gap-2">
            <span className="w-40 shrink-0">工程を切り替える項目</span>
            <select value={basedOn} onChange={(e) => setBasedOn(e.target.value)} className="field">
              <option value="">切り替えない（工程は1通り）</option>
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {base && !(base.options ?? []).length && <p className="text-warn">「{base.name}」に選択肢がまだありません。先に選択肢を作ってください。</p>}

          {keys.map((k) => (
            <section key={k || "__all"} className="rounded-[12px] border border-line p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {base ? <Tag color={colorOf(base, k)}>{k}</Tag> : <b>工程</b>}
                {base && keys.length > 1 && (
                  <select
                    value=""
                    onChange={(e) => e.target.value && set(k, structuredClone(listOf(e.target.value)))}
                    className="ml-auto rounded-[8px] border border-line bg-bg px-2 py-0.5 text-xs"
                    aria-label="ほかの選択肢からコピー"
                  >
                    <option value="">ほかからコピー…</option>
                    {keys
                      .filter((x) => x !== k)
                      .map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                  </select>
                )}
              </div>
              <div className="space-y-1.5">
                {listOf(k).map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-5 text-right text-xs text-muted">{i + 1}</span>
                    <input value={s.name} onChange={(e) => set(k, listOf(k).map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="工程の名前" className="field flex-1 py-1" aria-label="工程の名前" />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={s.pct}
                      onChange={(e) => set(k, listOf(k).map((x, j) => (j === i ? { ...x, pct: Number(e.target.value) } : x)))}
                      className="field w-20 py-1"
                      aria-label="％"
                    />
                    <span className="text-muted">%</span>
                    <button aria-label="この工程を消す" onClick={() => set(k, listOf(k).filter((_, j) => j !== i))} className="grid h-7 w-7 place-items-center rounded-full hover:bg-tint">
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                ))}
                <button
                  className="btn-sub min-h-[30px] px-3 text-xs"
                  onClick={() => set(k, [...listOf(k), { name: "", pct: Math.min(100, (listOf(k).at(-1)?.pct ?? 0) + 10) }])}
                >
                  <Icon name="add" size={14} />
                  工程を追加
                </button>
              </div>
              {listOf(k).length > 0 && (
                <div className="relative mt-3 h-6" aria-hidden>
                  <div className="absolute top-2.5 right-0 left-0 h-1 rounded-full bg-line" />
                  {listOf(k).map((s, i) => (
                    <span key={i} className="absolute top-1.5 -translate-x-1/2" style={{ left: `${Math.max(0, Math.min(100, s.pct))}%` }}>
                      <span className="block h-3 w-3 rotate-45 bg-accent" />
                    </span>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
