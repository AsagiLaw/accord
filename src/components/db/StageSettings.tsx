"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { MenuItem, Popover, usePopover } from "@/components/ui/Popover";
import { Select } from "@/components/ui/Select";
import type { Database, Property, StageStep } from "@/lib/local/db";
import { updateProperty } from "@/lib/local/requests";
import { withPct } from "@/lib/requests/stages";
import { Tag, colorOf } from "./meta";
import { isDateLike } from "@/lib/requests/formula";

/**
 * 工程の設定：どの選択の項目（プランなど）で切り替えるかと、選択肢ごとの工程の名前と割合。
 * 割合は合計がいくつでもよく、全体のうちの分で％になる（下書き 1・清書 4 なら 20%・80%）。
 * 進み具合はその工程までの合計の％。ここで選んだ開始日〜終了日（日付の項目）のその位置が期限になる。
 */
export function StageSettings({ database, prop, onClose }: { database: Database; prop: Property; onClose: () => void }) {
  const choices = database.props.filter((p) => p.type === "select" || p.type === "status");
  // 開始日・終了日に選べるのは、日付の項目と日付を出す数式
  const dates = database.props.filter((p) => isDateLike(database, p));
  const [basedOn, setBasedOn] = useState<string>(prop.basedOn ?? "");
  const [start, setStart] = useState<string>(prop.start ?? "");
  const [end, setEnd] = useState<string>(prop.end ?? "");
  const [stages, setStages] = useState<Record<string, StageStep[]>>(() => structuredClone(prop.stages ?? {}));
  const base = choices.find((p) => p.id === basedOn);
  const keys = base ? (base.options ?? []) : [""];
  const listOf = (k: string) => stages[k] ?? [];
  const set = (k: string, list: StageStep[]) => setStages({ ...stages, [k]: list });

  // 「⋮⋮」のドラッグで並べ替える（プロパティの表示/非表示と同じ）。k は選択肢、from は動かす工程、to は落とす位置（何番目の前か）
  const sections = useRef<Record<string, HTMLDivElement | null>>({});
  const dragRef = useRef<{ k: string; from: number; to: number } | null>(null);
  const [drag, setDrag] = useState<{ k: string; from: number; to: number } | null>(null);
  const putDrag = (d: { k: string; from: number; to: number } | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const indexAt = (k: string, y: number) =>
    [...(sections.current[k]?.querySelectorAll<HTMLElement>("[data-stage-row]") ?? [])].filter((r) => {
      const b = r.getBoundingClientRect();
      return b.top + b.height / 2 < y;
    }).length;
  const drop = () => {
    const d = dragRef.current;
    putDrag(null);
    if (!d) return;
    const to = d.to > d.from ? d.to - 1 : d.to;
    if (to === d.from) return;
    const next = [...listOf(d.k)];
    const [moved] = next.splice(d.from, 1);
    next.splice(to, 0, moved);
    set(d.k, next);
  };

  const save = async () => {
    const cleaned: Record<string, StageStep[]> = {};
    for (const k of keys) {
      cleaned[k] = listOf(k)
        .filter((s) => s.name.trim())
        .map((s) => ({ name: s.name.trim(), weight: Math.max(0, Number(s.weight) || 0) }));
    }
    await updateProperty(database.id, prop.id, { basedOn: basedOn || undefined, start: start || undefined, end: end || undefined, stages: cleaned });
    onClose();
  };

  return (
    <div className="sheet-backdrop fixed inset-0 z-[56] flex items-end justify-center bg-black/50 sm:items-center">
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
          <label className="flex items-center gap-2">
            <span className="w-40 shrink-0">工程を切り替える項目</span>
            <Select
              value={basedOn}
              onChange={setBasedOn}
              label="工程を切り替える項目"
              size="lg"
              options={[{ value: "", label: "切り替えない（工程は1通り）" }, ...choices.map((p) => ({ value: p.id, label: p.name }))]}
            />
          </label>
          {(
            [
              ["開始日", start, setStart],
              ["終了日", end, setEnd],
            ] as const
          ).map(([label, value, setValue]) => (
            <label key={label} className="flex items-center gap-2">
              <span className="w-40 shrink-0">{label}</span>
              <Select value={value} onChange={setValue} label={label} size="lg" options={[{ value: "", label: "選択なし" }, ...dates.map((p) => ({ value: p.id, label: p.name }))]} />
            </label>
          ))}
          {!dates.length && <p className="text-muted">日付の項目がまだありません。</p>}
          {base && !(base.options ?? []).length && <p className="text-warn">「{base.name}」に選択肢がまだありません。先に選択肢を作ってください。</p>}

          {keys.map((k) => (
            <section key={k || "__all"} className="rounded-[12px] border border-line p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {base ? <Tag color={colorOf(base, k)}>{k}</Tag> : <b>工程</b>}
                {base && keys.length > 1 && <CopyFrom options={keys.filter((x) => x !== k)} onPick={(x) => set(k, structuredClone(listOf(x)))} />}
              </div>
              <div className="space-y-1.5" ref={(el) => void (sections.current[k] = el)}>
                {listOf(k).length > 0 && (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className="w-4" />
                    <span className="w-5" />
                    <span className="flex-1">工程</span>
                    <span className="w-20">割合</span>
                    <span className="w-24 text-right">この工程の分</span>
                    <span className="w-7" />
                  </div>
                )}
                {withPct(listOf(k)).map((s, i, rows) => (
                  <div key={i} data-stage-row="" className={`relative flex items-center gap-2 ${drag?.k === k && drag.from === i ? "opacity-40" : ""}`}>
                    {/* 落とす位置の線 */}
                    {drag?.k === k && drag.to === i && <span aria-hidden className="absolute inset-x-0 -top-[4px] h-0.5 rounded-full bg-accent" />}
                    {drag?.k === k && drag.to === rows.length && i === rows.length - 1 && <span aria-hidden className="absolute inset-x-0 -bottom-[4px] h-0.5 rounded-full bg-accent" />}
                    <span
                      aria-label={`「${s.name || "無題"}」をドラッグして並べ替え`}
                      title="ドラッグして並べ替え"
                      className="grid h-7 w-4 shrink-0 cursor-grab touch-none place-items-center text-muted active:cursor-grabbing"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        putDrag({ k, from: i, to: i });
                      }}
                      onPointerMove={(e) => {
                        const d = dragRef.current;
                        if (!d || d.k !== k || d.from !== i) return;
                        const to = indexAt(k, e.clientY);
                        if (to !== d.to) putDrag({ ...d, to });
                      }}
                      onPointerUp={drop}
                      onPointerCancel={() => putDrag(null)}
                    >
                      <Icon name="drag" size={14} />
                    </span>
                    <span className="w-5 text-right text-xs text-muted">{i + 1}</span>
                    <input value={s.name} onChange={(e) => set(k, listOf(k).map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="工程の名前" className="field min-w-0 flex-1 py-1" aria-label="工程の名前" />
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={Number.isFinite(s.weight) ? s.weight : ""}
                      onChange={(e) => set(k, listOf(k).map((x, j) => (j === i ? { ...x, weight: e.target.value === "" ? NaN : Number(e.target.value) } : x)))}
                      className="field w-20 py-1"
                      aria-label="割合"
                    />
                    <span className="w-24 text-right text-xs whitespace-nowrap" title={`ここまでで ${s.pct}%`}>
                      <b className="text-sm">{s.share}%</b>
                      <span className="text-muted">（計{s.pct}%）</span>
                    </span>
                    <button aria-label="この工程を消す" onClick={() => set(k, listOf(k).filter((_, j) => j !== i))} className="grid h-7 w-7 shrink-0 place-items-center rounded-full hover:bg-tint">
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                ))}
                <button className="btn-sub min-h-[30px] px-3 text-xs" onClick={() => set(k, [...listOf(k), { name: "", weight: 1 }])}>
                  <Icon name="add" size={14} />
                  工程を追加
                </button>
              </div>
              {listOf(k).length > 0 && (
                <div className="mt-3 flex h-6 overflow-hidden rounded-[6px] border border-line text-[11px]" aria-hidden>
                  {withPct(listOf(k)).map((s, i) =>
                    s.share > 0 ? (
                      <span
                        key={i}
                        className={`flex min-w-0 items-center justify-center truncate px-1 ${i % 2 ? "bg-accent/25" : "bg-accent/45"}`}
                        style={{ width: `${s.share}%` }}
                        title={`${s.name || "無題"}：${s.share}%`}
                      >
                        {s.name}
                      </span>
                    ) : null,
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** ほかの選択肢の工程をコピーするボタン。押すと、コピー元の一覧が出る */
function CopyFrom({ options, onPick }: { options: string[]; onPick: (option: string) => void }) {
  const pop = usePopover();
  return (
    <>
      <button type="button" onClick={pop.toggle} aria-expanded={!!pop.anchor} className="btn-sub ml-auto min-h-[30px] gap-1 px-3 text-xs">
        <Icon name="copy" size={14} />
        ほかからコピー
      </button>
      <Popover anchor={pop.anchor} onClose={pop.close} width={200} align="end" label="工程のコピー元">
        {options.map((x) => (
          <MenuItem
            key={x}
            onClick={() => {
              pop.close();
              onPick(x);
            }}
          >
            {x}
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}
