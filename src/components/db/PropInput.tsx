"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { MediaPicker } from "@/components/MediaPicker";
import { ThumbImage } from "@/components/ThumbImage";
import { Checkbox } from "@/components/ui/Checkbox";
import { DateInput } from "@/components/ui/DateInput";
import { Popover, usePopover } from "@/components/ui/Popover";
import { Select, pickerBox } from "@/components/ui/Select";
import type { Database, DbPage, Property } from "@/lib/local/db";
import type { MemberWithProfile } from "@/lib/local/rooms";
import { formatValue } from "@/lib/requests/logic";
import { SubPageChip, subTargetOf } from "./PageLink";
import { PropValue, SelectEditor, StageEditor } from "./values";

/** データベースの1項目を入力する。選択肢は「追加…」でその場で増やせる */
export function PropInput({
  database,
  prop,
  value,
  onChange,
  members,
  userId,
  id,
  page,
}: {
  database: Database;
  prop: Property;
  value: unknown;
  onChange: (v: unknown) => void;
  members: MemberWithProfile[];
  userId: string;
  id?: string;
  /** 工程の項目で、そのページのプランを知るのに使う */
  page?: Pick<DbPage, "values"> & Partial<Pick<DbPage, "id" | "dbId" | "roomId">>;
}) {
  const [picking, setPicking] = useState(false);

  switch (prop.type) {
    case "chat":
    case "imageChat":
      return <p className="text-xs text-muted">ページの本文に「シングルビュー」を置くと、ここのチャットが出ます</p>;
    case "page":
      return (
        <div>
          <SubPageChip target={subTargetOf(page, prop.id)} name={prop.name} />
        </div>
      );
    case "title":
    case "text":
      return <TextInput id={id} value={String(value ?? "")} onCommit={onChange} required={prop.type === "title"} />;
    case "number":
      return (
        <div className="flex items-center gap-1">
          {prop.format === "yen" && <span className="text-muted">¥</span>}
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={prop.format === "percent" ? 0 : undefined}
            max={prop.format === "percent" ? 100 : undefined}
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
            className="field"
          />
          {prop.format === "percent" && <span className="text-muted">%</span>}
        </div>
      );
    case "date":
      return <DateInput id={id} value={String(value ?? "")} onChange={onChange} label={prop.name} size="lg" clearable />;
    case "select":
    case "status":
    case "multiselect":
      return <SelectField id={id} database={database} prop={prop} value={value} onChange={onChange} />;
    case "stage":
      return <StageField id={id} database={database} prop={prop} value={value} onChange={onChange} page={page} />;
    case "checkbox":
      return <Checkbox id={id} checked={!!value} onChange={onChange} label={prop.name} />;
    case "url":
    case "email":
    case "phone":
      return <TextInput id={id} value={String(value ?? "")} onCommit={onChange} type={prop.type === "url" ? "url" : prop.type === "email" ? "email" : "tel"} />;
    case "created":
    case "edited":
      return <p className="py-2 text-sm text-muted">{value ? String(value).replaceAll("-", "/") : "—"}（自動で入ります）</p>;
    case "formula":
    case "serial":
      return <p className="py-2 text-sm">{formatValue(prop, value) || <span className="text-muted">—</span>}</p>;
    case "user":
      return (
        <Select
          id={id}
          value={String(value ?? "")}
          onChange={onChange}
          label={prop.name}
          size="lg"
          placeholder="退出した人"
          options={[{ value: "", label: "—" }, ...members.map((m) => ({ value: m.userId, label: m.displayName }))]}
        />
      );
    case "media": {
      const ids = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1.5">
          {ids.map((mid) => (
            <div key={mid} className="relative h-14 w-14 overflow-hidden rounded-md">
              <ThumbImage id={mid} alt="" />
              <button
                type="button"
                aria-label="外す"
                onClick={() => onChange(ids.filter((x) => x !== mid))}
                className="absolute top-0.5 right-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white"
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
          <button type="button" className="btn-sub h-14 min-h-0 px-3 text-sm" onClick={() => setPicking(true)}>
            <Icon name="img" />
            メディアから
          </button>
          {picking && (
            <MediaPicker
              roomId={database.roomId}
              userId={userId}
              onClose={() => setPicking(false)}
              onPick={(picked) => {
                onChange([...ids, ...picked.filter((x) => !ids.includes(x))]);
                setPicking(false);
              }}
            />
          )}
        </div>
      );
    }
  }
}

/** 工程の項目：押すとそのプランの工程から選べる */
function StageField({ id, database, prop, value, onChange, page }: { id?: string; database: Database; prop: Property; value: unknown; onChange: (v: unknown) => void; page?: Pick<DbPage, "values"> }) {
  const pop = usePopover();
  const p = page ?? { values: {} };
  return (
    <>
      <button id={id} type="button" onClick={pop.toggle} aria-expanded={!!pop.anchor} className={`${pickerBox("lg")} w-full`}>
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <PropValue prop={prop} value={value} page={p} members={[]} empty={<span className="text-muted">選ぶ</span>} />
        </span>
        <Icon name="dn" size={16} className={`shrink-0 text-muted transition-transform ${pop.anchor ? "rotate-180" : ""}`} />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} label={prop.name}>
          <StageEditor database={database} prop={prop} page={p} onChange={onChange} onDone={pop.close} />
        </Popover>
      )}
    </>
  );
}

/** 選択肢の項目：押すと選択肢の編集が開く */
function SelectField({ id, database, prop, value, onChange }: { id?: string; database: Database; prop: Property; value: unknown; onChange: (v: unknown) => void }) {
  const pop = usePopover();
  return (
    <>
      <button id={id} type="button" onClick={pop.toggle} aria-expanded={!!pop.anchor} className={`${pickerBox("lg")} w-full`}>
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <PropValue prop={prop} value={value} members={[]} empty={<span className="text-muted">選ぶ</span>} />
        </span>
        <Icon name="dn" size={16} className={`shrink-0 text-muted transition-transform ${pop.anchor ? "rotate-180" : ""}`} />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} label={prop.name}>
          <SelectEditor database={database} prop={prop} value={value} onChange={onChange} onDone={pop.close} />
        </Popover>
      )}
    </>
  );
}

/** 入力中は保存せず、確定（フォーカスが外れる・Enter）したときに保存する文字入力 */
function TextInput({ value, onCommit, required, id, type = "text" }: { value: string; onCommit: (v: string) => void; required?: boolean; id?: string; type?: string }) {
  const [draft, setDraft] = useState(value);
  // 入力中にポップオーバーが閉じても、書いた内容を失わないよう最後に保存する
  const latest = useRef({ draft, value, onCommit, required });
  useEffect(() => {
    latest.current = { draft, value, onCommit, required };
  });
  useEffect(
    () => () => {
      const l = latest.current;
      if (l.draft !== l.value && !(l.required && !l.draft.trim())) l.onCommit(l.draft.trim());
    },
    [],
  );
  const [base, setBase] = useState(value);
  // 他の人が書き換えたときは、入力欄も新しい値にそろえる
  if (value !== base) {
    setBase(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft === value || (required && !draft.trim())) return setDraft(value);
    onCommit(draft.trim());
  };
  return (
    <input
      id={id}
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
      }}
      className="field"
    />
  );
}
